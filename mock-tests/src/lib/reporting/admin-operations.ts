import { callReportingFunction } from './connection'
import { asAtFor } from './lag'
import type { DataQualityRow, PlatformHealthRow } from './types'

/**
 * Reports A14 (Platform Health & Usage) and A15 (Data Quality &
 * Reconciliation) - the two operations surfaces in Phase 1.
 *
 * WHY THESE TWO SIT TOGETHER
 *   They answer the two questions an operator asks in the same breath: "is the
 *   platform coping?" and "can I trust what it is telling me?". A health
 *   dashboard with no data-quality panel invites the operator to act on numbers
 *   that stopped loading two days ago - which is worse than no dashboard,
 *   because the absence of data is at least visible.
 *
 * WHY BOTH ARE ADMIN-ONLY
 *   Both SQL functions raise 42501 unless `has_role('ADMIN')`. Neither contains
 *   a student identifier, but both contain information an operator needs and a
 *   customer should not: A14 exposes capacity headroom and error rates, A15
 *   exposes which internal objects are stale or broken. Publishing "our data
 *   quality check is failing" on a parent screen would be both alarming and
 *   unactionable.
 *
 * THE 366-DAY CAP
 *   Both functions enforce the §12.1 admin aggregate range cap in SQL. It is
 *   enforced there rather than only in the route because these functions run as
 *   SECURITY DEFINER, outside the reporting_ro statement_timeout - an unbounded
 *   aggregate over an hourly view is exactly the runaway query that timeout
 *   exists to stop.
 *
 * Types live in `./types` and the summary/verdict helpers in `./format`, both
 * re-exported so this path stays the single import for callers.
 */

export type { DataQualityRow, PlatformHealthRow, QualityStatus } from './types'
export {
  capacitySentence,
  dateKey,
  defaultDateRange,
  peakConcurrency,
  qualitySummary,
  qualityVerdict,
  refreshLagRows,
  worstErrorRate,
} from './format'

export interface AdminHealthResult {
  hours: PlatformHealthRow[]
  asAt: string | null
  error: boolean
  /** Set when the SQL function rejected the range or the role. */
  code?: string
}

/** Load A14 for a date range. ADMIN only, enforced in SQL. */
export async function loadPlatformHealth(
  fromDate: number,
  toDate: number
): Promise<AdminHealthResult> {
  const [res, asAt] = await Promise.all([
    callReportingFunction<PlatformHealthRow>('admin_platform_health', {
      p_from_date: fromDate,
      p_to_date: toDate,
    }),
    asAtFor('mv_platform_health'),
  ])

  if (res.error) return { hours: [], asAt, error: true, code: res.code }
  return { hours: res.rows, asAt, error: false }
}

export interface AdminQualityResult {
  checks: DataQualityRow[]
  asAt: string | null
  error: boolean
  code?: string
}

/**
 * Load A15 for a date range. ADMIN only, enforced in SQL.
 *
 * Rows arrive worst-first: FAIL, then WARN, then NOT_IMPLEMENTED, then OK. An
 * operator opening this screen wants the failures, not an alphabetical list of
 * everything that is fine.
 */
export async function loadDataQuality(
  fromDate: number,
  toDate: number
): Promise<AdminQualityResult> {
  const [res, asAt] = await Promise.all([
    callReportingFunction<DataQualityRow>('admin_data_quality', {
      p_from_date: fromDate,
      p_to_date: toDate,
    }),
    asAtFor('mv_data_quality'),
  ])

  if (res.error) return { checks: [], asAt, error: true, code: res.code }
  return { checks: res.rows, asAt, error: false }
}
