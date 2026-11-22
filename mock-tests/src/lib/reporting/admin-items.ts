import { callReportingFunction } from './connection'
import { asAtFor } from './lag'
import type { ItemStatisticsRow } from './types'

/**
 * Report A1 - Item Statistics. "Which items are defective?" -> retire, rewrite
 * or recalibrate.
 *
 * A1 OWNS the item metrics. §5 X-6 is explicit that `p_value` and
 * `distractor_analysis` belong to A1 and that T4 is "the same metric restricted
 * to tests the tutor assigned and to that tutor's consented students". Both call
 * `reporting.item_statistics()`; this module reads the nightly materialisation of
 * it over everybody, and the tutor wrapper calls the same function live over a
 * scoped student set. Neither contains a copy of any formula, so the admin's
 * p-value and the tutor's cannot drift apart - which is the failure mode X-6
 * exists to prevent.
 *
 * TWO CAVEATS ARE PART OF THE PAYLOAD, NOT OPTIONAL DECORATION
 *   Both are computed in SQL from the data, so each clears itself when the
 *   underlying defect is fixed:
 *
 *   - `markingCaveat`: rendered while `responses.is_correct` disagrees with
 *     `questions.correct_answer`, in which case difficulty and discrimination
 *     count marks rather than right answers and A15 fails
 *     `marking_key_disagreement` for the same reason. Measured at ZERO
 *     disagreements on 2026-11-22, so it is currently silent - and deliberately
 *     not restated as a constant here, because the number rots while
 *     `marking_reliable` does not.
 *   - `skipRateCaveat`: counts the items with no served-item history, whose skip
 *     rate is `null` rather than 0.0%. Skip rate itself IS measured since 123 -
 *     `(served - answered) / served` from `fact_item_served` - but the capture
 *     started part-way through the history, so the coverage gap is reported per
 *     item instead of disclaiming the whole column.
 *
 *   Following the A3 precedent, an A1 response without these would be actively
 *   misleading: it would look like a clean measurement rather than a compromised
 *   one. No threshold is tuned anywhere in this stack to make the defect count
 *   look smaller.
 *
 * `item_flag_rate_pct` is a LIFETIME rate and labelled as such via
 * `period_label`, because `questions.flag_count` has no timestamp. §5 anticipates
 * exactly this: "Until then A1 shows a lifetime rate and says so."
 */

export type { ItemStatisticsRow } from './types'

/**
 * The calibration bands A1's flags are judged against.
 *
 * Read from `reporting.item_thresholds` through `admin_item_thresholds()` rather
 * than restated here. The scatter has to draw the defective quadrant, and a
 * hardcoded 0.20/0.90 in the component would silently stop matching the table the
 * moment an operator recalibrated it - the same duplication §5 X-6 forbids for the
 * metrics themselves, applied to the thresholds that judge them.
 */
export interface ItemThresholds {
  min_responses_per_item: number
  p_value_floor: number
  p_value_ceiling: number
  point_biserial_min: number
  median_time_max_seconds: number
  skip_rate_max_pct: number
  updated_at: string | null
}

export interface AdminItemStatisticsResult {
  items: ItemStatisticsRow[]
  /** Null if the thresholds could not be read; the chart then omits the bands. */
  thresholds: ItemThresholds | null
  asAt: string | null
  error: boolean
  code?: string
}

/**
 * Load A1. ADMIN only, enforced in SQL by `has_role('ADMIN')` inside
 * `admin_item_statistics()` - a non-admin gets zero rows rather than an error.
 *
 * The SQL-side check is not redundant with `requireReportingRole` in the route:
 * PostgREST exposes every granted function directly at `/rest/v1/rpc/<name>`, so
 * a route-only check would leave it callable by anyone who bypasses the route.
 * Migration 044 established this after finding exactly that bug.
 */
export async function loadItemStatistics(
  testId?: string | null
): Promise<AdminItemStatisticsResult> {
  const [res, thresholdsRes, asAt] = await Promise.all([
    callReportingFunction<ItemStatisticsRow>('admin_item_statistics', {
      p_test_id: testId ?? null,
    }),
    callReportingFunction<ItemThresholds>('admin_item_thresholds', {}),
    asAtFor('mv_item_statistics'),
  ])

  // A threshold read failure is not fatal: the items are still correct, the
  // scatter just cannot draw the band lines. Degrading the chart beats failing
  // the whole report over a missing overlay.
  const thresholds = thresholdsRes.error ? null : (thresholdsRes.rows[0] ?? null)

  if (res.error) return { items: [], thresholds, asAt, error: true, code: res.code }
  return { items: res.rows, thresholds, asAt, error: false }
}

// Wording lives in ./format so it can be tested in Node without dragging
// `next/headers` in via ./connection. Re-exported so this module stays the
// single import path for A1 callers.
export {
  defectReasonLabel,
  difficultyLabel,
  formatPValue,
  itemStatisticsCsvRows,
  itemStatisticsHeadline,
  markingCaveat,
  skipRateCaveat,
  topDistractor,
  ITEM_STATISTICS_CSV_COLUMNS,
} from './format'
export type { ItemStatisticsCsvRow } from './format'
