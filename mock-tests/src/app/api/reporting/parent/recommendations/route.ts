import { envelope, reportJson } from '@/lib/reporting/envelope'
import { requireReportingRole } from '@/lib/reporting/route-auth'
import { requireStudentId } from '@/lib/reporting/route-params'
import { loadParentRecommendations, type RecommendationRow } from '@/lib/reporting/parent-recommendations'

/**
 * P8 - Recommended Next Actions. GET /api/reporting/parent/recommendations
 *
 * RULE B12: AT MOST THREE ITEMS, ENFORCED SERVER-SIDE.
 *
 * §12.2 marks this endpoint "At most 3 items (B12), enforced server-side", and
 * the enforcement point is `LIMIT 3` inside `public.parent_recommendations()`
 * (migration 029) - not the `.slice(0, 3)` in the loader, and not anything in
 * the UI. The rule exists because a parent handed eight recommendations acts
 * on none of them; a client-side slice would leave the rest in the payload
 * where any consumer could render it.
 *
 * `expected_impact_score` is a RANKING KEY, not a predicted score gain. It is
 * returned so a client can order or debug, and the UI deliberately does not
 * render it as a number: presenting a heuristic ordering as a forecast would
 * be a misleading claim about a child's future performance.
 */

const TTL_SECONDS = 900
const MAX_ITEMS = 3

interface RecommendationsDto {
  recommendations: RecommendationRow[]
  /** True when fewer than three were available. Absence of a fourth is a fact
   *  about the child's data, not a truncation, and the UI should not imply
   *  that more exist. */
  fewerThanMax: boolean
}

export async function GET(req: Request) {
  const REPORT_ID = 'P8'

  const auth = await requireReportingRole(REPORT_ID, ['PARENT', 'ADMIN'])
  if (!auth.ok) return auth.response

  const student = requireStudentId(REPORT_ID, req.url)
  if (!student.ok) return student.response

  const result = await loadParentRecommendations(student.value)

  if (result.error) {
    return reportJson(
      envelope<RecommendationsDto>({
        reportId: REPORT_ID,
        data: null,
        asAt: result.asAt,
        state: 'error',
      }),
      { status: 503 }
    )
  }

  // Defence in depth. The SQL LIMIT is the real cap; this only guarantees the
  // envelope cannot exceed it even if a future migration drops the LIMIT.
  const recommendations = result.recommendations.slice(0, MAX_ITEMS)

  return reportJson(
    envelope<RecommendationsDto>({
      reportId: REPORT_ID,
      data: {
        recommendations,
        fewerThanMax: recommendations.length < MAX_ITEMS,
      },
      asAt: result.asAt,
      // No recommendation is a genuine empty state: it means no topic has five
      // or more responses yet, so there is no signal to rank. That is not an
      // error and it is not "your child has no gaps" - the UI must not read it
      // as the latter.
      state: recommendations.length === 0 ? 'empty' : 'ok',
    }),
    { status: 200, ttlSeconds: TTL_SECONDS }
  )
}
