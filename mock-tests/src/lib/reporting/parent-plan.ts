import { callReportingFunction, callReportingWrite } from './connection'
import { asAtFor } from './lag'
import {
  MAX_WEEKLY_SESSIONS,
  MIN_WEEKLY_SESSIONS,
  type PracticePlan,
  type SavePlanInput,
  type SavePlanResult,
} from './plan-types'

// Re-exported so existing server-side callers (the P9 API route, the child
// page) keep one import path. `PlanControls.tsx` imports from './plan-types'
// DIRECTLY instead, because this module pulls in `next/headers` via
// `./connection` and cannot be part of a client bundle. See plan-types.ts.
export { MAX_WEEKLY_SESSIONS, MIN_WEEKLY_SESSIONS }
export type { PracticePlan, SavePlanInput, SavePlanResult }

/**
 * Report P9 - Practice Plan Controls. "How do I set this up?"
 *
 * The only Phase 1 parent report that WRITES. §12.2 marks it no-store and
 * write-through: the plan is saved and the stored row is returned, so the
 * screen cannot disagree with the database about what was saved.
 *
 * THE ONLY SURFACE THAT EXPOSES plan_overload_flag
 *   `required_daily` and `plan_overload_flag` are computed in
 *   `reporting.mv_student_daily_target` but are deliberately absent from
 *   `public.student_today()`. A child sees the capped daily number; the parent
 *   sees that the plan is overloaded and needs adjusting. P9 is the
 *   parent-facing surface, so this is the correct and only place the overload
 *   figure appears - see the header comment on src/lib/reporting/student-today.ts.
 *
 * WHY THE WRITE GOES THROUGH A FUNCTION
 *   `parent_plan_set()` validates the goal range, rejects a past exam date,
 *   and validates the exam_type enum against pg_enum BEFORE casting. An
 *   unchecked `::exam_type` cast raises an error whose message embeds the
 *   caller's raw input, which would then be reflected back to the browser.
 *   The function also refreshes the student dims afterwards, so the child's
 *   daily target moves immediately instead of at the next nightly load -
 *   without that, "Save plan" would appear to do nothing.
 */

export interface ParentPlanResult {
  plan: PracticePlan | null
  asAt: string | null
  error: boolean
}

/** Load P9 for one child. A child with no plan row returns null, not an error. */
export async function loadParentPlan(studentId: string): Promise<ParentPlanResult> {
  const [res, asAt] = await Promise.all([
    callReportingFunction<PracticePlan>('parent_plan_get', { p_student_id: studentId }),
    asAtFor('mv_student_daily_target'),
  ])

  if (res.error) return { plan: null, asAt, error: true }
  return { plan: res.rows[0] ?? null, asAt, error: false }
}

/**
 * Save the plan (write-through).
 *
 * Validation happens in SQL. The checks here exist to give a readable message
 * without a round trip, not as the enforcement point - a caller that skipped
 * this module would still be rejected by the function.
 */
export async function saveParentPlan(input: SavePlanInput): Promise<SavePlanResult> {
  const goal = input.weeklySessionsGoal ?? null

  if (goal !== null && (goal < MIN_WEEKLY_SESSIONS || goal > MAX_WEEKLY_SESSIONS)) {
    return {
      plan: null,
      error: true,
      code: '22023',
      message: `Weekly sessions must be between ${MIN_WEEKLY_SESSIONS} and ${MAX_WEEKLY_SESSIONS}.`,
    }
  }

  // Checked here too, so the parent sees a readable message about their own
  // input rather than a database rejection.
  if (input.examDate) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (new Date(input.examDate) < today) {
      return {
        plan: null,
        error: true,
        code: '22023',
        message: 'The exam date cannot be in the past.',
      }
    }
  }

  const res = await callReportingWrite<PracticePlan>('parent_plan_set', {
    p_student_id: input.studentId,
    p_target_exam: input.targetExam ?? null,
    p_target_exam_type: input.targetExamType ?? null,
    p_exam_date: input.examDate ?? null,
    p_weekly_sessions_goal: goal,
  })

  if (res.error) {
    return {
      plan: null,
      error: true,
      code: res.code,
      message:
        res.code === '42501'
          ? 'You are not authorised to change this plan.'
          : 'The plan could not be saved. Please try again.',
    }
  }

  return { plan: res.rows[0] ?? null, error: false }
}

// `overloadSentence` lives in ./format so it can be tested in Node without
// dragging `next/headers` in via ./connection. Re-exported here so
// `@/lib/reporting/parent-plan` stays the single import path for callers.
export { overloadSentence } from './format'


