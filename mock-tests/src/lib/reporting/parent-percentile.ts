import { callReportingFunction } from './connection'
import { asAtFor } from './lag'
import type { PercentileRow } from './types'

/**
 * Report P2 - Percentile & Cohort Context. "How does this compare to similar
 * students?" (11-...md §4.4 PA4)
 *
 * EVERY RULE LIVES IN SQL, NOT HERE (B1/X-4)
 *   - Suppression below the cohort floor, quartile bands below the point
 *     floor, and the mid-rank convention are all in mv_percentile_cohort and
 *     reporting.percentile_from_scores (migration 093). This module cannot
 *     widen them: the wrapper's RETURNS clause has no raw percentage field.
 *   - B1 (never without P1) is enforced by parent_percentile() raising 42501
 *     when the student has no completed, scored attempt. The route maps that
 *     to 403; the panel renders it as "complete a first test", not an error.
 *   - personal_progress_delta is P4's metric, embedded by the wrapper. This
 *     module never recomputes progress (MECE - parent-history.ts owns it).
 *
 * `code` is surfaced on error so the route can distinguish the B1 refusal
 * (42501 -> 403) from a genuine upstream failure (-> 503). Collapsing both
 * into one error state would show a parent "something went wrong" when the
 * truth is "your child hasn't sat a test yet".
 */

export type { PercentileRow } from './types'

export interface ParentPercentileResult {
  rows: PercentileRow[]
  asAt: string | null
  error: boolean
  /** Postgres error code when the call failed (42501 = B1 refusal). */
  code?: string
}

/** Load P2 for one child. Never throws. */
export async function loadParentPercentile(studentId: string): Promise<ParentPercentileResult> {
  const [res, asAt] = await Promise.all([
    callReportingFunction<PercentileRow>('parent_percentile', { p_student_id: studentId }),
    asAtFor('mv_percentile_cohort'),
  ])

  if (res.error) return { rows: [], asAt, error: true, code: res.code }
  return { rows: res.rows, asAt, error: false }
}

// Wording lives in ./format so it can be tested in Node without dragging
// `next/headers` in via ./connection. Re-exported so callers have one import
// path, matching parent-mastery.ts and parent-projection.ts.
export {
  cohortContextSentence,
  percentileBandLabel,
  percentileSentence,
  progressPairingSentence,
} from './format'