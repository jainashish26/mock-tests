'use client'

import { useState } from 'react'
import { trackClientEvent } from './track-client'

/**
 * The step-7 offer checkout button.
 *
 * Tracks the click before navigating. `window.location.href` replaces the page,
 * so any beacon fired after the assignment may never leave - which is why the
 * event is sent with `keepalive` and the navigation happens on the next tick
 * rather than synchronously.
 *
 * The 410 branch matters: when the offer window has closed the server refuses
 * the launch price. Silently falling back to full price would be the worst
 * outcome - the parent sees one number, is charged another, and the dispute
 * that follows costs more than the sale.
 */
export function OfferCheckoutButton({
  offerSlug,
  label,
  priceLabel,
  disabled = false,
  expiredMessage,
}: {
  offerSlug: string
  label: string
  priceLabel: string
  disabled?: boolean
  /**
   * Wording for the 410 branch. The launch offer's window can close; the
   * sibling offer has NO window, so "the window has closed" would be a lie -
   * its refusal means the family is no longer eligible (e.g. limit reached).
   */
  expiredMessage?: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCheckout = async () => {
    if (busy) return
    setBusy(true)
    setError(null)

    await trackClientEvent('OFFER_CTA_CLICKED', { offerSlug, priceLabel })

    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'payment', offerSlug }),
      })
      const data = await response.json().catch(() => ({}))

      if (response.status === 410) {
        // Refused server-side. Say so plainly rather than showing a generic
        // failure, and never silently fall back to a different price.
        setError(
          expiredMessage ??
            'That offer window has closed. The standard price now applies - you can still buy from the pricing page.'
        )
        await trackClientEvent('OFFER_EXPIRED', { offerSlug })
        setBusy(false)
        return
      }

      if (response.status === 401) {
        window.location.href = '/auth/login?next=' + encodeURIComponent('/parent/offer')
        return
      }

      if (!response.ok || typeof data.url !== 'string' || !data.url) {
        throw new Error(
          typeof data.error === 'string' && data.error
            ? data.error
            : 'Checkout could not be started.'
        )
      }

      await trackClientEvent('CHECKOUT_STARTED', { offerSlug, priceLabel })
      // Stripe Checkout is cross-origin; router.push cannot be used.
      window.location.href = data.url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      setBusy(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void handleCheckout()}
        disabled={busy || disabled}
        aria-busy={busy}
        style={{
          ...primaryStyle,
          opacity: busy || disabled ? 0.65 : 1,
          cursor: busy || disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {busy ? 'Opening secure checkout…' : label}
      </button>

      {error ? (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      ) : (
        <p style={reassuranceStyle}>
          Secure checkout by Stripe &middot; Card, Apple Pay, Google Pay and Afterpay
        </p>
      )}
    </div>
  )
}

const primaryStyle: React.CSSProperties = {
  width: '100%',
  padding: '1rem 1.5rem',
  border: 0,
  borderRadius: '9999px',
  background: 'var(--primary, #194bfb)',
  color: '#ffffff',
  fontSize: '1.0625rem',
  fontWeight: 800,
  textAlign: 'center',
}

const reassuranceStyle: React.CSSProperties = {
  margin: '0.75rem 0 0',
  textAlign: 'center',
  fontSize: '0.8125rem',
  color: 'var(--muted-foreground)',
}

const errorStyle: React.CSSProperties = {
  margin: '0.75rem 0 0',
  padding: '0.75rem 1rem',
  borderRadius: '0.625rem',
  background: 'rgba(220,38,38,0.08)',
  border: '1px solid rgba(220,38,38,0.25)',
  color: '#dc2626',
  fontSize: '0.875rem',
  textAlign: 'center',
}
