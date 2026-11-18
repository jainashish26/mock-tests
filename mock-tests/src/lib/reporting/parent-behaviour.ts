import { callReportingFunction } from './connection'
import { asAtFor } from './lag'
import type { StudyBehaviourRow } from './types'

/**
 * Report P7 - Study Behaviour. "Is my child working effectively?"
 *
 * The decision P7 supports is "change HOW they practise", not "practise more".
 * That distinction drives the copy in `./format`: every metric is framed as
 * something adjustable, never as effort or character.
 *
 * TWO METRICS ARE PROXIES, AND SAY SO
 *   `guess_rate` is a rapid-wrong-answer proxy (answered, marked wrong, under
 *   10 seconds). The data model has no guess flag, so this is an inference
 *   about behaviour, not a measurement of it. `pace_vs_expected` compares
 *   against the observed median of the same year level, because no expected
 *   pace is authored anywhere in the platform. Both are documented in the view
 *   comments (migration 028) and both are labelled as estimates in the UI
 *   rather than presented as measured facts.
 *
 * WHY PACE IS NEVER SHOWN ALONE
 *   Fast is not good and slow is not bad. Fast + wrong is guessing; slow +
 *   right is labouring. `paceLabel()` in `./format` therefore REQUIRES accuracy
 *   as a second argument and returns null without it - a UI that rendered pace
 *   on its own would tell a parent their careful child is "too slow".
 *
 * Types live in `./types` and wording rules in `./format`; both are re-exported
 * so this path stays the single import for callers. See parent-history.ts for
 * why the split exists.
 */

export type { StudyBehaviourRow } from './types'
export { adherencePct, behaviourSentence, formatDuration, paceLabel } from './format'

export interface ParentBehaviourResult {
  weeks: StudyBehaviourRow[]
  asAt: string | null
  error: boolean
}

/** §12.2 caps `weeks` at 26. Clamped here as well as in SQL. */
const MAX_WEEKS = 26

/**
 * Load P7 for one child.
 *
 * @param weeks Lookback window, clamped to 1..26. The SQL function clamps too,
 *   so a caller that bypasses this module still cannot widen the window.
 */
export async function loadParentBehaviour(
  studentId: string,
  weeks = 12
): Promise<ParentBehaviourResult> {
  const clamped = Math.min(Math.max(Math.trunc(weeks) || 12, 1), MAX_WEEKS)

  const [res, asAt] = await Promise.all([
    callReportingFunction<StudyBehaviourRow>('parent_study_behaviour', {
      p_student_id: studentId,
      p_weeks: clamped,
    }),
    asAtFor('mv_study_behaviour'),
  ])

  if (res.error) return { weeks: [], asAt, error: true }
  return { weeks: res.rows, asAt, error: false }
}
