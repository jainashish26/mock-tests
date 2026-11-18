import { NextResponse } from 'next/server'
import { envelope, reportJson } from '@/lib/reporting/envelope'
import { requireReportingRole } from '@/lib/reporting/route-auth'
import { requireStudentId } from '@/lib/reporting/route-params'
import {
  grantTutorConsent,
  grantTutorConsentByEmail,
  loadTutorConsents,
  revokeTutorConsent,
  type TutorConsentRow,
} from '@/lib/reporting/tutor'

/**
 * P10 - Consent & Access Control. /api/reporting/parent/consents
 *
 * Parent question PA9: "Who can see my child's data?" GET lists every tutor with
 * their access state; POST grants; DELETE revokes.
 *
 * PARENT only. A student cannot grant away access to their own data - the SQL
 * checks may_read_results() as well as is_parent_of(), so a student JWT is
 * rejected even for their own row.
 *
 * Revocation is immediate: is_tutor_of() evaluates consent at query time, so the
 * tutor loses access on their very next request with no job and no cache to wait
 * for. The consent record is never deleted - it is the audit trail that answers
 * "who had access, when, and who withdrew it".
 */

const REPORT_ID = 'P10'

export async function GET(req: Request) {
  const auth = await requireReportingRole(REPORT_ID, ['PARENT'])
  if (!auth.ok) return auth.response

  const student = requireStudentId(REPORT_ID, req.url)
  if (!student.ok) return student.response

  const result = await loadTutorConsents(student.value)
  if (result.error) {
    return reportJson(
      envelope<TutorConsentRow[]>({ reportId: REPORT_ID, data: null, asAt: null, state: 'error' }),
      { status: result.code === '42501' ? 403 : 503 }
    )
  }

  return reportJson(
    envelope<TutorConsentRow[]>({
      reportId: REPORT_ID,
      data: result.rows,
      asAt: new Date().toISOString(),
      state: result.rows.length === 0 ? 'empty' : 'ok',
    }),
    { status: 200, ttlSeconds: 0 }
  )
}

export async function POST(req: Request) {
  const auth = await requireReportingRole(REPORT_ID, ['PARENT'])
  if (!auth.ok) return auth.response

  let body: { studentId?: unknown; tutorUserId?: unknown; tutorEmail?: unknown; months?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const studentId = typeof body.studentId === 'string' ? body.studentId : ''
  const tutorUserId = typeof body.tutorUserId === 'string' ? body.tutorUserId : ''
  const tutorEmail = typeof body.tutorEmail === 'string' ? body.tutorEmail.trim() : ''
  if (!studentId || (!tutorUserId && !tutorEmail)) {
    return NextResponse.json(
      { error: 'studentId and either tutorEmail or tutorUserId are required' },
      { status: 400 }
    )
  }

  // Bounded here as well as in SQL: an indefinite grant is not offered at all.
  const months = typeof body.months === 'number' && Number.isInteger(body.months) ? body.months : 12
  if (months < 1 || months > 24) {
    return NextResponse.json({ error: 'months must be between 1 and 24' }, { status: 400 })
  }

  // Email is the normal path - it is what a tutor can tell a parent. The id path
  // exists for programmatic callers that already hold it.
  const result = tutorEmail
    ? await grantTutorConsentByEmail(studentId, tutorEmail, months)
    : await grantTutorConsent(studentId, tutorUserId, months)
  if (result.error) {
    const status = result.code === '42501' ? 403 : result.code === '22023' ? 400 : 503
    return NextResponse.json({ error: 'grant failed', code: result.code }, { status })
  }

  return NextResponse.json({ ok: true, consentId: result.consentId }, { status: 201 })
}

export async function DELETE(req: Request) {
  const auth = await requireReportingRole(REPORT_ID, ['PARENT'])
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const studentId = url.searchParams.get('studentId') ?? ''
  const tutorUserId = url.searchParams.get('tutorUserId') ?? ''
  if (!studentId || !tutorUserId) {
    return NextResponse.json({ error: 'studentId and tutorUserId are required' }, { status: 400 })
  }

  const result = await revokeTutorConsent(studentId, tutorUserId)
  if (result.error) {
    const status = result.code === '42501' ? 403 : 503
    return NextResponse.json({ error: 'revoke failed', code: result.code }, { status })
  }

  return NextResponse.json({ ok: true, revoked: result.revoked }, { status: 200 })
}
