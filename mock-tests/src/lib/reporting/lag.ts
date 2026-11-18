import { callReportingFunction } from './connection'

/**
 * Refresh-lag lookup for the report envelope.
 *
 * Backs `ReportEnvelope.meta.refreshLagMinutes` for views that do not carry
 * their own `as_at` column - notably `mv_attempt_history`, which P4 reads.
 * Rather than special-case P4, every report resolves its lag the same way.
 *
 * The underlying function (migration 034) counts only `status = 'ok'` rows in
 * `reporting.refresh_log`. A `skipped_blackout` row has a finished_at and no
 * error text but represents a refresh that deliberately did not happen during
 * the test blackout window; counting it would report a view as fresh while its
 * data sat untouched. That distinction is the whole point of the lag badge.
 */

export interface RefreshLag {
  object_name: string
  last_refreshed_at: string | null
  lag_minutes: number | null
}

/**
 * Resolve the lag for one reporting view.
 *
 * Returns null when the view is unknown or has never refreshed successfully.
 * A null lag is rendered as "unknown", never as "0 minutes" - claiming
 * freshness that was never established is exactly the failure the badge
 * exists to prevent.
 *
 * @param objectName Bare matview name, e.g. 'mv_attempt_history'. Not
 *   schema-qualified: `reporting.refresh_log` stores the bare name.
 */
export async function refreshLagFor(objectName: string): Promise<RefreshLag | null> {
  const { rows, error } = await callReportingFunction<RefreshLag>('reporting_refresh_lag', {
    p_object: objectName,
  })

  if (error || rows.length === 0) return null
  return rows[0]
}

/**
 * ISO timestamp for the envelope's `meta.asAt`, derived from the lag lookup.
 *
 * Null when the lag is unknown, which makes `lagMinutes()` in envelope.ts
 * return MAX_SAFE_INTEGER and the badge render as "unknown" rather than as a
 * small, reassuring, wrong number.
 */
export async function asAtFor(objectName: string): Promise<string | null> {
  const lag = await refreshLagFor(objectName)
  return lag?.last_refreshed_at ?? null
}

// `formatLag` lives in ./format so it can be tested in Node without dragging
// `next/headers` in via ./connection. Re-exported here because callers already
// import it from this module.
export { formatLag } from './format'

