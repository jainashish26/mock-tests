import Link from 'next/link'
import { Check, Clock, FileText, ShieldCheck, Sparkles, TrendingUp, Lock } from 'lucide-react'
import { OfferCountdown } from './OfferCountdown'
import { OfferCheckoutButton } from './OfferCheckoutButton'
import { PANEL_STYLES as S } from './offer-panel.styles'
import { interestLine } from '@/lib/pricing/offer-personalisation'

/**
 * Presentational panels for funnel step 7.
 *
 * Split out of the route so the page component stays a data-loading concern and
 * the conversion copy lives in one place. These are server components by design:
 * only the countdown and the checkout button need to be interactive, and keeping
 * the rest server-rendered means the price, the guarantee and the inclusion list
 * are in the initial HTML - visible to a parent with JavaScript disabled, and not
 * dependent on a hydration round trip before the CTA works.
 */

/** What the panel needs, already resolved by the route. */
export interface OfferPanelData {
  offerName: string
  offerDescription: string | null
  slug: string
  priceLabel: string
  originalLabel: string
  discountPercent: number
  guaranteeDays: number
  expiresAt: string | null
  includes: string[]
  /** The child's headline gap, for the diagnosis-first opening. */
  childLabel: string | null
  gapTopic: string | null
  gapAccuracy: number | null
  gapAttempted: number | null
  examLabel: string | null
  /**
   * The locked insight this parent clicked most on the paywall (N-7), or null.
   * Used only to acknowledge what they asked for and to order the benefit list;
   * it never changes the price, the guarantee or the offer window.
   */
  interestInsight?: string | null
}

export function OfferPanel({ data }: { data: OfferPanelData }) {
  const hasDiagnosis = Boolean(data.gapTopic || data.examLabel)
  const interest = interestLine(data.interestInsight ?? null)

  return (
    <main style={S.page}>
      {hasDiagnosis ? (
        <section style={S.diagnosis} aria-labelledby="offer-diagnosis-heading">
          <p style={S.eyebrow}>
            <TrendingUp size={13} aria-hidden="true" /> From your readiness report
          </p>
          <h2 id="offer-diagnosis-heading" style={S.diagnosisTitle}>
            {data.gapTopic
              ? `${data.childLabel ?? 'Your child'} is losing the most marks on ${data.gapTopic}`
              : `${data.childLabel ?? 'Your child'}'s diagnosis is ready`}
          </h2>
          <p style={S.diagnosisBody}>
            {data.gapTopic && data.gapAccuracy !== null
              ? `${data.gapAccuracy}% correct across ${data.gapAttempted ?? 0} questions${
                  data.examLabel ? `, against a ${data.examLabel} standard` : ''
                }. That is a specific, fixable problem, and it is what this pack is built to attack.`
              : 'The full report is on your dashboard. This pack turns that diagnosis into a weekly plan.'}
          </p>
        </section>
      ) : null}

      <section style={S.card} aria-labelledby="offer-heading">
        <span style={S.offerBadge}>
          <Sparkles size={13} aria-hidden="true" /> One-time launch offer
        </span>

        <h1 id="offer-heading" style={S.title}>
          {data.offerName}
        </h1>
        {data.offerDescription ? <p style={S.lede}>{data.offerDescription}</p> : null}

        <div style={S.priceRow}>
          <span style={S.price}>{data.priceLabel}</span>
          {data.discountPercent > 0 ? (
            <>
              <s style={S.strike}>{data.originalLabel}</s>
              <span style={S.save}>save {data.discountPercent}%</span>
            </>
          ) : null}
        </div>
        <p style={S.priceNote}>One payment. No subscription, no auto-renewal.</p>

        {data.expiresAt ? (
          <div style={S.countdownBlock}>
            <p style={S.countdownLabel}>
              <Clock size={13} aria-hidden="true" /> This price closes in
            </p>
            <OfferCountdown expiresAt={data.expiresAt} />
          </div>
        ) : null}

        {/* N-7: acknowledge what the parent asked to see, immediately above the
            benefit list whose first item now matches it. Null when there is no
            click history, so the panel renders its normal opening. */}
        {interest ? (
          <p
            style={{
              margin: '0 0 0.75rem',
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: 'var(--foreground)',
            }}
          >
            {interest}
          </p>
        ) : null}

        <ul style={S.includes}>
          {data.includes.map((item) => (
            <li key={item} style={S.includeItem}>
              <Check size={16} aria-hidden="true" style={S.check} />
              <span>{item}</span>
            </li>
          ))}
        </ul>

        <div style={S.guarantee}>
          <ShieldCheck size={20} aria-hidden="true" style={S.guaranteeIcon} />
          <div>
            <strong style={S.guaranteeTitle}>
              {data.guaranteeDays}-day money-back guarantee
            </strong>
            <p style={S.guaranteeBody}>
              Use it properly for {data.guaranteeDays} days. If {data.childLabel ?? 'your child'}
              &apos;s scores have not moved, or you simply decide it is not right for your family,
              email us and we refund the full amount. No form, no interrogation.{' '}
              <Link href="/terms#refunds" style={S.termsLink}>
                Full policy
              </Link>
            </p>
          </div>
        </div>

        <OfferCheckoutButton
          offerSlug={data.slug}
          label={`Get the ${data.offerName} for ${data.priceLabel}`}
          priceLabel={data.priceLabel}
        />

        <p style={S.finePrint}>
          <FileText size={12} aria-hidden="true" /> Prices include GST where applicable. This launch
          price is offered once per family.
        </p>
      </section>
    </main>
  )
}

/**
 * Shown to a family that has not completed enough assessments yet.
 *
 * Explains the path rather than selling. Pitching before the parent has received
 * value converts worse and, more importantly, damages the trust the free
 * diagnostic was built to create.
 */
export function OfferLockedPanel({
  remaining,
  threshold,
}: {
  remaining: number
  threshold: number
}) {
  return (
    <main style={S.page}>
      <div style={S.card}>
        <span style={S.lockBadge}>
          <Lock size={13} aria-hidden="true" /> Not unlocked yet
        </span>
        <h1 style={S.title}>
          {remaining > 0
            ? `${remaining} more ${remaining === 1 ? 'assessment' : 'assessments'} to unlock this`
            : 'This offer is not currently available'}
        </h1>
        <p style={S.lede}>
          The launch price opens once your family has completed {threshold} full assessments. That
          is not a hoop &mdash; it is the point at which we have enough of your child&apos;s data for
          the deeper analytics to say something worth paying for.
        </p>
        <ol style={S.steps}>
          <li>Assign a benchmark or mock exam to your child.</li>
          <li>They complete it in one sitting with the timer running.</li>
          <li>
            The deeper analytics, the adaptive plan and the launch price unlock automatically, and we
            email you the moment they do.
          </li>
        </ol>
        <div style={S.buttonRow}>
          <Link href="/parent" style={S.linkButton}>
            Assign a test
          </Link>
          <Link href="/pricing" style={S.ghostButton}>
            See standard pricing
          </Link>
        </div>
      </div>
    </main>
  )
}

/** Shown to a family that has already bought. Never re-pitch a customer. */
export function OfferOwnedPanel() {
  return (
    <main style={S.page}>
      <div style={S.card}>
        <h1 style={S.title}>You already have access</h1>
        <p style={S.lede}>
          Everything on this page is already unlocked on your account. Your study plan and reports
          are on the dashboard.
        </p>
        <div style={S.buttonRow}>
          <Link href="/parent" style={S.linkButton}>
            Go to my dashboard
          </Link>
        </div>
      </div>
    </main>
  )
}

