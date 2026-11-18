import { envelope, reportJson } from '@/lib/reporting/envelope'
import { requireReportingRole } from '@/lib/reporting/route-auth'
import { requireTestId } from '@/lib/reporting/route-params'
import { csvResponse } from '@/lib/reporting/csv'
import {
  ITEM_STATISTICS_CSV_COLUMNS,
  itemStatisticsCsvRows,
  markingCaveat,
  skipRateCaveat,
} from '@/lib/reporting/admin-items'
import {
  loadTutorItemAnalysis,
  type ItemStatisticsRow,
} from '@/lib/reporting/tutor'

/**
 * T4 - Item Analysis. GET /api/reporting/tutor/item-analysis?testId=
 *
 * "Is this item working for my students?" -> keep, replace or reteach. TUTOR only.
 *
 * SAME NUMBERS AS A1, NARROWER POPULATION. §5 X-6 makes A1 the owner of
 * `p_value` and `distractor_analysis` and defines T4 as "the same metric
 * restricted to tests the tutor assigned and to that tutor's consented students".
 * Both call `reporting.item_statistics()`; neither has its own copy of a formula.
 * Splitting the definition is what X-6 warns would make the tutor's p-value and
 * the admin's diverge within a quarter.
 *
 * `testId` IS REQUIRED, AND THE FAILURE MODE IS 403
 *   §12 specifies "403 unless the tutor assigned that test", and
 *   `tutor_item_analysis()` raises SQLSTATE 42501 when no `assignments` row with
 *   `assigned_by = auth.uid()` exists for it - which maps to 403 below. This is
 *   deliberately different from the other tutor reports, which return zero rows
 *   for a missing consent: "you did not set this work" must not be
 *   indistinguishable from "this test has no data", or a tutor will keep
 *   re-assigning work that already has responses.
 *
 *   Scope is enforced in SQL, not here. §4.5 requires an assignment by the calling
 *   tutor COMBINED WITH current consent, and consent is evaluated at read time by
 *   `is_tutor_of()`, so a parent's revocation takes effect on the next request
 *   rather than at the next nightly refresh.
 *
 * The same two caveats as A1 are attached, for the same reason: a tutor reading
 * "% correct" as "% who got it right" would reteach a topic on the strength of a
 * marking column that currently disagrees with the answer key half the time.
 */

const REPORT_ID = 'T4'
const TTL_SECONDS = 3600

interface TutorItemAnalysisDto {
  items: ItemStatisticsRow[]
  markingCaveat: string | null
  skipCaveat: string | null
}

export async function GET(req: Request) {
  const auth = await requireReportingRole(REPORT_ID, ['TUTOR'])
  if (!auth.ok) return auth.response

  const testId = requireTestId(REPORT_ID, req.url)
  if (!testId.ok) return testId.response

  const wantCsv = new URL(req.url).searchParams.get('format') === 'csv'
  const result = await loadTutorItemAnalysis(testId.value)

  if (result.error) {
    const status = result.code === '42501' ? 403 : 503
    if (wantCsv) {
      return new Response('Export unavailable\n', {
        status,
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    }
    return reportJson(
      envelope<TutorItemAnalysisDto>({
        reportId: REPORT_ID,
        data: null,
        asAt: null,
        state: 'error',
      }),
      { status }
    )
  }

  if (wantCsv) {
    return csvResponse(
      'tutor-item-analysis.csv',
      ITEM_STATISTICS_CSV_COLUMNS as string[],
      itemStatisticsCsvRows(result.rows)
    )
  }

  return reportJson(
    envelope<TutorItemAnalysisDto>({
      reportId: REPORT_ID,
      data: {
        items: result.rows,
        markingCaveat: markingCaveat(result.rows),
        skipCaveat: skipRateCaveat(result.rows),
      },
      // Zero rows is a legitimate outcome here rather than an error: the tutor
      // assigned the test but no consented student has answered it yet.
      asAt: new Date().toISOString(),
      state: result.rows.length === 0 ? 'empty' : 'ok',
    }),
    { status: 200, ttlSeconds: TTL_SECONDS }
  )
}
