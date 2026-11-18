import { callReportingFunction } from './connection'
import { asAtFor } from './lag'
import type { AttemptHistoryRow, ProgressSummaryRow } from './types'

/**
 * Report P4 - Test History & Trends. "Is my child improving?"
 *
 * OWNERSHIP (11-bi-reporting-design.md §4.4)
 *   P4 owns `attempt_score`, `personal_progress_delta` and `section_trend`.
 *   P2 (percentile, Phase 2) must borrow `personal_progress_delta` from here
 *   rather than compute its own - two definitions of progress is a MECE
 *   breach, and §12.2 makes the pairing a server-side rule (B1).
 *
 * WHY TWO CALLS
 *   `child_attempt_history()` returns the attempt-level rows;
 *   `parent_progress_summary()` returns the per-family trend. Both read the
 *   same materialised view, so the header and the table cannot disagree about
 *   what the latest score was. Computing the summary in TypeScript from the
 *   rows would have been a second definition of trend living in application
 *   code, invisible to every other consumer.
 *
 * WHAT THIS MODULE NEVER EXPOSES
 *   It is parent- and ADMIN-only at the database layer: both functions check
 *   `may_read_results()`, so a student calling either gets zero rows even
 *   though the student is the subject of every row. That is the boundary
 *   migration 015 draws, enforced in SQL rather than in this file.
 *
 * WHY THE TYPES AND HELPERS LIVE ELSEWHERE
 *   This module imports `./connection`, which reaches `next/headers` - so it
 *   cannot be loaded by the Node test runner or by a client bundle. Row shapes
 *   live in `./types` and the wording rules in `./format`, both re-exported
 *   below so `@/lib/reporting/parent-history` stays the single import path.
 *   The rules most worth testing therefore live where they CAN be tested.
 */

export type {
  AttemptHistoryRow,
  ProgressSummaryRow,
  SectionTrendPoint,
  TrendDirection,
} from './types'
export { primaryFamily, sectionTrends, trendSentence } from './format'

export interface ParentHistoryResult {
  attempts: AttemptHistoryRow[]
  summary: ProgressSummaryRow[]
  /** `mv_attempt_history`'s last successful refresh. Null if unknown. */
  asAt: string | null
  error: boolean
}

/**
 * Load P4 for one child.
 *
 * Never throws. A reporting failure sets `error` so the UI shows its error
 * state rather than an empty dashboard - "no completed tests yet" and "the
 * query failed" must not look the same to a parent.
 */
export async function loadParentHistory(studentId: string): Promise<ParentHistoryResult> {
  const [attemptsRes, summaryRes, asAt] = await Promise.all([
    callReportingFunction<AttemptHistoryRow>('child_attempt_history', {
      p_student_id: studentId,
    }),
    callReportingFunction<ProgressSummaryRow>('parent_progress_summary', {
      p_student_id: studentId,
    }),
    asAtFor('mv_attempt_history'),
  ])

  // Either call failing is a failure. Partial success would render a trend
  // header contradicted by the table beneath it.
  if (attemptsRes.error || summaryRes.error) {
    return { attempts: [], summary: [], asAt, error: true }
  }

  return {
    attempts: attemptsRes.rows,
    summary: summaryRes.rows,
    asAt,
    error: false,
  }
}
