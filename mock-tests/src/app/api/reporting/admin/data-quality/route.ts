import { envelope, reportJson } from '@/lib/reporting/envelope'
import { requireReportingRole } from '@/lib/reporting/route-auth'
import { dateKeyParam } from '@/lib/reporting/route-params'
import { csvResponse } from '@/lib/reporting/csv'
import {
  dateKey,
  loadDataQuality,
  qualityVerdict,
  refreshLagRows,
  type DataQualityRow,
} from '@/lib/reporting/admin-operations'

/**
 * A15 - Data Quality & Reconciliation. GET /api/reporting/admin/data-quality
 *
 * "Can we trust the data?" The decision it supports is repair-before-reporting:
 * an operator who does not know that `fact_item_response` stopped loading will
 * confidently act on a trend line that quietly flattened.
 *
 * A KNOWN LIMITATION, STATED RATHER THAN PAPERED OVER
 *   §4.4 gives A15 a `day × check` grain, which implies history. The view
 *   behind it (`reporting.mv_data_quality`) is fully replaced on each refresh
 *   and stamps every row with `CURRENT_DATE`, so it holds ONE day: the latest
 *   run. The date parameters below are honoured and bounded, but a range
 *   wider than today returns the same single day's rows. Persisting daily
 *   snapshots for trend is a follow-up; the default range is therefore today,
 *   not the last seven days, so the endpoint does not imply history it does
 *   not have.
 *
 * WHY `stripe_reconciliation` REPORTS NOT_IMPLEMENTED AND NOT ZERO
 *   Stripe ingestion is Phase 3 (14-...md §16). A gap count of 0 would assert
 *   that a reconciliation ran and found nothing - a positive claim about a
 *   check that has never executed. NOT_IMPLEMENTED is the truthful state, and
 *   `qualityVerdict` deliberately does not count it as a failure, because a
 *   screen that is always red trains operators to stop reading it.
 */

const REPORT_ID = 'A15'
const TTL_SECONDS = 900

const CSV_COLUMNS = [
  'check_date',
  'check_name',
  'object_name',
  'metric_value',
  'threshold',
  'status',
  'detail',
]

interface QualityDto {
  checks: DataQualityRow[]
  /** One-line verdict for the screen header. */
  verdict: string
  /** Refresh-lag rows lifted out, because they gate trust in every OTHER
   *  dashboard and should not be buried among integrity checks. */
  refreshLag: DataQualityRow[]
}

export async function GET(req: Request) {
  const auth = await requireReportingRole(REPORT_ID, ['ADMIN'])
  if (!auth.ok) return auth.response

  const today = dateKey(new Date())

  const from = dateKeyParam(REPORT_ID, req.url, 'from', { fallback: today })
  if (!from.ok) return from.response

  const to = dateKeyParam(REPORT_ID, req.url, 'to', { fallback: today })
  if (!to.ok) return to.response

  const wantCsv = new URL(req.url).searchParams.get('format') === 'csv'

  const result = await loadDataQuality(from.value, to.value)

  if (result.error) {
    const status = result.code === '42501' ? 403 : result.code === '22023' ? 400 : 503

    if (wantCsv) {
      return new Response('Export unavailable\n', {
        status,
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    }

    return reportJson(
      envelope<QualityDto>({ reportId: REPORT_ID, data: null, asAt: result.asAt, state: 'error' }),
      { status }
    )
  }

  if (wantCsv) {
    return csvResponse(
      `data-quality-${from.value}-${to.value}.csv`,
      CSV_COLUMNS,
      result.checks.map((c) => ({ ...c }))
    )
  }

  return reportJson(
    envelope<QualityDto>({
      reportId: REPORT_ID,
      data: {
        checks: result.checks,
        verdict: qualityVerdict(result.checks),
        refreshLag: refreshLagRows(result.checks),
      },
      asAt: result.asAt,
      // No check rows at all means the view has never been refreshed. That is
      // an operational failure, not an empty state: A15 always produces rows
      // once it has run, including rows reporting that other views are stale.
      state: result.checks.length === 0 ? 'error' : 'ok',
    }),
    { status: 200, ttlSeconds: TTL_SECONDS }
  )
}
