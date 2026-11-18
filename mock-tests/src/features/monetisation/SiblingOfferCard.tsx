'use client'

import { useEffect, useRef } from 'react'
import { ShieldCheck } from 'lucide-react'
import type { SiblingOfferPayload } from '@/lib/pricing/sibling-rules'
import { OfferCheckoutButton } from './OfferCheckoutButton'
import { trackView } from './track-client'

/**
 * The Second Child Pack card (N-5 at add-child, N-8 on the dashboard).
 *
 * COPY FOLLOWS THE SEED'S COMMERCIAL DECISION
 *   funnel_offers.sql prices this as "the same, for the second child" rather
 *   than as a discount, because the consistency argument is stronger than the
 *   saving: the parent has already decided the approach works. The saving is
 *   still shown as a derived number (N-3), never as the headline.
 *
 * NO COUNTDOWN, NO SCARCITY
 *   The sibling offer has no per-user window. Nothing here ticks, expires or
 *   claims limited availability - 15-...md §1.2(b) forbids fabricated urgency.
 *
 * MEASUREMENT
 *   One view event per mount: SIBLING_OFFER_VIEWED at add-child (N-5's own
 *   catalogue event) or CROSSSELL_VIEWED on the dashboard (N-8). The ref
 *   guard keeps React strict-mode double effects from doubling the metric.
 *   The purchase itself is measured by SECOND_PRODUCT_PURCHASED, already
 *   wired in the webhook - so the lever is measurable the day it ships.
 */
export function SiblingOfferCard({
  offer,
  surface,
}: {
  offer: SiblingOfferPayload
  surface: 'add-child' | 'dashboard'
}) {
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    fired.current = true
    trackView(surface === 'add-child' ? 'SIBLING_OFFER_VIEWED' : 'CROSSSELL_VIEWED', {
      offerSlug: offer.slug,
      surface,
      priceLabel: offer.priceLabel,
    })
  }, [offer.slug, offer.priceLabel, surface])

  const showSaving = offer.originalLabel !== offer.priceLabel

  return (
    <div style={cardStyle} aria-label={offer.name}>
      <p style={eyebrowStyle}>For your other child</p>
      <h3 style={titleStyle}>The same plan, for your second child</h3>
      {offer.description && <p style={descStyle}>{offer.description}</p>}

      {offer.includes.length > 0 && (
        <ul style={listStyle}>
          {offer.includes.map((item) => (
            <li key={item} style={listItemStyle}>
              {item}
            </li>
          ))}
        </ul>
      )}

      <p style={priceRowStyle}>
        {showSaving && <s style={anchorStyle}>{offer.originalLabel}</s>}
        <strong style={priceStyle}>{offer.priceLabel}</strong>
        {showSaving && <span style={savingStyle}>Save {offer.savingLabel}</span>}
      </p>

      <OfferCheckoutButton
        offerSlug={offer.slug}
        label={`Get the ${offer.name} for ${offer.priceLabel}`}
        priceLabel={offer.priceLabel}
        expiredMessage="This offer is no longer available on your account."
      />

      <p style={guaranteeStyle}>
        <ShieldCheck size={14} aria-hidden="true" />
        {offer.guaranteeDays}-day money-back guarantee, for any reason.
      </p>
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  marginTop: '1rem',
  padding: '1.25rem',
  borderRadius: '0.875rem',
  border: '1px solid var(--border, #e2e8f0)',
  background: 'var(--card, #ffffff)',
}

const eyebrowStyle: React.CSSProperties = {
  margin: '0 0 0.25rem',
  fontSize: '0.75rem',
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--primary, #194bfb)',
}

const titleStyle: React.CSSProperties = {
  margin: '0 0 0.5rem',
  fontSize: '1.0625rem',
  fontWeight: 800,
}

const descStyle: React.CSSProperties = {
  margin: '0 0 0.75rem',
  fontSize: '0.875rem',
  color: 'var(--muted-foreground, #64748b)',
}

const listStyle: React.CSSProperties = {
  margin: '0 0 0.75rem',
  paddingLeft: '1.1rem',
  fontSize: '0.8125rem',
  color: 'var(--muted-foreground, #64748b)',
}

const listItemStyle: React.CSSProperties = { marginBottom: '0.25rem' }

const priceRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.6rem',
  margin: '0 0 0.9rem',
}

const anchorStyle: React.CSSProperties = {
  fontSize: '0.9375rem',
  color: 'var(--muted-foreground, #94a3b8)',
}

const priceStyle: React.CSSProperties = { fontSize: '1.5rem', fontWeight: 800 }

const savingStyle: React.CSSProperties = {
  fontSize: '0.8125rem',
  fontWeight: 700,
  color: '#059669',
}

const guaranteeStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.4rem',
  margin: '0.75rem 0 0',
  fontSize: '0.8125rem',
  color: 'var(--muted-foreground, #64748b)',
}