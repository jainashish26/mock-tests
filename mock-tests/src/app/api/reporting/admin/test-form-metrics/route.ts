import { badRequest, envelope, reportJson } from '@/lib/reporting/envelope'
import { requireReportingRole } from '@/lib/reporting/route-auth'
import { dateKeyParam, optionalTestId } from '@/lib/reporting/route-params'
import { csvResponse } from '@/lib/reporting/csv'
import { dateKey } from '@/lib/reporting/format'
import {
  loadTestFormMetrics,
  reliabilityCaveat,
  testFormCsvRows,
  TEST_FORM_CSV_COLUMNS,
  type TestFormDistributionLike,
  type TestFormMetricRow,
  type TestFormThresholds,
} from '@/lib/reporting/test-forms'

/**
 * A4 - Test-Form Metrics. GET /api/reporting/admin/test-form-metrics
 *
 * "Is this test form fit to stay live?" -> publish, revise or withdraw. ADMIN
 * only, enforced in SQL by `has_role('ADMIN')` inside
 * `admin_test_form_metrics()` as well as by `requireReportingRole` here. The SQL
 * check is the one that matters: PostgREST exposes every granted function at
 * `/rest/v1/rpc/<name>`, so a route-only guard leaves it callable by anyone who
 * skips the route.
 *
 * ?from=&to= are YYYYMMDD date keys on the attempt START day, ?testId= adds the
 * histogram for one form, ?format=csv exports the table.
 *
 * THE CAVEAT IS PART OF THE PAYLOAD
 *   `reliabilityCaveat` is non-null while no form can produce a KR-20
 *   coefficient, and it is derived from the rows rather than hardcoded, so it
 *   clears itself when the runner starts recording the items it serves. An
 *   endpoint that returned a column of empty reliability cells without that
 *   sentence would invite the reader to conclude the forms are unreliable, when
 *   the truth is that the coefficient was never computable.
 *
 * RAW COUNTS TRAVEL WITH EVERY RATE
 *   `attempts_started`, `attempts_submitted` and `abandoned_attempts` are all in
 *   the payload because a 94.6% completion rate over 240 attempts and one over
 *   4 attempts are different claims, and section 13.4 requires the small one to
 *   be shown greyed with its n rather than suppressed silently.
 */

const REPORT_ID = 'A4'
const TTL_SECONDS = 900
/** Default look-back. See the range block below. */
const DEFAULT_WINDOW_DAYS = 90
/** The same 366-day cap the other admin aggregates apply. */
const MAX_WINDOW_DAYS = 366

/**
 * UTC midnight for a YYYYMMDD key.
 *
 * Whole-day arithmetic only exists to bound a request; the report itself filters
 * on the stored date_key, so a timezone never enters the calculation.
 */
function utcOf(key: number): number {
  const year = Math.floor(key / 10000)
  const month = Math.floor(key / 100) % 100
  const day = key % 100
  return Date.UTC(year, month - 1, day)
}

interface TestFormMetricsDto {
  forms: TestFormMetricRow[]
  /** The floors the flags are judged against. Null when unreadable. */
  thresholds: TestFormThresholds | null
  /** Only populated when ?testId= names a form. Ten buckets, always. */
  distribution: TestFormDistributionLike[]
  /** Non-null while no form has a computable coefficient. Must be shown. */
  reliabilityCaveat: string | null
}

export async function GET(req: Request) {
  const auth = await requireReportingRole(REPORT_ID, ['ADMIN'])
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const wantCsv = url.searchParams.get('format') === 'csv'

  // Ninety days by default: a single week rarely gives any form enough attempts
  // to clear the completion floor, and a panel that is permanently greyed
  // teaches operators to stop reading it.
  const to = dateKeyParam(REPORT_ID, req.url, 'to', { fallback: dateKey(new Date()) })
  if (!to.ok) return to.response
  const from = dateKeyParam(REPORT_ID, req.url, 'from', {
    fallback: dateKey(new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86_400_000)),
  })
  if (!from.ok) return from.response

  // The span guard lives here rather than in SQL because the parameters arrive
  // as YYYYMMDD integers: a caller asking for 1990-2100 is a client bug, and the
  // answer to a client bug is a 400, not a slow query.
  if (to.value < from.value) {
    return badRequest(REPORT_ID, 'to must not be before from')
  }
  const spanDays = Math.round((utcOf(to.value) - utcOf(from.value)) / 86_400_000)
  if (spanDays > MAX_WINDOW_DAYS) {
    return badRequest(REPORT_ID, `range must be at most ${MAX_WINDOW_DAYS} days`)
  }

  const testId = optionalTestId(REPORT_ID, req.url)
  if (!testId.ok) return testId.response

  const result = await loadTestFormMetrics({
    fromDate: from.value,
    toDate: to.value,
    testId: testId.value,
  })

  if (result.error) {
    const status = result.code === '42501' ? 403 : 503
    if (wantCsv) {
      return new Response('Export unavailable\n', {
        status,
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    }
    return reportJson(
      envelope<TestFormMetricsDto>({
        reportId: REPORT_ID,
        data: null,
        asAt: result.asAt,
        state: 'error',
      }),
      { status }
    )
  }

  if (wantCsv) {
    return csvResponse(
      'test-form-metrics.csv',
      TEST_FORM_CSV_COLUMNS as unknown as string[],
      testFormCsvRows(result.forms)
    )
  }

  return reportJson(
    envelope<TestFormMetricsDto>({
      reportId: REPORT_ID,
      data: {
        forms: result.forms,
        thresholds: result.thresholds,
        distribution: result.distribution,
        reliabilityCaveat: reliabilityCaveat(result.forms),
      },
      asAt: result.asAt,
      state: result.forms.length === 0 ? 'empty' : 'ok',
    }),
    { status: 200, ttlSeconds: TTL_SECONDS }
  )
}
