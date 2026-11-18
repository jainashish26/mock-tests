'use client'
import { useState } from 'react'
import { PublicLayout } from "@/components/layout/PublicLayout"
import { SpatialCard } from "@/components/ui/SpatialCard"
import { Button } from "@/components/ui/Button"
import { Badge } from "@/components/ui/Badge"
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { nextParam } from '@/lib/auth/safe-redirect'
import { useRouter } from 'next/navigation'
import { SocialAuthButtons } from '@/features/auth/components/SocialAuthButtons'
import { AuthErrorBanner } from '@/features/auth/components/AuthErrorBanner'
import { ConsentCheckboxes } from '@/features/auth/components/ConsentCheckboxes'
import { PageViewTracker } from '@/features/monetisation/PageViewTracker'

import {
  buildConsentMetadata,
  CONSENT_FIELDS,
  consentErrorMessage,
  EMPTY_CONSENT,
  validateConsent,
  writeConsentCookie,
  type ConsentState,
} from '@/lib/auth/consent'

/** Cookie the referral landing page writes when a parent arrives via ?ref= */
const REFERRAL_COOKIE = 'mt_ref';

/**
 * Recover the referral code that brought this parent here.
 *
 * Reads the cookie first, then the current query string. The cookie matters
 * because a referred parent rarely signs up on the same page load they arrive:
 * they read the landing page, look at pricing, come back tomorrow. Attribution
 * that only survives the current URL loses almost every referral, and a
 * referral programme that cannot attribute does not get shared.
 *
 * Returns null rather than throwing - attribution is best-effort and must never
 * block a signup.
 */
function readReferralCode(): string | null {
  if (typeof document === 'undefined') return null

  try {
    const fromCookie = document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${REFERRAL_COOKIE}=`))

    if (fromCookie) {
      const value = decodeURIComponent(fromCookie.slice(REFERRAL_COOKIE.length + 1)).trim()
      if (value) return value.slice(0, 16)
    }

    const fromQuery = new URLSearchParams(window.location.search).get('ref')
    if (fromQuery) return fromQuery.trim().toUpperCase().slice(0, 16)
  } catch {
    // A blocked cookie jar is normal in private browsing; fall through.
  }

  return null
}


export default function SignupPage() {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [consent, setConsent] = useState<ConsentState>(EMPTY_CONSENT)
  const [consentError, setConsentError] = useState<string | null>(null)
  const [invalidConsent, setInvalidConsent] = useState<(keyof ConsentState)[]>([])
  const router = useRouter()

  /**
   * Enforce the mandatory consents and report what is missing.
   *
   * Shared by the email submit handler and the Google button, so neither path can
   * create an account without an affirmative age confirmation and acceptance of
   * the Terms and Privacy Policy.
   */
  const enforceConsent = (current: ConsentState): boolean => {
    const missing = validateConsent(current)
    if (missing.length === 0) {
      setConsentError(null)
      setInvalidConsent([])
      return true
    }
    setInvalidConsent(missing)
    setConsentError(consentErrorMessage(missing))
    setError(null)

    // Move attention to the first unmet requirement rather than leaving the user
    // to hunt for it. `preventScroll` avoids a jarring jump; we scroll smoothly.
    const firstField = missing[0] === 'ageConfirmed' ? CONSENT_FIELDS.age : CONSENT_FIELDS.terms
    const target = document.getElementById(firstField)
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target.focus({ preventScroll: true })
    }
    return false
  }

  /** Gate for the social anchors - see `SocialAuthButtons.requireConsent`. */
  const gateSocialConsent = () => enforceConsent(consent)

  const handleSignup = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)

    const formData = new FormData(e.currentTarget)

    // Validate consent before any network call. Reading the boxes from the form
    // rather than only from state means the check still holds if React state and
    // the DOM ever disagree (e.g. an autofill or extension toggling an input).
    const submittedConsent: ConsentState = {
      ageConfirmed: formData.get(CONSENT_FIELDS.age) === 'on',
      termsAccepted: formData.get(CONSENT_FIELDS.terms) === 'on',
      marketingOptIn: formData.get(CONSENT_FIELDS.marketing) === 'on',
    }
    setConsent(submittedConsent)

    if (!enforceConsent(submittedConsent)) return

    setLoading(true)

    const email = formData.get('email') as string
    const password = formData.get('password') as string

    if (!email || !password) {
      setError('Please fill in all fields.')
      setLoading(false)
      return
    }

    const supabase = createClient()
    const { data: { user }, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Persisted by Supabase as auth.users.raw_user_meta_data. Records what was
        // accepted, which version of the wording was shown, and when - so the
        // confirmation is auditable rather than merely displayed.
        data: buildConsentMetadata(submittedConsent),
      },
    })

    if (signUpError) {
      setError(signUpError.message)
      setLoading(false)
      return
    }

    if (!user) {
      setError('Signup failed. Please try again.')
      setLoading(false)
      return
    }

    // Supabase returns an obfuscated stub user (empty `identities`, no session)
    // when the email is already registered and email confirmation is enabled.
    // Treat it as "already registered" instead of pushing the user to /parent,
    // where every RLS query would come back empty.
    if (user.identities && user.identities.length === 0) {
      setError('An account with this email already exists. Please log in instead.')
      setLoading(false)
      return
    }

    // The PARENT role is now provisioned by the `on_auth_user_created` trigger
    // (supabase/migrations/009_social_auth.sql) inside the same transaction that
    // creates the auth user, so there is no second request to race or fail.
    //
    // This replaces the previous `POST /api/auth/assign-role` call. That endpoint
    // had no authentication whatsoever — anyone could grant any user id the ADMIN
    // role — so it has been deleted along with this call site.

    // Start the funnel: create the lifecycle row, attribute any referral code and
    // record SIGNUP_COMPLETED. Awaited because the redirect would otherwise
    // discard the request before it lands, and a parent whose funnel never starts
    // receives no readiness report, no free mock and no offer.
    //
    // Failures are swallowed here on purpose - the account exists, and blocking
    // the redirect on a bookkeeping call would show an error on a signup that
    // actually succeeded.
    try {
      await fetch('/api/funnel/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'email',
          marketingOptIn: submittedConsent.marketingOptIn,
          ref: readReferralCode(),
        }),
      })
    } catch {
      // Instrumentation must never strand a successful signup.
    }

    // Land in the guided flow rather than on the dashboard. Dropping a new parent
    // on an empty dashboard is where the funnel spec's 70% first-value target is
    // lost: there is nothing to do and no reason given to do it.
    router.push(nextParam('/onboarding'))
  }

  return (
    <PublicLayout>
      {/*
        Funnel step 2 entry marker. Fires once per page load, before any form
        interaction, so it measures ARRIVAL at the signup form - the denominator
        for form abandonment. Without it the funnel can report how many people
        signed up but not how many started and gave up, which is the number
        that tells you the form is too long or the consent step is scaring
        people off.

        Anonymous by design: there is no user yet, so this rides the
        anonymous_id the tracker maintains and is bridged to the account later
        by SIGNUP_COMPLETED. No email, no password, no consent state - the
        event records that a form was viewed and nothing about who filled it in.
      */}
      <PageViewTracker event="SIGNUP_STARTED" />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 10rem)', paddingTop: '5rem' }}>
        <SpatialCard intensity={10} className="max-w-md w-full">
          <div style={{ padding: '3rem', width: '100%', maxWidth: '450px' }}>
            <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
              <Badge variant="secondary" style={{ marginBottom: '1rem' }}>Get Started</Badge>
              <h1 style={{ fontSize: '2.25rem', fontWeight: 800, margin: 0 }}>Create Account</h1>
              <p style={{ color: 'var(--muted-foreground)', marginTop: '0.5rem' }}>Join 50,000+ families today.</p>
            </div>

            {/* Surfaces ?error= codes from /auth/oauth/[provider] and /auth/callback. */}
            <AuthErrorBanner />

            {error && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '0.75rem', padding: '0.875rem 1rem', marginBottom: '1.25rem', color: '#ef4444', fontSize: '0.875rem' }}>
                {error}
              </div>
            )}

            {/* Social-first: Google is the primary sign-up path, email the fallback.
                Both paths are gated by the same mandatory consents below. */}
            <SocialAuthButtons requireConsent={gateSocialConsent} />

            <form onSubmit={handleSignup} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-foreground">Parent&apos;s Email</label>
                <input
                  type="email"
                  name="email"
                  placeholder="parent@example.com"
                  required
                  className="w-full px-4 py-3 rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground transition-all duration-200 focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/10"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-foreground">Create Password</label>
                <input
                  type="password"
                  name="password"
                  placeholder="Min. 8 characters"
                  required
                  minLength={8}
                  className="w-full px-4 py-3 rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground transition-all duration-200 focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/10"
                />
              </div>
              {/* Mandatory consents sit immediately above the submit button, which
                  is the conventional position and the last thing a parent reads
                  before creating the account. */}
              <ConsentCheckboxes
                value={consent}
                onChange={(next) => {
                  setConsent(next)
                  // Mirror the choice into the short-lived cookie so the Google
                  // path can record it too (see lib/auth/consent.ts).
                  writeConsentCookie(next)
                  // Clear the complaint as soon as the user starts fixing it.
                  if (consentError) {
                    const stillMissing = validateConsent(next)
                    if (stillMissing.length === 0) {
                      setConsentError(null)
                      setInvalidConsent([])
                    } else {
                      setInvalidConsent(stillMissing)
                      setConsentError(consentErrorMessage(stillMissing))
                    }
                  }
                }}
                invalidFields={invalidConsent}
                errorMessage={consentError}
              />

              <Button type="submit" size="lg" style={{ marginTop: '1rem', width: '100%' }} disabled={loading}>
                {loading ? 'Creating Account…' : 'Create Free Account'}
              </Button>
            </form>

            <div style={{ marginTop: '2rem', textAlign: 'center', fontSize: '0.875rem', color: 'var(--muted-foreground)' }}>
              Already have an account? <Link href="/auth/login" style={{ color: 'var(--primary)', fontWeight: 600 }}>Log In</Link>
            </div>
          </div>
        </SpatialCard>
      </div>
    </PublicLayout>
  )
}
