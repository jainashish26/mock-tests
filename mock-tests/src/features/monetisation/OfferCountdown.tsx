'use client'

import { useEffect, useState } from 'react'

/**
 * Live countdown to the offer deadline.
 *
 * WHY THE DEADLINE IS SERVER-SUPPLIED
 *   `expiresAt` comes from `funnel_state.offer_expires_at`, written when the
 *   offer was granted. A countdown computed from "now + 72h" in the browser
 *   would restart on every page load, and parents notice - a timer that resets
 *   teaches them that the urgency is fake, after which they ignore every future
 *   deadline. This component only renders a value it cannot influence.
 *
 * The component is client-side purely to tick; the initial HTML already contains
 * the correct remaining time so the page is meaningful before hydration and to
 * anyone with JavaScript disabled.
 */

export interface CountdownParts {
  days: number
  hours: number
  minutes: number
  seconds: number
  expired: boolean
}

/** Split a millisecond duration into display parts. Exported for testing. */
export function toParts(ms: number): CountdownParts {
  if (!Number.isFinite(ms) || ms <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true }
  }
  const totalSeconds = Math.floor(ms / 1000)
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    expired: false,
  }
}

const pad = (value: number): string => String(value).padStart(2, '0')

export function OfferCountdown({
  expiresAt,
  onExpire,
  compact = false,
}: {
  expiresAt: string
  onExpire?: () => void
  compact?: boolean
}) {
  const deadline = new Date(expiresAt).getTime()
  const [parts, setParts] = useState<CountdownParts>(() => toParts(deadline - Date.now()))

  useEffect(() => {
    // Recompute from the deadline rather than decrementing, so a backgrounded
    // tab (where timers are throttled) does not drift behind real time.
    const tick = () => {
      const next = toParts(deadline - Date.now())
      setParts(next)
      if (next.expired) onExpire?.()
    }

    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
    // `onExpire` is intentionally excluded: callers pass an inline arrow, and
    // including it would restart the interval on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline])

  // A single accessible live region. Announcing every second would make the
  // page unusable with a screen reader, so the announcement is coarse-grained
  // and the visual digits are marked aria-hidden.
  const announcement = parts.expired
    ? 'This offer has expired.'
    : parts.days > 0
      ? `${parts.days} days remaining on this offer.`
      : `${parts.hours} hours remaining on this offer.`

  if (parts.expired) {
    return (
      <div role="status" style={expiredStyle}>
        This offer has closed. The standard price now applies.
      </div>
    )
  }

  const units = compact
    ? [
        { value: parts.days, label: 'days' },
        { value: parts.hours, label: 'hrs' },
        { value: parts.minutes, label: 'min' },
      ]
    : [
        { value: parts.days, label: 'days' },
        { value: parts.hours, label: 'hours' },
        { value: parts.minutes, label: 'minutes' },
        { value: parts.seconds, label: 'seconds' },
      ]

  return (
    <div style={wrapperStyle}>
      <p aria-live="polite" style={srOnlyStyle}>
        {announcement}
      </p>
      <div aria-hidden="true" style={gridStyle}>
        {units.map((unit) => (
          <div key={unit.label} style={unitStyle}>
            <span style={valueStyle}>{pad(unit.value)}</span>
            <span style={labelStyle}>{unit.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const wrapperStyle: React.CSSProperties = { margin: '0.75rem 0' }

const gridStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
  justifyContent: 'center',
  flexWrap: 'wrap',
}

const unitStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  minWidth: '3.75rem',
  padding: '0.5rem 0.625rem',
  borderRadius: '0.625rem',
  background: 'rgba(220,38,38,0.08)',
  border: '1px solid rgba(220,38,38,0.22)',
}

const valueStyle: React.CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  fontSize: '1.375rem',
  fontWeight: 800,
  lineHeight: 1.1,
  color: '#dc2626',
}

const labelStyle: React.CSSProperties = {
  fontSize: '0.625rem',
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--muted-foreground)',
}

const expiredStyle: React.CSSProperties = {
  padding: '0.75rem 1rem',
  borderRadius: '0.625rem',
  background: 'var(--muted)',
  color: 'var(--muted-foreground)',
  fontSize: '0.875rem',
  textAlign: 'center',
}

const srOnlyStyle: React.CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  border: 0,
}
