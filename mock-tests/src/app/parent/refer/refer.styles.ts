import type { CSSProperties } from 'react'

/**
 * Styles for /parent/refer.
 *
 * The reward boxes lead with "They get" before "You get". That ordering is a
 * deliberate conversion choice, not a layout accident: a parent reading their own
 * benefit first is reminded that they are the one profiting, which is exactly the
 * framing that makes sharing feel transactional.
 */

const BORDER = 'var(--border)'
const MUTED = 'var(--muted-foreground)'
const BRAND = 'var(--primary, #194bfb)'
const SUCCESS = '#059669'

export const REFER_STYLES: Record<string, CSSProperties> = {
  page: {
    maxWidth: '44rem',
    margin: '0 auto',
    padding: '2.5rem 1.25rem 4rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
  },

  header: { textAlign: 'center' },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.375rem',
    padding: '0.3125rem 0.875rem',
    borderRadius: '9999px',
    background: 'rgba(5,150,105,0.1)',
    color: SUCCESS,
    fontSize: '0.6875rem',
    fontWeight: 800,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    marginBottom: '1rem',
  },
  h1: {
    margin: '0 0 0.75rem',
    fontSize: 'clamp(1.5rem, 4vw, 2rem)',
    fontWeight: 800,
    lineHeight: 1.2,
    letterSpacing: '-0.025em',
  },
  lede: {
    margin: '0 auto',
    maxWidth: '34rem',
    fontSize: '0.9375rem',
    lineHeight: 1.7,
    color: MUTED,
  },

  card: {
    padding: '1.5rem',
    borderRadius: '1.25rem',
    border: `1px solid ${BORDER}`,
    background: 'var(--card)',
  },
  cardHeader: {
    display: 'flex',
    gap: '0.625rem',
    alignItems: 'center',
    marginBottom: '1rem',
  },
  cardIcon: { color: BRAND },
  cardTitle: { margin: '0 0 1rem', fontSize: '1.0625rem', fontWeight: 800 },

  statGrid: {
    display: 'grid',
    gap: '0.75rem',
    gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))',
  },
  statBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.125rem',
    padding: '1rem',
    borderRadius: '0.875rem',
    border: `1px solid ${BORDER}`,
    background: 'var(--muted, #f8fafc)',
  },
  statValue: {
    fontSize: '1.75rem',
    fontWeight: 800,
    lineHeight: 1,
    letterSpacing: '-0.03em',
    fontVariantNumeric: 'tabular-nums',
  },
  statLabel: { fontSize: '0.75rem', lineHeight: 1.4, color: MUTED },

  pendingNote: {
    margin: '1rem 0 0',
    padding: '0.75rem 1rem',
    borderRadius: '0.75rem',
    background: 'rgba(217,119,6,0.08)',
    border: '1px solid rgba(217,119,6,0.22)',
    fontSize: '0.8125rem',
    lineHeight: 1.6,
    color: '#b45309',
  },
  emptyNote: {
    margin: '1rem 0 0',
    fontSize: '0.8125rem',
    lineHeight: 1.65,
    color: MUTED,
  },

  finePrint: {
    margin: 0,
    textAlign: 'center',
    fontSize: '0.75rem',
    lineHeight: 1.6,
    color: MUTED,
  },
}
