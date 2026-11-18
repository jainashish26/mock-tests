import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logging/logger'
import { isStripeConfigured } from '@/lib/pricing/catalog'
import { patchFunnelState, getFunnelState, offerStatus } from '@/lib/funnel/state'
import { advanceStage, trackEvent } from '@/lib/funnel/track'

/**
 * The step-7 launch offer.
 *
 * THE COMMERCIAL SHAPE
 *   One payment of $150, no subscription, 14-day money-back guarantee, offered
 *   once per family and only after they have reached the paywall. The spec's
 *   targets - 20% of all signups and 40%+ of those who reach step 5 - are only
 *   achievable if the offer is genuinely one-time: a discount that is always
 *   available is not a discount, it is the price, and it earns no urgency.
 *
 * WHY THE PRICE IS NOT IN THIS FILE
 *   `offer_amount_cents` lives in the `offers` table and `stripe_price_id` is
 *   what actually gets charged. The same rule `src/lib/pricing/catalog.ts`
 *   already enforces for subscriptions: the client sends an identifier, the
 *   server resolves the amount from Stripe. Hardcoding 15000 here would recreate
 *   exactly the drift bug that file's header comment describes.
 *
 * WHY A PER-USER WINDOW RATHER THAN A GLOBAL END DATE
 *   A global "offer ends 31 March" is a fixed deadline every visitor sees, so it
 *   resets psychologically for anyone who arrives in February. A per-user window
 *   starts when *that* parent reaches the paywall, which means the urgency is
 *   always real and always personal - and it is stored in `funnel_state`, so
 *   closing the tab does not reset it.
 */

/** Slug of the default launch offer seeded by `scripts/seed-funnel.sql`. */
export const LAUNCH_OFFER_SLUG = 'launch-150'

/** Fallback guarantee period when an offer row does not specify one. */
export const DEFAULT_GUARANTEE_DAYS = 14

/** How long the offer stays claimable once triggered, in hours. */
export const DEFAULT_OFFER_WINDOW_HOURS = 72

export interface ResolvedOffer {
  id: string
  slug: string
  name: string
  description: string | null
  kind: string
  stripePriceId: string | null
  offerAmountCents: number
  originalAmountCents: number
  currency: string
  guaranteeDays: number
  /** Whole-number saving, derived - never stored twice. */
  discountPercent: number
  /** Per-user expiry; null when the offer is not currently granted to anyone. */
  expiresAt: string | null
  /** Included bullets, from `offers.config.includes`. */
  includes: string[]
  /** offers.per_user_limit - how many times one family may redeem this offer. */
  perUserLimit: number
  /**
   * The product whose bundle a purchase grants (offers.config.productId).
   * Null when the offer has no fulfilment mapping - checkout MUST refuse it,
   * because taking money and granting nothing is the worst failure mode.
   */
  fulfilmentProductId: string | null
}

type Row = Record<string, unknown>

function toInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? Math.round(n) : fallback
}

/** Derive the saving so the displayed % can never contradict the two amounts. */
export function discountPercent(offer: number, original: number): number {
  if (!Number.isFinite(offer) || !Number.isFinite(original) || original <= offer || original <= 0) {
    return 0
  }
  return Math.round((1 - offer / original) * 100)
}

/** Read `config.includes` defensively - it is free-form jsonb. */
function parseIncludes(config: unknown): string[] {
  if (!config || typeof config !== 'object') return []
  const raw = (config as Row).includes
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 12)
}

/** Read `config.productId` defensively - it is free-form jsonb. */
function parseProductId(config: unknown): string | null {
  if (!config || typeof config !== 'object') return null
  const raw = (config as Row).productId
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : null
}

/** Map an `offers` row onto the resolved shape used by the UI and checkout. */
function toResolvedOffer(row: Row, expiresAt: string | null): ResolvedOffer | null {
  const offerAmountCents = toInt(row.offer_amount_cents, NaN)
  if (!Number.isFinite(offerAmountCents)) return null

  const originalAmountCents = toInt(row.original_amount_cents, offerAmountCents)

  return {
    id: String(row.id),
    slug: String(row.slug ?? ''),
    name: String(row.name ?? 'Exam Pack'),
    description: row.description ? String(row.description) : null,
    kind: String(row.kind ?? 'EXAM_PACK'),
    stripePriceId: row.stripe_price_id ? String(row.stripe_price_id) : null,
    offerAmountCents,
    originalAmountCents,
    currency: String(row.currency ?? 'AUD').toUpperCase(),
    guaranteeDays: toInt(row.guarantee_days, DEFAULT_GUARANTEE_DAYS),
    discountPercent: discountPercent(offerAmountCents, originalAmountCents),
    expiresAt,
    includes: parseIncludes(row.config),
    perUserLimit: toInt(row.per_user_limit, 1),
    fulfilmentProductId: parseProductId(row.config),
  }
}

/**
 * Read the currently live offer by slug.
 *
 * Returns null rather than throwing when nothing is configured, matching the
 * convention in `catalog.ts`: /pricing is prerendered and `next build` must stay
 * green without database credentials.
 */
export async function getLiveOffer(slug: string = LAUNCH_OFFER_SLUG): Promise<ResolvedOffer | null> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('offers')
      .select('*')
      .eq('slug', slug)
      .eq('active', true)
      .maybeSingle()

    if (error) {
      // Missing table (migration 011 not yet applied) is expected during a
      // staged rollout; warn rather than error so the logs stay readable.
      logger.warn('[offer] could not load offer', { slug, message: error.message })
      return null
    }
    if (!data) return null

    const row = data as unknown as Row
    const now = Date.now()
    if (row.starts_at && new Date(row.starts_at as string).getTime() > now) return null
    if (row.ends_at && new Date(row.ends_at as string).getTime() <= now) return null

    return toResolvedOffer(row, null)
  } catch (err) {
    logger.warn('[offer] getLiveOffer threw', err)
    return null
  }
}

/**
 * Grant the offer to one parent and start their countdown.
 *
 * Idempotent: a second call for a parent who already has a live offer returns
 * the existing window instead of extending it. Extending on retry is how a
 * "one-time" offer silently becomes permanent.
 */
export async function grantOfferToUser(
  userId: string,
  slug: string = LAUNCH_OFFER_SLUG
): Promise<ResolvedOffer | null> {
  const offer = await getLiveOffer(slug)
  if (!offer) return null

  const state = await getFunnelState(userId)

  // Already granted and still live -> return as-is, do not reset the clock.
  if (state?.offer_made_at && offerStatus(state) === 'live' && state.offer_expires_at) {
    return { ...offer, expiresAt: state.offer_expires_at }
  }

  // Already bought something -> they are past the offer, do not re-pitch.
  if (state?.first_purchase_at) return null

  const windowHours = DEFAULT_OFFER_WINDOW_HOURS
  const expiresAt = new Date(Date.now() + windowHours * 3_600_000).toISOString()

  const ok = await patchFunnelState(userId, {
    offer_id: offer.id,
    offer_made_at: new Date().toISOString(),
    offer_expires_at: expiresAt,
  })
  if (!ok) return null

  await advanceStage(userId, 'OFFER_MADE')
  await trackEvent({
    event: 'OFFER_MADE',
    userId,
    props: { offerSlug: offer.slug, offerAmountCents: offer.offerAmountCents, expiresAt },
  })

  return { ...offer, expiresAt }
}

/**
 * The offer as this specific parent should see it.
 *
 * `status` drives the UI: 'live' renders the countdown, 'expired' renders the
 * full-price fallback, 'used' renders nothing, and 'none' means the parent has
 * not reached the paywall yet and must not be pitched to at all.
 */
export async function getOfferForUser(
  userId: string,
  slug: string = LAUNCH_OFFER_SLUG
): Promise<{ offer: ResolvedOffer | null; status: 'none' | 'live' | 'expired' | 'used' }> {
  const [offer, state] = await Promise.all([getLiveOffer(slug), getFunnelState(userId)])
  const status = offerStatus(state)

  if (!offer) return { offer: null, status: 'none' }
  if (status === 'none') return { offer: null, status: 'none' }
  if (status === 'used') return { offer: null, status: 'used' }

  return { offer: { ...offer, expiresAt: state?.offer_expires_at ?? null }, status }
}

/**
 * Mark the offer redeemed.
 *
 * Called from the Stripe webhook on a completed checkout, not from the checkout
 * page - a parent who abandons Stripe halfway must not lose their offer, and one
 * who completes it must not be able to use it twice.
 */
export async function redeemOffer(userId: string, amountCents: number): Promise<void> {
  await patchFunnelState(userId, {
    offer_redeemed_at: new Date().toISOString(),
    first_purchase_at: new Date().toISOString(),
    first_purchase_amount_cents: amountCents,
  })
  await advanceStage(userId, 'CUSTOMER')
}

/**
 * Can the checkout honour an offer price for this user right now?
 *
 * This is the server-side authority behind the "claim offer" button. Checking
 * it again at checkout rather than trusting the page that rendered the button is
 * what stops a parent from bookmarking an offer URL and returning after the
 * window closed.
 */
export async function canClaimOffer(userId: string): Promise<ResolvedOffer | null> {
  if (!isStripeConfigured()) return null
  const { offer, status } = await getOfferForUser(userId)
  // No fulfilment mapping means a purchase would grant nothing - refuse rather
  // than take money (the webhook grants via offers.config.productId).
  if (status !== 'live' || !offer || !offer.stripePriceId || !offer.fulfilmentProductId) return null
  return offer
}

