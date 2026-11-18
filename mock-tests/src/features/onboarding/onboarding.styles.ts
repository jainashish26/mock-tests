import type { CSSProperties } from 'react'

/**
 * Styles for /onboarding (funnel steps 3 and 8).
 *
 * The visual hierarchy is doing conversion work: the numbered rail at the top
 * shows progress before any form appears, so a returning parent sees what is
 * already done rather than being asked to start again. Completed steps render in
 * the success colour rather than disappearing, because visible progress is what
 * keeps a multi-step flow going.
 */

const BORDER = 'var(--border)'
const MUTED = 'var(--muted-foreground)'
const BRAND = 'var(--primary, #194bfb)'
const SUCCESS = '#059669'

export const ONBOARDING_STYLES: Record<string, CSSProperties> = {
  page: {
    maxWidth: '48rem',
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
    background: 'rgba(25,75,251,0.1)',
    color: BRAND,
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

  progressList: {
    listStyle: 'none',
    display: 'grid',
    gap: '0.625rem',
    gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))',
    margin: 0,
    padding: 0,
  },
  stepItem: {
    display: 'flex',
    gap: '0.75rem',
    alignItems: 'flex-start',
    padding: '0.875rem 1rem',
    borderRadius: '0.875rem',
    border: `1px solid ${BORDER}`,
    background: 'var(--card)',
  },
  stepIndex: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: '1.5rem',
    height: '1.5rem',
    borderRadius: '9999px',
    fontSize: '0.75rem',
    fontWeight: 800,
  },
  stepIndexDone: { background: SUCCESS, color: '#ffffff' },
  stepIndexPending: { background: 'var(--muted, #f1f5f9)', color: MUTED },
  stepText: { display: 'flex', flexDirection: 'column', gap: '0.125rem', minWidth: 0 },
  stepTitle: { fontSize: '0.875rem', fontWeight: 800, lineHeight: 1.35 },
  stepDetail: { fontSize: '0.75rem', lineHeight: 1.5, color: MUTED },

  card: {
    padding: '1.5rem',
    borderRadius: '1.25rem',
    border: `1px solid ${BORDER}`,
    background: 'var(--card)',
  },
  cardHeader: {
    display: 'flex',
    gap: '0.875rem',
    alignItems: 'flex-start',
    marginBottom: '1.25rem',
  },
  cardIcon: { flexShrink: 0, marginTop: '0.125rem', color: BRAND },
  cardTitle: { margin: '0 0 0.375rem', fontSize: '1.0625rem', fontWeight: 800 },
  cardSub: { margin: 0, fontSize: '0.8125rem', lineHeight: 1.65, color: MUTED },

  formGrid: {
    display: 'grid',
    gap: '1rem',
    gridTemplateColumns: 'repeat(auto-fit, minmax(18rem, 1fr))',
  },

  buttonRow: { display: 'flex', gap: '0.625rem', flexWrap: 'wrap' },
  primaryButton: {
    display: 'inline-block',
    padding: '0.75rem 1.375rem',
    borderRadius: '9999px',
    background: BRAND,
    color: '#ffffff',
    fontSize: '0.875rem',
    fontWeight: 800,
    textDecoration: 'none',
  },
  ghostButton: {
    display: 'inline-block',
    padding: '0.75rem 1.375rem',
    borderRadius: '9999px',
    border: `1px solid ${BORDER}`,
    background: 'var(--card)',
    color: 'var(--foreground)',
    fontSize: '0.875rem',
    fontWeight: 700,
    textDecoration: 'none',
  },

  privacyNote: {
    margin: 0,
    textAlign: 'center',
    fontSize: '0.8125rem',
    lineHeight: 1.6,
    color: MUTED,
  },
}
