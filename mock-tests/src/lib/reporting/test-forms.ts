import { callReportingFunction } from './connection'
import type { TestFormDistributionLike, TestFormMetricLike } from './test-form-format'

/**
 * Report A4 - Test-Form Metrics. "Is this test form fit to stay live?"
 *
 * A4 OWNS these four metrics (section 5): `test_completion_rate`,
 * `abandonment_point`, `score_distribution`, `reliability_coefficient`. A1 owns
 * item difficulty and discrimination; nothing here recomputes them, and nothing
 * here is recomputed by T4.
 *
 * The reporting functions are live rather than materialised - see 121's header
 * for why that is a recorded deviation, and for the volume at which it should
 * become a nightly MV instead.
 */

/** One row per test form, from `admin_test_form_metrics()`. */
export interface TestFormMetricRow extends TestFormMetricLike {
  test_id: string
  exam_type: string | null
  family_label: string | null
  family_group: string | null
  year_level_min: number | null
  year_level_max: number | null
  content_status: string | null
  as_at: string | null
}

/** The floors A4 judges against, read from `admin_test_form_thresholds()`. */
export interface TestFormThresholds {
  min_attempts_for_completion: number
  min_attempts_for_reliability: number
  reliability_floor: number
  abandonment_alert_pct: number
  updated_at: string | null
}

export interface TestFormMetricsResult {
  forms: TestFormMetricRow[]
  /** Null if the thresholds could not be read; the panel then omits the floors. */
  thresholds: TestFormThresholds | null
  distribution: TestFormDistributionLike[]
  asAt: string | null
  error: boolean
  code?: string
}

/**
 * Load A4. ADMIN only, enforced in SQL by `has_role('ADMIN')` inside
 * `admin_test_form_metrics()` - a non-admin gets zero rows rather than an error.
 *
 * The SQL-side check is not redundant with `requireReportingRole` in the route:
 * PostgREST exposes every granted function at `/rest/v1/rpc/<name>`, so a
 * route-only check would leave it callable by anyone who skips the route.
 *
 * `testId` is optional. Without it the report covers every form that has
 * attempts in the window, which is the "which forms need attention" question.
 * With it, the histogram for that form is loaded too - the panel shows one
 * distribution at a time rather than ten tiny ones.
 */
export async function loadTestFormMetrics(opts: {
  fromDate: number
  toDate: number
  testId?: string | null
}): Promise<TestFormMetricsResult> {
  const [formsRes, thresholdsRes] = await Promise.all([
    callReportingFunction<TestFormMetricRow>('admin_test_form_metrics', {
      p_from_date: opts.fromDate,
      p_to_date: opts.toDate,
    }),
    callReportingFunction<TestFormThresholds>('admin_test_form_thresholds', {}),
  ])

  // A thresholds read failure is not fatal: the forms are still correct, the
  // panel just cannot quote the floor it is judging against. Degrading one line
  // beats failing the report.
  const thresholds = thresholdsRes.error ? null : (thresholdsRes.rows[0] ?? null)

  // `as_at` travels WITH the rows (MAX(etl_loaded_at) of the facts in scope)
  // rather than being looked up in reporting.refresh_log: A4 reads base fact
  // tables, and a fact table has no refresh_log entry. Resolving the lag the MV
  // way would report "unknown" for a report whose freshness is in fact known.
  const asAt = formsRes.rows[0]?.as_at ?? null

  if (formsRes.error) {
    return {
      forms: [],
      thresholds,
      distribution: [],
      asAt,
      error: true,
      code: formsRes.code,
    }
  }

  // The histogram follows the FOCUS form: the one named by `testId`, or the
  // busiest form when none is named. Doing that resolution here rather than in
  // the component means the panel cannot forget to fetch it, and it is one extra
  // round trip of ten rows rather than a second way to call the report.
  const focusId = opts.testId ?? formsRes.rows[0]?.test_id ?? null
  const distributionRes = focusId
    ? await callReportingFunction<TestFormDistributionLike>('admin_test_form_score_distribution', {
        p_test_id: focusId,
        p_from_date: opts.fromDate,
        p_to_date: opts.toDate,
      })
    : { rows: [] as TestFormDistributionLike[], error: false }

  return {
    forms: formsRes.rows,
    thresholds,
    distribution: distributionRes.error ? [] : distributionRes.rows,
    asAt,
    error: false,
  }
}

// Wording lives in ./test-form-format so it can be tested in Node without
// dragging `next/headers` in via ./connection. Re-exported so this module stays
// the single import path for A4 callers.
export {
  abandonmentSentence,
  attentionFlags,
  distributionSummary,
  formatCoefficient,
  formatPct,
  reliabilityCaveat,
  reliabilityLabel,
  testFormCsvRows,
  TEST_FORM_CSV_COLUMNS,
  RELIABILITY_STATES,
} from './test-form-format'
export type {
  ReliabilityState,
  TestFormCsvRow,
  TestFormDistributionLike,
  TestFormMetricLike,
} from './test-form-format'
