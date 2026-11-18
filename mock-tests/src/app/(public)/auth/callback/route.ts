import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  AUTH_ERROR_PATH,
  DEFAULT_AUTH_REDIRECT,
  roleRedirectPath,
  safeRedirectPath,
} from '@/lib/auth/role-redirects'
import { CONSENT_COOKIE, parseConsentCookie } from '@/lib/auth/consent'

/**
 * Read one cookie out of a raw `Cookie` header.
 *
 * The handler receives a plain `Request` rather than `NextRequest`, so there is
 * no `request.cookies` API available here.
 */
function readCookie(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return null
}

/**
 * GET /auth/callback — completes a Supabase-hosted OAuth (PKCE) sign-in.
 *
 * Registered in Supabase Dashboard → Authentication → URL Configuration →
 * Redirect URLs, and handed to Google as `redirect_to` by /auth/oauth/[provider].
 * Note this is *our* endpoint; the URI registered inside the Google client is
 * Supabase's own `https://<project-ref>.supabase.co/auth/v1/callback`. The two
 * are different URLs and both must be configured.
 *
 * Responsibilities beyond the original stub (which exchanged the code and then
 * hardcoded `/parent`):
 *   1. surface provider-side refusals (user hit "Cancel") instead of swallowing them
 *   2. reject accounts where the provider returned no email
 *   3. redirect by the user's actual role, so admins/creators don't land on /parent
 *   4. act as a safety net for role provisioning (the on_auth_user_created
 *      trigger in migration 009 is the primary mechanism)
 *   5. record the sign-up consent captured on /auth/signup for OAuth-created
 *      accounts, which cannot carry a `data` payload through signInWithOAuth
 *   6. never act as an open redirect
 */

export const dynamic = 'force-dynamic'

/** Every failure path lands back on the login page with a machine-readable code. */
function failTo(origin: string, code: string, next: string, description?: string) {
  const params = new URLSearchParams({ error: code })
  if (description) params.set('error_description', description)
  if (next) params.set('next', next)
  return NextResponse.redirect(`${origin}${AUTH_ERROR_PATH}?${params.toString()}`, 302)
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const { origin, searchParams } = url
  const next = safeRedirectPath(searchParams.get('next'), '')

  // 1. Provider-side refusal. Google forwards `?error=access_denied&error_code=…`
  //    when the user cancels the consent screen or the client is misconfigured.
  const providerError = searchParams.get('error')
  if (providerError) {
    return failTo(
      origin,
      'oauth_denied',
      next,
      searchParams.get('error_description') ?? providerError
    )
  }

  const code = searchParams.get('code')
  if (!code) {
    return failTo(origin, 'missing_code', next)
  }

  const supabase = await createClient()

  // PKCE: pairs `code` with the code-verifier cookie set by /auth/oauth/[provider].
  const { data: session, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error || !session?.user) {
    // "Both auth code and code verifier should be non-empty" means the verifier
    // cookie was lost (blocked cookies, or the user opened the link in a
    // different browser/profile than the one that started the flow).
    return failTo(origin, 'exchange_failed', next, error?.message)
  }

  const user = session.user

  // 2. Email guard. Google virtually always returns a verified email, but a
  //    provider that does not (Facebook is the usual offender) leaves us with an
  //    account that cannot receive notifications or Stripe receipts, and which
  //    Supabase can never auto-link to a password account. Refuse it up front
  //    rather than create a half-usable parent profile.
  if (!user.email) {
    await supabase.auth.signOut({ scope: 'local' })
    return failTo(origin, 'email_required', next)
  }

  // 3. Resolve the role.
  //    Read through the admin client rather than the user-scoped one: this runs
  //    in the same request that just minted the session, and going through RLS
  //    here would depend on PostgREST picking up the brand-new access token.
  //    The query is a single-column lookup keyed by the *verified* session user
  //    id, so there is no user-supplied input to escalate with.
  const admin = createAdminClient()
  const { data: roleRow } = await admin
    .from('app_user_roles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()

  let role: string | null = roleRow?.role ?? null

  // 4. Safety net. The on_auth_user_created trigger (migration 009) provisions
  //    PARENT for every non-student sign-up, so this should not fire. It covers
  //    users created before that migration ran, and any future provider whose
  //    sign-up path bypasses the trigger.
  if (!role) {
    const { data: inserted, error: insertError } = await admin
      .from('app_user_roles')
      .insert({ user_id: user.id, role: 'PARENT' })
      .select('role')
      .maybeSingle()

    if (insertError) {
      console.error('OAuth callback: default role provisioning failed', {
        userId: user.id,
        error: insertError.message,
      })
      return failTo(origin, 'role_provisioning_failed', next, insertError.message)
    }
    role = inserted?.role ?? 'PARENT'
  }

  // 5. Record sign-up consent for OAuth-created accounts.
  //
  //    `signInWithOAuth` cannot carry a `data` payload, so the signup page
  //    stashed the confirmation in a short-lived cookie. Now that a session
  //    exists we can persist the same metadata the email path writes at
  //    `signUp`, keeping the audit trail consistent across both routes.
  //
  //    Strictly additive: a missing, stale or malformed cookie is ignored and
  //    never blocks sign-in, because this same route serves the LOGIN page where
  //    an existing account holder must not be asked to re-confirm their age.
  const consentRecord = parseConsentCookie(readCookie(request.headers.get('cookie'), CONSENT_COOKIE))
  if (consentRecord) {
    const { error: updateError } = await supabase.auth.updateUser({
      data: consentRecord.metadata,
    })
    if (updateError) {
      // Non-fatal: the account is valid and signed in. Log so a pattern of
      // failures is visible rather than silently losing consent records.
      console.error('OAuth callback: failed to persist consent metadata', {
        userId: user.id,
        error: updateError.message,
      })
    }
  }

  // 6. An explicit, validated `next` wins; otherwise send the user to their own
  //    dashboard. safeRedirectPath above already rejected anything non-relative.
  const target = next || roleRedirectPath(role) || DEFAULT_AUTH_REDIRECT
  const response = NextResponse.redirect(`${origin}${target}`, 302)

  // Consume the hand-off cookie so it cannot be replayed into a later sign-in.
  if (consentRecord) {
    response.cookies.set(CONSENT_COOKIE, '', {
      path: '/',
      maxAge: 0,
      sameSite: 'lax',
    })
  }

  return response
}
