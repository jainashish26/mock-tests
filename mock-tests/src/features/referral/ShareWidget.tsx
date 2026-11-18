'use client'

import { useState } from 'react'
import { Check, Copy, Share2 } from 'lucide-react'
import { trackClientEvent } from '@/features/monetisation/track-client'

/**
 * The share widget for /parent/refer (funnel step 1).
 *
 * WHY THE LINK IS PRE-SELECTED AND ONE TAP
 *   Every extra step between "I want to share this" and "it is shared" loses a
 *   large fraction of sharers. A parent is usually doing this in a 30-second gap
 *   at school pickup; a copy button that requires them to select text first does
 *   not survive that context.
 *
 *   The confirmation is visible and explicit ("Copied") because an uncertain
 *   sharer pastes nothing. Feedback here is not polish, it is the conversion.
 */

export interface ShareWidgetProps {
  shareUrl: string
  code: string
  /** Pre-written message the parent can send as-is. */
  suggestedMessage: string
  referrerBenefitLabel: string
  refereeBenefitLabel: string
}

export function ShareWidget({
  shareUrl,
  code,
  suggestedMessage,
  referrerBenefitLabel,
  refereeBenefitLabel,
}: ShareWidgetProps) {
  const [copied, setCopied] = useState<'link' | 'message' | null>(null)

  const copy = async (value: string, kind: 'link' | 'message') => {
    try {
      // The async Clipboard API needs a secure context; older Safari and any
      // http:// preview deployment does not have it, so fall back to execCommand
      // rather than showing a button that silently does nothing.
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
      } else {
        const area = document.createElement('textarea')
        area.value = value
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        document.execCommand('copy')
        document.body.removeChild(area)
      }

      setCopied(kind)
      await trackClientEvent('REFERRAL_SHARED', { surface: 'referral_share', kind, code })
      window.setTimeout(() => setCopied(null), 2500)
    } catch {
      // A failed copy must not look like a success. Leave the state alone so the
      // parent can select and copy manually.
      setCopied(null)
    }
  }

  const message = `${suggestedMessage}\n\n${shareUrl}`

  return (
    <div style={wrapStyle}>
      <div style={rewardRowStyle}>
        <div style={rewardBoxStyle}>
          <span style={rewardLabelStyle}>They get</span>
          <strong style={rewardValueStyle}>{refereeBenefitLabel}</strong>
        </div>
        <div style={rewardBoxStyle}>
          <span style={rewardLabelStyle}>You get</span>
          <strong style={rewardValueStyle}>{referrerBenefitLabel}</strong>
        </div>
      </div>

      <label style={fieldLabelStyle} htmlFor="share-link">
        Your referral link
      </label>
      <div style={linkRowStyle}>
        <input
          id="share-link"
          readOnly
          value={shareUrl}
          onFocus={(event) => event.currentTarget.select()}
          style={linkInputStyle}
        />
        <button
          type="button"
          onClick={() => void copy(shareUrl, 'link')}
          style={copyButtonStyle}
          aria-live="polite"
        >
          {copied === 'link' ? (
            <Check size={15} aria-hidden="true" />
          ) : (
            <Copy size={15} aria-hidden="true" />
          )}
          {copied === 'link' ? 'Copied' : 'Copy'}
        </button>
      </div>

      <label style={fieldLabelStyle} htmlFor="share-message">
        Or send this message
      </label>
      <textarea
        id="share-message"
        readOnly
        rows={4}
        value={message}
        onFocus={(event) => event.currentTarget.select()}
        style={messageStyle}
      />
      <div style={actionRowStyle}>
        <button type="button" onClick={() => void copy(message, 'message')} style={copyButtonStyle}>
          {copied === 'message' ? (
            <Check size={15} aria-hidden="true" />
          ) : (
            <Share2 size={15} aria-hidden="true" />
          )}
          {copied === 'message' ? 'Message copied' : 'Copy message'}
        </button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noopener noreferrer"
          style={ghostLinkStyle}
        >
          WhatsApp
        </a>
        <a
          href={`mailto:?subject=${encodeURIComponent(
            'Exam practice that tells you what to fix'
          )}&body=${encodeURIComponent(message)}`}
          style={ghostLinkStyle}
        >
          Email
        </a>
      </div>

      <p style={codeLineStyle}>
        Their code is <code style={codeChipStyle}>{code}</code> &mdash; it is already in the link, so
        they do not need to type it.
      </p>
    </div>
  )
}

const BORDER = 'var(--border)'
const MUTED = 'var(--muted-foreground)'
const SUCCESS = '#059669'

const wrapStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.625rem' }

const rewardRowStyle: React.CSSProperties = {
  display: 'grid',
  gap: '0.625rem',
  gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))',
  marginBottom: '0.75rem',
}

const rewardBoxStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.125rem',
  padding: '0.75rem 1rem',
  borderRadius: '0.75rem',
  background: 'rgba(5,150,105,0.08)',
  border: '1px solid rgba(5,150,105,0.22)',
}

const rewardLabelStyle: React.CSSProperties = {
  fontSize: '0.6875rem',
  fontWeight: 800,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: MUTED,
}

const rewardValueStyle: React.CSSProperties = {
  fontSize: '0.9375rem',
  fontWeight: 800,
  color: SUCCESS,
}

const fieldLabelStyle: React.CSSProperties = { fontSize: '0.8125rem', fontWeight: 700 }

const linkRowStyle: React.CSSProperties = { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }

const linkInputStyle: React.CSSProperties = {
  flex: '1 1 16rem',
  minWidth: 0,
  padding: '0.625rem 0.75rem',
  borderRadius: '0.625rem',
  border: `1px solid ${BORDER}`,
  background: 'var(--muted, #f8fafc)',
  color: 'var(--foreground)',
  fontSize: '0.8125rem',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
}

const messageStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.75rem',
  borderRadius: '0.625rem',
  border: `1px solid ${BORDER}`,
  background: 'var(--muted, #f8fafc)',
  color: 'var(--foreground)',
  fontSize: '0.8125rem',
  lineHeight: 1.6,
  resize: 'vertical',
  fontFamily: 'inherit',
}

const actionRowStyle: React.CSSProperties = { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }

const copyButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.375rem',
  padding: '0.625rem 1.125rem',
  borderRadius: '9999px',
  border: 0,
  background: 'var(--primary, #194bfb)',
  color: '#ffffff',
  fontSize: '0.8125rem',
  fontWeight: 800,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const ghostLinkStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0.625rem 1.125rem',
  borderRadius: '9999px',
  border: `1px solid ${BORDER}`,
  background: 'var(--card)',
  color: 'var(--foreground)',
  fontSize: '0.8125rem',
  fontWeight: 700,
  textDecoration: 'none',
  whiteSpace: 'nowrap',
}

const codeLineStyle: React.CSSProperties = {
  margin: '0.5rem 0 0',
  fontSize: '0.75rem',
  color: MUTED,
}

const codeChipStyle: React.CSSProperties = {
  padding: '0.125rem 0.4375rem',
  borderRadius: '0.375rem',
  background: 'var(--muted, #f1f5f9)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontWeight: 700,
  letterSpacing: '0.08em',
  color: 'var(--foreground)',
}

