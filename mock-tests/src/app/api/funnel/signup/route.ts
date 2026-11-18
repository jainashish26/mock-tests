import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'
import { initialiseFunnelState } from '@/lib/funnel/state'
import { attributeReferral } from '@/lib/funnel/referral'
import { normalizeUtm } from '@/lib/funnel/events'
import { trackEvent } from '@/lib/funnel/track'
import { classifyDevice } from '@/lib/funnel/device'

/**
 * POST /api/funnel/signup - starts the funnel for a newly created parent.
 *
 * WHY A SEPARATE ENDPOINT RATHER THAN LOGIC IN THE SIGNUP PAGE
 *   The signup page is a client component, and every one of these three writes
 *   needs the service-role client: `funnel_state` has a SELECT-only policy,
 *   `referral_codes` cannot be read by a user who is not yet fully signed in, and
 *   `funnel_events` has no client policy at all. Doing it from the browser would
 *   mean exposing the service key, which is not a trade worth making for one
 *   fewer request.
 *
 *   It is also shared by both signup paths - email/password and Google OAuth -
 *   so the funnel cannot start on one and not the other. That symmetry matters:
 *   OAuth is the majority path, and a funnel that only tracks email signups
 *   would report conversion against a denominator missing most of its users.
 *
 * FAILURE MODE
 *   Always returns 200 once the caller is authenticated. Failing to record a
 *   funnel start must not strand a parent who has just successfully created an
 *   account; they would see an error on a page that has actually worked.
 */

/** Referral codes are short alphanumerics; anything longer is not one. */
function sanitizeRef(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (value.length < 4 || value.length > 16) return null
  return value
}

export async function POST(req: Request) {
  let userId: string
  let email: string | null = null

  try {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.getUser()
    if (error || !data.user) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
    }
    userId = data.user.id
    email = data.user.email ?? null
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
  }

  let body: Record<string, unknown> = {}
  try {
    const parsed = await req.json()
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>
    }
  } catch {
    // A missing body is fine - the funnel still starts, just without attribution.
  }

  const ref = sanitizeRef(body.ref)
  const marketingOptIn = body.marketingOptIn === true
  const utm = normalizeUtm(body.utm)
  const source = typeof body.source === 'string' ? body.source.slice(0, 32) : 'email'

  try {
    // Create the lifecycle row first, so attribution has somewhere to write the
    // referrer code.
    await initialiseFunnelState(userId, {
      email,
      marketingOptIn,
      referredByCode: ref,
    })

    const attributed = ref ? await attributeReferral(userId, ref, utm) : false

    await trackEvent({
      event: source === 'oauth' ? 'OAUTH_COMPLETED' : 'SIGNUP_COMPLETED',
      userId,
      path: '/auth/signup',
      utm,
      // C9: derived here rather than inherited, because this is the FIRST
      // stage-bearing event of the journey. A brand-new user_id has no event
      // history to inherit a device from, so without this the top of every
      // funnel would read 'unknown'.
      device: classifyDevice(req),
      props: {
        source,
        referred: attributed,
        referralCode: attributed ? ref : null,
        marketingOptIn,
        hasEmail: Boolean(email),
      },
    })

    return NextResponse.json({
      ok: true,
      referred: attributed,
      // Tells the client whether to show the "your friend gets X" confirmation,
      // which is worth showing: it makes the two-sided reward visible and
      // encourages the new parent to share their own code later.
      next: '/onboarding',
    })
  } catch (err) {
    // Logged loudly but not surfaced: the account exists, and that is what the
    // parent cares about at this moment.
    logger.error('FUNNEL_SIGNUP', '[funnel] signup recording failed', err)
    return NextResponse.json({ ok: false, next: '/onboarding' })
  }
}
