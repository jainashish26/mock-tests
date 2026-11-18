import { envelope, reportJson } from '@/lib/reporting/envelope'
import { requireReportingRole } from '@/lib/reporting/route-auth'
import { optionalStudentId } from '@/lib/reporting/route-params'
import { csvResponse } from '@/lib/reporting/csv'
import { loadTutorRecommendations, type TutorRecommendationRow } from '@/lib/reporting/tutor'

/**
 * T7 - Next-Best Recommendations. GET /api/reporting/tutor/recommendations?studentId=
 *
 * TUTOR only, consented students only. `studentId` is an optional filter; omitted,
 * the whole roster is returned with at most three recommendations per student.
 *
 * SAME NUMBERS AS P8. Both this and parent_recommendations() call
 * reporting.recommendations_scored(), so the impact formula, the five-response
 * signal floor and B12's cap of three have exactly one definition. A parent and
 * their tutor cannot be given different advice for the same child, and a pgtap
 * assertion fails if that ever changes.
 *
 * READ-ONLY. The spec's "Assign" action is not wired: public.tests is empty, there
 * is no practice-set entity to map a subject/topic recommendation onto, and tutors
 * hold no INSERT policy on public.assignments. Guessing that mapping would be a
 * product decision, not an implementation one.
 */

const REPORT_ID = 'T7'
const TTL_SECONDS = 900

const CSV_COLUMNS = [
  'student_name', 'recommendation_rank', 'subject', 'topic',
  'items_answered', 'accuracy_pct', 'expected_impact_score', 'reason',
]

export async function GET(req: Request) {
  const auth = await requireReportingRole(REPORT_ID, ['TUTOR'])
  if (!auth.ok) return auth.response

  const student = optionalStudentId(REPORT_ID, req.url)
  if (!student.ok) return student.response

  const result = await loadTutorRecommendations(student.value)

  if (result.error) {
    const status = result.code === '42501' ? 403 : 503
    if (new URL(req.url).searchParams.get('format') === 'csv') {
      return new Response('Export unavailable\n', {
        status,
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    }
    return reportJson(
      envelope<TutorRecommendationRow[]>({ reportId: REPORT_ID, data: null, asAt: null, state: 'error' }),
      { status }
    )
  }

  if (new URL(req.url).searchParams.get('format') === 'csv') {
    return csvResponse('tutor-recommendations.csv', CSV_COLUMNS, result.rows)
  }

  return reportJson(
    envelope<TutorRecommendationRow[]>({
      reportId: REPORT_ID,
      data: result.rows,
      asAt: new Date().toISOString(),
      state: result.rows.length === 0 ? 'empty' : 'ok',
    }),
    { status: 200, ttlSeconds: TTL_SECONDS }
  )
}
