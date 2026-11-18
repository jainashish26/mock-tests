/**
 * The P9 plan contract: types and constants shared by the SERVER loader and the
 * CLIENT form.
 *
 * WHY THIS MODULE EXISTS SEPARATELY FROM parent-plan.ts
 *   `PlanControls.tsx` is a client component ('use client') and needs the
 *   `PracticePlan` shape plus the 1..14 goal bounds. Importing those from
 *   `parent-plan.ts` drags that module's `./connection` import - and therefore
 *   `@/lib/supabase/server` and `next/headers` - into the browser bundle.
 *   Next.js rejects that at build time:
 *
 *     You're importing a component that needs "next/headers". That only works
 *     in a Server Component.
 *
 *   `tsc --noEmit` does NOT catch it, because it is a bundler-boundary error,
 *   not a type error - the import graph is perfectly well-typed. Only the
 *   build sees it. So the rule for this module is strict and deliberate:
 *
 *     NO IMPORTS AT ALL. Types and literal constants only.
 *
 *   That is what makes it safe on both sides of the boundary. Anything here
 *   that needed a runtime import would reintroduce the same failure.
 */

/** The stored plan, as returned by `public.parent_plan_get()`. */
export interface PracticePlan {
  student_id: string
  /** Parent-entered label, e.g. "Scholarship paper". Free text. */
  target_exam: string | null
  target_exam_type: string | null
  exam_date: string | null
  /** Whole days remaining, floored at 0 - never negative. */
  days_to_exam: number | null
  weekly_sessions_goal: number
  /** 'tests' | 'questions'. */
  unit_kind: string | null
  /** Today's target, already capped by year level. */
  daily_target_units: number | null
  /** What the plan requires per day to finish in time. PARENT ONLY. */
  required_daily: number | null
  /** The year-level cap applied. PARENT ONLY. */
  effective_cap: number | null
  /** True when required_daily exceeds the cap. PARENT ONLY. */
  plan_overload_flag: boolean | null
  updated_at: string
}

/**
 * Bounds on the weekly session goal.
 *
 * Mirrors the CHECK constraint on `public.student_exam_targets`
 * (`weekly_sessions_goal BETWEEN 1 AND 14`). Declared here so the client form
 * can validate before submitting and the server loader can produce a readable
 * message - but the constraint in the database is the actual enforcement
 * point, and `parent_plan_set()` re-checks it before the write.
 */
export const MIN_WEEKLY_SESSIONS = 1
export const MAX_WEEKLY_SESSIONS = 14

/** Input for a plan write. */
export interface SavePlanInput {
  studentId: string
  targetExam?: string | null
  targetExamType?: string | null
  examDate?: string | null
  weeklySessionsGoal?: number | null
}

export interface SavePlanResult {
  plan: PracticePlan | null
  /** True when the write was rejected. */
  error: boolean
  /** Postgres SQLSTATE. 42501 = not authorised, 22023 = invalid input. */
  code?: string
  /** Parent-facing message for a validation rejection. */
  message?: string
}
