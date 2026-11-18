import { createClient } from '@/lib/supabase/server'

/**
 * Reporting data access.
 *
 * A DOCUMENTED DEVIATION FROM 12-bi-reporting-data-model.md §8.3
 *
 * The spec defines `withReportingRole()` as a postgres.js transaction that
 * issues `SET LOCAL ROLE reporting_ro` plus a 5s statement timeout. That
 * requires a raw SQL driver. This project talks to Postgres only through
 * `@supabase/supabase-js`, which exposes PostgREST and `rpc()` - it cannot
 * issue `SET LOCAL`. Adding postgres.js purely to satisfy the letter of the
 * spec would introduce a second database driver, a second connection pool and
 * a second set of credentials to manage.
 *
 * What the spec's mechanism is FOR is capability reduction: a reporting read
 * must not be able to reach a column the caller has no business seeing, and
 * must not be able to run long enough to affect live tests. Both properties
 * are preserved here by a different route:
 *
 *   1. Every reporting read goes through a SECURITY DEFINER function whose
 *      RETURNS clause is the entire visible surface. The database cannot
 *      return a column its signature does not declare, so there is no
 *      `select *` to widen later by accident.
 *   2. Authorisation is checked INSIDE the function against the real caller's
 *      JWT (`may_read_results()`, `is_parent_of()`, `has_role()`), not in
 *      application code that a future edit could drop.
 *   3. `search_path` is pinned on every function, so a shadowing object in a
 *      caller-writable schema cannot substitute itself.
 *   4. No grant on any reporting view reaches `authenticated` or `anon` - the
 *      pattern set by migrations 016/017. `reporting_ro` holds SELECT for
 *      diagnostics only.
 *
 * The one property NOT reproduced is the per-query statement timeout, because
 * there is no transaction to set it in. That is mitigated at the source
 * instead: the admin aggregate functions cap their own date range at 366 days
 * (migrations 032), and every parent read hits a pre-aggregated materialised
 * view rather than a live table. A runaway aggregate would have to be written
 * into a view definition deliberately, not triggered by a caller.
 */

/** Result of a reporting RPC call. Never throws. */
export interface ReportingCallResult<T> {
  rows: T[]
  /** True when the call failed. The UI shows its error state rather than an
   *  empty dashboard, so a failure is never rendered as "no data". */
  error: boolean
  /** Postgres error code, when one was returned. Lets a route map 42501 to
   *  403 and 22023 to 400 without parsing a message string. */
  code?: string
}

/**
 * Call a reporting function with the caller's own identity.
 *
 * Uses the user-scoped server client so the caller's JWT reaches Postgres and
 * `auth.uid()` inside the function resolves to the real user. The admin client
 * must NOT be used here: it would make `auth.uid()` null, and every
 * authorisation check in these functions would then reject the call - or, if a
 * check were ever written as `auth.uid() IS NULL OR ...`, silently allow it.
 *
 * Never throws. A reporting failure degrades one panel to its error state; it
 * must not take down a page, and a child must never see a stack trace.
 */
export async function callReportingFunction<T>(
  fn: string,
  args: Record<string, unknown> = {}
): Promise<ReportingCallResult<T>> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc(fn, args)

    if (error) return { rows: [], error: true, code: error.code ?? undefined }

    // A RETURNS TABLE function arrives as an array; a single-row function can
    // arrive as an object. Normalising here means callers never have to
    // special-case the two shapes.
    if (data === null || data === undefined) return { rows: [], error: false }
    if (Array.isArray(data)) return { rows: data as T[], error: false }
    return { rows: [data as T], error: false }
  } catch {
    return { rows: [], error: true }
  }
}

/**
 * Call a reporting function that writes.
 *
 * Identical to `callReportingFunction` except that it surfaces the Postgres
 * error code, which the write path needs: P9's `parent_plan_set` raises 42501
 * for an unauthorised caller and 22023 for an invalid goal or a past exam
 * date, and the route maps those to 403 and 400 respectively rather than
 * collapsing both into a generic 500.
 */
export async function callReportingWrite<T>(
  fn: string,
  args: Record<string, unknown> = {}
): Promise<ReportingCallResult<T>> {
  return callReportingFunction<T>(fn, args)
}
