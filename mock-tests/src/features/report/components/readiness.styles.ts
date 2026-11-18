import type { CSSProperties } from 'react'

/**
 * Styles for the readiness report (funnel step 4).
 *
 * Two visual rules carry the conversion logic:
 *
 * 1. FREE CONTENT LOOKS FINISHED, NOT CRIPPLED. The score, bands and topic gaps
 *    are rendered at full weight with no "locked" styling. A free tier that looks
 *    broken communicates "this product is broken".
 * 2. LOCKED CONTENT IS VISIBLE AND DESCRIBED. The paid panels are rendered as
 *    real cards with a lock, a name and a sentence explaining what they would
 *    tell you. An absent feature cannot be wanted; a described one can.
 */

const SUCCESS = '#059669'
const MUTED = 'var(--muted-foreground)'
const BORDER = 'var(--border)'

export const READINESS_STYLES: Record<string, CSSProperties> = {
  page: {
    maxWidth: '52rem',
    margin: '0 auto',
    padding: '2rem 1.25rem 4rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '2rem',
  },

  header: { textAlign: 'center' },
  eyebrow: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.375rem',
    margin: '0 0 0.5rem',
    fontSize: '0.6875rem',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: MUTED,
  },
  h1: {
    margin: '0 0 0.375rem',
    fontSize: '2rem',
    fontWeight: 800,
    letterSpacing: '-0.03em',
    lineHeight: 1.15,
  },
  subhead: {
    margin: 0,
    fontSize: '0.875rem',
    color: MUTED,
  },

  scoreCard: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1.5rem',
    flexWrap: 'wrap',
    padding: '1.5rem 1.75rem',
    borderRadius: '1.25rem',
    border: `1px solid ${BORDER}`,
    background: 'var(--card)',
    boxShadow: '0 18px 44px -30px rgba(15,23,42,0.45)',
  },
  scoreLeft: { display: 'flex', flexDirection: 'column', gap: '0.125rem' },
  scoreEyebrow: {
    fontSize: '0.6875rem',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: MUTED,
  },
  scoreRow: { display: 'flex', alignItems: 'baseline', gap: '0.25rem' },
  scoreValue: {
    fontSize: '3.5rem',
    fontWeight: 800,
    lineHeight: 1,
    letterSpacing: '-0.04em',
    fontVariantNumeric: 'tabular-nums',
  },
  scoreMax: { fontSize: '1.25rem', fontWeight: 600, color: MUTED },
  scoreBand: { fontSize: '1rem', fontWeight: 700 },
  scoreNote: {
    margin: 0,
    maxWidth: '16rem',
    fontSize: '0.8125rem',
    lineHeight: 1.6,
    color: MUTED,
    textAlign: 'right',
  },

  h2: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    margin: '0 0 0.75rem',
    fontSize: '1.125rem',
    fontWeight: 800,
    letterSpacing: '-0.01em',
  },
  h2Icon: { color: '#dc2626' },
  sectionLede: {
    margin: '0 0 1rem',
    fontSize: '0.875rem',
    lineHeight: 1.65,
    color: MUTED,
  },

  examGrid: {
    display: 'grid',
    gap: '0.875rem',
    gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))',
  },
  examCard: {
    padding: '1.25rem',
    borderRadius: '1rem',
    border: `1px solid ${BORDER}`,
    background: 'var(--card)',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  examName: {
    margin: 0,
    fontSize: '0.8125rem',
    fontWeight: 700,
    lineHeight: 1.4,
    color: MUTED,
    minHeight: '2.25rem',
  },
  examScoreRow: { display: 'flex', alignItems: 'baseline', gap: '0.25rem' },
  examScore: {
    fontSize: '2.25rem',
    fontWeight: 800,
    lineHeight: 1,
    letterSpacing: '-0.03em',
    fontVariantNumeric: 'tabular-nums',
  },
  examMax: { fontSize: '0.9375rem', fontWeight: 600, color: MUTED },
  examBand: {
    alignSelf: 'flex-start',
    padding: '0.1875rem 0.625rem',
    borderRadius: '9999px',
    fontSize: '0.6875rem',
    fontWeight: 800,
    letterSpacing: '0.02em',
  },
  examSummary: {
    margin: '0.375rem 0 0',
    fontSize: '0.8125rem',
    lineHeight: 1.6,
    color: MUTED,
  },

  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  listItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1rem',
    padding: '0.875rem 1.125rem',
    borderRadius: '0.875rem',
    border: `1px solid ${BORDER}`,
    background: 'var(--card)',
  },
  listItemMain: { display: 'flex', flexDirection: 'column', gap: '0.125rem', minWidth: 0 },
  listItemTitle: { fontSize: '0.9375rem', fontWeight: 700 },
  listItemMeta: { fontSize: '0.75rem', color: MUTED },
  listItemRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.625rem',
    flexShrink: 0,
  },
  listItemValue: {
    fontSize: '1.25rem',
    fontWeight: 800,
    fontVariantNumeric: 'tabular-nums',
  },
  severity: {
    padding: '0.1875rem 0.5rem',
    borderRadius: '9999px',
    fontSize: '0.625rem',
    fontWeight: 800,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  },

  barTrack: {
    position: 'relative',
    height: '0.375rem',
    borderRadius: '9999px',
    background: 'var(--muted, #f1f5f9)',
    overflow: 'hidden',
    marginTop: '0.5rem',
  },
  barFill: {
    position: 'absolute',
    inset: 0,
    borderRadius: '9999px',
    background: SUCCESS,
  },
}

/**
 * Locked-panel styles (the step-6 paywall surface).
 *
 * Deliberately NOT greyed out or blurred. Blurring content is a dark pattern: it
 * hides what is being sold, which means the parent has to trust a claim rather
 * than evaluate it, and a parent who feels tricked does not buy - they leave and
 * tell the school group. These panels are legible, named and described, with a
 * visible lock and an honest explanation of why they are not open.
 */
export const LOCKED_STYLES: Record<string, CSSProperties> = {
  section: {
    padding: '1.5rem 1.5rem 1.75rem',
    borderRadius: '1.25rem',
    border: '1px solid var(--primary, #194bfb)',
    background: 'linear-gradient(180deg, rgba(25,75,251,0.05) 0%, var(--card) 60%)',
  },
  sectionHead: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '1rem',
    flexWrap: 'wrap',
    marginBottom: '1rem',
  },
  sectionTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    margin: '0 0 0.375rem',
    fontSize: '1.125rem',
    fontWeight: 800,
    letterSpacing: '-0.01em',
  },
  sectionLede: {
    margin: 0,
    maxWidth: '34rem',
    fontSize: '0.875rem',
    lineHeight: 1.65,
    color: MUTED,
  },
  attemptsPill: {
    flexShrink: 0,
    padding: '0.25rem 0.75rem',
    borderRadius: '9999px',
    background: 'var(--card)',
    border: `1px solid ${BORDER}`,
    fontSize: '0.75rem',
    fontWeight: 700,
    color: MUTED,
    whiteSpace: 'nowrap',
  },

  grid: {
    display: 'grid',
    gap: '0.75rem',
    gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))',
    margin: '0 0 1.5rem',
    padding: 0,
    listStyle: 'none',
  },
  card: {
    display: 'flex',
    gap: '0.75rem',
    alignItems: 'flex-start',
    padding: '1rem 1.125rem',
    borderRadius: '0.875rem',
    border: `1px solid ${BORDER}`,
    background: 'var(--card)',
  },
  cardIcon: {
    flexShrink: 0,
    marginTop: '0.125rem',
    color: MUTED,
  },
  cardTitle: {
    display: 'block',
    margin: '0 0 0.25rem',
    fontSize: '0.875rem',
    fontWeight: 700,
    lineHeight: 1.4,
  },
  cardBody: {
    margin: 0,
    fontSize: '0.8125rem',
    lineHeight: 1.6,
    color: MUTED,
  },

  ctaRow: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.625rem',
  },
  ctaPrimary: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.875rem 1.75rem',
    borderRadius: '9999px',
    background: 'var(--primary, #194bfb)',
    color: '#ffffff',
    fontSize: '1rem',
    fontWeight: 800,
    textDecoration: 'none',
    boxShadow: '0 14px 32px -16px rgba(25,75,251,0.7)',
  },
  ctaSecondary: {
    fontSize: '0.8125rem',
    color: MUTED,
    textDecoration: 'underline',
  },
  guaranteeNote: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.375rem',
    margin: 0,
    fontSize: '0.75rem',
    color: SUCCESS,
    fontWeight: 700,
  },
}

