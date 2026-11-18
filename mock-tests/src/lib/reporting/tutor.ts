import { callReportingFunction, callReportingWrite } from './connection'
import type {
  ItemStatisticsRow,
  TutorAssignmentRow,
  TutorAtRiskRow,
  TutorConsentRow,
  TutorRecommendationRow,
  TutorSkillGapRow,
  TutorStudentRow,
} from './types'

/**
 * Tutor surface (T1/T2/T3) and P10 consent management.
 *
 * THE ACCESS MODEL (decision D-B, confirmed by the owner)
 *   A tutor sees all reports for students linked to them by a CURRENT consent
 *   record, and nothing else - no unlinked students, no billing. Consent is
 *   granted and revoked by the PARENT through P10, defaults to 12 months, and
 *   both revocation and expiry take effect on the tutor's next query because
 *   `is_tutor_of()` evaluates them at read time.
 *
 *   Every function here is gated in SQL on `is_tutor_of(student_id)`, which
 *   requires BOTH the link and live consent. A tutor with no consent gets zero
 *   rows rather than an error, matching the parent reports' shape.
 *
 * WHY THESE DO NOT ADMIT ADMIN
 *   Admin row-level student access must be pseudonymous, audited and
 *   reason-required (AC-30..34). Routing an admin through a tutor endpoint would
 *   bypass that control, so these are tutor-only and admin uses the audited
 *   drilldown instead.
 *
 * BANDING
 *   T1 returns raw scores. `bandForScore()` in src/lib/report/readiness.ts is the
 *   single definition of a band; §5.4 explicitly forbids T1 defining its own.
 */

export type {
  ItemStatisticsRow,
  TutorAssignmentRow,
  TutorAtRiskRow,
  TutorConsentRow,
  TutorRecommendationRow,
  TutorSkillGapRow,
  TutorStudentRow,
} from './types'

export interface TutorReportResult<T> {
  rows: T[]
  error: boolean
  code?: string
}

/** T1 - Student Overview. */
export async function loadTutorOverview(periodDays = 30): Promise<TutorReportResult<TutorStudentRow>> {
  const res = await callReportingFunction<TutorStudentRow>('tutor_student_overview', {
    p_period_days: periodDays,
  })
  return res.error ? { rows: [], error: true, code: res.code } : { rows: res.rows, error: false }
}

/** T2 - Skill Gap, scoped to consented students. */
export async function loadTutorSkillGaps(): Promise<TutorReportResult<TutorSkillGapRow>> {
  const res = await callReportingFunction<TutorSkillGapRow>('tutor_skill_gaps', {})
  return res.error ? { rows: [], error: true, code: res.code } : { rows: res.rows, error: false }
}

/** T3 - At-Risk List. Every row names its rule. */
export async function loadTutorAtRisk(): Promise<TutorReportResult<TutorAtRiskRow>> {
  const res = await callReportingFunction<TutorAtRiskRow>('tutor_at_risk', {})
  return res.error ? { rows: [], error: true, code: res.code } : { rows: res.rows, error: false }
}

/**
 * T5 - Assignment Tracker: what this tutor set, and what is outstanding.
 *
 * Only assignments the CALLING TUTOR created, for students with a current
 * consent. `status` filters on the derived partition (assigned/started/
 * completed/overdue); omit it for the whole chase list. Overdue is evaluated in
 * SQL against now(), so it is never an hour stale.
 */
export async function loadTutorAssignments(
  status?: string | null
): Promise<TutorReportResult<TutorAssignmentRow>> {
  const res = await callReportingFunction<TutorAssignmentRow>('tutor_assignments', {
    p_status: status ?? null,
  })
  return res.error ? { rows: [], error: true, code: res.code } : { rows: res.rows, error: false }
}

/**
 * T7 - Next-Best Recommendations for consented students.
 *
 * The same numbers P8 shows the parent: both read reporting.recommendations_scored().
 * At most three per student. `studentId` narrows to one child; omit it for the
 * whole roster.
 */
export async function loadTutorRecommendations(
  studentId?: string | null
): Promise<TutorReportResult<TutorRecommendationRow>> {
  const res = await callReportingFunction<TutorRecommendationRow>('tutor_recommendations', {
    p_student_id: studentId ?? null,
  })
  return res.error ? { rows: [], error: true, code: res.code } : { rows: res.rows, error: false }
}

/**
 * T4 - Item Analysis for a test THIS TUTOR assigned.
 *
 * SAME NUMBERS AS A1. Both read `reporting.item_statistics()`, so p_value,
 * point-biserial and the distractor breakdown have exactly one definition
 * (§5 X-6). A1 materialises it over every student; T4 calls it live over the
 * intersection of "students I assigned this test to" and "students whose consent
 * is live right now".
 *
 * `testId` is REQUIRED and this throws rather than defaulting. §12 specifies 403
 * unless the tutor assigned that test, and `tutor_item_analysis()` raises
 * SQLSTATE 42501 in that case - which the route maps to 403. Falling back to the
 * whole bank would be the one request shape that leaks item statistics across
 * tests the tutor never set.
 *
 * A 403 here is deliberate and different from the other tutor reports, which
 * return zero rows for a missing consent. "You did not set this work" is an
 * authorisation failure and must not be indistinguishable from "this test has no
 * data" - a tutor who cannot tell those apart will keep re-assigning work that
 * already has responses.
 */
export async function loadTutorItemAnalysis(
  testId: string
): Promise<TutorReportResult<ItemStatisticsRow>> {
  const res = await callReportingFunction<ItemStatisticsRow>('tutor_item_analysis', {
    p_test_id: testId,
  })
  return res.error ? { rows: [], error: true, code: res.code } : { rows: res.rows, error: false }
}

/**
 * T7's "Assign" action - set a published test to a consented student.
 *
 * Authorisation and every validation rule live in `tutor_assign_test()`: live
 * consent, test is PUBLISHED, due date in the future, and the student's year level
 * inside the test's band. The route does not re-check any of them, because a rule
 * enforced in two places is a rule that will eventually be enforced in one.
 *
 * Re-assigning the same test is allowed. T5 attributes each attempt to exactly one
 * assignment (migration 075), so setting the same test again after a poor attempt
 * does not corrupt the tracker - and refusing it would block an ordinary teaching
 * action.
 */
export async function assignTest(
  studentId: string,
  testId: string,
  dueAt: string | null
): Promise<{ assignmentId: string | null; error: boolean; code?: string }> {
  const res = await callReportingWrite<string>('tutor_assign_test', {
    p_student_id: studentId,
    p_test_id: testId,
    p_due_at: dueAt,
  })
  if (res.error) return { assignmentId: null, error: true, code: res.code }
  return { assignmentId: res.rows[0] ?? null, error: false }
}

/** One published test a tutor may set, with how well it covers the topic. */
export interface AssignableTestRow {
  test_id: string
  title: string
  exam_type: string | null
  year_level_min: number
  year_level_max: number
  time_limit_mins: number
  /** Questions in this test on the recommended subject/topic. */
  matching_items: number
  total_items: number
}

/**
 * Which tests this tutor may assign for a T7 recommendation.
 *
 * A test has no subject or topic of its own - those live on its questions - so
 * "tests covering this topic" is a join through test_questions, filtered to the
 * student's year band. That is done in SQL because doing it in the browser would
 * mean shipping the whole catalogue to a tutor entitled to see only their consented
 * students' material.
 *
 * Ordered by coverage: the recommendation exists because the student is weak in
 * this topic, so the test with the most questions ON it is the one that will
 * actually practise it.
 */
export async function loadAssignableTests(
  studentId: string,
  subject?: string | null,
  topic?: string | null
): Promise<TutorReportResult<AssignableTestRow>> {
  const res = await callReportingFunction<AssignableTestRow>('tutor_assignable_tests', {
    p_student_id: studentId,
    p_subject: subject ?? null,
    p_topic: topic ?? null,
  })
  return res.error ? { rows: [], error: true, code: res.code } : { rows: res.rows, error: false }
}

/** Outcome of one reminder request, per recipient class. */
export interface RemindResult {
  queued: number
  already_sent: number
  unreachable: number
  reason: string | null
  error: boolean
  code?: string
}

/**
 * T5's "Remind" action - queue an email about an outstanding assignment.
 *
 * Recipients are the student AND every linked parent. The student is a minor and
 * the parent is the one who granted the tutor access through P10, so notifying only
 * the child would route the reminder to the person least able to act on it.
 *
 * RATE LIMITED BY CONSTRUCTION, not by client-side disabling of a button.
 * `email_log` has a unique index on (user_id, template, dedupe_key) and the dedupe
 * key includes the assignment and today's date, so one reminder per recipient per
 * day however many times the control is clicked. An overdue assignment is exactly
 * where a frustrated tutor clicks repeatedly, and the family should not receive six
 * emails because of it. `already_sent` reports the suppression so the control does
 * not look broken.
 */
export async function remindAssignment(assignmentId: string): Promise<RemindResult> {
  const res = await callReportingWrite<{
    queued: number
    already_sent: number
    unreachable: number
    reason: string | null
  }>('tutor_remind', { p_assignment_id: assignmentId })

  if (res.error) {
    return { queued: 0, already_sent: 0, unreachable: 0, reason: null, error: true, code: res.code }
  }

  const row = res.rows[0]
  return {
    queued: row?.queued ?? 0,
    already_sent: row?.already_sent ?? 0,
    unreachable: row?.unreachable ?? 0,
    reason: row?.reason ?? null,
    error: false,
  }
}

/** P10 - the parent's view of who can see this child's data. */
export async function loadTutorConsents(studentId: string): Promise<TutorReportResult<TutorConsentRow>> {
  const res = await callReportingFunction<TutorConsentRow>('parent_tutor_consents', {
    p_student_id: studentId,
  })
  return res.error ? { rows: [], error: true, code: res.code } : { rows: res.rows, error: false }
}

/**
 * P10 - grant consent. Returns the new consent id, or an error code.
 *
 * Duration is bounded 1..24 months in SQL; an indefinite grant is not offered,
 * because access to a child's data should always have an end date.
 */
export async function grantTutorConsent(
  studentId: string,
  tutorUserId: string,
  months = 12
): Promise<{ consentId: string | null; error: boolean; code?: string }> {
  const res = await callReportingWrite<string>('parent_grant_tutor_consent', {
    p_student_id: studentId,
    p_tutor_user_id: tutorUserId,
    p_months: months,
  })
  if (res.error) return { consentId: null, error: true, code: res.code }
  return { consentId: res.rows[0] ?? null, error: false }
}

/**
 * P10 - grant consent by tutor email, which is what a tutor can actually tell a
 * parent. Resolution and authorisation happen in SQL; the caller never gets a
 * general user-lookup capability, and unknown-address vs not-a-tutor return the
 * same error so this cannot enumerate accounts.
 */
export async function grantTutorConsentByEmail(
  studentId: string,
  tutorEmail: string,
  months = 12
): Promise<{ consentId: string | null; error: boolean; code?: string }> {
  const res = await callReportingWrite<string>('parent_grant_tutor_consent_by_email', {
    p_student_id: studentId,
    p_tutor_email: tutorEmail,
    p_months: months,
  })
  if (res.error) return { consentId: null, error: true, code: res.code }
  return { consentId: res.rows[0] ?? null, error: false }
}

/**
 * P10 - revoke consent. Takes effect on the tutor's next request.
 *
 * The link is left intact so the parent can re-grant without re-adding the tutor,
 * and the consent record is never deleted - it is an audit trail.
 */
export async function revokeTutorConsent(
  studentId: string,
  tutorUserId: string
): Promise<{ revoked: number; error: boolean; code?: string }> {
  const res = await callReportingWrite<number>('parent_revoke_tutor_consent', {
    p_student_id: studentId,
    p_tutor_user_id: tutorUserId,
  })
  if (res.error) return { revoked: 0, error: true, code: res.code }
  return { revoked: res.rows[0] ?? 0, error: false }
}

/** Human wording for a consent state, for the P10 list. */
export function consentStateLabel(state: TutorConsentRow['state']): string {
  switch (state) {
    case 'ACTIVE':
      return 'Has access'
    case 'REVOKED':
      return 'Access withdrawn'
    case 'EXPIRED':
      return 'Access expired'
    case 'NO_CONSENT':
      return 'Never granted'
    default:
      return state
  }
}

/** Human wording for an at-risk rule, so a tutor can disagree with it (TU1). */
export function atRiskRuleLabel(rule: TutorAtRiskRow['at_risk_rule']): string {
  switch (rule) {
    case 'DECLINING_TREND':
      return 'Scores declining'
    case 'LOW_ENGAGEMENT':
      return 'Not practising'
    case 'REPEATED_MISCONCEPTION':
      return 'Recurring weak topics'
    default:
      return rule
  }
}

/** T5 - the four-column partition, in the words the spec uses. */
export function assignmentStatusLabel(status: TutorAssignmentRow['assignment_status']): string {
  switch (status) {
    case 'ASSIGNED':
      return 'Assigned'
    case 'STARTED':
      return 'Started'
    case 'COMPLETED':
      return 'Completed'
    case 'OVERDUE':
      return 'Overdue'
    default:
      return status
  }
}

/**
 * T5 - deadline wording. NO_DUE_DATE must never render as "on time": no deadline
 * was set, so there is nothing to be on time against.
 */
export function dueStateLabel(dueState: TutorAssignmentRow['due_state']): string {
  switch (dueState) {
    case 'NO_DUE_DATE':
      return 'No due date'
    case 'MET':
      return 'Handed in'
    case 'OVERDUE':
      return 'Overdue'
    case 'ON_TIME':
      return 'On time'
    default:
      return dueState
  }
}
