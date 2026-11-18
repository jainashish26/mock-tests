import { envelope, reportJson } from '@/lib/reporting/envelope'
import { requireReportingRole } from '@/lib/reporting/route-auth'
import { requireStudentId } from '@/lib/reporting/route-params'
import { trackEvent } from '@/lib/funnel/track'
import {
  loadParentPlan,
  saveParentPlan,
  MAX_WEEKLY_SESSIONS,
  MIN_WEEKLY_SESSIONS,
  overloadSentence,
  type PracticePlan,
} from '@/lib/reporting/parent-plan'

/**
 * P9 - Practice Plan Controls. GET/PUT /api/reporting/parent/plan
 *
 * The only Phase 1 parent report that writes. §12.2 marks it no-store and
 * write-through, and specifies that it emits `PRACTICE_PLAN_CHANGED`.
 *
 * WHY no-store ON BOTH VERBS
 *   A cached GET would show a parent the plan as it was before they saved it.
 *   On a write-through screen that is not a stale number, it is a lie about
 *   whether their action took effect - and the parent's response is to save
 *   again, or to stop trusting the screen.
 *
 * WHY THE EVENT IS EMITTED AFTER THE WRITE COMMITS
 *   Same reasoning as TEST_STARTED in the runner: an event fired before the
 *   commit would count plan changes the database rejected (validation failure,
 *   lost authorisation race), inflating the onboard stage of A11 with changes
 *   that never happened.
 *
 * WHAT THIS SURFACE EXPOSES THAT NO OTHER ONE DOES
 *   `required_daily`, `effective_cap` and `plan_overload_flag` are parent-only
 *   by design and absent from `public.student_today()`. A child sees the capped
 *   daily number; a parent sees that the plan cannot fit inside the cap and
 *   needs adjusting. This endpoint is the correct and only place those three
 *   fields appear.
 */

interface PlanDto {
  plan: PracticePlan | null
  /** Parent-facing explanation of the cap, when the plan exceeds it. */
  overloadNotice: string | null
}

/** Error envelope for this report, so no branch repeats the shape. */
function errorResponse(status: number) {
  return reportJson(
    envelope<PlanDto>({ reportId: 'P9', data: null, asAt: null, state: 'error' }),
    { status }
  )
}

export async function GET(req: Request) {
  const REPORT_ID = 'P9'

  const auth = await requireReportingRole(REPORT_ID, ['PARENT', 'ADMIN'])
  if (!auth.ok) return auth.response

  const student = requireStudentId(REPORT_ID, req.url)
  if (!student.ok) return student.response

  const result = await loadParentPlan(student.value)

  if (result.error) return errorResponse(503)

  return reportJson(
    envelope<PlanDto>({
      reportId: REPORT_ID,
      data: { plan: result.plan, overloadNotice: overloadSentence(result.plan) },
      asAt: result.asAt,
      // A child with no plan row yet is a genuine empty state: the parent has
      // not configured anything. That is the prompt to set one up, which is
      // the decision P9 exists to support.
      state: result.plan === null ? 'empty' : 'ok',
    }),
    { status: 200 }
  )
}

interface PlanPutBody {
  studentId?: unknown
  targetExam?: unknown
  targetExamType?: unknown
  examDate?: unknown
  weeklySessionsGoal?: unknown
}

export async function PUT(req: Request) {
  const auth = await requireReportingRole('P9', ['PARENT', 'ADMIN'])
  if (!auth.ok) return auth.response

  let body: PlanPutBody
  try {
    body = (await req.json()) as PlanPutBody
  } catch {
    return errorResponse(400)
  }

  const studentId = typeof body.studentId === 'string' ? body.studentId : null
  if (!studentId) return errorResponse(400)

  // examDate arrives as YYYY-MM-DD from a date input. Anything else is
  // rejected here rather than passed to Postgres, where a malformed date
  // raises from inside a SECURITY DEFINER body and surfaces as an opaque 500.
  const rawDate = body.examDate
  let examDate: string | null = null
  if (typeof rawDate === 'string' && rawDate.trim() !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate.trim())) return errorResponse(400)
    examDate = rawDate.trim()
  }

  const rawGoal = body.weeklySessionsGoal
  let goal: number | null = null
  if (rawGoal !== null && rawGoal !== undefined && rawGoal !== '') {
    const parsed = Number(rawGoal)
    if (!Number.isFinite(parsed)) return errorResponse(400)
    goal = Math.trunc(parsed)
  }

  const saved = await saveParentPlan({
    studentId,
    targetExam: typeof body.targetExam === 'string' ? body.targetExam : null,
    targetExamType: typeof body.targetExamType === 'string' ? body.targetExamType : null,
    examDate,
    weeklySessionsGoal: goal,
  })

  if (saved.error) {
    // 42501 = the caller is not linked to this child. 22023 = invalid goal or
    // a past exam date. Both are the caller's fault, not a server fault, so
    // neither is a 500.
    return errorResponse(saved.code === '42501' ? 403 : 400)
  }

  // Emitted only after the write committed, so the onboard stage of A11 counts
  // plan changes that actually exist.
  //
  // Props carry the plan's SHAPE, never a result: goal, exam type and whether
  // the plan is overloaded. No score, no accuracy, no readiness - the boundary
  // migration 015 draws applies to analytics payloads too, and a plan-change
  // event has no business carrying a performance figure.
  await trackEvent({
    event: 'PRACTICE_PLAN_CHANGED',
    userId: auth.userId,
    studentId,
    props: {
      weeklySessionsGoal: saved.plan?.weekly_sessions_goal ?? goal,
      hasExamDate: Boolean(saved.plan?.exam_date),
      examType: saved.plan?.target_exam_type ?? null,
      planOverloaded: Boolean(saved.plan?.plan_overload_flag),
      goalMin: MIN_WEEKLY_SESSIONS,
      goalMax: MAX_WEEKLY_SESSIONS,
    },
  })

  // Re-read rather than trusting the write's RETURNING row: the RETURNING
  // clause does not include the derived daily-target fields, and the parent
  // needs to see the effect of their change immediately.
  const refreshed = await loadParentPlan(studentId)
  const plan = refreshed.plan ?? saved.plan

  return reportJson(
    envelope<PlanDto>({
      reportId: 'P9',
      data: { plan, overloadNotice: overloadSentence(plan) },
      asAt: refreshed.asAt,
      state: 'ok',
    }),
    { status: 200 }
  )
}

