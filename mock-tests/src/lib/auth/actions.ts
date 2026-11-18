'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

/**
 * Signs the current user out and returns them to a login screen.
 *
 * The previous "Sign Out" control was a plain `<Link href="/">`, which only
 * navigated away: the Supabase session cookie stayed intact, so the user was
 * still authenticated and could walk straight back into `/student`.
 *
 * @param redirectTo Where to land after signing out. Students get their own
 *   portal; everyone else the shared login page.
 */
export async function signOut(redirectTo = '/auth/login') {
  const supabase = await createClient()

  // Global sign-out also revokes the refresh token server-side. If that call
  // fails (session already expired or revoked) we still clear the local
  // cookies, so a stale session can never trap the user on the dashboard.
  const { error } = await supabase.auth.signOut()
  if (error) {
    await supabase.auth.signOut({ scope: 'local' })
  }

  // Only allow same-origin relative paths so this action can never be abused as
  // an open redirect.
  const target =
    redirectTo.startsWith('/') && !redirectTo.startsWith('//') ? redirectTo : '/auth/login'

  // `redirect` throws internally to short-circuit the response.
  redirect(target)
}
