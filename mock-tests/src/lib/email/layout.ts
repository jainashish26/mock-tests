import { CONTACT, SITE_NAME, SITE_URL } from '@/lib/seo/site-config'
import { unsubscribeUrl } from '@/lib/funnel/unsubscribe'

/**
 * Shared email layout + copy primitives.
 *
 * COPY PRINCIPLES (and why each is a rule rather than a matter of taste)
 *
 * 1. ONE call to action per email. Every additional link roughly halves the
 *    click-through on the one that matters. Where a secondary action is
 *    genuinely needed (unsubscribe, pause) it goes in the footer, visually
 *    separated, never inline with the primary button.
 *
 * 2. Value before ask. The readiness email delivers the whole diagnosis and
 *    asks for nothing. The offer email comes after two completed tests, when
 *    the parent has already received something. Reversing that order is the
 *    most common way a freemium funnel dies.
 *
 * 3. Name the loss, not the gain. "{child} is at 43% on Fractions" moves a
 *    parent more than "unlock deeper analytics". Loss aversion is roughly twice
 *    the strength of the equivalent gain, and a topic gap is a concrete loss.
 *
 * 4. A real deadline. The step-5 mock expires in 7 days and the step-7 offer
 *    has a per-user window. Deadlines that reset on every page load train
 *    parents to ignore them; these are stored server-side in `funnel_state`.
 *
 * 5. Risk reversal next to the price. The 14-day guarantee appears in the same
 *    visual block as the amount, because price anxiety is exactly what the
 *    guarantee exists to answer. Separating them wastes it.
 *
 * 6. Table-based HTML with inline styles. Gmail, Outlook and Apple Mail still
 *    disagree about flexbox and CSS custom properties. Email markup is
 *    deliberately archaic - this is not a place to apply the site's Tailwind
 *    conventions.
 */

/** Brand colour, duplicated from the CSS token because email cannot read it. */
const BRAND = '#194bfb'
const INK = '#0f172a'
const MUTED = '#64748b'
const SUCCESS = '#059669'
const WARNING = '#d97706'
const DANGER = '#dc2626'

/** Palette exported so the individual templates stay visually consistent. */
export const EMAIL_COLOURS = { BRAND, INK, MUTED, SUCCESS, WARNING, DANGER } as const

/** Absolute link, so clicks work from any mail client. */
export function link(
  path: string,
  query?: Record<string, string | number | undefined>
): string {
  const base = path.startsWith('http')
    ? path
    : `${SITE_URL}${path.startsWith('/') ? '' : '/'}${path}`
  if (!query) return base

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${base}${base.includes('?') ? '&' : '?'}${qs}` : base
}

/**
 * Escape user-supplied text before it reaches HTML.
 *
 * Child usernames are generated, but the target exam name is typed by a parent
 * into a free-text field, so it is attacker-controllable input rendered into an
 * email. Escaping is not optional here.
 */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Format a countdown target as a human date.
 *
 * en-AU with a weekday: "by 9pm Tuesday 4 March" reads as a real deadline,
 * whereas an ISO timestamp reads as a system message and gets ignored.
 */
export function formatDeadline(iso: string | null | undefined): string {
  if (!iso) return 'soon'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'soon'
  return date.toLocaleString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Australia/Sydney',
  })
}

/** Whole-day countdown, floored at zero, for "X days left". */
export function daysRemaining(iso: string | null | undefined): number {
  if (!iso) return 0
  const ms = new Date(iso).getTime() - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return Math.floor(ms / 86_400_000)
}

/** Format cents as AUD, matching `formatMoney` in the pricing catalog. */
export function money(cents: number, currency = 'AUD'): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

interface LayoutOptions {
  preheader: string
  body: string
  /** Footer note, kept out of the main flow so it cannot compete with the CTA. */
  footerNote?: string
  userId?: string
}

/**
 * Shared shell.
 *
 * The preheader is the ~90 characters a mail client shows beside the subject in
 * the inbox list. It is the second-most-read piece of copy in the whole email
 * and is almost always wasted on "View in browser". Set it deliberately.
 */
export function emailLayout({ preheader, body, footerNote, userId }: LayoutOptions): string {
  // A signed one-click link is preferred: it is what Gmail's unsubscribe button
  // needs, and it cannot be forged. Falling back to the settings page keeps the
  // footer honest when no signing key is configured.
  const signedUrl = userId ? unsubscribeUrl(userId) : null
  const unsubscribe = signedUrl
    ? `<a href="${esc(signedUrl)}" style="color:${MUTED};text-decoration:underline;">Unsubscribe</a>`
    : `<a href="${esc(link('/parent/settings'))}" style="color:${MUTED};text-decoration:underline;">Email preferences</a>`

  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${esc(preheader)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;-webkit-text-size-adjust:100%;">
<!-- Preheader: hidden visually but read by every inbox list. Must not simply
     repeat the subject line, or the preview slot is wasted. -->
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0;font-size:1px;line-height:1px;">
${esc(preheader)}
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">

<tr><td style="background:${BRAND};padding:20px 32px;">
<a href="${esc(link('/'))}" style="color:#ffffff;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:17px;font-weight:800;letter-spacing:-0.01em;">
${esc(SITE_NAME)}
</a>
</td></tr>

<tr><td style="padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK};font-size:15px;line-height:1.65;">
${body}
</td></tr>

<tr><td style="padding:20px 32px 28px;border-top:1px solid #e2e8f0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:${MUTED};">
${footerNote ? `<p style="margin:0 0 10px;">${footerNote}</p>` : ''}
<p style="margin:0 0 10px;">
You are receiving this because you created a ${esc(SITE_NAME)} account.
${unsubscribe} &nbsp;&middot;&nbsp;
<a href="${esc(link('/contact'))}" style="color:${MUTED};text-decoration:underline;">Contact us</a>
</p>
<p style="margin:0;">
${esc(SITE_NAME)} &middot; ${esc(CONTACT.country)} &middot;
<a href="${esc(link('/privacy-policy'))}" style="color:${MUTED};text-decoration:underline;">Privacy</a> &middot;
<a href="${esc(link('/terms'))}" style="color:${MUTED};text-decoration:underline;">Terms</a>
</p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`
}

/**
 * Primary button.
 *
 * The visible URL underneath is not decoration: a parent being asked to enter
 * card details wants to see where the link goes before clicking, and hiding it
 * costs more trust than the extra line of copy.
 */
export function ctaButton(href: string, label: string, colour: string = BRAND): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
<tr><td align="center" style="border-radius:9999px;background:${colour};">
<a href="${esc(href)}" style="display:inline-block;padding:14px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:9999px;">${esc(label)}</a>
</td></tr>
</table>
<p style="margin:-12px 0 24px;text-align:center;font-size:12px;color:${MUTED};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;word-break:break-all;">
<a href="${esc(href)}" style="color:${MUTED};">${esc(href)}</a>
</p>`
}

/** Section heading inside a template body. */
export function h2(text: string): string {
  return `<h2 style="margin:28px 0 10px;font-size:16px;font-weight:800;color:${INK};letter-spacing:-0.01em;">${esc(text)}</h2>`
}

/** Bordered callout, used for the score block and the guarantee. */
export function callout(inner: string, accent: string = BRAND): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
<tr><td style="border:1px solid #e2e8f0;border-left:4px solid ${accent};border-radius:10px;padding:16px 18px;background:#f8fafc;">
${inner}
</td></tr></table>`
}

/** A single row in a two-column stat/gap list. */
export function listRow(label: string, value: string, colour: string = INK): string {
  return `<tr>
<td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:${MUTED};">${esc(label)}</td>
<td align="right" style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;font-weight:700;color:${colour};">${esc(value)}</td>
</tr>`
}

/**
 * Wrapped list table - email needs a real table for reliable alignment.
 *
 * Accepts either an array of row markup or an already-joined string, because
 * callers that build rows conditionally find one or the other more natural and
 * forcing a single shape produces `.join('')` noise at every call site.
 */
export function listTable(rows: string[] | string): string {
  const inner = Array.isArray(rows) ? rows.join('') : rows
  if (!inner.trim()) return ''
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0 20px;border-collapse:collapse;">${inner}</table>`
}

