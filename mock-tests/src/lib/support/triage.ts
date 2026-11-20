/**
 * Enquiry triage vocabulary - the pure half of the admin support queue.
 *
 * WHY MIRROR THE STATE MACHINE IN TYPESCRIPT AT ALL
 *   `admin_enquiry_transition()` is authoritative: it refuses a second first
 *   response, refuses `reply` after closure, and demands an outcome before
 *   resolution, all inside one transaction with the row locked. This module
 *   replaces none of that and must never be treated as the check.
 *
 *   It exists so the queue cannot *offer* an action the database will refuse.
 *   A button that is always going to fail is worse than no button: it teaches
 *   the operator that the interface lies, and it raises an error toast on a row
 *   that was already in the right state. Deriving the allowed actions from the
 *   same three facts the SQL uses (`status`, `first_response_at`,
 *   `resolved_at`) means the two agree by construction rather than by memory,
 *   and the agreement is asserted in scripts/enquiry.test.mts against a table
 *   of hand-written row states rather than against a running database.
 *
 *   If a guard is ever added to the SQL without its counterpart here, the UI
 *   offers something that 400s - annoying, not corrupting. The opposite error,
 *   hiding an action that would have worked, is the one the live probe watches
 *   for, so both directions are checked rather than only the easy one.
 */

export const ENQUIRY_STATUSES = [
  'new',
  'triaged',
  'in_progress',
  'waiting_on_customer',
  'resolved',
  'closed',
  'spam',
] as const
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number]

export const ENQUIRY_OUTCOMES = [
  'answered',
  'refunded',
  'escalated',
  'no_action',
  'spam',
  'duplicate',
  'withdrawn',
] as const
export type EnquiryOutcome = (typeof ENQUIRY_OUTCOMES)[number]

export const ENQUIRY_ACTIONS = [
  'triage',
  'start',
  'reply',
  'resolve',
  'close',
  'reopen',
  'assign',
  'spam',
] as const
export type EnquiryAction = (typeof ENQUIRY_ACTIONS)[number]

/**
 * Statuses that mean the work is finished.
 *
 * One list, used for the SLA state, the open counter and the reply guard. Two
 * definitions of "finished" is how a queue ends up showing a closed enquiry as
 * still breaching, or offering a reply on something already resolved.
 */
export const DONE_STATUSES: readonly EnquiryStatus[] = ['resolved', 'closed', 'spam']

export function isDone(status: EnquiryStatus): boolean {
  return DONE_STATUSES.includes(status)
}

/**
 * What the record knows about whether this enquiry was ever answered.
 *
 * Three values, not two, because the honest middle case is the whole point:
 *   recorded   a first response exists
 *   missing    finished, and no response was ever recorded - A13 must report
 *              this as unknown, not as "met"
 *   open       not finished, so the clock may still be set truthfully
 */
export type ResponseKnowledge = 'recorded' | 'missing' | 'open'

export function responseKnowledge(row: {
  status: EnquiryStatus
  first_response_at: string | null
}): ResponseKnowledge {
  if (row.first_response_at) return 'recorded'
  return isDone(row.status) ? 'missing' : 'open'
}

export interface TriageRow {
  status: EnquiryStatus
  first_response_at: string | null
  resolved_at: string | null
}

/**
 * The actions an operator may legitimately take on a row, right now.
 *
 * Each rule names the fact it depends on, because the set is only maintainable
 * if a reader can check it against the SQL without re-deriving it.
 */
export function allowedActions(row: TriageRow): EnquiryAction[] {
  const actions: EnquiryAction[] = []

  // Assignment is always available, including on a finished enquiry: re-rolling
  // a closed complaint onto someone else for a post-mortem is a real request,
  // and it moves nothing.
  actions.push('assign')

  if (isDone(row.status)) {
    // Only reopening. `reply` is refused deliberately, and its absence here is
    // the UI half of the guard in admin_enquiry_transition: a first response
    // entered now would be timed from receipt to this click, which is not when
    // anybody was answered. That gap is reported by responseKnowledge rather
    // than papered over with a button.
    actions.push('reopen')
    return actions
  }

  // A first response can be recorded exactly once.
  if (!row.first_response_at) actions.push('reply')

  if (row.status === 'new') actions.push('triage')

  // Resuming work. `waiting_on_customer` is in this list because it is exactly
  // the status you leave when the family replies - and the alternative, a
  // queue where the only moves available after they answer are resolve or
  // close, forces an outcome on an enquiry that is still being worked. The SQL
  // has never restricted `start` to those three states, so this is the UI
  // catching up to it rather than a new permission.
  if (
    row.status === 'new' ||
    row.status === 'triaged' ||
    row.status === 'waiting_on_customer'
  ) {
    actions.push('start')
  }

  // Both are available here: everything finished already returned above, so a
  // row reaching this line is open and can be ended either way.
  actions.push('resolve', 'close')
  actions.push('spam')

  return actions
}

/**
 * Whether an action needs an outcome, and so must open the outcome picker.
 *
 * Read from the same rule the SQL enforces, so the form cannot present a
 * button that fires a 400 at a missing required field.
 */
export function actionNeedsOutcome(action: EnquiryAction): boolean {
  return action === 'resolve' || action === 'close'
}

/** The status each action produces. Mirrors the CASE in the SQL exactly. */
export const ACTION_TARGET: Record<EnquiryAction, EnquiryStatus | null> = {
  triage: 'triaged',
  start: 'in_progress',
  reply: 'waiting_on_customer',
  resolve: 'resolved',
  close: 'closed',
  reopen: 'in_progress',
  // Assignment moves nothing. null is the signal the UI uses to keep the row's
  // current status rather than inventing one.
  assign: null,
  spam: 'spam',
}

/**
 * The six SLA states `admin_enquiry_queue()` can return.
 *
 * Listed rather than implied by a `string` so a test can assert the labels
 * module covers every one. `unknown_calendar` is the newest and the most
 * important: it exists so that a gap in the public-holiday calendar shows up as
 * "not computed" instead of silently becoming "within".
 */
export const SLA_STATES = [
  'met',
  'breached',
  'at_risk',
  'within',
  'unrecorded',
  'unknown_calendar',
] as const
export type SlaState = (typeof SLA_STATES)[number]

/** Which clock the promise is measured against. Mirrors the CHECK in 104/109. */
export const SLA_BASES = ['calendar', 'business'] as const
export type SlaBasis = (typeof SLA_BASES)[number]

export interface SlaFacts {
  sla_state: string
  age_minutes: number
  response_minutes: number | null
  resolution_hours: number | null
  /**
   * Only populated under the 'calendar' basis. NULL under 'business', where the
   * window is counted in days - which is why nothing may default this to 1440.
   */
  sla_minutes: number | null
  sla_basis: SlaBasis
  /** Only populated under the 'business' basis. */
  sla_business_days: number | null
  /** The computed deadline; NULL when the calendar cannot produce one. */
  due_at: string | null
  sla_is_confirmed: boolean
}

/**
 * Whether a row counts as a breach, for a screen that has to say so in words.
 *
 * Sourced from `sla_state` rather than recomputed here, on purpose. The
 * database owns the definition - §5.8's rule that an unanswered enquiry
 * breaches *now*, not only once resolved. A second implementation in a
 * component would be a second definition, and the two would diverge the first
 * time the threshold is tuned.
 */
export function isBreached(facts: Pick<SlaFacts, 'sla_state'>): boolean {
  return facts.sla_state === 'breached'
}

/**
 * The sentence a queue header shows beside the breach figures.
 *
 * Two things changed here in 109, and both were lies waiting to be told:
 *   * Q-5 is no longer "an open question". Decision 1-B answered it: the clock is
 *     business days. Repeating that it is unresolved would contradict the
 *     recorded decision on the screen that most needs to be current.
 *   * The window is no longer described in hours unconditionally. Under the
 *     business basis `sla_minutes` is NULL by design, and the old
 *     `numeric(sla_minutes, 1440)` fallback would have printed "24 continuous
 *     hours" beside a deadline measured in business days - a confidently wrong
 *     caption on the one line whose job is to say what was measured.
 *
 * What remains provisional is the sign-off, not the question.
 */
export function slaCaveat(
  facts: Pick<SlaFacts, 'sla_basis' | 'sla_minutes' | 'sla_business_days' | 'sla_is_confirmed'>
): string | null {
  if (facts.sla_is_confirmed) return null

  const days = facts.sla_business_days ?? 1
  const window =
    facts.sla_basis === 'business'
      ? `${days} business day${days === 1 ? '' : 's'}, measured to the close of the last ` +
        'one on the Victorian public-holiday calendar'
      : `${Math.round((facts.sla_minutes ?? 0) / 60)} continuous hours`

  return (
    `Provisional. Measured as ${window}. The published response time is read as ` +
    'business days (A-15 / Q-5 answered by decision 1-B); what is still outstanding ' +
    'is confirmation of that reading, so treat these figures as a measurement ' +
    'against an unconfirmed promise.'
  )
}

/**
 * The minimum reason an admin must give to read a parent's contact details.
 *
 * Mirrors `enquiry_contact_access_log.task_reason CHECK (length(trim()) >= 12)`.
 * The rule lives in the database; this exists so the form can ask for twelve
 * characters before the request rather than showing a raw 22023 after it.
 */
export const TASK_REASON_MIN = 12

export function taskReasonError(reason: unknown): string | null {
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    return 'A reason is required to read contact details.'
  }
  if (reason.trim().length < TASK_REASON_MIN) {
    return `Give a reason of at least ${TASK_REASON_MIN} characters. It is stored in the access audit.`
  }
  return null
}

/**
 * A duration in minutes phrased the way a person reads a queue.
 *
 * "2000 minutes" is not information. The queue is a triage surface, and the
 * whole reason an SLA column exists is to be glanced at and acted on.
 */
export function describeAge(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes) || minutes < 0) return 'unknown'
  if (minutes < 60) return `${Math.round(minutes)} min`
  const hours = minutes / 60
  if (hours < 48) return `${hours.toFixed(hours < 10 ? 1 : 0)} h`
  return `${Math.round(hours / 24)} d`
}

