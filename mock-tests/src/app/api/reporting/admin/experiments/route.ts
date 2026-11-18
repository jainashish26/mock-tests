import { envelope, reportJson } from '@/lib/reporting/envelope'
import { requireReportingRole } from '@/lib/reporting/route-auth'
import { csvResponse } from '@/lib/reporting/csv'
import { loadExperimentResults, type ExperimentResultRow } from '@/lib/reporting/admin-experiments'
import { experimentHeadline } from '@/lib/reporting/format'

/**
 * A12 - Experiment Results. GET /api/reporting/admin/experiments
 *
 * "Did this change work?" -> ship, revert or extend. ADMIN only, enforced in SQL.
 *
 * The payload carries `decision_reason` for every arm. §5.4 requires it: the
 * verdict is "a RECOMMENDATION, not an automatic action... includes a reasoning
 * string so a human can disagree". Dropping the reason would turn a statistical
 * suggestion into an instruction, which is exactly what the spec forbids.
 *
 * No subject identifiers are returned - only per-arm aggregates.
 */

const REPORT_ID = 'A12'
const TTL_SECONDS = 3600

const CSV_COLUMNS = [
  'experiment_key',
  'experiment_name',
  'status',
  'variant',
  'is_control',
  'sample_size',
  'conversions',
  'variant_conversion_rate',
  'control_sample_size',
  'control_rate',
  'diff_pp',
  'ci_lower_pp',
  'ci_upper_pp',
  'p_value_experiment',
  'recommended_decision',
  'decision_reason',
]

interface ExperimentsDto {
  rows: ExperimentResultRow[]
  headline: string
}

export async function GET(req: Request) {
  const auth = await requireReportingRole(REPORT_ID, ['ADMIN'])
  if (!auth.ok) return auth.response

  const result = await loadExperimentResults()

  if (result.error) {
    const status = result.code === '42501' ? 403 : 503
    if (new URL(req.url).searchParams.get('format') === 'csv') {
      return new Response('Export unavailable\n', {
        status,
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    }
    return reportJson(
      envelope<ExperimentsDto>({ reportId: REPORT_ID, data: null, asAt: null, state: 'error' }),
      { status }
    )
  }

  if (new URL(req.url).searchParams.get('format') === 'csv') {
    return csvResponse('experiments.csv', CSV_COLUMNS, result.rows)
  }

  return reportJson(
    envelope<ExperimentsDto>({
      reportId: REPORT_ID,
      data: { rows: result.rows, headline: experimentHeadline(result.rows) },
      // Computed on read rather than from a materialised view, so there is no
      // refresh lag to report: the figures are current as of this request.
      asAt: new Date().toISOString(),
      state: result.rows.length === 0 ? 'empty' : 'ok',
    }),
    { status: 200, ttlSeconds: TTL_SECONDS }
  )
}
