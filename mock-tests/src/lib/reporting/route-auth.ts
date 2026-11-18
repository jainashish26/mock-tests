import { createClient } from '@/lib/supabase/server'
import { getUserRole } from '@/lib/rbac/get-user-role'
import type { UserRole } from '@/types'
import { forbidden } from './envelope'

/**
 * Role gate for REPORTING API routes.
 *
 * WHY THIS EXISTS ALONGSIDE `requireRole`
 *   `src/lib/rbac/require-role.ts` calls `redirect()` on failure, which is
 *   correct for a page and wrong for a JSON endpoint: a fetch client receives
 *   a 3xx to `/auth/login` and either follows it silently or throws an opaque
 *   error, so the UI cannot distinguish "not signed in" from "network
 *   failure". Reporting routes need a real 401/403 with the standard envelope
 *   so the caller can render its error state.
 *
 *   This does NOT reimplement authorisation. It reuses `getUserRole` and the
 *   same role vocabulary; only the failure transport differs.
 *
 * DEFENCE IN DEPTH (§12.1)
 *   "Authorisation is enforced by RLS and by the route's role check. Neither
 *   alone is sufficient." The route check here is the first layer. The second
 *   is inside every SECURITY DEFINER reporting function, which re-checks the
 *   real caller against `auth.uid()` via `may_read_results()`,
 *   `is_parent_of()` or `has_role()`. So a route that forgot its check, or a
 *   parent asking about a child they are not linked to, still gets zero rows
 *   from the database.
 */

export type RouteAuthResult =
  | { ok: true; userId: string; role: UserRole }
  | { ok: false; response: Response }

/**
 * Resolve the caller and assert one of `allowed`.
 *
 * Returns a discriminated result rather than throwing, because a route handler
 * that throws produces a 500 - and §12.1 forbids a 500 with a stack trace for
 * what is really an authorisation failure.
 */
export async function requireReportingRole(
  reportId: string,
  allowed: UserRole[]
): Promise<RouteAuthResult> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    // 403 rather than 401 for an absent session: revealing whether an account
    // exists is not something a reporting endpoint should do, and the client
    // already knows whether it sent a token.
    if (!user) return { ok: false, response: forbidden(reportId) }

    const role = await getUserRole(user.id)
    if (!role || !allowed.includes(role)) {
      return { ok: false, response: forbidden(reportId) }
    }

    return { ok: true, userId: user.id, role }
  } catch {
    return { ok: false, response: forbidden(reportId) }
  }
}

/** True for a 4xx/5xx envelope response, for callers that want to branch. */
export function isAuthFailure(r: RouteAuthResult): r is { ok: false; response: Response } {
  return r.ok === false
}
