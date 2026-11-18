/**
 * Post-authentication redirect handling.
 *
 * WHY THIS EXISTS: /pricing sends unauthenticated visitors to
 * `/auth/signup?next=/pricing` so that after signing up they return to the plan
 * they were choosing instead of the generic parent dashboard. Without that
 * round trip the checkout funnel dead-ends.
 *
 * WHY IT IS VALIDATED: an unvalidated `next` parameter is an open redirect.
 * `/auth/signup?next=https://evil.example` would bounce a freshly-registered
 * parent to an attacker's site, which is a credible phishing vector because the
 * redirect comes from a trusted domain immediately after they entered a
 * password. Only same-origin relative paths are ever accepted.
 *
 * Deliberately reads `window.location.search` at call time rather than using
 * `useSearchParams()`: that hook requires a Suspense boundary in a prerendered
 * client component, and adding one to the auth pages would risk the consent
 * validation suite for no benefit - the value is only needed after hydration,
 * inside a submit handler.
 */

/** True when `candidate` is a safe same-origin relative path. */
function isSafeInternalPath(candidate: string): boolean {
  // Must be root-relative; reject absolute URLs and protocol-relative `//host`.
  if (!candidate.startsWith('/')) return false
  if (candidate.startsWith('//')) return false
  // Reject backslash variants (`/\evil.example`), which some browsers normalise
  // to a protocol-relative URL.
  if (candidate.includes('\\')) return false

  try {
    const resolved = new URL(candidate, 'http://redirect-guard.invalid')
    return resolved.origin === 'http://redirect-guard.invalid'
  } catch {
    return false
  }
}

/**
 * Resolve a redirect target, falling back when it is absent or unsafe.
 * Returns a normalised `pathname + search + hash`.
 */
export function safeRedirectPath(candidate: unknown, fallback: string): string {
  if (typeof candidate !== 'string') return fallback

  const value = candidate.trim()
  if (!value || !isSafeInternalPath(value)) return fallback

  try {
    const resolved = new URL(value, 'http://redirect-guard.invalid')
    return resolved.pathname + resolved.search + resolved.hash
  } catch {
    return fallback
  }
}

/**
 * Read and validate the `next` query parameter from the current URL.
 * Client-side only; returns the fallback during SSR.
 */
export function nextParam(fallback: string): string {
  if (typeof window === 'undefined') return fallback
  return safeRedirectPath(new URLSearchParams(window.location.search).get('next'), fallback)
}