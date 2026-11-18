/**
 * Funnel event catalogue.
 *
 * A closed, typed vocabulary rather than free-form strings. Free-form event
 * names are how analytics dies: six months in nobody knows whether the signup
 * event is `signup`, `sign_up`, `user_signed_up` or `Signup`, and every
 * conversion number becomes an argument. Declaring the names here means the
 * compiler rejects a typo and the funnel query in `funnel_conversion` stays
 * honest.
 *
 * Each event is tagged with the funnel step it belongs to so the mapping back
 * to the 10-stage spec is explicit and reviewable.
 */

/** The 10 acquisition-to-renewal stages from the funnel specification. */
import type { DeviceClass } from './device'


export const FUNNEL_STEPS = [
  'acquire',
  'signup',
  'first_value',
  'readiness_report',
  'second_session',
  'paywall',
  'offer',
  'onboard',
  'expand',
  'renew',
] as const

export type FunnelStep = (typeof FUNNEL_STEPS)[number]

/**
 * Event name -> funnel step.
 *
 * Kept as a single flat record so `EVENT_NAMES` can be derived from it and so a
 * reviewer can check the whole taxonomy on one screen.
 */
export const EVENT_STEP: Record<string, FunnelStep> = {
  // 1. Acquire
  LANDING_VIEWED: 'acquire',
  REFERRAL_LANDED: 'acquire',
  REFERRAL_SHARED: 'acquire',
  REFERRAL_REWARDED: 'acquire',
  PRICING_VIEWED: 'acquire',
  SIGNUP_STARTED: 'signup',

  // 2. Signup
  SIGNUP_COMPLETED: 'signup',
  OAUTH_COMPLETED: 'signup',
  LOGIN_COMPLETED: 'signup',

  // 3. First Value
  ONBOARDING_STARTED: 'first_value',
  STUDENT_ADDED: 'first_value',
  EXAM_TARGET_SET: 'first_value',
  DIAGNOSTIC_OFFERED: 'first_value',
  DIAGNOSTIC_STARTED: 'first_value',
  DIAGNOSTIC_ABANDONED: 'first_value',
  DIAGNOSTIC_COMPLETED: 'first_value',
  ONBOARDING_COMPLETED: 'first_value',

  // 4. Readiness Report
  READINESS_REPORT_GENERATED: 'readiness_report',
  READINESS_REPORT_EMAILED: 'readiness_report',
  READINESS_REPORT_VIEWED: 'readiness_report',

  // 5. Second Session
  SECOND_SESSION_GRANTED: 'second_session',
  SECOND_SESSION_EMAILED: 'second_session',
  SECOND_SESSION_STARTED: 'second_session',
  SECOND_SESSION_COMPLETED: 'second_session',
  SECOND_SESSION_EXPIRED: 'second_session',

  // 6. Natural Paywall
  PAYWALL_TRIGGERED: 'paywall',
  PAYWALL_VIEWED: 'paywall',
  PAYWALL_LOCK_CLICKED: 'paywall',
  PAYWALL_DISMISSED: 'paywall',
  PAYWALL_EMAILED: 'paywall',

  // 7. Offer
  OFFER_MADE: 'offer',
  OFFER_VIEWED: 'offer',
  OFFER_CTA_CLICKED: 'offer',
  CHECKOUT_STARTED: 'offer',
  CHECKOUT_COMPLETED: 'offer',
  CHECKOUT_ABANDONED: 'offer',
  OFFER_EXPIRED: 'offer',

  // 8. Onboard
  STUDY_PLAN_CREATED: 'onboard',
  // STUDY_PLAN_SESSION_COMPLETED / STUDY_PLAN_SESSION_MISSED were REMOVED here
  // by migration 039. They duplicated DAILY_TARGET_MET / DAILY_TARGET_MISSED
  // below: two names, same funnel step ('onboard'), same measurement. Nothing
  // had emitted either, so the duplication had never been forced into the open.
  //
  // The surviving pair is the accurate one. This job counts tests or questions
  // against `daily_target_units`, which is a DAILY TARGET, not a session: a
  // child who answers ten questions in one sitting has met a ten-question
  // target in a single session, so "session completed" would be the wrong word
  // for a true result. The catalogue's own header warns that duplicate names
  // are how analytics dies - a declared-but-unemitted event is an invitation
  // for the next engineer to wire it and split one metric across two names.

  // 9. Expand
  SIBLING_OFFER_VIEWED: 'expand',
  SIBLING_ADDED: 'expand',
  CROSSSELL_VIEWED: 'expand',
  SECOND_PRODUCT_PURCHASED: 'expand',

  // 10. Renew
  RENEWAL_REMINDER_SENT: 'renew',
  RENEWAL_COMPLETED: 'renew',
  SUBSCRIPTION_PAUSED: 'renew',
  SUBSCRIPTION_RESUMED: 'renew',
  SUBSCRIPTION_CANCELLED: 'renew',
  YEAR_IN_REVIEW_SENT: 'renew',
  CHURNED: 'renew',

  // Cross-cutting
  EMAIL_OPENED: 'readiness_report',
  EMAIL_CLICKED: 'readiness_report',
  EMAIL_UNSUBSCRIBED: 'readiness_report',

  // ---------------------------------------------------------------------------
  // Reporting events (11-bi-reporting-design.md §6.3).
  //
  // These exist because the original catalogue instrumented the FUNNEL but not the
  // PRODUCT. Without them there is no denominator for paid-test completion (A4),
  // no source for pacing/skip/guess metrics (P7), no item-level timing (A1), no
  // marking-pipeline telemetry (A5-A7), and no way to detect an error that happens
  // while a child is mid-test (A14).
  //
  // ITEM_ANSWERED is the high-volume one - roughly one per question per attempt.
  // The owner chose to wire it batched rather than rely on the nightly ETL from
  // public.responses, accepting the write volume in exchange for near-real-time
  // item analytics. It is flushed in batches by the runner, never one request per
  // answer: that alone would break the 2s mobile budget and the serverless bill.
  //
  // ITEM_ANSWERED deliberately carries NO `isCorrect`. Putting correctness into an
  // analytics event would leak results into a table that student sessions write to,
  // which is the exact boundary migration 015 exists to hold.
  // ---------------------------------------------------------------------------
  TEST_STARTED: 'first_value',
  ITEM_ANSWERED: 'first_value',
  TEST_SUBMITTED: 'first_value',
  TEST_ABANDONED: 'first_value',
  ITEM_FLAGGED: 'first_value',

  WRITING_MARK_COMPLETED: 'readiness_report',
  WRITING_MARK_FLAGGED: 'readiness_report',

  ENQUIRY_CREATED: 'acquire',
  ENQUIRY_FIRST_RESPONDED: 'acquire',
  ENQUIRY_RESOLVED: 'acquire',

  DAILY_TARGET_MET: 'onboard',
  DAILY_TARGET_MISSED: 'onboard',
  PRACTICE_PLAN_CHANGED: 'onboard',
  CONSENT_GRANTED: 'onboard',
  CONSENT_REVOKED: 'onboard',

  REPORT_VIEWED: 'readiness_report',

  // `phase: 'during_test'` is what makes this metric meaningful - an error on a
  // marketing page is not an error during a test. No stack traces or messages in
  // props: they can contain user input.
  ERROR_OCCURRED: 'first_value',
} as const

export type FunnelEventName = keyof typeof EVENT_STEP

/** Every known event name, for validation at the API boundary. */
export const EVENT_NAMES = Object.keys(EVENT_STEP) as FunnelEventName[]

const EVENT_NAME_SET = new Set<string>(EVENT_NAMES)

/** True when `name` is a declared event. Unknown names are dropped, not stored. */
export function isKnownEvent(name: unknown): name is FunnelEventName {
  return typeof name === 'string' && EVENT_NAME_SET.has(name)
}

/** The funnel step an event belongs to, or null for an unknown name. */
export function stepForEvent(name: string): FunnelStep | null {
  return isKnownEvent(name) ? EVENT_STEP[name] : null
}

/**
 * The persisted lifecycle stage an event implies, if any.
 *
 * Only a subset of events move the stage pointer - most are behavioural signals
 * that inform the emails but do not represent progress. Returning undefined
 * means "record the event, leave the stage alone".
 */
export const EVENT_STAGE: Partial<Record<FunnelEventName, string>> = {
  SIGNUP_COMPLETED: 'SIGNED_UP',
  OAUTH_COMPLETED: 'SIGNED_UP',
  STUDENT_ADDED: 'STUDENT_ADDED',
  DIAGNOSTIC_STARTED: 'DIAGNOSTIC_STARTED',
  DIAGNOSTIC_COMPLETED: 'FIRST_VALUE',
  READINESS_REPORT_EMAILED: 'REPORT_SENT',
  SECOND_SESSION_GRANTED: 'SECOND_OFFERED',
  PAYWALL_TRIGGERED: 'PAYWALL_READY',
  OFFER_MADE: 'OFFER_MADE',
  CHECKOUT_COMPLETED: 'CUSTOMER',
  STUDY_PLAN_CREATED: 'ONBOARDED',
  SECOND_PRODUCT_PURCHASED: 'EXPANDED',
  RENEWAL_COMPLETED: 'RENEWED',
}

/**
 * Payload accepted by `trackEvent`.
 *
 * `props` is deliberately loose: the whole point of an event store is that a
 * new question can be answered without a schema migration. The *name* is
 * strict, the *context* is flexible.
 */
export interface TrackEventInput {
  event: FunnelEventName
  userId?: string | null
  anonymousId?: string | null
  studentId?: string | null
  props?: Record<string, unknown>
  path?: string | null
  referrer?: string | null
  utm?: Record<string, string> | null
  /**
   * Coarse device class, for CRO requirement C9 (every funnel number split by
   * device). Pass `classifyDevice(req)` wherever a Request is available.
   *
   * When omitted, `trackEvent` resolves the visitor's last known device rather
   * than writing 'unknown' - which matters because most stage-bearing events are
   * emitted by the lifecycle worker and other server paths that have no Request
   * at all. See src/lib/funnel/device.ts for why this was previously unmet.
   */
  device?: DeviceClass | null
}

/** Row shape written to `funnel_events`. */
export interface FunnelEventRow {
  user_id: string | null
  anonymous_id: string | null
  student_id: string | null
  event: string
  stage: string | null
  props: Record<string, unknown>
  path: string | null
  referrer: string | null
  utm: Record<string, string> | null
}

/** UTM keys worth persisting. Anything else is dropped to keep rows small. */
const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'] as const

/**
 * Normalise a raw UTM object down to the known keys.
 *
 * Browsers can send arbitrary query strings; storing them verbatim would let a
 * crafted URL write unbounded JSON into every event row.
 */
export function normalizeUtm(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const key of UTM_KEYS) {
    const value = source[key] ?? source['utm_' + key]
    if (typeof value === 'string' && value.trim()) {
      out[key] = value.trim().slice(0, 200)
    }
  }
  return Object.keys(out).length > 0 ? out : null
}

/** Cap a free-form string so a pasted URL cannot bloat the row. */
function truncate(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

/**
 * Convert a validated `TrackEventInput` into an insertable row.
 *
 * Returns null when neither identifier is present - a row with no user_id and
 * no anonymous_id can never be joined to anything. The DB CHECK enforces the
 * same rule, but rejecting here avoids a pointless round trip and an error log.
 */
export function toEventRow(input: TrackEventInput): FunnelEventRow | null {
  const userId = truncate(input.userId, 64)
  const anonymousId = truncate(input.anonymousId, 64)
  if (!userId && !anonymousId) return null

  return {
    user_id: userId,
    anonymous_id: anonymousId,
    student_id: truncate(input.studentId, 64),
    event: input.event,
    stage: EVENT_STAGE[input.event] ?? null,
    // Spread into a fresh object so a caller mutating its input afterwards
    // cannot change what was already serialised.
    //
    // `device` is written into props because reporting.load_event_facts() reads
    // props->>'device' into fact_event.device_class. It is set here rather than
    // by each caller so no call site can forget it; an explicit input.device
    // wins over anything a caller happened to put in props.
    props: {
      ...(input.props ?? {}),
      ...(input.device ? { device: input.device } : {}),
    },
    path: truncate(input.path, 500),
    referrer: truncate(input.referrer, 500),
    utm: normalizeUtm(input.utm),
  }
}

