import { NextResponse } from 'next/server'
import { requireReportingRole } from '@/lib/reporting/route-auth'
import { isUuid } from '@/lib/reporting/route-params'
import { remindAssignment } from '@/lib/reporting/tutor'

/**
 * T5's "Remind" action. POST /api/reporting/tutor/reminders
 *
 * { assignmentId } -> 200 with { queued, alreadySent, unreachable, reason }.
 *
 * TUTOR only, and `tutor_remind()` additionally requires that THIS tutor created
 * the assignment and still holds live consent for the student. A tutor cannot chase
 * work another tutor set, and a revoked consent blocks reminders immediately rather
 * than at the next nightly refresh.
 *
 * A 200 WITH queued: 0 IS A SUCCESS, NOT A FAILURE. The reminder was correctly
 * refused by the once-per-assignment-per-day dedupe, which is the intended outcome
 * and the one the tutor needs told about in words. Returning 409 or 429 here would
 * make the normal case look like an error and train tutors to retry - the opposite
 * of what rate limiting is for.
 *
 * Queues rather than sends: delivery belongs to whatever already drains
 * `email_log`, so reminders inherit its retries and failure recording instead of
 * inventing a second sending path.
 */

const REPORT_ID = 'T5'

export async function POST(req: Request) {
  const auth = await requireReportingRole(REPORT_ID, ['TUTOR'])
  if (!auth.ok) return auth.response

  let body: { assignmentId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const assignmentId =
    typeof body.assignmentId === 'string' ? body.assignmentId.trim() : ''
  if (!isUuid(assignmentId)) {
    return NextResponse.json(
      { error: 'assignmentId is required and must be a valid id' },
      { status: 400 }
    )
  }

  const result = await remindAssignment(assignmentId)

  if (result.error) {
    // 42501: not this tutor's assignment, or consent has lapsed. 22023: no such
    // assignment. Anything else is a fault on our side.
    const status =
      result.code === '42501' ? 403 : result.code === '22023' ? 404 : 503
    return NextResponse.json(
      { error: 'reminder failed', code: result.code },
      { status }
    )
  }

  return NextResponse.json(
    {
      ok: true,
      queued: result.queued,
      alreadySent: result.already_sent,
      unreachable: result.unreachable,
      reason: result.reason,
    },
    { status: 200 }
  )
}
