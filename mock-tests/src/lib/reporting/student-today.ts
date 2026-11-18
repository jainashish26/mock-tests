import { createClient } from '@/lib/supabase/server'

/**
 * Report S1 (exam countdown) and S2 (daily practice target) - the only two reads a
 * student is permitted.
 *
 * WHY THIS MODULE EXISTS
 *   The student role must have no access to scores, percentages, percentiles,
 *   correctness, mastery, writing marks, trends or any report. That is enforced in
 *   the database by migration 015 (no student SELECT policy on `attempts`,
 *   `responses` or `writing_evaluations`, plus the `may_read_results()` guard) and
 *   by migrations 014/016/017 (no grant on any reporting materialised view).
 *
 *   This module is the third layer. `StudentToday` is a closed type with no numeric
 *   result field in it, so a caller cannot destructure a score that the API never
 *   returns, and TypeScript will reject an attempt to add one without a deliberate
 *   edit here. `public.student_today()` is a SECURITY DEFINER function whose
 *   RETURNS clause has the same shape - the database cannot return what its
 *   signature does not declare.
 *
 * WHAT IS DELIBERATELY ABSENT
 *   `required_daily` and `plan_overload_flag` are computed in
 *   `reporting.mv_student_daily_target` but are NOT selected by
 *   `reporting.v_student_today`, so they never reach this type. When a missed day
 *   pushes the required load above the year-level cap, the child keeps seeing the
 *   capped number and the parent gets a plan-adjustment notice instead. The
 *   overload figure is parent-facing only, and there is no code path here by which
 *   it could become child-facing.
 */

/** One row per assigned exam the student has a plan for. */
export interface StudentToday {
  student_id: string
  /** Parent-entered label, e.g. "Scholarship paper". Free text, may be null. */
  exam_label: string | null
  exam_date: string | null
  /** Whole days remaining, floored at 0 - never negative (rule S1). */
  days_to_exam: number | null
  exam_passed: boolean | null
  /** Today's target, already capped by year level. */
  daily_target_units: number | null
  /** 'tests' | 'questions' - drives the noun shown next to the number. */
  unit_kind: string | null
}

export interface StudentTodayResult {
  rows: StudentToday[]
  /** True when the query failed. The UI shows its error state rather than an
   *  empty dashboard, so a parent is not told "no exam set" when one is. */
  error: boolean
}

/**
 * Load S1 + S2 for a student.
 *
 * Uses the user-scoped server client so the caller's JWT reaches Postgres and
 * `auth.uid()` inside the function resolves to the real user. The admin client
 * must NOT be used here: it would make `auth.uid()` null and the function's
 * authorisation check would reject the call.
 *
 * Never throws. A reporting failure should degrade the student dashboard to its
 * error state, not take down the page - and a child must never see a stack trace.
 */
export async function loadStudentToday(studentId: string): Promise<StudentTodayResult> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('student_today', { p_student_id: studentId })

    if (error) return { rows: [], error: true }

    return { rows: (data as StudentToday[] | null) ?? [], error: false }
  } catch {
    return { rows: [], error: true }
  }
}

/**
 * The single row to show when a student has one active exam target.
 *
 * A child may have several exam dates; the dashboard leads with the nearest one
 * that has not passed, because "how long until MY exam" is a singular question and
 * answering it with a list is answering a different question.
 */
export function primaryTarget(rows: StudentToday[]): StudentToday | null {
  const upcoming = rows
    .filter((r) => r.days_to_exam !== null && r.exam_passed !== true)
    .sort((a, b) => (a.days_to_exam ?? Infinity) - (b.days_to_exam ?? Infinity))

  return upcoming[0] ?? rows[0] ?? null
}

/**
 * Plain-English framing for the daily target (rules B4, B5, B10).
 *
 * Positive framing only. There is no "you are behind" wording, no reference to a
 * missed day, and no loss frame - the target is what to do today, not a judgement
 * on yesterday. Copy is written to roughly a Year 4 reading level, which is the
 * midpoint of Years 2-8 (assumption A-10).
 */
export function targetSentence(t: StudentToday | null): string {
  const units = t?.daily_target_units ?? 0
  const noun = (t?.unit_kind === 'questions' ? 'question' : 'test') + (units === 1 ? '' : 's')

  if (units <= 0) return 'No practice needed today. Enjoy your day off!'
  return `Aim for ${units} ${noun} today.`
}

/**
 * Plain-English framing for the countdown.
 *
 * Never renders a negative number - `days_to_exam` is floored at 0 in SQL and
 * `exam_passed` handles the after-the-fact case, because "-3 days" is meaningless
 * to a child and reads as an error.
 */
export function countdownSentence(t: StudentToday | null): string {
  if (!t?.exam_date) return 'No exam set yet.'
  if (t.exam_passed) return 'Your exam is done. Nice work!'

  const days = t.days_to_exam ?? 0
  if (days === 0) return 'Your exam is today. You have got this!'
  if (days === 1) return '1 day to go!'
  return `${days} days to go!`
}
