import { NextResponse } from 'next/server'
import { badRequest, envelope, reportJson } from '@/lib/reporting/envelope'
import { requireReportingRole } from '@/lib/reporting/route-auth'
import { csvResponse } from '@/lib/reporting/csv'
import { isUuid, textParam } from '@/lib/reporting/route-params'
import {
  assignTest,
  loadTutorAssignments,
  type TutorAssignmentRow,
} from '@/lib/reporting/tutor'

/**
 * T5 - Assignment Tracker. GET /api/reporting/tutor/assignments?status=
 *
 * TUTOR only, and only assignments THIS tutor set for students with a current
 * consent. Not ADMIN: an admin reaching identified student work belongs in the
 * audited drilldown (AC-30..34), not here.
 *
 * `status` filters the four-column partition. An unknown value is a 400 rather
 * than a silent fallback to "all", because a tutor who asked for overdue work and
 * quietly received the whole list would chase the wrong students.
 *
 * Overdue is computed in SQL against now(), so the answer is current even though
 * the underlying attempt facts refresh hourly.
 */

const REPORT_ID = 'T5'
const TTL_SECONDS = 300

const ALLOWED_STATUS = new Set(['assigned', 'started', 'completed', 'overdue'])

const CSV_COLUMNS = [
  'student_name', 'test_title', 'assignment_status', 'due_state', 'due_at',
  'is_overdue', 'attempt_status', 'attempts_n', 'assigned_at', 'last_activity_at',
]

export async function GET(req: Request) {
  const auth = await requireReportingRole(REPORT_ID, ['TUTOR'])
  if (!auth.ok) return auth.response

  const status = textParam(REPORT_ID, req.url, 'status')
  if (!status.ok) return status.response

  if (status.value !== null && !ALLOWED_STATUS.has(status.value.toLowerCase())) {
    return badRequest(
      REPORT_ID,
      `status must be one of ${[...ALLOWED_STATUS].join(', ')}`
    )
  }

  const result = await loadTutorAssignments(status.value)

  if (result.error) {
    const status_code = result.code === '42501' ? 403 : 503
    if (new URL(req.url).searchParams.get('format') === 'csv') {
      return new Response('Export unavailable\n', {
        status: status_code,
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    }
    return reportJson(
      envelope<TutorAssignmentRow[]>({ reportId: REPORT_ID, data: null, asAt: null, state: 'error' }),
      { status: status_code }
    )
  }

  if (new URL(req.url).searchParams.get('format') === 'csv') {
    return csvResponse('tutor-assignments.csv', CSV_COLUMNS, result.rows)
  }

  return reportJson(
    envelope<TutorAssignmentRow[]>({
      reportId: REPORT_ID,
      data: result.rows,
      asAt: new Date().toISOString(),
      // Zero rows is the normal state for a tutor who has set nothing yet.
      state: result.rows.length === 0 ? 'empty' : 'ok',
    }),
    { status: 200, ttlSeconds: TTL_SECONDS }
  )
}

/**
 * T7's "Assign" action. POST /api/reporting/tutor/assignments
 *
 * { studentId, testId, dueAt? } -> 201 with the new assignment id.
 *
 * This is the write half of the T7 -> T5 pairing in §4.5: T7 recommends what to set
 * next, and Assign is what actually sets it. It was withheld in 074 because
 * public.tests was empty and there was nothing to map a subject/topic recommendation
 * onto; the content layer now holds 53 published tests, so the action can be real
 * rather than a disabled button.
 *
 * EVERY RULE IS ENFORCED IN SQL by tutor_assign_test(): live consent, PUBLISHED
 * test, future due date, and the student's year level inside the test's band. They
 * are deliberately NOT duplicated here - a rule written in two places is a rule
 * that will eventually be enforced in one, and PostgREST exposes the function
 * directly at /rest/v1/rpc/ anyway, so a route-only check would protect nothing.
 *
 * The validation this route DOES own is the shape of the request: types, uuid
 * format, and a due date that parses. Letting an unparseable date reach SQL would
 * turn a client mistake into a 500 from inside a SECURITY DEFINER body.
 */
export async function POST(req: Request) {
  const auth = await requireReportingRole(REPORT_ID, ['TUTOR'])
  if (!auth.ok) return auth.response

  let body: { studentId?: unknown; testId?: unknown; dueAt?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const studentId = typeof body.studentId === 'string' ? body.studentId.trim() : ''
  const testId = typeof body.testId === 'string' ? body.testId.trim() : ''
  if (!isUuid(studentId) || !isUuid(testId)) {
    return NextResponse.json(
      { error: 'studentId and testId are required and must be valid ids' },
      { status: 400 }
    )
  }

  let dueAt: string | null = null
  if (body.dueAt !== null && body.dueAt !== undefined && body.dueAt !== '') {
    if (typeof body.dueAt !== 'string') {
      return NextResponse.json({ error: 'dueAt must be an ISO date string' }, { status: 400 })
    }
    const parsed = new Date(body.dueAt)
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: 'dueAt is not a parseable date' }, { status: 400 })
    }
    dueAt = parsed.toISOString()
  }

  const result = await assignTest(studentId, testId, dueAt)

  if (result.error) {
    // 42501 no consent / not this tutor; 22023 unpublished test, past due date or
    // year band mismatch - all of which are the caller's mistake, not a fault.
    const status = result.code === '42501' ? 403 : result.code === '22023' ? 400 : 503
    return NextResponse.json({ error: 'assignment failed', code: result.code }, { status })
  }

  return NextResponse.json({ ok: true, assignmentId: result.assignmentId }, { status: 201 })
}
