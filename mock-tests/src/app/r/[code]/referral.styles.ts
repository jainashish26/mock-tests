import type { CSSProperties } from 'react'

/**
 * Styles for the referral landing page.
 *
 * Kept visually continuous with the marketing pages rather than styled like a
 * promotional landing page. A referred visitor is comparing this against what
 * their friend described; a page that looks like an ad contradicts the
 * recommendation that brought them here.
 */

const BRAND = 'var(--primary, #194bfb)'
const MUTED = 'var(--muted-foreground)'
const BORDER = 'var(--border)'
const SUCCESS = '#059669'

export const REFERRAL_STYLES: Record<string, CSSProperties> = {
  page: {
    maxWidth: '44rem',
    margin: '0 auto',
    padding: '3rem 1.25rem 4rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '2rem',
  },

  hero: { textAlign: 'center' },
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
    marginBottom: '1.25rem',
  },
  h1: {
    margin: '0 0 1rem',
    fontSize: 'clamp(1.75rem, 5vw, 2.5rem)',
    fontWeight: 800,
    lineHeight: 1.15,
    letterSpacing: '-0.03em',
  },
  lede: {
    margin: '0 auto 1.75rem',
    maxWidth: '34rem',
    fontSize: '1.0625rem',
    lineHeight: 1.7,
    color: MUTED,
  },

  rewardCard: {
    margin: '0 auto 1.75rem',
    maxWidth: '26rem',
    padding: '1.25rem 1.5rem',
    borderRadius: '1rem',
    border: `1px solid ${BORDER}`,
    background: 'var(--card)',
    textAlign: 'left',
  },
  rewardRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '1rem',
    padding: '0.5rem 0',
    borderBottom: `1px solid ${BORDER}`,
    fontSize: '0.875rem',
  },
  rewardLabel: { fontWeight: 700, color: MUTED },
  rewardValue: { fontWeight: 800, color: SUCCESS, textAlign: 'right' },
  rewardNote: {
    margin: '0.75rem 0 0',
    fontSize: '0.75rem',
    lineHeight: 1.6,
    color: MUTED,
  },

  ctaRow: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' },
  ctaPrimary: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '1rem 2rem',
    borderRadius: '9999px',
    background: BRAND,
    color: '#ffffff',
    fontSize: '1.0625rem',
    fontWeight: 800,
    textDecoration: 'none',
    boxShadow: '0 16px 36px -18px rgba(25,75,251,0.75)',
  },
  ctaNote: {
    margin: 0,
    maxWidth: '28rem',
    fontSize: '0.8125rem',
    lineHeight: 1.6,
    color: MUTED,
  },

  codeLine: { margin: '1.5rem 0 0', fontSize: '0.8125rem', color: MUTED },
  codeChip: {
    padding: '0.1875rem 0.5rem',
    borderRadius: '0.375rem',
    background: 'var(--muted, #f1f5f9)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.8125rem',
    fontWeight: 700,
    letterSpacing: '0.08em',
    color: 'var(--foreground)',
  },

  proof: {
    padding: '1.75rem',
    borderRadius: '1.25rem',
    border: `1px solid ${BORDER}`,
    background: 'var(--muted, #f8fafc)',
  },
  h2: { margin: '0 0 1rem', fontSize: '1.125rem', fontWeight: 800, letterSpacing: '-0.01em' },
  list: {
    listStyle: 'none',
    margin: '0 0 1.25rem',
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.625rem',
  },
  listItem: {
    display: 'flex',
    gap: '0.625rem',
    alignItems: 'flex-start',
    fontSize: '0.9375rem',
    lineHeight: 1.55,
  },
  check: { flexShrink: 0, marginTop: '0.15rem', color: SUCCESS },
  privacyNote: {
    display: 'flex',
    gap: '0.5rem',
    alignItems: 'flex-start',
    margin: 0,
    fontSize: '0.8125rem',
    lineHeight: 1.6,
    color: MUTED,
  },
}
