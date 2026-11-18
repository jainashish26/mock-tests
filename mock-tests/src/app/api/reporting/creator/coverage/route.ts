import { envelope, reportJson } from '@/lib/reporting/envelope'
import { requireReportingRole } from '@/lib/reporting/route-auth'
import { intParam } from '@/lib/reporting/route-params'
import { csvResponse } from '@/lib/reporting/csv'
import {
  coverageCaveat,
  draftAgeNote,
  loadProductionQueue,
  type ProductionQueueRow,
} from '@/lib/reporting/admin-coverage'

/**
 * TC1 - Content Coverage & Production Queue. GET /api/reporting/creator/coverage
 *
 * "What content needs writing?" -> prioritise authoring. TEST_CREATOR or ADMIN.
 *
 * §12.2 requires that this endpoint's response type has NO student field, and
 * `ProductionQueueRow` has none: it is built from `mv_topic_coverage`, which is
 * aggregated over the item catalogue and never touches a response or an attempt.
 * A creator deciding what to write next needs no student data, and the type
 * makes that structural rather than a convention someone must remember.
 *
 * WHY THE QUEUE IS NOT EMPTY WHILE THE THRESHOLD IS UNSET
 *   With `min_items_per_subtopic` NULL, every sub-topic's `coverage_status` is
 *   ADEQUATE. Migration 041 filtered to non-ADEQUATE rows, which returned zero
 *   rows and told every creator there was nothing to write - while 85 sub-topics
 *   included ones with a single published item. Migration 043 changed the filter
 *   so the queue falls back to scarcest-first ordering when the threshold is
 *   missing, and `deficit` is NULL rather than 0, because 0 reads as "none
 *   needed" and NULL reads as "unknown".
 */

const REPORT_ID = 'TC1'
const TTL_SECONDS = 3600
const LIMIT_DEFAULT = 50
const LIMIT_MAX = 500

const CSV_COLUMNS = [
  'production_priority',
  'subject',
  'topic',
  'sub_topic',
  'exam_type',
  'published_count',
  'draft_count',
  'min_items_required',
  'threshold_configured',
  'deficit',
  'oldest_draft_age_days',
  'coverage_status',
]

interface QueueRowDto extends ProductionQueueRow {
  /** Stall warning, precomputed so no client has to re-derive the 90-day rule. */
  draftNote: string | null
}

interface QueueDto {
  queue: QueueRowDto[]
  thresholdConfigured: boolean
  caveat: string | null
}

export async function GET(req: Request) {
  const auth = await requireReportingRole(REPORT_ID, ['TEST_CREATOR', 'ADMIN'])
  if (!auth.ok) return auth.response

  const limit = intParam(REPORT_ID, req.url, 'limit', {
    fallback: LIMIT_DEFAULT,
    min: 1,
    max: LIMIT_MAX,
  })
  if (!limit.ok) return limit.response

  const wantCsv = new URL(req.url).searchParams.get('format') === 'csv'
  const result = await loadProductionQueue(limit.value)

  if (result.error) {
    const status = result.code === '42501' ? 403 : 503
    if (wantCsv) {
      return new Response('Export unavailable\n', {
        status,
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    }
    return reportJson(
      envelope<QueueDto>({ reportId: REPORT_ID, data: null, asAt: result.asAt, state: 'error' }),
      { status }
    )
  }

  if (wantCsv) {
    return csvResponse('production-queue.csv', CSV_COLUMNS, result.queue)
  }

  const caveat = coverageCaveat(result.queue)

  return reportJson(
    envelope<QueueDto>({
      reportId: REPORT_ID,
      data: {
        queue: result.queue.map((row) => ({ ...row, draftNote: draftAgeNote(row) })),
        thresholdConfigured: caveat === null,
        caveat,
      },
      asAt: result.asAt,
      state: result.queue.length === 0 ? 'empty' : 'ok',
    }),
    { status: 200, ttlSeconds: TTL_SECONDS }
  )
}
