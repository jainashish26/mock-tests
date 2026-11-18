/**
 * The shared reporting response envelope (13-bi-reporting-integrations-api-ux.md §12.1).
 *
 * WHY ONE ENVELOPE
 *   Every reporting endpoint returns this shape so no client has to special-case
 *   an error. Without it each screen invents its own way of saying "no data",
 *   and the screens that get it wrong are the ones that render an empty
 *   dashboard as though it were a real result - which is how a parent ends up
 *   reading "your child has no attempts" when the query actually failed.
 *
 * WHY EVERY RESPONSE CARRIES refreshLagMinutes
 *   A stale materialised view is indistinguishable from a correct one. The lag
 *   badge is the only defence against acting on yesterday's number as today's,
 *   so the field is required in `meta` rather than optional. A caller that
 *   cannot state its lag cannot be trusted to state its data.
 *
 * WHY `data` IS NULL IN EVERY NON-OK STATE
 *   A partially-populated payload in an error state invites the UI to render
 *   the parts that did arrive. Null forces the caller down the state branch.
 */

/** The four states every reporting screen must handle. */
export type ReportState = 'ok' | 'empty' | 'low_data' | 'error'

/** Cohort provenance. Required wherever a comparison figure is shown. */
export interface CohortMeta {
  size: number
  windowMonths: number
  /** Always this literal. A cohort whose definition can vary silently is a
   *  cohort whose percentiles cannot be compared across releases. */
  definition: 'platform cohort'
}

export interface ReportEnvelope<T> {
  /** Stable report ID from 11-bi-reporting-design.md §4, e.g. 'P1', 'A15'. */
  reportId: string
  /** Null in every non-ok state. */
  data: T | null
  meta: {
    /** ISO timestamp of the underlying view's data, NOT the request time.
     *  Using the request time would make a stale view look current. */
    asAt: string
    /** Minutes between `asAt` and now. Shown on every dashboard. */
    refreshLagMinutes: number
    cohort?: CohortMeta
    /** True when a figure is withheld because the cohort is too small. */
    suppressed?: boolean
    state: ReportState
  }
  pagination?: {
    page: number
    pageSize: number
    totalItems: number
    hasMore: boolean
  }
}

/**
 * Sentinel returned when refresh lag cannot be determined.
 *
 * `ReportEnvelope.meta.refreshLagMinutes` is a required `number` (§12.1), so
 * "unknown" cannot be represented as null there. This sentinel stands in for
 * it - and it MUST be compared by identity, not by `Number.isFinite`, because
 * `MAX_SAFE_INTEGER` is perfectly finite. That was a real bug: the lag badge
 * rendered "Updated 6254999482459 days ago" instead of admitting it did not
 * know, which is worse than no badge at all because it looks like data.
 */
export const UNKNOWN_LAG = Number.MAX_SAFE_INTEGER

/**
 * Minutes between a view's `asAt` and now, floored at zero.
 *
 * A view refreshed in the future relative to the app server (clock skew between
 * the database and the runtime) would otherwise produce a negative badge, which
 * reads as a bug rather than as "fresh".
 *
 * Returns `UNKNOWN_LAG` when the timestamp is missing or unparseable. Callers
 * must not present that as a duration.
 */
export function lagMinutes(asAt: string | null | undefined): number {
  if (!asAt) return UNKNOWN_LAG
  const then = new Date(asAt).getTime()
  if (Number.isNaN(then)) return UNKNOWN_LAG
  return Math.max(0, Math.floor((Date.now() - then) / 60000))
}


/**
 * Build an envelope, deriving `refreshLagMinutes` from `asAt`.
 *
 * Callers pass the view's own `as_at` column. Passing `new Date().toISOString()`
 * instead would defeat the lag badge entirely, which is why this helper takes
 * `asAt` as a required argument rather than defaulting it.
 */
export function envelope<T>(args: {
  reportId: string
  data: T | null
  asAt: string | null | undefined
  state?: ReportState
  cohort?: CohortMeta
  suppressed?: boolean
  pagination?: ReportEnvelope<T>['pagination']
}): ReportEnvelope<T> {
  const { reportId, data, asAt, cohort, suppressed, pagination } = args

  // An explicit state wins. Otherwise the state is inferred: no data is
  // 'empty'. 'low_data' is never inferred, because whether a sample is too
  // small to publish is a judgement only the caller can make.
  const state: ReportState =
    args.state ?? (data === null || (Array.isArray(data) && data.length === 0) ? 'empty' : 'ok')

  return {
    reportId,
    data: state === 'ok' || state === 'low_data' ? data : null,
    meta: {
      asAt: asAt ?? new Date(0).toISOString(),
      refreshLagMinutes: lagMinutes(asAt),
      ...(cohort ? { cohort } : {}),
      ...(suppressed !== undefined ? { suppressed } : {}),
      state,
    },
    ...(pagination ? { pagination } : {}),
  }
}

/**
 * Cache-Control for a reporting payload.
 *
 * Always `private`: these payloads are per-family, and a `public` directive
 * would let a shared cache serve one parent's child's scores to another. The
 * `stale-while-revalidate` window is 4x the TTL per §12.1, so a nightly-refreshed
 * view keeps serving while the refresh runs rather than showing a spinner.
 */
export function reportCacheControl(ttlSeconds: number): string {
  return `private, max-age=${ttlSeconds}, stale-while-revalidate=${ttlSeconds * 4}`
}

/** Serialise an envelope with the reporting cache header. */
export function reportJson<T>(
  body: ReportEnvelope<T>,
  init?: { status?: number; ttlSeconds?: number }
): Response {
  const status = init?.status ?? 200
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  // Error states are never cached. Caching a 503 would pin a transient refresh
  // failure in place for the whole TTL and turn a blip into an outage.
  if (status === 200 && init?.ttlSeconds) {
    headers['Cache-Control'] = reportCacheControl(init.ttlSeconds)
  } else {
    headers['Cache-Control'] = 'no-store'
  }

  return Response.json(body, { status, headers })
}

/**
 * Error envelopes. Status codes per §12.1: 400 bad filter, 403 not authorised
 * or not linked, 404 no such student, 503 upstream stale. A 500 with a stack
 * trace is never returned - the client always gets the standard envelope so no
 * caller has to special-case an error shape.
 */
export function badRequest(reportId: string, message: string): Response {
  // The reason is logged, never returned. Which filter was malformed is useful
  // to an operator reading server logs; echoing caller-supplied detail back in
  // a response body is not, and the envelope has no field for it by design.
  console.error(`[reporting:${reportId}] 400 bad filter: ${message}`)

  return reportJson(
    envelope<null>({ reportId, data: null, asAt: null, state: 'error' }),
    { status: 400 }
  )
}


export function forbidden(reportId: string): Response {
  return reportJson(
    envelope<null>({ reportId, data: null, asAt: null, state: 'error' }),
    { status: 403 }
  )
}

export function notFound(reportId: string): Response {
  return reportJson(
    envelope<null>({ reportId, data: null, asAt: null, state: 'error' }),
    { status: 404 }
  )
}

/** Upstream view is stale or failed to refresh. */
export function upstreamStale(reportId: string): Response {
  return reportJson(
    envelope<null>({ reportId, data: null, asAt: null, state: 'error' }),
    { status: 503 }
  )
}

