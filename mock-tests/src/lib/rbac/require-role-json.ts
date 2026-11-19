import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUserRole } from './get-user-role'
import type { UserRole } from '@/types'

/**
 * Role guard for API routes.
 *
 * WHY `requireRole` CANNOT BE REUSED HERE
 *   `require-role.ts` calls `redirect()` on failure, which is right for a page
 *   and wrong for JSON: a fetch client follows the 3xx to /auth/login, receives
 *   HTML, and either reports a parse error or silently renders a logged-out
 *   screen over data the operator thought they were looking at. `route-auth.ts`
 *   records the same argument for the reporting layer and returns the reporting
 *   envelope; these are ordinary application routes, whose clients expect the
 *   `{ error }` shape every other admin and creator route already returns.
 *
 *   It reuses `getUserRole` and the same role vocabulary rather than
 *   reimplementing authorisation - only the failure transport differs.
 *
 * DEFENCE IN DEPTH, NOT A REPLACEMENT FOR IT
 *   Every function this guards re-checks the caller inside the database
 *   (`has_role('ADMIN')` against `auth.uid()`). A route that forgot this call
 *   still gets zero rows or a 42501. This is the first layer, not the only one.
 */
export type RoleGuard =
  | { ok: true; userId: string; role: UserRole }
  | { ok: false; response: NextResponse }

export async function requireRoleJson(allowed: UserRole[]): Promise<RoleGuard> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { ok: false, response: NextResponse.json({ error: 'Not signed in.' }, { status: 401 }) }
    }

    const role = await getUserRole(user.id)
    if (!role || !allowed.includes(role)) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'You do not have access to this area.' }, { status: 403 }),
      }
    }

    return { ok: true, userId: user.id, role }
  } catch {
    // 403 rather than 500: an unreadable session is an authorisation failure,
    // and §12.1's rule against leaking a stack trace into a response body
    // applies to app routes as much as to reporting ones.
    return {
      ok: false,
      response: NextResponse.json({ error: 'Your session has expired. Please sign in again.' }, { status: 403 }),
    }
  }
}
