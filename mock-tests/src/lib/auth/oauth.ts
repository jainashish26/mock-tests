import type { Provider } from '@supabase/supabase-js'

/**
 * Social sign-in provider registry.
 *
 * IMPORTANT — where the credentials live:
 * With Supabase-hosted OAuth the client ID / client secret are configured in
 * **Supabase Dashboard → Authentication → Sign In / Providers**, NOT in this
 * app's environment. The browser is redirected to
 * `https://<project-ref>.supabase.co/auth/v1/authorize?provider=google`, and it
 * is Supabase that talks to Google. Consequently the app has no way to detect
 * at runtime whether a provider has been enabled, so these flags exist purely
 * to keep the buttons hidden in environments where the provider is not wired up
 * (or where a deploy happens before the dashboard change).
 *
 * Turning a flag on without enabling the provider in Supabase produces
 * "Provider is not enabled" from GoTrue; the callback route surfaces that as a
 * readable banner rather than a blank redirect loop.
 */
export interface SocialProviderConfig {
  /** Supabase `Provider` identifier — also the URL segment in /auth/oauth/[provider]. */
  id: Provider
  /** Google's brand guidelines require one of the approved button labels. */
  label: string
  enabled: boolean
}

/**
 * NEXT_PUBLIC_* values are inlined into the client bundle at BUILD time by
 * literal text replacement, and that replacement only happens for a direct
 * member expression (`process.env.NEXT_PUBLIC_FOO`).
 *
 * A computed key such as `process.env[name]` cannot be replaced. It then
 * resolves from the real Node environment on the server but from the browser's
 * `process.env` shim on the client, so the two sides disagree. That produced a
 * hydration mismatch on /auth/signup: the server rendered the Google button,
 * the client rendered nothing, and React reported the following <form> as
 * unexpected. Read the variable literally so both sides get the same constant.
 *
 * Consequence: changing this flag requires a rebuild/redeploy, not just a
 * runtime env change.
 */
const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_SOCIAL_AUTH_GOOGLE_ENABLED === 'true'
const FACEBOOK_ENABLED = process.env.NEXT_PUBLIC_SOCIAL_AUTH_FACEBOOK_ENABLED === 'true'

export const SOCIAL_PROVIDERS: SocialProviderConfig[] = [
  {
    id: 'google',
    label: 'Continue with Google',
    enabled: GOOGLE_ENABLED,
  },
  {
    // Keep this flag "false" until BOTH are done:
    //   1. The Meta app exists and its App ID + App Secret are saved in
    //      Supabase -> Authentication -> Sign In / Providers -> Facebook.
    //   2. Supabase's own callback URI is registered in the Meta app under
    //      Facebook Login -> Settings -> Valid OAuth Redirect URIs:
    //        https://<project-ref>.supabase.co/auth/v1/callback
    //      (NOT /auth/callback — that one goes in Supabase's Redirect URLs, and
    //      is already configured for Google.)
    //
    // GoTrue's Facebook provider requests ONLY the `email` scope and then calls
    //   graph.facebook.com/me?fields=email,first_name,last_name,name,picture
    // with an HMAC-SHA256 appsecret_proof. If the Meta app has not been granted
    // `email` (Use Cases -> Authentication and Account Creation -> "Ready for
    // testing"), Facebook returns no email and GoTrue rejects the sign-in with
    // "provider did not return an email address". That permission is the single
    // most common cause of a Facebook integration that "does nothing".
    id: 'facebook',
    label: 'Continue with Facebook',
    enabled: FACEBOOK_ENABLED,
  },
]

/** Providers whose flag is on — what the UI renders. */
export const ENABLED_SOCIAL_PROVIDERS = SOCIAL_PROVIDERS.filter((provider) => provider.enabled)

/**
 * Type guard used by the OAuth route handler so an arbitrary `:provider`
 * segment can never reach `signInWithOAuth`.
 */
export function isSocialProviderEnabled(value: string): value is Provider {
  return SOCIAL_PROVIDERS.some((provider) => provider.id === value && provider.enabled)
}
