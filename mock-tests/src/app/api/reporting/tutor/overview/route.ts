import { envelope, reportJson } from '@/lib/reporting/envelope'
import { requireReportingRole } from '@/lib/reporting/route-auth'
import { intParam } from '@/lib/reporting/route-params'
import { csvResponse } from '@/lib/reporting/csv'
import { loadTutorOverview, type TutorStudentRow } from '@/lib/reporting/tutor'

/**
 * T1 - Student Overview. GET /api/reporting/tutor/overview
 *
 * TUTOR only. Not ADMIN: admin row-level student access must be pseudonymous,
 * audited and reason-required (AC-30..34), and this endpoint returns identified
 * students. Every row is gated in SQL on is_tutor_of(), which requires both a
 * link and a current consent record.
 *
 * Returns raw scores, not bands - bandForScore() is the single definition.
 */

const REPORT_ID = 'T1'
const TTL_SECONDS = 900

const CSV_COLUMNS = [
  'student_name', 'year_level', 'assigned_count', 'completed_count', 'completion_rate',
  'current_attempts', 'current_score', 'prior_attempts', 'prior_score', 'movement_pp',
  'consent_expires_at',
]

export async function GET(req: Request) {
  const auth = await requireReportingRole(REPORT_ID, ['TUTOR'])
  if (!auth.ok) return auth.response

  const period = intParam(REPORT_ID, req.url, 'period', { fallback: 30, min: 7, max: 180 })
  if (!period.ok) return period.response

  const result = await loadTutorOverview(period.value)

  if (result.error) {
    const status = result.code === '42501' ? 403 : 503
    if (new URL(req.url).searchParams.get('format') === 'csv') {
      return new Response('Export unavailable\n', {
        status,
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    }
    return reportJson(
      envelope<TutorStudentRow[]>({ reportId: REPORT_ID, data: null, asAt: null, state: 'error' }),
      { status }
    )
  }

  if (new URL(req.url).searchParams.get('format') === 'csv') {
    return csvResponse('tutor-students.csv', CSV_COLUMNS, result.rows)
  }

  return reportJson(
    envelope<TutorStudentRow[]>({
      reportId: REPORT_ID,
      data: result.rows,
      asAt: new Date().toISOString(),
      // Zero rows means no consented students, which is a real and common state
      // for a new tutor - not a failure.
      state: result.rows.length === 0 ? 'empty' : 'ok',
    }),
    { status: 200, ttlSeconds: TTL_SECONDS }
  )
}
