import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logging/logger'

/**
 * Parent-to-parent referrals (funnel step 1).
 *
 * WHY REFERRALS DESERVE REAL PLUMBING
 *   A referred parent converts at a multiple of a cold one, because the
 *   recommendation arrives pre-trusted and the referrer has already answered the
 *   "is this legit?" question that kills most free-trial signups. For a
 *   category like exam prep - where parents talk to each other constantly in
 *   school groups and never want to be the one who missed something - it is the
 *   highest-quality channel available and the cheapest, because the acquisition
 *   cost is paid in product credit rather than ad spend.
 *
 * THE TWO-SIDED REWARD
 *   Both parties get something. One-sided programs underperform because sharing
 *   a link that only benefits you is socially awkward; a parent does not want to
 *   be seen to be monetising their friends. Giving the referee a benefit turns
 *   the share into a favour, which is a completely different social act.
 *
 * ATTRIBUTION IS WRITE-ONCE
 *   `referrals.referee_user_id` is UNIQUE. A parent who clicks two links is
 *   attributed to the first, permanently. Last-touch would let a campaign code
 *   steal credit from the parent who actually did the recommending, and the
 *   moment referrers notice that, the program is dead.
 */

/**
 * Alphabet with the ambiguous characters removed.
 *
 * Codes get read aloud in school playgrounds and typed into phones. A code
 * containing both `0` and `O`, or `1` and `I`, generates support tickets from
 * people who typed it correctly and were told it was wrong.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8

/** Reward granted to the referrer when the referee becomes a paying customer. */
export const DEFAULT_REFERRER_REWARD_CENTS = 3000
/** Discount the referee receives for arriving via a code. */
export const DEFAULT_REFEREE_DISCOUNT_CENTS = 2000

/** Shape of a stored code. */
export interface ReferralCode {
  code: string
  ownerUserId: string | null
  kind: 'PARENT' | 'CAMPAIGN'
  rewardKind: 'CREDIT_CENTS' | 'FREE_MONTH' | 'NONE'
  rewardValue: number
  refereeOfferId: string | null
  active: boolean
}

/** Aggregate progress shown on the parent's share page. */
export interface ReferralStats {
  code: string
  invited: number
  activated: number
  converted: number
  /** Credit earned so far, in cents. */
  earnedCents: number
  /** Credit still pending a conversion. */
  pendingCents: number
  shareUrl: string
}

type Row = Record<string, unknown>

function isReferralConfigured(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
}

/**
 * Generate an unambiguous code.
 *
 * Uses the Web Crypto API rather than `Math.random()`: codes are identifiers in
 * a table with a reward attached, so a predictable generator would let someone
 * enumerate valid codes and claim rewards that were never shared with them.
 */
export function generateReferralCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH)
  // `crypto` is globally available in Node 19+ and in the edge runtime.
  globalThis.crypto.getRandomValues(bytes)

  let code = ''
  for (const byte of bytes) {
    code += CODE_ALPHABET[byte % CODE_ALPHABET.length]
  }
  return code
}

/**
 * Normalise a code from a URL or a form field.
 *
 * Parents paste codes with stray whitespace, in lower case, and sometimes with
 * the share URL wrapped around them. Normalising here means the lookup succeeds
 * instead of reporting "invalid code" for something that was in fact valid - a
 * failure mode that costs a signup and annoys the referrer.
 */
export function normalizeReferralCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let value = raw.trim().toUpperCase()
  if (!value) return null

  // Tolerate a pasted share URL: take the last path segment or the ?ref= value.
  if (value.includes('/')) {
    try {
      const url = new URL(value.startsWith('http') ? value : `https://x/${value}`)
      value = (url.searchParams.get('ref') ?? url.pathname.split('/').filter(Boolean).pop() ?? '').toUpperCase()
    } catch {
      value = value.split('/').filter(Boolean).pop() ?? value
    }
  }

  // Strip anything outside the alphabet, e.g. a hyphenated display form.
  value = value.replace(/[^A-Z0-9]/g, '')
  if (value.length < 4 || value.length > 16) return null
  return value
}

/** Map a `referral_codes` row onto the public shape. */
function toReferralCode(row: Row): ReferralCode {
  return {
    code: String(row.code),
    ownerUserId: row.owner_user_id ? String(row.owner_user_id) : null,
    kind: row.kind === 'CAMPAIGN' ? 'CAMPAIGN' : 'PARENT',
    rewardKind:
      row.reward_kind === 'FREE_MONTH' || row.reward_kind === 'NONE' ? row.reward_kind : 'CREDIT_CENTS',
    rewardValue: Number(row.reward_value) || 0,
    refereeOfferId: row.referee_offer_id ? String(row.referee_offer_id) : null,
    active: row.active !== false,
  }
}

/**
 * Get or create the calling parent's referral code.
 *
 * Idempotent by design: the share page must render the same code every time, or
 * a parent who has already sent theirs to a school group ends up with a dead
 * link. The UNIQUE(owner_user_id) constraint backs this up at the database
 * level, so a concurrent double-mint cannot produce two codes.
 */
export async function getOrCreateReferralCode(userId: string): Promise<ReferralCode | null> {
  if (!isReferralConfigured() || !userId) return null

  try {
    const admin = createAdminClient()

    const { data: existing } = await admin
      .from('referral_codes')
      .select('*')
      .eq('owner_user_id', userId)
      .maybeSingle()

    if (existing) return toReferralCode(existing as unknown as Row)

    // Retry on collision. With a 31-character alphabet and 8 positions the space
    // is roughly 850 billion, so this loop is a formality - but a PRIMARY KEY
    // conflict surfacing as an error on the share page is a bad way to find out.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateReferralCode()
      const { data: created, error } = await admin
        .from('referral_codes')
        .insert({
          code,
          owner_user_id: userId,
          kind: 'PARENT',
          reward_kind: 'CREDIT_CENTS',
          reward_value: DEFAULT_REFERRER_REWARD_CENTS,
          active: true,
        })
        .select('*')
        .maybeSingle()

      if (!error && created) return toReferralCode(created as unknown as Row)
      // 23505 = unique_violation on `code`; anything else is a real failure.
      if (error && error.code !== '23505') {
        logger.error('REFERRAL_MINT', '[referral] could not mint code', error.message)
        return null
      }
    }

    logger.error('REFERRAL_MINT', '[referral] exhausted code generation attempts', undefined)
    return null
  } catch (err) {
    logger.error('REFERRAL_MINT', '[referral] getOrCreate threw', err)
    return null
  }
}

/** Look up a code from an inbound `?ref=` parameter. Null when invalid. */
export async function resolveReferralCode(raw: unknown): Promise<ReferralCode | null> {
  const code = normalizeReferralCode(raw)
  if (!code || !isReferralConfigured()) return null

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('referral_codes')
      .select('*')
      .eq('code', code)
      .eq('active', true)
      .maybeSingle()

    if (error || !data) return null
    return toReferralCode(data as unknown as Row)
  } catch (err) {
    logger.warn('[referral] resolve threw', err)
    return null
  }
}

/**
 * Attribute a new signup to a code.
 *
 * Fire-and-forget from the caller's perspective: signup must never fail because
 * attribution failed. The UNIQUE constraint on `referee_user_id` makes a
 * duplicate attribution a no-op rather than a double reward.
 */
export async function attributeReferral(
  refereeUserId: string,
  rawCode: unknown,
  utm?: Record<string, string> | null
): Promise<boolean> {
  const resolved = await resolveReferralCode(rawCode)
  if (!resolved || !refereeUserId) return false

  // Never let a parent refer themselves for credit.
  if (resolved.ownerUserId === refereeUserId) return false

  try {
    const admin = createAdminClient()
    const { error } = await admin.from('referrals').insert({
      code: resolved.code,
      referee_user_id: refereeUserId,
      reward_state: 'PENDING',
      reward_value: resolved.rewardValue,
      utm: utm ?? null,
    })
    // 23505 = already attributed. That is the desired end state, not a failure.
    if (error && error.code !== '23505') {
      logger.error('REFERRAL_ATTRIBUTE', '[referral] attribution failed', error.message)
      return false
    }
    return true
  } catch (err) {
    logger.error('REFERRAL_ATTRIBUTE', '[referral] attribution threw', err)
    return false
  }
}


/** Stamp the activation moment - the referee completed their diagnostic. */
export async function markReferralActivated(refereeUserId: string): Promise<void> {
  if (!isReferralConfigured() || !refereeUserId) return
  try {
    const admin = createAdminClient()
    await admin
      .from('referrals')
      .update({ activated_at: new Date().toISOString() })
      .eq('referee_user_id', refereeUserId)
      .is('activated_at', null)
  } catch (err) {
    logger.warn('[referral] activation stamp failed', err)
  }
}

/**
 * Stamp the conversion and pay out the referrer's credit.
 *
 * Reward is granted only on a *paid* conversion, not on signup or activation.
 * Paying for signups is how referral programs get farmed: the marginal cost of a
 * throwaway account is zero, so a signup reward attracts exactly the wrong
 * behaviour and inflates the metric the program is judged on.
 */
export async function markReferralConverted(
  refereeUserId: string,
  amountCents: number
): Promise<void> {
  if (!isReferralConfigured() || !refereeUserId) return
  try {
    const admin = createAdminClient()

    const { data: referral } = await admin
      .from('referrals')
      .select('id, code, reward_state, reward_value, referral_codes(owner_user_id)')
      .eq('referee_user_id', refereeUserId)
      .maybeSingle()

    if (!referral) return
    const row = referral as unknown as Row
    if (row.reward_state === 'GRANTED') return

    await admin
      .from('referrals')
      .update({
        converted_at: new Date().toISOString(),
        reward_state: 'GRANTED',
        rewarded_at: new Date().toISOString(),
      })
      .eq('id', String(row.id))

    const ownerId = (row.referral_codes as Row | null)?.owner_user_id
    if (!ownerId) return

    // Credit is tracked against the referrer's funnel row rather than a separate
    // wallet table: `lifetime_value_cents` is already read by the checkout and
    // the admin dashboard, so one column keeps the two in agreement.
    const { data: state } = await admin
      .from('funnel_state')
      .select('lifetime_value_cents')
      .eq('user_id', String(ownerId))
      .maybeSingle()

    const current = Number((state as Row | null)?.lifetime_value_cents) || 0
    await admin
      .from('funnel_state')
      .update({ lifetime_value_cents: current + (Number(row.reward_value) || 0) })
      .eq('user_id', String(ownerId))

    logger.info('[referral] reward granted', {
      referrer: String(ownerId),
      referee: refereeUserId,
      rewardCents: Number(row.reward_value) || 0,
      purchaseCents: amountCents,
    })
  } catch (err) {
    logger.error('REFERRAL_CONVERT', '[referral] conversion stamp threw', err)
  }
}

/**
 * Aggregate progress for the parent's share page.
 *
 * Deliberately exposes counts only, never the referees' emails or children. A
 * referrer is entitled to know that their link worked; they are not entitled to
 * see who it worked on. That distinction is a privacy requirement, not a
 * convenience - the referees are identifiable individuals whose parents never
 * consented to being listed on someone else's dashboard.
 */
export async function getReferralStats(
  userId: string,
  siteUrl: string
): Promise<ReferralStats | null> {
  const code = await getOrCreateReferralCode(userId)
  if (!code) return null

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('referrals')
      .select('activated_at, converted_at, reward_state, reward_value')
      .eq('code', code.code)

    if (error) {
      logger.warn('[referral] stats query failed', { message: error.message })
      return {
        code: code.code,
        invited: 0,
        activated: 0,
        converted: 0,
        earnedCents: 0,
        pendingCents: 0,
        shareUrl: `${siteUrl}/r/${code.code}`,
      }
    }

    const rows = (data ?? []) as unknown as Row[]
    const granted = rows.filter((r) => r.reward_state === 'GRANTED')
    const pending = rows.filter((r) => r.reward_state === 'PENDING')

    const sum = (list: Row[]) =>
      list.reduce((total, r) => total + (Number(r.reward_value) || 0), 0)

    return {
      code: code.code,
      invited: rows.length,
      activated: rows.filter((r) => r.activated_at).length,
      converted: rows.filter((r) => r.converted_at).length,
      earnedCents: sum(granted),
      pendingCents: sum(pending),
      shareUrl: `${siteUrl}/r/${code.code}`,
    }
  } catch (err) {
    logger.error('REFERRAL_STATS', '[referral] stats threw', err)
    return null
  }
}

