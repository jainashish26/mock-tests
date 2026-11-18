import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logging/logger'
import { isEmailConfigured, sendEmail } from '@/lib/email/provider'
import {
  diagnosticNudgeEmail,
  expandEmail,
  offerEmail,
  paywallEmail,
  readinessReportEmail,
  secondSessionEmail,
  type EmailMessage,
} from '@/lib/email/templates'
import {
  buildReadinessReport,
  readinessEmailTokens,
  type ReadinessReport,
} from '@/lib/report/readiness'
import { getOfferForUser, grantOfferToUser } from '@/lib/pricing/launch-offer'
import { getSiblingOfferForUser } from '@/lib/pricing/sibling-offer'
import { link } from '@/lib/email/layout'
import {
  DIAGNOSTIC_WINDOW_HOURS,
  PAYWALL_ATTEMPT_THRESHOLD,
  grantSecondSession,
  listExpansionCandidates,
  listWorkerCandidates,
  patchFunnelState,
  stageRank,
  type FunnelState,
} from './state'
import { advanceStage, hasFiredEvent, trackEvent, trackEventOnce } from './track'
import { markReferralActivated } from './referral'

/**
 * Lifecycle orchestration - the thing that actually runs steps 4, 5, 6 and 7.
 *
 * WHY A POLLING WORKER RATHER THAN EVENT-DRIVEN SENDS
 *   Every trigger in this funnel is time-based, not action-based: the readiness
 *   report goes out after the diagnostic settles, the nudge fires 12 hours into
 *   a 24-hour window, the offer countdown needs a reminder near expiry. A
 *   webhook can only react to something that just happened; a scheduled worker
 *   can react to something that happened *a while ago and is still unfinished*,
 *   which is where almost all of the conversion actually lives.
 *
 *   Actions still write state immediately (see `recordAttemptCompleted`), so the
 *   worker never has to derive progress - it only has to decide what is due.
 *
 * IDEMPOTENCY
 *   Every send goes through `sendEmail`, which claims a UNIQUE(user_id,
 *   template, dedupe_key) slot before transmitting. That makes the whole worker
 *   safe to run twice, which matters because Vercel Cron and QStash both retry,
 *   and a duplicated "your card will be charged" email is a support ticket.
 *
 * ORDERING
 *   One email per user per run. A parent who reaches the paywall should not
 *   receive a readiness report, a free-mock grant and an offer in the same
 *   minute; that is a spam complaint, not a funnel.
 */

/** How long after signup the diagnostic nudge becomes eligible. */
const NUDGE_AFTER_HOURS = 12

/** Do not nudge once the window has closed - it would be a lie. */
const NUDGE_BEFORE_HOURS = 2

/** Minimum minutes between two lifecycle emails to one parent. */
const MIN_HOURS_BETWEEN_EMAILS = 20

/** Locked-analytics copy, shared between the paywall email and the UI gate. */
export const LOCKED_INSIGHT_LABELS = [
  'Time per question - whether a wrong answer was a guess or a slow, careful miss',
  'Question-level review with worked explanations for every item missed',
  'Progress trend across attempts, so you can see whether the gap is closing',
  'The adaptive study plan that re-targets the weakest topic each week',
  'Further AI writing marks beyond the single free sample',
] as const

type Row = Record<string, unknown>

function isConfigured(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
}

/** Hours elapsed since an ISO timestamp, or null when it is unset. */
function hoursSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return null
  return ms / 3_600_000
}

/** What the worker needs to know about the family before it can write copy. */
interface FamilyContext {
  /** Display label. Child usernames are synthetic, so this is already private-safe. */
  childLabel: string
  studentId: string | null
  yearLevel: number
  report: ReadinessReport | null
}

/**
 * Load the first linked child plus their readiness report.
 *
 * Uses the service-role client because the worker runs outside any user session
 * and RLS would return nothing. This is the only place in the funnel that reads
 * child data without a parent's session, and it reads the minimum needed to
 * render an email - no names, no answers, only aggregates.
 */
async function loadFamilyContext(userId: string): Promise<FamilyContext | null> {
  try {
    const admin = createAdminClient()

    const { data: links, error } = await admin
      .from('parent_student_links')
      .select('student_profiles(id, username, year_level)')
      .eq('parent_user_id', userId)
      .limit(1)

    if (error) {
      logger.warn('[lifecycle] could not load children', { userId, message: error.message })
      return null
    }

    const first = (links ?? [])[0] as Row | undefined
    const profile = first?.student_profiles as Row | null | undefined
    if (!profile) return null

    const studentId = String(profile.id)
    // The admin client is a SupabaseClient with wider generics than the report
    // helper's signature; the cast is structural only, and this is the single
    // place in the funnel that reads child data without a parent's session.
    const report = await buildReadinessReport(admin as unknown as SupabaseClient, studentId, {
      unlocked: false,
    })

    return {
      childLabel: String(profile.username ?? 'Your child'),
      studentId,
      yearLevel: Number(profile.year_level) || 0,
      report,
    }
  } catch (err) {
    logger.warn('[lifecycle] family context threw', err)
    return null
  }
}

/** Build one concrete teaser stat from the child's real data. */
function teaserStat(report: ReadinessReport | null, childLabel: string): string {
  if (!report) return `${childLabel} has completed two full assessments`
  if (report.gaps.length > 0) {
    const gap = report.gaps[0]
    return `${gap.accuracy}% on ${gap.topic} across ${gap.attempted} questions`
  }
  return `${report.overallScore}/100 overall, band ${report.overallBand}`
}

/** The single email a user is due on this run, if any. */
interface DueEmail {
  message: EmailMessage
  /** Runs once the send succeeds, so the funnel reflects reality not intent. */
  onSuccess: () => Promise<void>
  reason: string
}

/**
 * Decide what - if anything - this parent should receive right now.
 *
 * The order of the checks is the funnel order, and that is not incidental: a
 * parent who has reached the paywall must never receive a diagnostic nudge, and
 * one who has not finished a diagnostic must never receive an offer. Returning at
 * most one message per run is what keeps the sequence legible instead of
 * collapsing into a blast.
 */
export async function decideNextEmail(
  state: FunnelState,
  context: FamilyContext | null
): Promise<DueEmail | null> {
  const rank = stageRank(state.stage)
  const childLabel = context?.childLabel ?? 'Your child'

  // A parent who has bought something is out of the acquisition sequence. Their
  // email belongs to the EXPANSION branch (step 9), which has its own gates:
  // real usage of the first purchase before any upsell (gap-analysis item 10 -
  // "an upsell at the moment a card clears reads as a cash grab").
  if (state.first_purchase_at) {
    return decideExpansionEmail(state, childLabel)
  }

  // --- Step 3: diagnostic started but not finished -------------------------
  if (rank < stageRank('FIRST_VALUE')) {
    return decideDiagnosticNudge(state, context, childLabel, rank)
  }

  // --- Step 4: readiness report --------------------------------------------
  if (!state.report_sent_at) {
    return decideReadinessReport(state, context, childLabel)
  }

  // --- Step 5: surprise free mock ------------------------------------------
  if (!state.second_session_offered_at) {
    return decideSecondSession(state, childLabel)
  }

  // --- Steps 6 + 7: paywall, then the offer --------------------------------
  if (state.completed_attempts >= PAYWALL_ATTEMPT_THRESHOLD) {
    return decidePaywallAndOffer(state, context, childLabel, rank)
  }

  return null
}

/**
 * Step 3 nudge logic.
 *
 * Two distinct cases, deliberately separated: nothing started at all, versus
 * started-and-stalled. They need different copy and different timing, and
 * conflating them is how a parent who opened the diagnostic and got interrupted
 * ends up being told they "never started".
 */
async function decideDiagnosticNudge(
  state: FunnelState,
  context: FamilyContext | null,
  childLabel: string,
  rank: number
): Promise<DueEmail | null> {
  const sinceStart = hoursSince(state.diagnostic_started_at)

  if (sinceStart === null) {
    const sinceSignup = hoursSince(state.signed_up_at)
    // Give the in-app onboarding a chance first. Emailing a parent four minutes
    // after signup is how a list gets marked as spam.
    if (sinceSignup === null || sinceSignup < NUDGE_AFTER_HOURS) return null
    // No child profile yet means there is nothing to nudge about; onboarding
    // owns that case, not email.
    if (rank < stageRank('STUDENT_ADDED') || !context) return null

    const hoursRemaining = Math.max(1, Math.round(DIAGNOSTIC_WINDOW_HOURS - sinceSignup))
    return buildNudge(state, childLabel, hoursRemaining, 'diagnostic_not_started', async () => {
      await trackEvent({ event: 'DIAGNOSTIC_OFFERED', userId: state.user_id })
    })
  }

  // Started but stalled: nudge once, partway through the window and never after
  // it has closed, because a countdown that has already hit zero is a lie.
  const latestAllowed = DIAGNOSTIC_WINDOW_HOURS - NUDGE_BEFORE_HOURS
  if (sinceStart >= NUDGE_AFTER_HOURS && sinceStart <= latestAllowed) {
    const hoursRemaining = Math.max(1, Math.round(DIAGNOSTIC_WINDOW_HOURS - sinceStart))
    return buildNudge(state, childLabel, hoursRemaining, 'diagnostic_stalled', async () => {
      await trackEvent({
        event: 'DIAGNOSTIC_ABANDONED',
        userId: state.user_id,
        props: { hoursRemaining },
      })
    })
  }

  return null
}

/** Shared construction for both nudge variants. */
function buildNudge(
  state: FunnelState,
  childLabel: string,
  hoursRemaining: number,
  reason: string,
  onSuccess: () => Promise<void>
): DueEmail {
  return {
    reason,
    message: diagnosticNudgeEmail({
      userId: state.user_id,
      childLabel,
      hoursRemaining,
      testTitle: 'Free benchmark diagnostic',
      timeLimitMins: 20,
      startUrl: link('/parent'),
    }),
    onSuccess,
  }
}


/**
 * Step 4: the readiness report.
 *
 * Refuses to send when the report cannot be built. A readiness email with empty
 * numbers is worse than no email - it demonstrates the product does not work at
 * the exact moment the parent is being asked to trust it.
 */
async function decideReadinessReport(
  state: FunnelState,
  context: FamilyContext | null,
  childLabel: string
): Promise<DueEmail | null> {
  if (!context?.report) return null

  const tokens = readinessEmailTokens(context.report, childLabel)
  const studentId = context.studentId

  return {
    reason: 'readiness_report',
    message: readinessReportEmail({
      userId: state.user_id,
      childLabel: tokens.childLabel,
      yearLevel: tokens.yearLevel,
      overallScore: tokens.overallScore,
      overallBand: tokens.overallBand,
      primaryExam: tokens.primaryExam,
      primaryScore: tokens.primaryScore,
      primaryBand: tokens.primaryBand,
      confidence: tokens.confidence,
      summary: tokens.summary,
      gapLines: tokens.gapLines,
      strengthLines: tokens.strengthLines,
      questionsAnswered: tokens.questionsAnswered,
      attemptsUsed: tokens.attemptsUsed,
      readinessUrl: studentId ? link('/parent/readiness/' + studentId) : link('/parent'),
    }),
    onSuccess: async () => {
      await patchFunnelState(state.user_id, { report_sent_at: new Date().toISOString() })
      await advanceStage(state.user_id, 'REPORT_SENT')
      await trackEvent({
        event: 'READINESS_REPORT_EMAILED',
        userId: state.user_id,
        studentId,
        // NO score and NO band. The email itself carries the result - that is
        // its purpose - but this event only needs to record THAT it was sent.
        // A11 measures conversion, not attainment; results live in
        // fact_test_attempt, which the parent may read.
        //
        // This matters because funnel_events is written from student sessions.
        // Its safety currently rests on having NO RLS policies at all, which is
        // a property a future "let users read their own events" policy would
        // silently destroy. Migration 047 removes the SELECT grant so the
        // boundary no longer depends on that absence.
        props: { attemptsUsed: tokens.attemptsUsed },
      })
      // The referrer has now earned the activation marker (step 1 reward path).
      await markReferralActivated(state.user_id)
    },
  }
}

/**
 * Step 5: grant and announce the surprise free mock.
 *
 * The grant happens before the email is composed, not after it is sent, so the
 * 7-day expiry quoted in the copy is the same expiry stored in `funnel_state`.
 * Composing first and granting later is how an email ends up promising a
 * deadline the database does not know about.
 */
async function decideSecondSession(
  state: FunnelState,
  childLabel: string
): Promise<DueEmail | null> {
  const granted = await grantSecondSession(state.user_id)
  if (!granted) return null

  return {
    reason: 'second_session_grant',
    message: secondSessionEmail({
      userId: state.user_id,
      childLabel,
      testTitle: 'Full-length mock exam',
      timeLimitMins: 45,
      expiresAt: granted.expiresAt,
      startUrl: link('/parent'),
    }),
    onSuccess: async () => {
      await trackEvent({
        event: 'SECOND_SESSION_EMAILED',
        userId: state.user_id,
        props: { expiresAt: granted.expiresAt },
      })
    },
  }
}


/**
 * Steps 6 and 7: the paywall email, then the offer email.
 *
 * These are deliberately two separate sends on two separate runs. Pairing the
 * diagnosis and the pitch in one message is the single easiest way to lose the
 * credibility the paywall was built on - the parent reads it as a sales email
 * that happened to mention their child, rather than as a report that happened to
 * end with an offer.
 */
async function decidePaywallAndOffer(
  state: FunnelState,
  context: FamilyContext | null,
  childLabel: string,
  rank: number
): Promise<DueEmail | null> {
  // Ensure the stage pointer reflects the attempt count even if the event that
  // should have moved it was lost.
  if (rank < stageRank('PAYWALL_READY')) {
    await advanceStage(state.user_id, 'PAYWALL_READY')
  }

  const studentId = context?.studentId ?? null
  const reportUrl = studentId ? link('/parent/readiness/' + studentId) : link('/parent')

  if (!state.offer_made_at) {
    // Open the offer window NOW, in the same run that sends the paywall email -
    // not later, and not in the send's success callback.
    //
    // Doing it in the callback would mean a parent whose offer row failed to
    // write on the first pass is never retried, because `sendEmail` suppresses
    // the duplicate and the callback only runs on a real send. Doing it on a
    // later run would mean the 72-hour countdown starts at an arbitrary point
    // rather than at the moment the paywall email lands.
    //
    // Granting also advances the stage, which resets `stage_updated_at` and
    // therefore spaces the offer email roughly a day behind the paywall email via
    // MIN_HOURS_BETWEEN_EMAILS. That gap is deliberate: a diagnosis followed
    // immediately by a price is a pitch, and pitches get deleted.
    await grantOfferToUser(state.user_id)

    return {
      reason: 'paywall',
      message: paywallEmail({
        userId: state.user_id,
        childLabel,
        completedAttempts: state.completed_attempts,
        lockedItems: [...LOCKED_INSIGHT_LABELS],
        teaserStat: teaserStat(context?.report ?? null, childLabel),
        reportUrl,
        upgradeUrl: link('/parent/offer'),
      }),
      onSuccess: async () => {
        await trackEvent({ event: 'PAYWALL_EMAILED', userId: state.user_id })
      },
    }
  }

  const { offer, status } = await getOfferForUser(state.user_id)

  if (status === 'live' && offer) {
    const expiresAt = offer.expiresAt ?? new Date().toISOString()
    const primaryGap = context?.report?.gaps[0]?.topic ?? null

    return {
      reason: 'offer',
      message: offerEmail({
        userId: state.user_id,
        childLabel,
        offerName: offer.name,
        // Falls back to the standard inclusion list when the offer row does not
        // carry its own copy, so a newly seeded offer still renders completely.
        includes:
          offer.includes.length > 0
            ? offer.includes
            : [
                '6 full-length exam papers across every exam type',
                'Unlimited AI writing marks with criterion-level feedback',
                'Deeper analytics: time per question, question review and trend',
                'An adaptive study plan that re-targets the weakest topic weekly',
                `A ${offer.guaranteeDays}-day money-back guarantee`,
              ],
        offerAmountCents: offer.offerAmountCents,
        originalAmountCents: offer.originalAmountCents,
        currency: offer.currency,
        guaranteeDays: offer.guaranteeDays,
        expiresAt,
        checkoutUrl: link('/parent/offer'),
        primaryGap,
        primaryExam:
          context?.report?.exams.find((e) => e.eligible)?.label ?? 'NAPLAN',
      }),
      onSuccess: async () => {
        await trackEvent({
          event: 'OFFER_VIEWED',
          userId: state.user_id,
          props: { offerSlug: offer.slug, channel: 'email' },
        })
      },
    }
  }

  // Window closed without a purchase. Recorded once so the funnel reports a real
  // offer-to-purchase conversion instead of an open-ended one.
  if (status === 'expired') {
    // `trackEventOnce`, not `trackEvent`: this branch stays reachable on every
    // hourly worker pass for as long as the parent remains a candidate (offer
    // expired, no purchase). The comment above says "recorded once" - this is
    // what actually makes that true.
    await trackEventOnce({ event: 'OFFER_EXPIRED', userId: state.user_id })

    // CHECKOUT_ABANDONED is a SUBSET of offer expiry, not a synonym for it.
    //
    // A parent who never opened Stripe did not abandon a checkout - they
    // declined an offer. Conflating the two would make A11's
    // `checkout_abandonment_rate` measure offer rejection instead, and those
    // need opposite fixes: abandonment is a payment-flow problem (card fields,
    // an unexpected total, a redirect that failed), rejection is a price or
    // desire problem. Only parents who actually reached checkout belong here.
    //
    // Derived from the event log rather than a new column, because
    // CHECKOUT_STARTED is already emitted by OfferCheckoutButton and
    // CHECKOUT_COMPLETED by the Stripe webhook in purchase.ts. "The first
    // happened and the second did not" IS the definition of abandonment; a
    // separate flag would be a second source of truth for the same fact.
    const startedCheckout = await hasFiredEvent(state.user_id, 'CHECKOUT_STARTED')
    const completedCheckout = await hasFiredEvent(state.user_id, 'CHECKOUT_COMPLETED')

    if (startedCheckout && !completedCheckout) {
      await trackEventOnce({
        event: 'CHECKOUT_ABANDONED',
        userId: state.user_id,
        props: { offerSlug: offer?.slug ?? null },
      })
    }

  }

  return null
}

/** Minimum hours after a first purchase before any expansion pitch. */
const EXPANSION_AFTER_PURCHASE_HOURS = 72

/** Completed attempts by the family's children SINCE the purchase that count
 *  as "actually used what they bought". One is enough: the point is that the
 *  product entered the child's routine, not that a quota was hit. */
const EXPANSION_MIN_ATTEMPTS_SINCE_PURCHASE = 1

/** Customers scanned per worker pass. Bounded separately from the acquisition
 *  limit so neither sequence can starve the other. */
const EXPANSION_SCAN_LIMIT = 50

/**
 * Has any linked child completed an attempt since `sinceIso`?
 *
 * The usage gate for step 9, and deliberately a LIVE query rather than a
 * funnel_state counter: `completed_attempts` counts the whole journey and
 * cannot distinguish "practised after buying" from "practised before". Fails
 * closed - an unknown answer means no upsell, never the reverse.
 */
async function hasCompletedAttemptSince(userId: string, sinceIso: string): Promise<boolean> {
  try {
    const admin = createAdminClient()
    const { data: links, error: linkError } = await admin
      .from('parent_student_links')
      .select('student_id')
      .eq('parent_user_id', userId)
    if (linkError) return false

    const studentIds = ((links ?? []) as unknown as { student_id: string }[])
      .map((r) => r.student_id)
      .filter(Boolean)
    if (studentIds.length === 0) return false

    const { count, error } = await admin
      .from('attempts')
      .select('*', { count: 'exact', head: true })
      .in('student_id', studentIds)
      .in('status', ['SUBMITTED', 'COMPLETE'])
      .gt('submitted_at', sinceIso)
    if (error) return false

    return (count ?? 0) >= EXPANSION_MIN_ATTEMPTS_SINCE_PURCHASE
  } catch {
    return false
  }
}

/**
 * Step 9: the expansion email (sibling offer only, for now).
 *
 * FOUR GATES, ALL REQUIRED - each one exists because its absence is a known
 * failure mode, not because more conditions feel safer:
 *   1. >= 72h since the purchase. "An upsell at the moment a card clears reads
 *      as a cash grab and depresses the renewal that is worth more."
 *   2. Real usage: a linked child completed an attempt AFTER the purchase.
 *      The template's own footer promises this ("we only send expansion offers
 *      to families who have already used what they bought") - a promise the
 *      code must keep, not copy the email merely prints.
 *   3. Sibling eligibility from the SAME authority checkout uses
 *      (getSiblingOfferForUser): priced live offer, >= 2 children, redemption
 *      limit not reached. The email can never pitch what checkout would refuse.
 *   4. One send per family per kind, enforced structurally by email_log's
 *      unique slot (template 'expand', dedupeKey 'kind:SIBLING') - not by a
 *      flag this code could forget to set.
 *
 * No funnel event is emitted for the send itself: the catalogue declares none,
 * email_log is the system of record, and inventing an event name to look
 * instrumented is exactly the drift the coverage gate exists to prevent. The
 * OUTCOME is already measured - SECOND_PRODUCT_PURCHASED fires from the
 * webhook, so send -> purchase conversion is answerable from day one.
 *
 * NEXT_PACK and WRITING_BOOSTER variants of expandEmail are deliberately NOT
 * decided here yet: neither has a fulfilment mapping nor an in-product
 * surface, and an email must never outsell what checkout can deliver.
 */
async function decideExpansionEmail(
  state: FunnelState,
  childLabel: string
): Promise<DueEmail | null> {
  const sincePurchase = hoursSince(state.first_purchase_at)
  if (sincePurchase === null || sincePurchase < EXPANSION_AFTER_PURCHASE_HOURS) return null

  const view = await getSiblingOfferForUser(state.user_id)
  if (!view.eligible || !view.offer) return null

  const used = await hasCompletedAttemptSince(state.user_id, state.first_purchase_at as string)
  if (!used) return null

  const offer = view.offer
  return {
    reason: 'expansion_sibling',
    message: expandEmail({
      userId: state.user_id,
      childLabel,
      kind: 'SIBLING',
      productName: offer.name,
      offerAmountCents: offer.offerAmountCents,
      originalAmountCents: offer.originalAmountCents,
      currency: offer.currency,
      guaranteeDays: offer.guaranteeDays,
      includes: offer.includes,
      // The dashboard carries the one-tap re-purchase card (N-8), so the email
      // lands the parent where the offer is already resolved server-side
      // rather than on a page that could disagree with this pitch.
      checkoutUrl: link('/parent'),
    }),
    onSuccess: async () => {
      // No state to patch and no event to invent: email_log holds the send,
      // and expanded_at (set by recordPurchase) removes the family from the
      // candidate list when the offer converts.
    },
  }
}

/** Outcome of one worker run, returned to the cron caller for logging. */
export interface LifecycleRunResult {
  scanned: number
  sent: number
  skipped: number
  failed: number
}

/**
 * Run one lifecycle pass.
 *
 * Safe to call repeatedly and concurrently at the user level: `sendEmail`'s
 * unique slot means the worst case is a wasted query, never a duplicated email.
 *
 * Never throws. A cron endpoint that throws gets retried by the platform, and a
 * retry storm against a mail provider is how an account gets rate-limited.
 */
export async function runLifecycleWorker(limit = 200): Promise<LifecycleRunResult> {
  const result: LifecycleRunResult = { scanned: 0, sent: 0, skipped: 0, failed: 0 }

  if (!isConfigured()) {
    logger.info('[lifecycle] not configured, skipping run')
    return result
  }

  const candidates = [
    ...(await listWorkerCandidates(limit)),
    // Step 9: customers are scanned with their own bounded budget. Ordering
    // matters - acquisition first, so a large customer base can never push
    // unfinished funnels out of the pass.
    ...(await listExpansionCandidates(EXPANSION_SCAN_LIMIT)),
  ]
  result.scanned = candidates.length

  for (const state of candidates) {
    try {
      // Respect the minimum spacing between emails. Without it a parent who
      // reaches three milestones in one day gets three emails in one day.
      const sinceStageChange = hoursSince(state.stage_updated_at) ?? 0
      if (sinceStageChange < MIN_HOURS_BETWEEN_EMAILS) {
        result.skipped += 1
        continue
      }

      const context = await loadFamilyContext(state.user_id)
      const due = await decideNextEmail(state, context)
      if (!due) {
        result.skipped += 1
        continue
      }

      const outcome = await sendEmail({
        to: state.email ?? '',
        subject: due.message.subject,
        html: due.message.html,
        text: due.message.text,
        userId: state.user_id,
        template: due.message.template,
        dedupeKey: due.message.dedupeKey,
      })

      if (outcome.ok) {
        result.sent += 1
        if (!outcome.skipped) await due.onSuccess()
      } else {
        result.failed += 1
      }
    } catch (err) {
      // One bad user must not abort the whole pass.
      result.failed += 1
      logger.error('LIFECYCLE_USER', '[lifecycle] user pass failed', err, state.user_id)
    }
  }

  logger.info('[lifecycle] run complete', result)
  return result
}

/** Whether the email layer can actually deliver, surfaced for the health check. */
export function isLifecycleReady(): boolean {
  return isConfigured() && isEmailConfigured()
}

