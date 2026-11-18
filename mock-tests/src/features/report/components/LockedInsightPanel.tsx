'use client'

import { trackClientEvent } from '@/features/monetisation/track-client'

/**
 * Click tracking for a locked analytics panel (funnel step 6).
 *
 * WHICH INSIGHT THE PARENT CLICKS IS THE MOST VALUABLE SINGLE DATUM IN THE
 * FUNNEL. It tells you what they actually want, as opposed to what a feature
 * matrix says they should want. If "time per question" gets three times the
 * clicks of "progress trend", the offer page and the emails should lead with
 * time per question - and that conclusion comes from this one event.
 *
 * A client component because it needs an onClick handler; the surrounding report
 * markup stays server-rendered.
 */
export function LockedInsightCard({
  title,
  body,
  icon,
}: {
  title: string
  body: string
  icon: React.ReactNode
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() =>
          // `immediate` because a click here usually precedes a navigation, and
          // a queued beacon may not survive it.
          void trackClientEvent('PAYWALL_LOCK_CLICKED', { insight: title }, { immediate: true })
        }
        style={cardButtonStyle}
        aria-label={`${title}. Locked - part of the full plan.`}
      >
        <span style={iconStyle} aria-hidden="true">
          {icon}
        </span>
        <span>
          <span style={titleStyle}>{title}</span>
          <span style={bodyStyle}>{body}</span>
        </span>
      </button>
    </li>
  )
}

const cardButtonStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.75rem',
  alignItems: 'flex-start',
  width: '100%',
  padding: '1rem 1.125rem',
  borderRadius: '0.875rem',
  border: '1px solid var(--border)',
  background: 'var(--card)',
  cursor: 'pointer',
  textAlign: 'left',
  font: 'inherit',
  color: 'inherit',
}

const iconStyle: React.CSSProperties = {
  flexShrink: 0,
  marginTop: '0.125rem',
  color: 'var(--muted-foreground)',
}

const titleStyle: React.CSSProperties = {
  display: 'block',
  margin: '0 0 0.25rem',
  fontSize: '0.875rem',
  fontWeight: 700,
  lineHeight: 1.4,
}

const bodyStyle: React.CSSProperties = {
  display: 'block',
  margin: 0,
  fontSize: '0.8125rem',
  lineHeight: 1.6,
  color: 'var(--muted-foreground)',
}
