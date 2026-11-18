import { envelope, reportJson } from '@/lib/reporting/envelope'
import { requireReportingRole } from '@/lib/reporting/route-auth'
import { optionalTestId } from '@/lib/reporting/route-params'
import { csvResponse } from '@/lib/reporting/csv'
import {
  ITEM_STATISTICS_CSV_COLUMNS,
  itemStatisticsCsvRows,
  loadItemStatistics,
  markingCaveat,
  skipRateCaveat,
  type ItemStatisticsRow,
} from '@/lib/reporting/admin-items'

/**
 * A1 - Item Statistics. GET /api/reporting/admin/item-statistics?testId=
 *
 * "Which items are defective?" -> retire, rewrite or recalibrate. ADMIN only,
 * enforced in SQL by `has_role('ADMIN')` inside `admin_item_statistics()` as well
 * as by `requireReportingRole` here. The SQL check is the one that matters:
 * PostgREST exposes every granted function at `/rest/v1/rpc/<name>`, so a
 * route-only guard would leave it callable by anyone who skips the route.
 *
 * A1 IS THE OWNER OF THIS METRIC. §5 X-6 assigns `p_value`, `point_biserial`,
 * `distractor_analysis`, `median_time_per_item` and `skip_rate` to A1, and makes
 * T4 "the same metric restricted to tests the tutor assigned". Both call
 * `reporting.item_statistics()`, so there is exactly one definition and the two
 * cannot diverge - a pgtap assertion fails if they do on the same population.
 *
 * THE CAVEATS ARE PART OF THE PAYLOAD
 *   Following the A3 precedent: a report whose inputs are compromised must say so
 *   in the response, not only in a code comment. `markingCaveat` is non-null while
 *   `responses.is_correct` contradicts the authored key (currently 52% of MCQ
 *   responses), and `skipRateCaveat` while skips are not captured at all. Both are
 *   derived from the data in SQL, so each clears itself when its defect is fixed.
 *   Without them this endpoint would return "45% correct" for an item and imply it
 *   was measured, when in fact the marking behind it is noise.
 */

const REPORT_ID = 'A1'
const TTL_SECONDS = 3600

interface ItemStatisticsDto {
  items: ItemStatisticsRow[]
  /** Non-null while marking disagrees with the answer key. Must be shown. */
  markingCaveat: string | null
  /** Non-null while skipped items are not recorded. Must be shown. */
  skipCaveat: string | null
}

export async function GET(req: Request) {
  const auth = await requireReportingRole(REPORT_ID, ['ADMIN'])
  if (!auth.ok) return auth.response

  const testId = optionalTestId(REPORT_ID, req.url)
  if (!testId.ok) return testId.response

  const wantCsv = new URL(req.url).searchParams.get('format') === 'csv'
  const result = await loadItemStatistics(testId.value)

  if (result.error) {
    const status = result.code === '42501' ? 403 : 503
    if (wantCsv) {
      return new Response('Export unavailable\n', {
        status,
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    }
    return reportJson(
      envelope<ItemStatisticsDto>({
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
      'item-statistics.csv',
      ITEM_STATISTICS_CSV_COLUMNS as string[],
      itemStatisticsCsvRows(result.items)
    )
  }

  return reportJson(
    envelope<ItemStatisticsDto>({
      reportId: REPORT_ID,
      data: {
        items: result.items,
        markingCaveat: markingCaveat(result.items),
        skipCaveat: skipRateCaveat(result.items),
      },
      asAt: result.asAt,
      state: result.items.length === 0 ? 'empty' : 'ok',
    }),
    { status: 200, ttlSeconds: TTL_SECONDS }
  )
}
