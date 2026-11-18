import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logging/logger'
import { advanceStage, isFunnelConfigured, trackEvent } from './track'

/**
 * Funnel lifecycle state.
 *
 * `funnel_state` is the single mutable row that says where a parent is in the
 * 10-step journey. Everything the lifecycle worker decides - which email to
 * send, whether the paywall may open, whether the offer window is still live -
 * is read from here rather than recomputed from the event log, because those
 * decisions run on a schedule across the whole user base and must be O(1).
 *
 * All writes use the service-role client: clients hold a SELECT-only policy, so
 * a tampered browser request cannot promote itself to CUSTOMER.
 */

/** Completed attempts required before the natural paywall opens (spec step 6). */
export const PAYWALL_ATTEMPT_THRESHOLD = 2

/** How long the surprise free mock stays available (spec step 5: 7 days). */
export const SECOND_SESSION_WINDOW_DAYS = 7

/** How long the parent has to finish the diagnostic (spec step 3: 24 hours). */
export const DIAGNOSTIC_WINDOW_HOURS = 24

export type FunnelStage =
  | 'SIGNED_UP'
  | 'STUDENT_ADDED'
  | 'DIAGNOSTIC_STARTED'
  | 'FIRST_VALUE'
  | 'REPORT_SENT'
  | 'SECOND_OFFERED'
  | 'PAYWALL_READY'
  | 'OFFER_MADE'
  | 'CUSTOMER'
  | 'ONBOARDED'
  | 'EXPANDED'
  | 'RENEWED'

/** Rank order, mirrored from `funnel_stage_rank` in SQL. */
const STAGE_RANK: Record<FunnelStage, number> = {
  SIGNED_UP: 1,
  STUDENT_ADDED: 2,
  DIAGNOSTIC_STARTED: 3,
  FIRST_VALUE: 4,
  REPORT_SENT: 5,
  SECOND_OFFERED: 6,
  PAYWALL_READY: 7,
  OFFER_MADE: 8,
  CUSTOMER: 9,
  ONBOARDED: 10,
  EXPANDED: 11,
  RENEWED: 12,
}

export function stageRank(stage: string | null | undefined): number {
  return stage && stage in STAGE_RANK ? STAGE_RANK[stage as FunnelStage] : 0
}

/** The persisted row. Nullable columns come back as null from PostgREST. */
export interface FunnelState {
  user_id: string
  stage: FunnelStage
  stage_updated_at: string
  signed_up_at: string | null
  first_student_at: string | null
  diagnostic_started_at: string | null
  diagnostic_completed_at: string | null
  report_sent_at: string | null
  second_session_offered_at: string | null
  second_session_expires_at: string | null
  second_session_completed_at: string | null
  completed_attempts: number
  offer_id: string | null
  offer_made_at: string | null
  offer_expires_at: string | null
  offer_redeemed_at: string | null
  first_purchase_at: string | null
  first_purchase_amount_cents: number | null
  lifetime_value_cents: number
  products_purchased: number
  onboarded_at: string | null
  expanded_at: string | null
  renewed_at: string | null
  referred_by_code: string | null
  marketing_opt_in: boolean
  email_suppressed: boolean
  email: string | null
  updated_at: string
}

const SELECT_COLUMNS =
  'user_id, stage, stage_updated_at, signed_up_at, first_student_at, ' +
  'diagnostic_started_at, diagnostic_completed_at, report_sent_at, ' +
  'second_session_offered_at, second_session_expires_at, second_session_completed_at, ' +
  'completed_attempts, offer_id, offer_made_at, offer_expires_at, offer_redeemed_at, ' +
  'first_purchase_at, first_purchase_amount_cents, lifetime_value_cents, ' +
  'products_purchased, onboarded_at, expanded_at, renewed_at, referred_by_code, ' +
  'marketing_opt_in, email_suppressed, email, updated_at'

/** Read a parent's lifecycle row, or null when they have none yet. */
export async function getFunnelState(userId: string): Promise<FunnelState | null> {
  if (!isFunnelConfigured() || !userId) return null
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('funnel_state')
      .select(SELECT_COLUMNS)
      .eq('user_id', userId)
      .maybeSingle()
    if (error) {
      logger.error('FUNNEL_STATE_READ', '[funnel] state read failed', error.message)
      return null
    }
    return (data as unknown as FunnelState) ?? null
  } catch (err) {
    logger.error('FUNNEL_STATE_THROW', '[funnel] state read threw', err)
    return null
  }
}

/** Fields a caller may patch. Stage is excluded - use `advanceStage`. */
export type FunnelStatePatch = Partial<
  Omit<FunnelState, 'user_id' | 'stage' | 'stage_updated_at' | 'updated_at'>
> & { updated_at?: string }

/**
 * Apply a partial update to a parent's lifecycle row.
 *
 * Upserts rather than updates: the row may not exist yet when the first event
 * for a brand-new signup lands, and requiring callers to create it first would
 * be a race between two concurrent requests.
 */
export async function patchFunnelState(
  userId: string,
  patch: FunnelStatePatch
): Promise<boolean> {
  if (!isFunnelConfigured() || !userId) return false
  try {
    const admin = createAdminClient()
    const { error } = await admin
      .from('funnel_state')
      .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' })
    if (error) {
      logger.error('FUNNEL_STATE_WRITE', '[funnel] state write failed', error.message)
      return false
    }
    return true
  } catch (err) {
    logger.error('FUNNEL_STATE_THROW', '[funnel] state write threw', err)
    return false
  }
}

/**
 * Create the lifecycle row at signup (spec step 2).
 *
 * Called from the signup API path and from the OAuth callback. Idempotent via
 * upsert: a parent who signs up, deletes the account row and signs up again
 * keeps their original timestamps rather than resetting the funnel clock.
 */
export async function initialiseFunnelState(
  userId: string,
  options: {
    email?: string | null
    marketingOptIn?: boolean
    referredByCode?: string | null
  } = {}
): Promise<boolean> {
  const ok = await patchFunnelState(userId, {
    // `stage` is intentionally not set here: the column defaults to
    // 'SIGNED_UP' in SQL, and `advanceStage` below owns every stage write so
    // the monotonic guard in `advance_funnel_stage` cannot be bypassed.
    signed_up_at: new Date().toISOString(),
    email: options.email ?? null,
    marketing_opt_in: options.marketingOptIn ?? false,
    // Only set the referrer when the caller supplied one; a bare upsert must
    // not wipe attribution recorded earlier in the same request.
    ...(options.referredByCode ? { referred_by_code: options.referredByCode } : {}),
  })
  if (ok) await advanceStage(userId, 'SIGNED_UP')
  return ok
}

/** Spec step 3a: the parent added their first child profile. */
export async function recordStudentAdded(
  userId: string,
  studentId: string
): Promise<void> {
  const existing = await getFunnelState(userId)
  // Stamp the timestamp only the first time - a fourth child must not overwrite
  // when the family actually started.
  if (!existing?.first_student_at) {
    await patchFunnelState(userId, { first_student_at: new Date().toISOString() })
  }
  await advanceStage(userId, 'STUDENT_ADDED')
  await trackEvent({ event: 'STUDENT_ADDED', userId, studentId })
}

/**
 * Spec step 3: the diagnostic has been STARTED.
 *
 * WHY THIS FUNCTION DID NOT EXIST
 *   `diagnostic_started_at` was declared on FunnelState and read by the
 *   lifecycle worker's nudge logic (`hoursSince(state.diagnostic_started_at)`
 *   in decideDiagnosticNudge), but nothing anywhere wrote it. The 24-hour
 *   diagnostic window (DIAGNOSTIC_WINDOW_HOURS) therefore could never be
 *   measured, the DIAGNOSTIC_STARTED stage was unreachable, and the
 *   DIAGNOSTIC_STARTED event - declared in the catalogue - was never emitted.
 *   A read-only column that gates a deadline is a deadline that never fires.
 *
 * Called from the runner's start path, via attempt.ts, when the test being
 * started is the BENCHMARK diagnostic.
 */
export async function recordDiagnosticStarted(
  userId: string,
  studentId: string,
  meta: { testId?: string | null } = {}
): Promise<void> {
  const state = await getFunnelState(userId)

  // Stamped once, for the same reason `first_student_at` is: a retake must not
  // move the moment the family actually began, or the 24-hour window would
  // restart on every sitting and the nudge would never become due.
  if (!state?.diagnostic_started_at) {
    await patchFunnelState(userId, {
      diagnostic_started_at: new Date().toISOString(),
    })
  }

  await advanceStage(userId, 'DIAGNOSTIC_STARTED')
  await trackEvent({
    event: 'DIAGNOSTIC_STARTED',
    userId,
    studentId,
    // No score and no correctness: the attempt has only just begun, so there is
    // no result to carry. This event sits on the PARENT's funnel row, but the
    // student's session is what triggered it - keeping result-bearing fields
    // out of any student-originating payload is the boundary migration 015
    // draws, and it costs nothing to honour it here.
    props: { testId: meta.testId ?? null },
  })
}


/**
 * Spec step 6: the natural paywall trigger.
 *
 * Called once per completed attempt. Increments the counter and, the moment it
 * reaches `PAYWALL_ATTEMPT_THRESHOLD`, opens the paywall stage and emits
 * PAYWALL_TRIGGERED - which is what the lifecycle worker polls for to send the
 * step-6 email.
 *
 * The increment and the stage check live in the same function on purpose:
 * splitting them is how a parent ends up at three completed tests with the
 * paywall never having opened, because whichever caller forgot the second half
 * is never caught.
 */
export async function recordAttemptCompleted(
  userId: string,
  studentId: string,
  meta: { testId?: string; examType?: string } = {}
): Promise<{ completed: number; paywallOpened: boolean }> {
  const state = await getFunnelState(userId)
  const previous = state?.completed_attempts ?? 0
  const completed = previous + 1

  await patchFunnelState(userId, { completed_attempts: completed })

  // First completion is the activation moment (spec step 3): the diagnostic is
  // done, so the readiness report may now be generated and emailed.
  if (completed === 1 && !state?.diagnostic_completed_at) {
    await patchFunnelState(userId, {
      diagnostic_completed_at: new Date().toISOString(),
    })
  }

  const alreadyPastPaywall = stageRank(state?.stage) >= STAGE_RANK.PAYWALL_READY
  const paywallOpened = completed === PAYWALL_ATTEMPT_THRESHOLD && !alreadyPastPaywall

  if (paywallOpened) await advanceStage(userId, 'PAYWALL_READY')

  await trackEvent({
    event: completed === 1 ? 'DIAGNOSTIC_COMPLETED' : 'SECOND_SESSION_COMPLETED',
    userId,
    studentId,
    props: {
      completedAttempts: completed,
      testId: meta.testId ?? null,
      examType: meta.examType ?? null,
      // NO score, and no `score` key in the meta type at all. This event is
      // written from a submission the STUDENT triggered, and the rule the
      // catalogue states for ITEM_ANSWERED applies with equal force here:
      // correctness and results belong in the reporting layer (fact_test_attempt,
      // which the parent may read), never in an analytics payload that a
      // student's own session caused to be written. Removing it from the type
      // - not just from this object - means a future caller cannot reintroduce
      // it without a deliberate signature change that shows up in review.

      paywallOpened,
    },
  })

  if (paywallOpened) {
    await trackEvent({
      event: 'PAYWALL_TRIGGERED',
      userId,
      studentId,
      props: { completedAttempts: completed },
    })
  }

  return { completed, paywallOpened }
}


/**
 * Spec step 5: grant the surprise free mock with a 7-day deadline.
 *
 * Returns the expiry so the caller can put a real countdown in the email and on
 * the dashboard - a deadline the user can see is what makes the mechanic work.
 */
export async function grantSecondSession(
  userId: string
): Promise<{ expiresAt: string } | null> {
  const state = await getFunnelState(userId)
  // Never re-grant: the surprise only works once, and re-granting would reset a
  // deadline the parent may already be working against.
  if (state?.second_session_offered_at) {
    return {
      expiresAt:
        state.second_session_expires_at ??
        new Date(Date.now() + SECOND_SESSION_WINDOW_DAYS * 86_400_000).toISOString(),
    }
  }

  const expiresAt = new Date(
    Date.now() + SECOND_SESSION_WINDOW_DAYS * 86_400_000
  ).toISOString()

  const ok = await patchFunnelState(userId, {
    second_session_offered_at: new Date().toISOString(),
    second_session_expires_at: expiresAt,
  })
  if (!ok) return null

  await advanceStage(userId, 'SECOND_OFFERED')
  await trackEvent({ event: 'SECOND_SESSION_GRANTED', userId, props: { expiresAt } })
  return { expiresAt }
}

/** Tri-state for a deadline window, used by the dashboard and the worker. */
export type WindowStatus = 'none' | 'live' | 'expired' | 'used'

/** Classify a stored expiry timestamp against now. */
export function windowStatus(
  offeredAt: string | null,
  expiresAt: string | null,
  completedAt: string | null
): WindowStatus {
  if (!offeredAt) return 'none'
  if (completedAt) return 'used'
  if (!expiresAt) return 'live'
  return new Date(expiresAt).getTime() > Date.now() ? 'live' : 'expired'
}

/**
 * Spec step 7: is the one-time offer still claimable?
 *
 * The offer window opens when the paywall does and is deliberately short.
 * Scarcity that never expires is not scarcity, and a countdown that resets on
 * every page load trains parents to ignore it - which is worse than having no
 * countdown at all.
 */
export function offerStatus(state: FunnelState | null): WindowStatus {
  if (!state?.offer_made_at) return 'none'
  if (state.offer_redeemed_at) return 'used'
  if (!state.offer_expires_at) return 'live'
  return new Date(state.offer_expires_at).getTime() > Date.now() ? 'live' : 'expired'
}

/** Milliseconds remaining on the offer window, floored at zero. */
export function offerMsRemaining(state: FunnelState | null): number {
  if (offerStatus(state) !== 'live' || !state?.offer_expires_at) return 0
  return Math.max(0, new Date(state.offer_expires_at).getTime() - Date.now())
}

/**
 * Users the lifecycle worker should act on: signed up, not suppressed, and
 * still short of a purchase.
 *
 * Exposed here rather than inlined in the worker so the definition of "active
 * funnel candidate" exists in exactly one place.
 */
export async function listWorkerCandidates(limit = 200): Promise<FunnelState[]> {
  if (!isFunnelConfigured()) return []
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('funnel_state')
      .select(SELECT_COLUMNS)
      .eq('email_suppressed', false)
      // Acquisition candidates only. Buyers are scanned by
      // `listExpansionCandidates` below - two lists with two budgets, so a
      // growing customer base can never starve the acquisition sequence
      // (or vice versa) inside one shared `limit`.
      .is('first_purchase_at', null)
      .not('email', 'is', null)
      .order('stage_updated_at', { ascending: true })
      .limit(limit)

    if (error) {
      logger.error('FUNNEL_CANDIDATES', '[funnel] candidate query failed', error.message)
      return []
    }
    return (data ?? []) as unknown as FunnelState[]
  } catch (err) {
    logger.error('FUNNEL_CANDIDATES', '[funnel] candidate query threw', err)
    return []
  }
}

/**
 * Customers the expansion branch of the worker should consider (step 9).
 *
 * Purchasers who have NOT yet expanded, oldest purchase first. `expanded_at`
 * (set by recordPurchase on a second product) removes a family from this list
 * for good - the sibling pitch is not a newsletter. The per-kind dedupe slot
 * in email_log is the second guard: even if this query over-selects, a parent
 * can only ever receive ONE sibling email.
 *
 * Subscription renewal reminders (step 10) will need their own list with their
 * own cadence; they are deliberately not folded in here - RENEWAL_REMINDER_SENT
 * remains unwired until that sequence is built.
 */
export async function listExpansionCandidates(limit = 50): Promise<FunnelState[]> {
  if (!isFunnelConfigured()) return []
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('funnel_state')
      .select(SELECT_COLUMNS)
      .eq('email_suppressed', false)
      .not('first_purchase_at', 'is', null)
      .is('expanded_at', null)
      .not('email', 'is', null)
      .order('first_purchase_at', { ascending: true })
      .limit(limit)

    if (error) {
      logger.error('FUNNEL_EXPANSION_CANDIDATES', '[funnel] expansion candidate query failed', error.message)
      return []
    }
    return (data ?? []) as unknown as FunnelState[]
  } catch (err) {
    logger.error('FUNNEL_EXPANSION_CANDIDATES', '[funnel] expansion candidate query threw', err)
    return []
  }
}

