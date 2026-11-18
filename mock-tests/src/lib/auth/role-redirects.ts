import type { UserRole } from '@/types'

/**
 * Single source of truth for "where does this role land after authenticating".
 *
 * This used to be an inline `ROLE_REDIRECTS` constant duplicated in
 * `/auth/login`, and the OAuth callback in `/auth/callback` hardcoded
 * `/parent` — which silently dumped admins and creators on the wrong
 * dashboard. Both now read from here.
 */
export const ROLE_REDIRECTS: Record<UserRole, string> = {
  PARENT: '/parent',
  ADMIN: '/admin',
  TEST_CREATOR: '/creator',
  STUDENT: '/student',
  TUTOR: '/tutor',
}

/** Landing page for a freshly signed-up user. Self-serve sign-up is always PARENT. */
export const DEFAULT_AUTH_REDIRECT = '/parent'

/** Where to bounce when an OAuth flow fails, carrying an `?error=` code. */
export const AUTH_ERROR_PATH = '/auth/login'

/**
 * Resolve a role to its dashboard path, tolerating unknown/missing values.
 *
 * Deliberately accepts `string | null | undefined` rather than `UserRole`
 * because the value comes straight out of PostgREST (`app_user_roles.role`)
 * and a new enum member should degrade to the default rather than crash.
 */
export function roleRedirectPath(role: string | null | undefined): string {
  if (!role) return DEFAULT_AUTH_REDIRECT
  return ROLE_REDIRECTS[role as UserRole] ?? DEFAULT_AUTH_REDIRECT
}

/**
 * Validate a post-auth redirect target.
 *
 * Only same-origin relative paths are accepted. Anything else falls back to
 * `fallback`, so a crafted `?next=//evil.com` or `?next=https://evil.com`
 * can never turn `/auth/callback` into an open redirect. The same guard style
 * is already used by `signOut()` in `@/lib/auth/actions`.
 */
export function safeRedirectPath(
  candidate: string | null | undefined,
  fallback: string = DEFAULT_AUTH_REDIRECT
): string {
  if (!candidate) return fallback

  // Must be an absolute path…
  if (!candidate.startsWith('/')) return fallback
  // …but not a protocol-relative URL, which browsers resolve cross-origin.
  if (candidate.startsWith('//')) return fallback
  // Backslashes are treated as forward slashes by some browsers: `/\evil.com`.
  if (candidate.includes('\\')) return fallback
  // Reject control characters, which would allow header/CRLF injection.
  if (/[\u0000-\u001f\u007f]/.test(candidate)) return fallback

  return candidate
}
