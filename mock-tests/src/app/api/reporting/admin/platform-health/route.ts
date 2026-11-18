import { envelope, reportJson } from '@/lib/reporting/envelope'
import { requireReportingRole } from '@/lib/reporting/route-auth'
import { dateKeyParam } from '@/lib/reporting/route-params'
import { csvResponse } from '@/lib/reporting/csv'
import {
  defaultDateRange,
  loadPlatformHealth,
  type PlatformHealthRow,
} from '@/lib/reporting/admin-operations'

/**
 * A14 - Platform Health & Usage. GET /api/reporting/admin/platform-health
 *
 * "Is the platform coping, and are tests failing?" Refreshes every 15 minutes
 * (cron job `rpt-platform-health`), which is the highest-frequency reporting
 * view in the platform because it is the only one an operator watches while
 * tests are actively running.
 *
 * THE 366-DAY CAP IS ENFORCED IN SQL, NOT ONLY HERE
 *   `admin_platform_health()` raises 22023 on a wider range. That matters more
 *   than usual for this endpoint: it runs as SECURITY DEFINER, outside the
 *   reporting_ro statement_timeout that 12-...md §8.3 relies on, and it scans
 *   an hourly view. An unbounded range is the one query that could actually
 *   run long enough to matter.
 *
 * THE CAPACITY DENOMINATOR IS AN ASSUMPTION AND SAYS SO
 *   `concurrency_vs_cap` divides by 200 - the peak figure from the project
 *   brief, treated as a capacity target. Nothing in the repository corroborates
 *   it as a measurement (assumption A-13). `cap_is_measured` is returned with
 *   every row and included in the CSV so an operator reading the export away
 *   from the UI still knows the denominator is a target, not an observation.
 *   A scaling decision taken on a number someone mistook for a measurement is
 *   worse than no decision.
 */

const REPORT_ID = 'A14'
const TTL_SECONDS = 900

const CSV_COLUMNS = [
  'hour_start',
  'date_key',
  'hour_of_day',
  'active_users',
  'peak_concurrency',
  'concurrency_vs_cap',
  'peak_concurrency_cap',
  'cap_is_measured',
  'tests_started',
  'tests_submitted',
  'errors',
  'test_error_rate',
  'submit_errors',
  'failed_submission_rate',
]

interface HealthDto {
  hours: PlatformHealthRow[]
}

export async function GET(req: Request) {
  const auth = await requireReportingRole(REPORT_ID, ['ADMIN'])
  if (!auth.ok) return auth.response

  const defaults = defaultDateRange(7)

  const from = dateKeyParam(REPORT_ID, req.url, 'from', { fallback: defaults.from })
  if (!from.ok) return from.response

  const to = dateKeyParam(REPORT_ID, req.url, 'to', { fallback: defaults.to })
  if (!to.ok) return to.response

  const wantCsv = new URL(req.url).searchParams.get('format') === 'csv'

  const result = await loadPlatformHealth(from.value, to.value)

  if (result.error) {
    // 403 when the SQL rejected the role, 400 when it rejected the range,
    // otherwise 503 for a failed upstream. Collapsing all three into one code
    // would leave an operator unable to tell "you may not" from "you asked
    // for too much" from "it is broken".
    const status = result.code === '42501' ? 403 : result.code === '22023' ? 400 : 503

    if (wantCsv) {
      return new Response('Export unavailable\n', {
        status,
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    }

    return reportJson(
      envelope<HealthDto>({ reportId: REPORT_ID, data: null, asAt: result.asAt, state: 'error' }),
      { status }
    )
  }

  if (wantCsv) {
    return csvResponse(
      `platform-health-${from.value}-${to.value}.csv`,
      CSV_COLUMNS,
      result.hours.map((h) => ({ ...h }))
    )
  }

  return reportJson(
    envelope<HealthDto>({
      reportId: REPORT_ID,
      data: { hours: result.hours },
      asAt: result.asAt,
      state: result.hours.length === 0 ? 'empty' : 'ok',
    }),
    { status: 200, ttlSeconds: TTL_SECONDS }
  )
}
