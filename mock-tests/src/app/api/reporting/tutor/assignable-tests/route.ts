import { envelope, reportJson } from '@/lib/reporting/envelope'
import { requireReportingRole } from '@/lib/reporting/route-auth'
import { requireStudentId, textParam } from '@/lib/reporting/route-params'
import {
  loadAssignableTests,
  type AssignableTestRow,
} from '@/lib/reporting/tutor'

/**
 * T7's Assign support. GET /api/reporting/tutor/assignable-tests?studentId=&subject=&topic=
 *
 * Answers "which published test should I set for this recommendation?" - the
 * mapping that was missing when T7 shipped read-only in 074. T7 recommends a
 * SUBJECT and a TOPIC; assigning needs a TEST, and a test carries neither of those:
 * they live on its questions. So this resolves the recommendation to real,
 * assignable content.
 *
 * TUTOR only, consented students only, enforced by is_tutor_of() inside
 * `tutor_assignable_tests()`. A tutor without current consent gets zero rows rather
 * than an error, matching the other tutor reports - and critically, cannot use this
 * to enumerate the published catalogue for a student they have no access to.
 *
 * The year band filter is applied here too, so the Assign form can never offer a
 * test that `tutor_assign_test()` would then refuse. Offering a choice that is
 * guaranteed to fail on submit is how a form acquires a reputation for being
 * broken.
 */

const REPORT_ID = 'T7'
const TTL_SECONDS = 300

export async function GET(req: Request) {
  const auth = await requireReportingRole(REPORT_ID, ['TUTOR'])
  if (!auth.ok) return auth.response

  const student = requireStudentId(REPORT_ID, req.url)
  if (!student.ok) return student.response

  const subject = textParam(REPORT_ID, req.url, 'subject')
  if (!subject.ok) return subject.response

  const topic = textParam(REPORT_ID, req.url, 'topic')
  if (!topic.ok) return topic.response

  const result = await loadAssignableTests(student.value, subject.value, topic.value)

  if (result.error) {
    return reportJson(
      envelope<AssignableTestRow[]>({
        reportId: REPORT_ID,
        data: null,
        asAt: null,
        state: 'error',
      }),
      { status: result.code === '42501' ? 403 : 503 }
    )
  }

  return reportJson(
    envelope<AssignableTestRow[]>({
      reportId: REPORT_ID,
      data: result.rows,
      asAt: new Date().toISOString(),
      // Empty is a real outcome: no published test covers that topic for this
      // student's year level. The Assign control says so instead of showing a
      // dropdown with nothing in it.
      state: result.rows.length === 0 ? 'empty' : 'ok',
    }),
    { status: 200, ttlSeconds: TTL_SECONDS }
  )
}
