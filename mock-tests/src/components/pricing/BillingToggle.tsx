'use client'

import { useId } from 'react'
import type { BillingInterval } from '@/lib/pricing/catalog'

/**
 * Monthly / annual selector.
 *
 * Two mutually exclusive options is a radiogroup, not a switch: the ARIA
 * radiogroup pattern gives correct semantics ("radio 1 of 2, selected") and
 * roving tabindex with arrow-key navigation, which a switch cannot express.
 *
 * The savings figure is derived from the real Stripe prices by the catalog, so
 * it can never disagree with what is actually charged.
 */

interface BillingToggleProps {
  value: BillingInterval
  onChange: (next: BillingInterval) => void
  savingsPercent: number
  /**
   * Annual saving in cents, when the caller can compute it from the real prices.
   *
   * WHY THIS PROP EXISTS
   *   The badge previously read only "Save 20%". A concrete dollar figure
   *   outperforms a percentage at the decision point: "$120 saved" is a sum of
   *   money a parent can picture, "20%" is an abstraction they have to multiply
   *   out themselves, and most will not. The percentage is kept as the fallback
   *   so this stays backwards compatible with callers that only know the rate.
   *
   *   Both values must come from the same price source or the badge will disagree
   *   with what Stripe charges. Pass the cents; do not hand-write the label.
   */
  savingsAmountCents?: number
  disabled?: boolean
}

const OPTIONS: { id: BillingInterval; label: string }[] = [
  { id: 'monthly', label: 'Monthly' },
  { id: 'annual', label: 'Annual' },
]

/** AUD, whole dollars when it divides evenly, otherwise two decimals. */
function formatSaving(cents: number): string {
  const dollars = cents / 100
  return '$' + (Number.isInteger(dollars) ? dollars.toString() : dollars.toFixed(2))
}

export function BillingToggle({
  value,
  onChange,
  savingsPercent,
  savingsAmountCents,
  disabled = false,
}: BillingToggleProps) {
  const groupId = useId()
  const showSavings = savingsPercent > 0 || (savingsAmountCents ?? 0) > 0

  // Prefer the dollar figure; fall back to the percentage. Never show both in the
  // badge - two numbers in one pill reads as clutter and dilutes the larger one.
  const hasAmount = (savingsAmountCents ?? 0) > 0
  const badgeLabel = hasAmount ? `Save ${formatSaving(savingsAmountCents!)}` : `Save ${savingsPercent}%`
  const liveSaving = hasAmount
    ? `You save ${formatSaving(savingsAmountCents!)} a year compared with paying monthly.`
    : `You save ${savingsPercent}% compared with paying monthly.`

  const move = (delta: number) => {
    const current = OPTIONS.findIndex((o) => o.id === value)
    const next = OPTIONS[(current + delta + OPTIONS.length) % OPTIONS.length]
    onChange(next.id)
    // Move focus with the selection, as the radiogroup pattern requires.
    document.getElementById(groupId + '-' + next.id)?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault()
        move(1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault()
        move(-1)
        break
      default:
        break
    }
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={groupId + '-label'}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}
    >
      <span
        id={groupId + '-label'}
        style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--muted-foreground)' }}
      >
        Choose a billing period
      </span>

      <div
        style={{
          display: 'inline-flex',
          gap: '0.25rem',
          padding: '0.25rem',
          background: 'var(--muted)',
          borderRadius: '9999px',
        }}
      >
        {OPTIONS.map((option) => {
          const selected = option.id === value
          return (
            <button
              key={option.id}
              id={groupId + '-' + option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(option.id)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.5rem 1.25rem',
                border: 0,
                borderRadius: '9999px',
                cursor: disabled ? 'not-allowed' : 'pointer',
                fontSize: '0.9375rem',
                fontWeight: 700,
                background: selected ? 'var(--card)' : 'transparent',
                color: selected ? 'var(--foreground)' : 'var(--muted-foreground)',
                boxShadow: selected ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
                transition: 'background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease',
              }}
            >
              {option.label}
              {option.id === 'annual' && showSavings && (
                <span
                  style={{
                    padding: '0.1rem 0.45rem',
                    borderRadius: '9999px',
                    fontSize: '0.6875rem',
                    fontWeight: 800,
                    background: 'rgba(5,150,105,0.12)',
                    color: '#059669',
                  }}
                >
                  {badgeLabel}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Polite live region: screen reader users hear the consequence of switching,
          not just the new checked state. */}
      <p
        aria-live="polite"
        style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--muted-foreground)' }}
      >
        {value === 'annual'
          ? showSavings
            ? 'Billed once a year. ' + liveSaving
            : 'Billed once a year.'
          : 'Billed every month. Switch to annual any time.'}
      </p>
    </div>
  )
}