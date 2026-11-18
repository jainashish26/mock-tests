import { callReportingFunction } from './connection'
import { asAtFor } from './lag'
import { capRecommendations } from './format'
import type { RecommendationRow } from './types'

/**
 * Report P8 - Recommended Next Actions. "What should we do next?"
 *
 * RULE B12: AT MOST THREE. Enforced in SQL by `LIMIT 3` inside
 * `public.parent_recommendations()` (migration 029), not here. A UI-side slice
 * would leave the fourth item in the payload where any client could render it,
 * and the reason the rule exists is that a parent given eight recommendations
 * acts on none of them.
 *
 * WHY A HEURISTIC AND NOT A MODEL
 *   There is no validated learning-gain model for these exams and none is
 *   invented here. Ranking is headroom x ln(evidence volume): how far the topic
 *   is from 100%, weighted by how many questions support that estimate. The log
 *   damps volume so 200 questions at 60% does not outrank 30 questions at 25% -
 *   the second is the weaker skill and the better use of this week.
 *   `expected_impact_score` is a RANKING KEY, not a predicted score gain, and is
 *   never rendered as a number for that reason.
 *
 * WHY A FIVE-RESPONSE FLOOR
 *   Below five responses there is no signal. A single missed question would
 *   otherwise produce a 0% "gap" and top the list, sending a parent to work on
 *   something the child got wrong once.
 */

export type { RecommendationRow } from './types'
export { accuracySentence, actionSentence, capRecommendations } from './format'

/** Rule B12, restated where the cap is applied. */
export const MAX_RECOMMENDATIONS = 3

export interface ParentRecommendationsResult {
  recommendations: RecommendationRow[]
  asAt: string | null
  error: boolean
}

/**
 * Load P8 for one child.
 *
 * The result is already capped at three by the database. `capRecommendations`
 * is defence in depth, not the enforcement point: if a future migration dropped
 * the LIMIT, this would keep the contract - though the payload would still have
 * carried the extra rows, which is why the SQL LIMIT is the real control.
 */
export async function loadParentRecommendations(
  studentId: string
): Promise<ParentRecommendationsResult> {
  const [res, asAt] = await Promise.all([
    callReportingFunction<RecommendationRow>('parent_recommendations', {
      p_student_id: studentId,
    }),
    asAtFor('mv_skill_gap'),
  ])

  if (res.error) return { recommendations: [], asAt, error: true }

  return {
    recommendations: capRecommendations(res.rows, MAX_RECOMMENDATIONS),
    asAt,
    error: false,
  }
}
