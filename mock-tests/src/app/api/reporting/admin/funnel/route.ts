import { envelope, reportJson } from '@/lib/reporting/envelope'
import { requireReportingRole } from '@/lib/reporting/route-auth'
import { dateKeyParam } from '@/lib/reporting/route-params'
import { csvResponse } from '@/lib/reporting/csv'
import { dateKey } from '@/lib/reporting/format'
import { loadFunnel, type FunnelOutcomes, type FunnelSegment, type FunnelStageRow } from '@/lib/reporting/admin-funnel'
import { funnelHeadline, weakestStage } from '@/lib/reporting/format'

/**
 * A11 - Conversion Funnel. GET /api/reporting/admin/funnel
 *
 * "Where are we losing people?" -> fix the weakest stage. ADMIN only, enforced in
 * SQL by both underlying functions.
 *
 * ?segment=none|channel|campaign|device. Defaults to `none` because the headline
 * funnel is the question; segmentation is the drill-down (C2). The three-way
 * cross-product is deliberately not offered - multiplying dimensions is how a
 * 58-signup funnel becomes a dozen unreadable 4-visitor cells.
 *
 * RAW COUNTS TRAVEL WITH EVERY RATE
 *   `visitors`, `prev_stage_visitors`, `stage_dropoff_count`, `reached_paywall`,
 *   `checkout_started` and `signup_cohort` are all in the payload. §5.4's caveat
 *   on stage_dropoff_count is that it must be shown BESIDE the percentage because
 *   "a 50% drop on 2 users is not a finding", and C5 requires the free-to-paid
 *   denominator to be stated explicitly on the visual. Both are only satisfiable
 *   if the client has the denominator, so it is not optional here.
 *
 * C9 (device split) IS NOW MET. Device is derived server-side by
 * `classifyDevice()` (src/lib/funnel/device.ts), written to `props.device` by the
 * beacon, and inherited by server-side stage events through `trackEvent`. It was
 * previously captured only on beacon events, which carry no funnel stage and so
 * never reached this report.
 *
 * `deviceUnimplemented` is computed from the returned rows rather than hardcoded,
 * so it stays honest in both directions: normally false, and true again if device
 * capture ever regresses - in which case the UI states the gap instead of
 * rendering a one-row breakdown that reads as "100% unknown devices".
 */

const REPORT_ID = 'A11'
const TTL_SECONDS = 3600
/** Default look-back when no ?from is supplied. See the range block below. */
const DEFAULT_WINDOW_DAYS = 30

const SEGMENTS: FunnelSegment[] = ['none', 'channel', 'campaign', 'device']

const CSV_COLUMNS = [
  'stage_rank',
  'stage',
  'channel',
  'campaign',
  'device_class',
  'visitors',
  'prev_stage',
  'prev_stage_visitors',
  'stage_conversion_rate',
  'stage_dropoff_count',
  'suppressed',
]

interface FunnelDto {
  segment: FunnelSegment
  stages: FunnelStageRow[]
  outcomes: FunnelOutcomes | null
  headline: string
  weakestStageName: string | null
  /** True only if every returned row is 'unknown' - i.e. device capture has
   *  regressed. Computed from data, not assumed. */
  deviceUnimplemented: boolean
}

export async function GET(req: Request) {
  const auth = await requireReportingRole(REPORT_ID, ['ADMIN'])
  if (!auth.ok) return auth.response

  const range = (() => {
    // A funnel over "today" is almost always empty, and an empty default teaches
    // operators the report is broken. Thirty days is the shortest window in which
    // stage-to-stage counts can reach the n>=20 reporting floor.
    const to = dateKeyParam(REPORT_ID, req.url, 'to', { fallback: dateKey(new Date()) })
    if (!to.ok) return to
    const from = dateKeyParam(REPORT_ID, req.url, 'from', {
      fallback: dateKey(new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86_400_000)),
    })
    if (!from.ok) return from
    return { ok: true as const, value: { from: from.value, to: to.value } }
  })()
  if (!range.ok) return range.response

  const url = new URL(req.url)
  const rawSegment = (url.searchParams.get('segment') ?? 'none').toLowerCase()
  const segment: FunnelSegment = (SEGMENTS as string[]).includes(rawSegment)
    ? (rawSegment as FunnelSegment)
    : 'none'

  const result = await loadFunnel(range.value.from, range.value.to, segment)

  if (result.error) {
    const status = result.code === '42501' ? 403 : 503
    if (url.searchParams.get('format') === 'csv') {
      return new Response('Export unavailable\n', {
        status,
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    }
    return reportJson(
      envelope<FunnelDto>({ reportId: REPORT_ID, data: null, asAt: result.asAt, state: 'error' }),
      { status }
    )
  }

  if (url.searchParams.get('format') === 'csv') {
    return csvResponse('funnel.csv', CSV_COLUMNS, result.stages)
  }

  const weakest = weakestStage(result.stages)

  return reportJson(
    envelope<FunnelDto>({
      reportId: REPORT_ID,
      data: {
        segment,
        stages: result.stages,
        outcomes: result.outcomes,
        headline: funnelHeadline(result.stages),
        weakestStageName: weakest ? weakest.stage : null,
        deviceUnimplemented: result.stages.every((s) => s.device_class === 'unknown'),
      },
      asAt: result.asAt,
      state: result.stages.length === 0 ? 'empty' : 'ok',
    }),
    { status: 200, ttlSeconds: TTL_SECONDS }
  )
}
