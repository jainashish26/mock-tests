import { envelope, reportJson } from '@/lib/reporting/envelope'
import { requireReportingRole } from '@/lib/reporting/route-auth'
import { csvResponse } from '@/lib/reporting/csv'
import { loadTutorAtRisk, type TutorAtRiskRow } from '@/lib/reporting/tutor'

/**
 * T3 - At-Risk List. GET /api/reporting/tutor/at-risk
 *
 * TUTOR only, consented students only. Every row carries `at_risk_rule` and a
 * plain-English `rule_detail`, because TU1 requires that a tutor be able to
 * DISAGREE with a flag - an unexplained flag cannot be argued with.
 *
 * `thresholds_validated` is false: these are seeded defaults, not validated
 * cut-points. The UI must say so rather than present the list as settled science.
 */

const REPORT_ID = 'T3'
const TTL_SECONDS = 900

const CSV_COLUMNS = [
  'student_name', 'at_risk_rule', 'at_risk_severity', 'rule_detail', 'thresholds_validated',
]

export async function GET(req: Request) {
  const auth = await requireReportingRole(REPORT_ID, ['TUTOR'])
  if (!auth.ok) return auth.response

  const result = await loadTutorAtRisk()

  if (result.error) {
    const status = result.code === '42501' ? 403 : 503
    if (new URL(req.url).searchParams.get('format') === 'csv') {
      return new Response('Export unavailable\n', {
        status,
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    }
    return reportJson(
      envelope<TutorAtRiskRow[]>({ reportId: REPORT_ID, data: null, asAt: null, state: 'error' }),
      { status }
    )
  }

  if (new URL(req.url).searchParams.get('format') === 'csv') {
    return csvResponse('tutor-at-risk.csv', CSV_COLUMNS, result.rows)
  }

  return reportJson(
    envelope<TutorAtRiskRow[]>({
      reportId: REPORT_ID,
      data: result.rows,
      asAt: new Date().toISOString(),
      // An empty at-risk list is a GOOD outcome and must not render as an error
      // or as "no data". The panel says so explicitly.
      state: result.rows.length === 0 ? 'empty' : 'ok',
    }),
    { status: 200, ttlSeconds: TTL_SECONDS }
  )
}
