'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import { BillingToggle } from './BillingToggle'
import { usePricingSession } from './usePricingSession'
import { PageViewTracker } from '@/features/monetisation/PageViewTracker'
import {
  annualPerMonthCents,
  formatMoney,
  type ALaCarteProduct,
  type BillingInterval,
  type SubscriptionTier,
} from '@/lib/pricing/catalog'

/**
 * The three pricing tiers.
 *
 * Handlers are deliberately split by *intent*, because each one has different
 * failure modes and different auth requirements:
 *   handleSelectFree()        - no payment, no Stripe round trip
 *   handlePurchaseTest(id)    - one-time Checkout Session (mode: payment)
 *   handleSubscribe(interval) - recurring Checkout Session (mode: subscription)
 *
 * The client only ever sends an identifier (productId / interval). It never
 * sends an amount, so a tampered request cannot change the price - the server
 * resolves the amount from the Stripe catalog.
 */

interface PricingTiersProps {
  tier: SubscriptionTier | null
  products: ALaCarteProduct[]
}

type PendingAction =
  | { kind: 'free' }
  | { kind: 'product'; id: string }
  | { kind: 'subscribe'; interval: BillingInterval }
  | null

/**
 * Annual saving in cents, derived from the same real Stripe prices that
 * `annualSavingsPercent` is computed from, so the badge's dollar figure and the
 * catalog's percentage can never disagree.
 *
 * Returns 0 when either price is missing, which makes BillingToggle fall back to
 * the percentage rather than printing "Save $0" or "Save $NaN".
 */
function annualSavingCents(tier: SubscriptionTier): number {
  const monthly = tier.prices.monthly?.amountCents ?? 0
  const annual = tier.prices.annual?.amountCents ?? 0
  if (monthly <= 0 || annual <= 0) return 0
  return Math.max(0, monthly * 12 - annual)
}

export function PricingTiers({ tier, products }: PricingTiersProps) {
  const router = useRouter()
  // Resolved in the browser so the route can stay static/prerendered.
  const { isAuthenticated, activeInterval } = usePricingSession()
  const [interval, setInterval] = useState<BillingInterval>('annual')
  const [pending, setPending] = useState<PendingAction>(null)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const busy = pending !== null
  const isPending = (action: PendingAction) =>
    action !== null && pending !== null && JSON.stringify(action) === JSON.stringify(pending)

  /** Send an authenticated user into sign-up, remembering where to return. */
  const goAuth = (returnPath: string) => {
    startTransition(() => {
      router.push('/auth/signup?next=' + encodeURIComponent(returnPath))
    })
  }

  /**
   * Create a Checkout Session server-side, then hand off to Stripe.
   * `window.location.href` (not router.push) - Stripe Checkout is cross-origin.
   */
  const startCheckout = async (body: Record<string, string>, action: PendingAction) => {
    setPending(action)
    setError(null)
    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await response.json().catch(() => ({}))

      // 401 means the session expired while the tab was open; re-authenticate
      // rather than showing a generic failure.
      if (response.status === 401) {
        goAuth('/pricing')
        return
      }
      if (!response.ok) {
        throw new Error(typeof data.error === 'string' && data.error ? data.error : 'Checkout could not be started.')
      }
      if (typeof data.url !== 'string' || !data.url) {
        throw new Error('Checkout did not return a redirect URL.')
      }

      window.location.href = data.url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      setPending(null)
    }
  }

  // ---- Tier 1: Free -------------------------------------------------------
  // No Stripe call at all. Routing straight to /free avoids a pointless round
  // trip and keeps the free funnel frictionless.
  const handleSelectFree = () => {
    setError(null)
    if (!isAuthenticated) {
      goAuth('/free')
      return
    }
    startTransition(() => {
      router.push('/free')
    })
  }

  // ---- Tier 2: A la carte -------------------------------------------------
  const handlePurchaseTest = (testId: string) => {
    if (!isAuthenticated) {
      goAuth('/pricing')
      return
    }
    void startCheckout({ mode: 'payment', productId: testId }, { kind: 'product', id: testId })
  }

  // ---- Tier 3: Subscription ----------------------------------------------
  // `planType` defaults to whatever the toggle shows, so the button and the
  // displayed price can never disagree.
  const handleSubscribe = (planType: BillingInterval = interval) => {
    if (!isAuthenticated) {
      goAuth('/pricing')
      return
    }
    if (!tier) {
      setError('Subscription pricing is not available yet. Please contact us.')
      return
    }
    void startCheckout(
      { mode: 'subscription', interval: planType },
      { kind: 'subscribe', interval: planType }
    )
  }
  const price = tier ? tier.prices[interval] : null
  const perMonth = price ? (interval === 'annual' ? annualPerMonthCents(price.amountCents) : price.amountCents) : null
  const cheapest = products.length > 0 ? Math.min(...products.map((p) => p.priceCents)) : null

  return (
    <div>
      {/* Acquire-stage event. /pricing is a STATIC route, so this is the only
          place a per-visitor view can be recorded - and without it report A11 has
          no stage-1 denominator and every conversion rate below it is null. */}
      <PageViewTracker event="PRICING_VIEWED" props={{ surface: 'pricing_page' }} />
      {tier && (
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '2.5rem' }}>
          <BillingToggle
            value={interval}
            onChange={setInterval}
            savingsPercent={tier.annualSavingsPercent}
            savingsAmountCents={annualSavingCents(tier)}
            disabled={busy}
          />
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            maxWidth: '42rem',
            margin: '0 auto 1.5rem',
            padding: '0.875rem 1rem',
            borderRadius: '0.75rem',
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            color: '#ef4444',
            fontSize: '0.875rem',
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gap: '1.5rem',
          alignItems: 'start',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        }}
      >
        {/* ---- Tier 1: Free ---- */}
        <section aria-labelledby="tier-free" style={cardStyle}>
          <h2 id="tier-free" style={titleStyle}>Free</h2>
          <p style={taglineStyle}>Try the platform before you spend anything.</p>
          <p style={priceStyle}>
            {formatMoney(0)}
            <span style={periodStyle}> forever</span>
          </p>
          <ul style={listStyle}>
            {[
              'A rotating set of free practice tests',
              'Diagnostic maths assessment',
              'One AI-marked writing sample',
              'Parent progress report',
            ].map((feature) => (
              <li key={feature} style={itemStyle}>
                <Check size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: '0.2rem', color: '#059669' }} />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={handleSelectFree}
            disabled={busy}
            style={{ ...secondaryBtn, opacity: busy ? 0.6 : 1 }}
          >
            Start for free
          </button>
        </section>

        {/* ---- Tier 3: Subscription (featured) ---- */}
        <section aria-labelledby="tier-unlimited" style={{ ...cardStyle, ...featuredStyle }}>
          <span style={badgeStyle}>Best value</span>
          <h2 id="tier-unlimited" style={titleStyle}>{tier ? tier.name : 'Unlimited'}</h2>
          <p style={taglineStyle}>
            {tier ? tier.tagline : 'Every test, every year level, no per-test fees.'}
          </p>

          {tier && price && perMonth !== null ? (
            <>
              <p style={priceStyle}>
                {formatMoney(perMonth, price.currency)}
                <span style={periodStyle}> /month</span>
              </p>
              <p style={noteStyle}>
                {interval === 'annual'
                  ? 'Billed as ' + formatMoney(price.amountCents, price.currency) + ' once a year'
                  : 'Billed monthly, cancel anytime'}
              </p>
            </>
          ) : (
            <>
              <p style={priceStyle}>
                <span style={periodStyle}>Pricing coming soon</span>
              </p>
              <p style={noteStyle}>
                Subscription billing is being configured. Single tests and the free
                plan are available now.
              </p>
            </>
          )}

          <ul style={listStyle}>
            {(tier ? tier.features : [
              'Unlimited access to every premium test',
              'All year levels (3-8) and all exam types',
              'AI writing feedback on every attempt',
            ]).map((feature) => (
              <li key={feature} style={itemStyle}>
                <Check size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: '0.2rem', color: '#059669' }} />
                <span>{feature}</span>
              </li>
            ))}
          </ul>

          {activeInterval ? (
            <p style={{ margin: 0, fontSize: '0.875rem', textAlign: 'center', color: 'var(--muted-foreground)' }}>
              You are on the {activeInterval} plan.{' '}
              <a href="/api/billing/portal" style={{ color: 'var(--primary)', fontWeight: 700 }}>
                Manage subscription
              </a>
            </p>
          ) : (
            <button
              type="button"
              onClick={() => handleSubscribe(interval)}
              disabled={busy || !tier}
              aria-busy={isPending({ kind: 'subscribe', interval })}
              style={{ ...primaryBtn, opacity: busy || !tier ? 0.6 : 1, cursor: busy || !tier ? 'not-allowed' : 'pointer' }}
            >
              {isPending({ kind: 'subscribe', interval })
                ? 'Redirecting to secure checkout...'
                : tier
                  ? 'Subscribe ' + interval
                  : 'Notify me when available'}
            </button>
          )}
        </section>

        {/* ---- Tier 2: A la carte ---- */}
        <section aria-labelledby="tier-alacarte" style={cardStyle}>
          <h2 id="tier-alacarte" style={titleStyle}>Single tests</h2>
          <p style={taglineStyle}>Buy only what you need. Yours to keep.</p>
          <p style={priceStyle}>
            {cheapest !== null ? 'from ' + formatMoney(cheapest) : 'One-off'}
            <span style={periodStyle}> per test</span>
          </p>

          {products.length > 0 ? (
            <ul style={{ ...listStyle, maxHeight: '17rem', overflowY: 'auto' }}>
              {products.map((product) => (
                <li
                  key={product.id}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}
                >
                  <span style={{ fontSize: '0.875rem', lineHeight: 1.5 }}>{product.name}</span>
                  <button
                    type="button"
                    onClick={() => handlePurchaseTest(product.id)}
                    disabled={busy}
                    aria-busy={isPending({ kind: 'product', id: product.id })}
                    aria-label={'Buy ' + product.name + ' for ' + formatMoney(product.priceCents, product.currency)}
                    style={{ ...smallBtn, opacity: busy ? 0.6 : 1 }}
                  >
                    {isPending({ kind: 'product', id: product.id }) ? '...' : formatMoney(product.priceCents, product.currency)}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ fontSize: '0.875rem', color: 'var(--muted-foreground)', margin: '0.5rem 0 1.25rem' }}>
              No single tests are on sale right now.
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
const cardStyle: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
  padding: '2rem',
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: '1.25rem',
}

const featuredStyle: React.CSSProperties = {
  borderColor: 'var(--primary)',
  boxShadow: '0 16px 40px -20px rgba(25,75,251,0.45)',
}

const badgeStyle: React.CSSProperties = {
  position: 'absolute',
  top: '-0.75rem',
  left: '50%',
  transform: 'translateX(-50%)',
  padding: '0.25rem 0.75rem',
  borderRadius: '9999px',
  background: 'var(--primary)',
  color: '#ffffff',
  fontSize: '0.6875rem',
  fontWeight: 800,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
}

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '1.375rem',
  fontWeight: 800,
}

const taglineStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.875rem',
  lineHeight: 1.6,
  color: 'var(--muted-foreground)',
}

const priceStyle: React.CSSProperties = {
  margin: '0.5rem 0 0',
  fontSize: '2.25rem',
  fontWeight: 800,
  letterSpacing: '-0.02em',
  lineHeight: 1.1,
}

const periodStyle: React.CSSProperties = {
  fontSize: '0.9375rem',
  fontWeight: 500,
  color: 'var(--muted-foreground)',
}

const noteStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8125rem',
  lineHeight: 1.6,
  color: 'var(--muted-foreground)',
}

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.625rem',
  margin: '0.5rem 0 1.25rem',
  padding: 0,
}

const itemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '0.5rem',
  fontSize: '0.875rem',
  lineHeight: 1.6,
}

const primaryBtn: React.CSSProperties = {
  padding: '0.875rem 1.5rem',
  border: 0,
  borderRadius: '9999px',
  background: 'var(--primary)',
  color: '#ffffff',
  fontSize: '1rem',
  fontWeight: 700,
  textAlign: 'center',
}

const secondaryBtn: React.CSSProperties = {
  padding: '0.875rem 1.5rem',
  border: '1px solid var(--primary)',
  borderRadius: '9999px',
  background: 'var(--card)',
  color: 'var(--primary)',
  fontSize: '1rem',
  fontWeight: 700,
  cursor: 'pointer',
  textAlign: 'center',
}

const smallBtn: React.CSSProperties = {
  flexShrink: 0,
  padding: '0.375rem 0.75rem',
  border: 0,
  borderRadius: '9999px',
  background: 'var(--primary)',
  color: '#ffffff',
  fontSize: '0.8125rem',
  fontWeight: 700,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}