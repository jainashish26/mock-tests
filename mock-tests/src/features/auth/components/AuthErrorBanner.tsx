'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

/**
 * Renders the auth error banner for `?error=` codes produced by
 * /auth/oauth/[provider] and /auth/callback.
 *
 * Before this, the old callback redirected to `/auth/login?error=Invalid_Token`
 * and nothing on the login page ever read that parameter — the user was simply
 * dumped back on the form with no explanation. Every OAuth failure is now
 * surfaced here with a human-readable message.
 *
 * `useSearchParams()` requires a Suspense boundary above it during static
 * prerendering or `next build` fails with "missing suspense boundary". The
 * boundary is owned by this component so callers cannot forget it.
 */

const ERROR_MESSAGES: Record<string, string> = {
  // User pressed "Cancel" on the Google consent screen, or Google rejected the
  // request (e.g. the client is still in "Testing" publishing status and the
  // user is not one of the registered test users).
  oauth_denied: 'Google sign-in was cancelled or declined. Please try again.',

  // GoTrue said no. Almost always "Provider is not enabled" — the Google
  // provider toggle/credentials are missing in the Supabase dashboard, or the
  // NEXT_PUBLIC_SOCIAL_AUTH_GOOGLE_ENABLED flag is on ahead of that change.
  provider_disabled: 'Google sign-in is not available right now. Please use your email and password.',
  oauth_start_failed: 'We could not start Google sign-in. Please try again in a moment.',

  missing_code: 'That sign-in link was incomplete. Please try signing in again.',

  // Most common cause: the PKCE code-verifier cookie was not present, because
  // cookies are blocked or the callback was opened in a different browser or
  // profile than the one that started the flow.
  exchange_failed: 'We could not complete Google sign-in. Please try again.',

  email_required:
    'Your Google account did not share an email address, so we could not create your profile. Please sign up with your email and password instead.',

  role_provisioning_failed:
    'Your account was created but we could not finish setting it up. Please try signing in again, or contact support.',

  // Retained for backwards compatibility with any bookmarked/stale links from
  // the previous callback implementation.
  Invalid_Token: 'That sign-in link has expired. Please try signing in again.',
}

function AuthErrorBannerInner() {
  const searchParams = useSearchParams()
  const code = searchParams.get('error')
  if (!code) return null

  const description = searchParams.get('error_description')
  const message = ERROR_MESSAGES[code] ?? description ?? 'Sign-in failed. Please try again.'

  return (
    <div
      role="alert"
      style={{
        background: 'rgba(239,68,68,0.1)',
        border: '1px solid rgba(239,68,68,0.3)',
        borderRadius: '0.75rem',
        padding: '0.875rem 1rem',
        marginBottom: '1.25rem',
        color: '#ef4444',
        fontSize: '0.875rem',
      }}
    >
      {message}
      {/* Show the provider's own wording when we have no mapping for the code —
          a raw "access_denied" is still more useful than silence. */}
      {description && ERROR_MESSAGES[code] ? (
        <div style={{ marginTop: '0.375rem', fontSize: '0.75rem', opacity: 0.85 }}>
          {description}
        </div>
      ) : null}
    </div>
  )
}

export function AuthErrorBanner() {
  return (
    <Suspense fallback={null}>
      <AuthErrorBannerInner />
    </Suspense>
  )
}
