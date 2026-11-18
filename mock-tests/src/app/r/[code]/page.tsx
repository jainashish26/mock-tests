import type { Metadata } from 'next'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { PublicLayout } from '@/components/layout/PublicLayout'
import { ReferralCookieSetter } from '@/features/referral/ReferralCookieSetter'
import { ReferralLandingTracker } from '@/features/referral/ReferralLandingTracker'
import { DEFAULT_REFEREE_DISCOUNT_CENTS } from '@/lib/funnel/referral'
import { formatMoney } from '@/lib/pricing/catalog'
import { SITE_NAME, SITE_URL } from '@/lib/seo/site-config'
import { Check, Gift, ShieldCheck, Sparkles } from 'lucide-react'
import { REFERRAL_STYLES as S } from './referral.styles'

/**
 * /r/[code] - the referral landing page (funnel step 1).
 *
 * WHY A DEDICATED PAGE RATHER THAN `/?ref=CODE`
 *   A referred visitor arrives with a social recommendation attached, which is a
 *   materially different psychological state from a cold search visit. Showing
 *   them the generic homepage throws that away. Naming the referrer on the first
 *   screen converts the visit from "an ad I clicked" into "something a friend
 *   sent me", and that frame is the reason referrals outconvert paid acquisition.
 *
 *   It is also the only place the two-sided reward can be stated up front, which
 *   matters for honesty: a parent who discovers later that their friend earned
 *   credit feels tricked, and says so in the school group.
 *
 * INVALID CODES DEGRADE, NEVER 404.
 *   A dead link shared into a parent WhatsApp group is worse than a generic
 *   landing page. If the code cannot be resolved the visitor still gets a
 *   working entry point into the product.
 */

interface ReferralPageProps {
  params: Promise<{ code: string }>
}

export async function generateMetadata({ params }: ReferralPageProps): Promise<Metadata> {
  const { code } = await params
  return {
    title: `A parent invited you to ${SITE_NAME}`,
    description: `Free exam diagnostic, readiness report and AI-marked writing feedback for Years 3-8. Referred with code ${code}.`,
    // Per-code pages are unindexed deliberately: thousands of near-duplicate
    // landing pages would dilute the canonical marketing pages in search.
    robots: { index: false, follow: true },
    alternates: { canonical: '/' },
    openGraph: {
      type: 'website',
      url: `${SITE_URL}/r/${code}`,
      title: `A parent invited you to ${SITE_NAME}`,
      description: 'Free exam diagnostic and readiness report for Years 3-8. No card needed.',
    },
  }
}

/**
 * Resolve a code to something safe to render.
 *
 * Deliberately returns no owner identity: the referrer is only ever an email
 * address in this system, and exposing even a fragment of it to the referee would
 * be a privacy breach dressed up as personalisation. The copy therefore refers to
 * "a MockTests Pro parent", which carries the social proof without the data.
 */
async function resolveCode(rawCode: string) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null

  const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (code.length < 4 || code.length > 16) return null

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('referral_codes')
      .select('code, kind, reward_value, active')
      .eq('code', code)
      .eq('active', true)
      .maybeSingle()

    if (error || !data) return null

    const row = data as { code: string; kind?: string; reward_value?: number; active?: boolean }
    if (row.active === false) return null

    return {
      code: row.code,
      kind: row.kind === 'CAMPAIGN' ? ('CAMPAIGN' as const) : ('PARENT' as const),
      referrerRewardCents: Number(row.reward_value) || 0,
    }
  } catch {
    // An unresolvable code is an expected outcome (typo, deactivated campaign),
    // not an error worth logging at ERROR level.
    return null
  }
}

/** What the free tier gives away, stated as concrete deliverables. */
const FREE_PROMISES = [
  'A benchmark diagnostic across numeracy, reading, language conventions and reasoning',
  'A readiness report with a band for NAPLAN, and for Selective entry from Year 7',
  'The specific topics where marks are being lost, worst first',
  'One AI-marked writing sample against the official rubric',
  'A second full-length mock exam, unlocked free for seven days',
] as const

export default async function ReferralLandingPage({ params }: ReferralPageProps) {
  const { code: rawCode } = await params
  const referral = await resolveCode(rawCode)
  const code = referral?.code ?? rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16)

  const refereeBenefit = formatMoney(DEFAULT_REFEREE_DISCOUNT_CENTS)
  const referrerBenefit = referral
    ? formatMoney(referral.referrerRewardCents)
    : formatMoney(DEFAULT_REFEREE_DISCOUNT_CENTS)

  const referrerLabel =
    referral?.kind === 'CAMPAIGN' ? 'Your school community' : `A ${SITE_NAME} parent`

  const signupHref = `/auth/signup?ref=${encodeURIComponent(code)}`

  return (
    <PublicLayout>
      {/* Persists the code so attribution survives the trip to /auth/signup. */}
      <ReferralCookieSetter code={code} />
      <ReferralLandingTracker code={code} valid={referral !== null} />

      <main style={S.page}>
        <section style={S.hero} aria-labelledby="referral-heading">
          <span style={S.badge}>
            <Gift size={13} aria-hidden="true" /> You were referred
          </span>

          <h1 id="referral-heading" style={S.h1}>
            {referrerLabel} thought {SITE_NAME} would help your family
          </h1>

          <p style={S.lede}>
            A free exam diagnostic, a full readiness report naming the topics where marks are being
            lost, and AI-marked writing feedback. Years 3 to 8. No credit card, and nothing to
            cancel.
          </p>

          <div style={S.rewardCard}>
            <div style={S.rewardRow}>
              <span style={S.rewardLabel}>For you</span>
              <span style={S.rewardValue}>{refereeBenefit} off your first pack</span>
            </div>
            <div style={{ ...S.rewardRow, borderBottom: 'none' }}>
              <span style={S.rewardLabel}>For them</span>
              <span style={S.rewardValue}>{referrerBenefit} credit if you stay</span>
            </div>
            <p style={S.rewardNote}>
              Both are attached to your account automatically when you sign up with this link.
              Neither of you has to claim anything.
            </p>
          </div>

          <div style={S.ctaRow}>
            <Link href={signupHref} style={S.ctaPrimary}>
              <Sparkles size={16} aria-hidden="true" />
              Start free — no card needed
            </Link>
            <p style={S.ctaNote}>
              Signing up takes about two minutes. Your child&apos;s diagnostic is roughly 20 minutes
              and can be done any time in the next 24 hours.
            </p>
          </div>

          {code ? (
            <p style={S.codeLine}>
              Referral code <code style={S.codeChip}>{code}</code>
            </p>
          ) : null}
        </section>

        <section style={S.proof} aria-labelledby="what-you-get">
          <h2 id="what-you-get" style={S.h2}>
            What you get before you spend anything
          </h2>
          <ul style={S.list}>
            {FREE_PROMISES.map((item) => (
              <li key={item} style={S.listItem}>
                <Check size={16} aria-hidden="true" style={S.check} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p style={S.privacyNote}>
            <ShieldCheck size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: '0.1rem' }} />
            <span>
              We never ask for your child&apos;s real name, date of birth or school. Each child gets a
              generated username.
            </span>
          </p>
        </section>
      </main>
    </PublicLayout>
  )
}

