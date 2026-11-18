import { envelope, reportJson } from '@/lib/reporting/envelope'
import { requireReportingRole } from '@/lib/reporting/route-auth'
import { textParam } from '@/lib/reporting/route-params'
import { csvResponse } from '@/lib/reporting/csv'
import {
  coverageCaveat,
  loadCoverageGaps,
  type CoverageGapRow,
} from '@/lib/reporting/admin-coverage'

/**
 * A3 - Curriculum Coverage Gaps. GET /api/reporting/admin/coverage-gaps
 *
 * "Where is coverage too thin?" -> commission content. ADMIN only, enforced in
 * SQL by `has_role('ADMIN')` inside `admin_coverage_gaps()`.
 *
 * THE `caveat` FIELD IS NOT OPTIONAL DECORATION
 *   `coverage_thresholds.min_items_per_subtopic` is NULL in the live database,
 *   which disables the TOO_FEW branch of `coverage_status`. All 85 sub-topics
 *   currently report ADEQUATE, including ones with a single published item. So
 *   an A3 response with no caveat would be actively misleading: it would look
 *   like a clean bill of health rather than an unclassifiable one.
 *
 *   `caveat` is therefore part of the payload whenever the threshold is unset,
 *   and `thresholdConfigured` is exposed so a client cannot render
 *   `coverage_status` as a verdict without also handling it. Migration 042 makes
 *   the same fact fail an A15 check, so it is visible to an operator who never
 *   opens this endpoint at all.
 */

const REPORT_ID = 'A3'
const TTL_SECONDS = 3600

const CSV_COLUMNS = [
  'subject',
  'topic',
  'sub_topic',
  'exam_type',
  'item_count',
  'published_count',
  'draft_count',
  'min_items_required',
  'threshold_configured',
  'coverage_status',
  'avg_authored_difficulty',
  'avg_observed_difficulty',
]

interface CoverageDto {
  gaps: CoverageGapRow[]
  thresholdConfigured: boolean
  /** Non-null while the threshold is unset. Must be shown with the data. */
  caveat: string | null
}

export async function GET(req: Request) {
  const auth = await requireReportingRole(REPORT_ID, ['ADMIN'])
  if (!auth.ok) return auth.response

  const examType = textParam(REPORT_ID, req.url, 'examType')
  if (!examType.ok) return examType.response

  const wantCsv = new URL(req.url).searchParams.get('format') === 'csv'
  const result = await loadCoverageGaps(examType.value)

  if (result.error) {
    const status = result.code === '42501' ? 403 : 503
    if (wantCsv) {
      return new Response('Export unavailable\n', {
        status,
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    }
    return reportJson(
      envelope<CoverageDto>({ reportId: REPORT_ID, data: null, asAt: result.asAt, state: 'error' }),
      { status }
    )
  }

  if (wantCsv) {
    return csvResponse('coverage-gaps.csv', CSV_COLUMNS, result.gaps)
  }

  const caveat = coverageCaveat(result.gaps)

  return reportJson(
    envelope<CoverageDto>({
      reportId: REPORT_ID,
      data: {
        gaps: result.gaps,
        thresholdConfigured: caveat === null,
        caveat,
      },
      asAt: result.asAt,
      // Zero rows is genuinely ambiguous here and the caveat disambiguates it:
      // with a threshold configured, empty means no gaps; without one, empty
      // would mean the view itself is unpopulated. Either way the UI shows the
      // empty state alongside the caveat rather than "all coverage is adequate".
      state: result.gaps.length === 0 ? 'empty' : 'ok',
    }),
    { status: 200, ttlSeconds: TTL_SECONDS }
  )
}
