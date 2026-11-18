'use client'

import { useEffect } from 'react'

/** Cookie the signup page reads back. Must match `REFERRAL_COOKIE` there. */
const REFERRAL_COOKIE = 'mt_ref'

/** 90 days: exam-prep decisions are rarely made in one sitting. */
const MAX_AGE_SECONDS = 90 * 24 * 60 * 60

/**
 * Persists a referral code so it survives the journey to signup.
 *
 * A referrer's link almost never converts on the first page view - the parent
 * reads it, checks the pricing, asks the referrer whether it was any good, and
 * comes back later, often from a different entry point. Without persistence,
 * attribution only works for the small minority who sign up immediately, and the
 * programme under-reports its own value, which is how referral budgets get cut.
 *
 * A separate client component because a server component cannot write a cookie
 * during render, and doing it in a route handler would lose the personalised
 * landing copy that makes the referral land as a recommendation rather than an ad.
 */
export function ReferralCookieSetter({ code }: { code: string }) {
  useEffect(() => {
    if (!code) return
    try {
      const secure = window.location.protocol === 'https:' ? '; Secure' : ''
      // SameSite=Lax so the cookie is sent on the top-level navigation to
      // /auth/signup, but not on cross-site subresource requests.
      document.cookie =
        `${REFERRAL_COOKIE}=${encodeURIComponent(code)}; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax${secure}`
    } catch {
      // Private browsing can refuse the write. Attribution degrades to the
      // query-string fallback in the signup page rather than failing.
    }
  }, [code])

  return null
}
