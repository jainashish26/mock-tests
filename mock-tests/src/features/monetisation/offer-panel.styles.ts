import type { CSSProperties } from 'react'

/**
 * Styles for the step-7 offer panels.
 *
 * A plain object of `CSSProperties` rather than a CSS module because these panels
 * are server components and the values reference the same CSS custom properties
 * the rest of the app uses. Keeping them in a separate file stops the component
 * from becoming half markup, half style literals.
 *
 * The palette deliberately matches the site's existing tokens (`--primary`,
 * `--muted-foreground`, `--border`) so the offer page does not look like a
 * third-party landing page bolted onto the product. A conversion page that
 * visually departs from the app it belongs to reads as an ad, and ads get closed.
 */

const SUCCESS = '#059669'
const DANGER = '#dc2626'

export const PANEL_STYLES: Record<string, CSSProperties> = {
  page: {
    maxWidth: '44rem',
    margin: '0 auto',
    padding: '2rem 1.25rem 4rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.25rem',
  },

  diagnosis: {
    padding: '1.25rem 1.5rem',
    borderRadius: '1rem',
    border: '1px solid var(--border)',
    borderLeft: '4px solid var(--primary, #194bfb)',
    background: 'var(--muted, #f8fafc)',
  },
  eyebrow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.375rem',
    margin: '0 0 0.5rem',
    fontSize: '0.6875rem',
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--muted-foreground)',
  },
  diagnosisTitle: {
    margin: '0 0 0.5rem',
    fontSize: '1.25rem',
    fontWeight: 800,
    lineHeight: 1.3,
    letterSpacing: '-0.01em',
    color: 'var(--foreground)',
  },
  diagnosisBody: {
    margin: 0,
    fontSize: '0.9375rem',
    lineHeight: 1.65,
    color: 'var(--muted-foreground)',
  },

  card: {
    position: 'relative',
    padding: '2rem 1.75rem',
    borderRadius: '1.25rem',
    border: '1px solid var(--primary, #194bfb)',
    background: 'var(--card)',
    boxShadow: '0 20px 50px -28px rgba(25,75,251,0.45)',
  },

  offerBadge: {
    position: 'absolute',
    top: '-0.75rem',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.3125rem',
    padding: '0.25rem 0.75rem',
    borderRadius: '9999px',
    background: 'var(--primary, #194bfb)',
    color: '#ffffff',
    fontSize: '0.6875rem',
    fontWeight: 800,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  },
  lockBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.3125rem',
    padding: '0.25rem 0.75rem',
    borderRadius: '9999px',
    background: 'var(--muted, #f1f5f9)',
    color: 'var(--muted-foreground)',
    fontSize: '0.6875rem',
    fontWeight: 800,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    marginBottom: '1rem',
  },

  title: {
    margin: '0.5rem 0 0.5rem',
    fontSize: '1.625rem',
    fontWeight: 800,
    lineHeight: 1.25,
    letterSpacing: '-0.02em',
    color: 'var(--foreground)',
    textAlign: 'center',
  },
  lede: {
    margin: '0 0 1.25rem',
    fontSize: '0.9375rem',
    lineHeight: 1.65,
    color: 'var(--muted-foreground)',
    textAlign: 'center',
  },

  priceRow: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: '0.625rem',
    flexWrap: 'wrap',
  },
  price: {
    fontSize: '2.75rem',
    fontWeight: 800,
    lineHeight: 1,
    letterSpacing: '-0.03em',
    color: 'var(--primary, #194bfb)',
  },
  strike: {
    fontSize: '1.125rem',
    fontWeight: 600,
    color: 'var(--muted-foreground)',
  },
  save: {
    padding: '0.1875rem 0.5rem',
    borderRadius: '9999px',
    background: 'rgba(5,150,105,0.12)',
    color: SUCCESS,
    fontSize: '0.75rem',
    fontWeight: 800,
  },
  priceNote: {
    margin: '0.5rem 0 0',
    textAlign: 'center',
    fontSize: '0.8125rem',
    color: 'var(--muted-foreground)',
  },

  countdownBlock: {
    margin: '1.25rem 0',
    padding: '1rem',
    borderRadius: '0.875rem',
    background: 'rgba(220,38,38,0.05)',
    border: '1px solid rgba(220,38,38,0.18)',
  },
  countdownLabel: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.375rem',
    margin: 0,
    fontSize: '0.75rem',
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: DANGER,
  },

  includes: {
    listStyle: 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.625rem',
    margin: '1.5rem 0',
    padding: 0,
  },
  includeItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.625rem',
    fontSize: '0.9375rem',
    lineHeight: 1.55,
    color: 'var(--foreground)',
  },
  check: {
    flexShrink: 0,
    marginTop: '0.15rem',
    color: SUCCESS,
  },

  // The guarantee sits adjacent to the price rather than in a footer because it
  // is the answer to the question the price just raised. Separating them wastes
  // the single most effective objection-handling element on the page.
  guarantee: {
    display: 'flex',
    gap: '0.75rem',
    alignItems: 'flex-start',
    padding: '1rem 1.125rem',
    borderRadius: '0.875rem',
    background: 'rgba(5,150,105,0.07)',
    border: '1px solid rgba(5,150,105,0.22)',
    marginBottom: '1.5rem',
  },
  guaranteeIcon: {
    flexShrink: 0,
    marginTop: '0.125rem',
    color: SUCCESS,
  },
  guaranteeTitle: {
    display: 'block',
    fontSize: '0.9375rem',
    fontWeight: 800,
    color: SUCCESS,
    marginBottom: '0.25rem',
  },
  guaranteeBody: {
    margin: 0,
    fontSize: '0.8125rem',
    lineHeight: 1.65,
    color: 'var(--muted-foreground)',
  },
  termsLink: {
    color: 'var(--muted-foreground)',
    textDecoration: 'underline',
  },

  finePrint: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.375rem',
    margin: '1rem 0 0',
    fontSize: '0.75rem',
    color: 'var(--muted-foreground)',
    textAlign: 'center',
  },

  steps: {
    margin: '0 0 1.5rem',
    paddingLeft: '1.25rem',
    fontSize: '0.9375rem',
    lineHeight: 1.75,
    color: 'var(--muted-foreground)',
  },

  linkButton: {
    display: 'inline-block',
    padding: '0.8125rem 1.5rem',
    borderRadius: '9999px',
    background: 'var(--primary, #194bfb)',
    color: '#ffffff',
    fontSize: '0.9375rem',
    fontWeight: 700,
    textAlign: 'center',
    textDecoration: 'none',
  },
  ghostButton: {
    display: 'inline-block',
    padding: '0.8125rem 1.5rem',
    borderRadius: '9999px',
    border: '1px solid var(--border)',
    background: 'var(--card)',
    color: 'var(--foreground)',
    fontSize: '0.9375rem',
    fontWeight: 700,
    textAlign: 'center',
    textDecoration: 'none',
  },
  buttonRow: {
    display: 'flex',
    gap: '0.75rem',
    flexWrap: 'wrap',
  },
}

