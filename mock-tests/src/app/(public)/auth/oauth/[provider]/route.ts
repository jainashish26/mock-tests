import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSocialProviderEnabled } from '@/lib/auth/oauth'
import { AUTH_ERROR_PATH, safeRedirectPath } from '@/lib/auth/role-redirects'

/**
 * GET /auth/oauth/:provider — starts a Supabase-hosted OAuth (PKCE) sign-in.
 *
 * Rendered as a plain link rather than a Server Action for two reasons:
 *
 *  1. PKCE reliability. `signInWithOAuth` writes the code-verifier into a
 *     `sb-<ref>-auth-token-code-verifier` cookie, which `/auth/callback` needs
 *     in order to exchange the code. `@/lib/supabase/server` wraps `setAll` in
 *     a silent try/catch, so a cookie write that fails in the wrong React
 *     context vanishes without a trace and only surfaces later as "Both auth
 *     code and code verifier should be non-empty". A Route Handler has an
 *     unambiguous, always-writable cookie context.
 *  2. Progressive enhancement — the buttons work with JavaScript disabled.
 *
 * The request origin is used to build `redirectTo` (rather than APP_URL) so the
 * same deployment works on localhost, a Vercel preview and production without
 * an env change — provided each is in the Supabase Redirect URLs allowlist.
 */

export const dynamic = 'force-dynamic'

const CALLBACK_PATH = '/auth/callback'

/** Build a login-page redirect carrying a machine-readable error code. */
function failTo(origin: string, code: string, next: string, description?: string) {
  const params = new URLSearchParams({ error: code })
  if (description) params.set('error_description', description)
  if (next) params.set('next', next)
  return NextResponse.redirect(`${origin}${AUTH_ERROR_PATH}?${params.toString()}`, 302)
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params
  const url = new URL(request.url)

  // Only forwarded when the caller actually supplied one. Defaulting it here
  // would override the role-aware redirect in /auth/callback and drop an ADMIN
  // or TEST_CREATOR onto /parent.
  const rawNext = url.searchParams.get('next')
  const next = rawNext ? safeRedirectPath(rawNext, '') : ''

  if (!isSocialProviderEnabled(provider)) {
    return failTo(url.origin, 'provider_disabled', next, `Unknown or disabled provider: ${provider}`)
  }

  const supabase = await createClient()
  const redirectTo = `${url.origin}${CALLBACK_PATH}${next ? `?next=${encodeURIComponent(next)}` : ''}`

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      // We are on the server, so return the URL and issue the redirect
      // ourselves instead of relying on the browser side-effect.
      skipBrowserRedirect: true,
      // Google: Supabase already requests `openid email profile`, which is all
      // we need. `scopes` is deliberately omitted — requesting more triggers
      // Google's sensitive-scope verification process.
      // `queryParams` is deliberately omitted too: `access_type=offline` +
      // `prompt=consent` would be needed for a refresh token, but we never call
      // Google APIs on the user's behalf and it would force the consent screen
      // on every single login.
    },
  })

  if (error) {
    // GoTrue returns "Provider is not enabled" when the dashboard toggle is off
    // or the client ID/secret were never saved.
    return failTo(url.origin, 'oauth_start_failed', next, error.message)
  }

  if (!data?.url) {
    return failTo(url.origin, 'oauth_start_failed', next)
  }

  // Cookies written by signInWithOAuth are merged into this response by Next.
  return NextResponse.redirect(data.url, 302)
}
