import type { Metadata } from 'next'
import { requireRole } from '@/lib/rbac/require-role'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { ShareWidget } from '@/features/referral/ShareWidget'
import {
  DEFAULT_REFEREE_DISCOUNT_CENTS,
  DEFAULT_REFERRER_REWARD_CENTS,
  getReferralStats,
} from '@/lib/funnel/referral'
import { formatMoney } from '@/lib/pricing/catalog'
import { SITE_NAME, SITE_URL } from '@/lib/seo/site-config'
import { Gift, Users } from 'lucide-react'
import { REFER_STYLES as S } from './refer.styles'

/**
 * /parent/refer - the referral share page (funnel step 1, and step 9's cheapest
 * growth lever).
 *
 * WHY IT SITS IN THE PARENT AREA RATHER THAN ON THE MARKETING SITE
 *   A parent is most willing to recommend the product immediately after receiving
 *   something valuable from it - the readiness report, or a child's score
 *   improvement. Both happen inside the app. A share surface behind the marketing
 *   nav is only seen by people who have not decided yet, which is the wrong
 *   audience entirely.
 *
 * THE TWO-SIDED REWARD IS STATED FIRST
 *   "They get $20 off, you get $30 credit" appears above the link. Sharing a link
 *   that only benefits you is socially awkward and most parents will not do it;
 *   leading with the referee's benefit turns the share into a favour, which is a
 *   different and much easier social act.
 *
 * PRIVACY
 *   Only aggregate counts are shown. The identities of referred families are never
 *   surfaced, because those families never consented to appear on someone else's
 *   dashboard.
 */

export const metadata: Metadata = {
  title: 'Refer a family',
  robots: { index: false, follow: false },
}

/**
 * The message a parent actually sends.
 *
 * Written in a parent's voice rather than the brand's. Copy that reads like
 * marketing gets edited or not sent at all; copy that reads like something a
 * friend would say gets pasted into the school group unchanged.
 */
function suggestedMessage(): string {
  return (
    'We have been using this for exam practice and the readiness report is genuinely useful - ' +
    'it names the exact topics where marks are being lost rather than just giving a score. ' +
    'Free diagnostic, no card needed.'
  )
}

/** One aggregate figure. Counts only - never who referred whom. */
function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={S.statBox}>
      <span style={S.statValue}>{value}</span>
      <span style={S.statLabel}>{label}</span>
    </div>
  )
}

export default async function ReferPage() {
  const { user } = await requireRole(['PARENT'])

  // Stats include the parent's code, which is minted on first visit.
  const stats = await getReferralStats(user.id, SITE_URL)

  const refereeLabel = `${formatMoney(DEFAULT_REFEREE_DISCOUNT_CENTS)} off their first pack`
  const referrerLabel = `${formatMoney(DEFAULT_REFERRER_REWARD_CENTS)} credit`

  return (
    <DashboardLayout role="PARENT" userName="Parent Account">
      <main style={S.page}>
        <header style={S.header}>
          <span style={S.badge}>
            <Gift size={13} aria-hidden="true" /> Refer a family
          </span>
          <h1 style={S.h1}>Send a family the free diagnostic</h1>
          <p style={S.lede}>
            They get a full readiness report at no cost and {refereeLabel.toLowerCase()}. You get{' '}
            {referrerLabel.toLowerCase()} once they decide to stay. Neither of you has to claim
            anything &mdash; it is attached automatically.
          </p>
        </header>

        {stats ? (
          <>
            <section style={S.card} aria-labelledby="share-heading">
              <h2 id="share-heading" style={S.cardTitle}>
                Share your link
              </h2>
              <ShareWidget
                shareUrl={stats.shareUrl}
                code={stats.code}
                suggestedMessage={suggestedMessage()}
                refereeBenefitLabel={refereeLabel}
                referrerBenefitLabel={referrerLabel}
              />
            </section>

            <section style={S.card} aria-labelledby="referral-progress-heading">
              <div style={S.cardHeader}>
                <Users size={17} aria-hidden="true" style={S.cardIcon} />
                <h2 id="referral-progress-heading" style={{ ...S.cardTitle, margin: 0 }}>
                  Your referrals
                </h2>
              </div>

              <div style={S.statGrid}>
                <Stat label="Families invited" value={stats.invited} />
                <Stat label="Completed a diagnostic" value={stats.activated} />
                <Stat label="Became members" value={stats.converted} />
                <Stat label="Credit earned" value={formatMoney(stats.earnedCents)} />
              </div>

              {stats.pendingCents > 0 ? (
                <p style={S.pendingNote}>
                  {formatMoney(stats.pendingCents)} more is pending &mdash; it lands as credit the
                  moment a family you referred makes their first purchase.
                </p>
              ) : null}

              {stats.invited === 0 ? (
                <p style={S.emptyNote}>
                  No referrals yet. The families most likely to say yes are the ones already asking
                  what you use &mdash; the school group chat is usually enough.
                </p>
              ) : null}
            </section>
          </>
        ) : (
          <section style={S.card}>
            <h2 style={S.cardTitle}>Referrals are not available right now</h2>
            <p style={S.lede}>
              We could not generate your {SITE_NAME} referral code. This usually means the referral
              tables have not been created yet &mdash; apply migration{' '}
              <code>011_funnel.sql</code> and reload.
            </p>
          </section>
        )}

        <p style={S.finePrint}>
          Referral credit applies to your next purchase and cannot be exchanged for cash. Credit
          earned from a purchase that is later refunded is withdrawn. Full terms at {SITE_URL}/terms.
        </p>
      </main>
    </DashboardLayout>
  )
}

