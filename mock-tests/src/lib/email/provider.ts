import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logging/logger'
import { unsubscribeUrl } from '@/lib/funnel/unsubscribe'
import { CONTACT, SITE_NAME } from '@/lib/seo/site-config'

/**
 * Transactional email delivery.
 *
 * WHY A HAND-ROLLED FETCH CLIENT RATHER THAN AN SDK
 *   The repo already talks to Upstash QStash and DeepSeek over plain HTTP, and
 *   `src/lib/pricing/catalog.ts` sets the precedent of degrading to a no-op
 *   when credentials are missing so `next build` stays green. Adding an email
 *   SDK would introduce a dependency whose only job here is one POST request.
 *   Resend's API is a single JSON endpoint; calling it directly keeps the
 *   failure modes visible and the bundle unchanged.
 *
 * WHY EVERY SEND IS LOGGED BEFORE IT IS ATTEMPTED
 *   `email_log` has UNIQUE(user_id, template, dedupe_key). Inserting first and
 *   treating a constraint violation as "already sent" makes every lifecycle
 *   email exactly-once even when QStash retries the job, the cron fires twice,
 *   or two workers race over the same user. Sending first and logging
 *   afterwards cannot give that guarantee.
 */

/** Provider selection. `console` is the zero-config development fallback. */
export type EmailProvider = 'resend' | 'console'

/**
 * Resend is only usable when BOTH the key and a sender address exist.
 *
 * Checking the key alone was wrong while the sender had a hardcoded fictional
 * default, and it is wrong now that the default is gone: a configured key with no
 * resolvable `From:` is a guaranteed 4xx from Resend's API, because the domain
 * cannot be verified. Falling back to `console` means that misconfiguration
 * degrades the same way every other unconfigured integration in this repo does —
 * the message is logged and the run continues — instead of failing every
 * lifecycle email at the transport for a reason the log would obscure.
 *
 * `isEmailConfigured()` is the health check, so it inherits the same rule and
 * reports the honest answer: this deployment cannot send mail.
 */
export function resolveEmailProvider(): EmailProvider {
  return process.env.RESEND_API_KEY?.trim() && resolveFromAddress() ? 'resend' : 'console'
}


export function isEmailConfigured(): boolean {
  return resolveEmailProvider() === 'resend'
}

/**
 * From address. `null` when nothing usable is configured.
 *
 * Used to fall back to `CONTACT.supportEmail`, which was a hardcoded
 * `support@mocktestspro.com.au` on a domain nobody owns — so every outbound
 * lifecycle email was addressed `From:` a mailbox that cannot receive, and
 * Resend would have rejected it outright for failing domain verification. That
 * coupling was deliberate and is documented in `site-config.ts`: the sender must
 * never disagree with the address published in the Privacy Policy, because a
 * mismatch is both confusing for parents and an Australian Privacy Principle
 * problem. The right response to that rule is for both to go unset together,
 * which is what happens now — not for the policy to name a dead address and the
 * mailer to send from it.
 */
export function resolveFromAddress(): string | null {
  const custom = process.env.EMAIL_FROM?.trim()
  if (custom) return custom
  return CONTACT.supportEmail ? `${SITE_NAME} <${CONTACT.supportEmail}>` : null
}

/** Reply-To, so a parent who hits reply reaches a monitored mailbox. */
export function resolveReplyTo(): string | null {
  return process.env.EMAIL_REPLY_TO?.trim() || CONTACT.supportEmail
}


export interface SendEmailInput {
  to: string
  subject: string
  html: string
  text?: string
  /** Owner of the email, for the idempotency key. Optional for anonymous sends. */
  userId?: string | null
  /** Template key, e.g. 'readiness_report'. Required for idempotency. */
  template: string
  /** Discriminator when one template legitimately sends more than once. */
  dedupeKey?: string
  /** Reply-To override. */
  replyTo?: string
  /** Extra headers. */
  headers?: Record<string, string>
}

export interface SendEmailResult {
  ok: boolean
  skipped: boolean
  provider: EmailProvider
  messageId?: string
  error?: string
}

/** Shape of a Resend JSON response. */
interface ResendResponse {
  id?: string
  message?: string
}

/**
 * RFC-8058 one-click unsubscribe headers.
 *
 * Returns an empty object when no signed URL can be produced, so the send still
 * goes out rather than failing on a header. A missing List-Unsubscribe is a
 * deliverability concern, not a correctness one, and blocking a parent's
 * readiness report over it would be the wrong trade.
 */
function unsubscribeHeader(userId: string | null | undefined): Record<string, string> {
  if (!userId) return {}
  const url = unsubscribeUrl(userId)
  if (!url) return {}
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}

/**
 * Basic RFC-822 shape check.
 *
 * Deliberately not a full validator: the goal is to reject obvious garbage
 * (empty, no @, whitespace, multiple addresses) before it reaches a provider
 * that would bill for the attempt or, worse, damage sender reputation. A high
 * bounce rate is the fastest way to lose deliverability for every other email.
 */
export function isPlausibleEmail(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (trimmed.length < 5 || trimmed.length > 254) return false
  if (trimmed.includes(',') || trimmed.includes(';') || trimmed.includes(' ')) return false
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(trimmed)
}

/**
 * Minimal HTML -> text fallback for callers that only supplied HTML.
 *
 * Not a real parser - it exists so the multipart alternative is never empty.
 * Templates should still pass an explicit `text` where the wording matters.
 */
export function stripToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Post the message to Resend. Returns an error string on transport failure. */
async function sendViaResend(
  input: SendEmailInput,
  from: string
): Promise<{ id?: string; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) return { error: 'RESEND_API_KEY is not set' }

  const replyTo = input.replyTo ?? resolveReplyTo()

  const body = {
    from,
    to: [input.to],
    subject: input.subject,
    html: input.html,
    // A text part is not optional in practice: clients that strip HTML and spam
    // filters both penalise HTML-only mail.
    text: input.text ?? stripToText(input.html),
    // Omitted entirely when there is no mailbox to reply to. Sending
    // `reply_to: null` is accepted, but a *blank* one from a template string
    // would be the kind of silently-wrong value that makes a parent's reply
    // bounce — and right now no address is configured, so this is the normal
    // path, not the edge case.
    ...(replyTo ? { reply_to: replyTo } : {}),
    headers: {
      // One-click unsubscribe is required by Gmail and Yahoo for bulk senders,
      // and it is the difference between an unsubscribe and a spam complaint.
      // The URL is HMAC-signed so it cannot be forged for another user.
      ...(unsubscribeHeader(input.userId)),
      ...(input.headers ?? {}),
    },
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    // A hung connection must not pin a serverless function open.
    signal: AbortSignal.timeout(15_000),
  })

  const raw = await response.text()
  let parsed: ResendResponse = {}
  try {
    parsed = raw ? (JSON.parse(raw) as ResendResponse) : {}
  } catch {
    // Non-JSON error page; the status code below carries the information.
  }

  if (!response.ok) {
    return { error: `Resend ${response.status}: ${parsed.message ?? raw.slice(0, 300)}` }
  }
  return { id: parsed.id }
}

/**
 * Claim the idempotency slot for a send.
 *
 * Returns:
 *   'claimed'   - this caller may send
 *   'duplicate' - an identical email was already logged; do not send
 *   'unlogged'  - the log is unavailable; send anyway rather than silently
 *                 dropping a parent's readiness report
 */
async function claimDeliverySlot(
  input: SendEmailInput
): Promise<'claimed' | 'duplicate' | 'unlogged'> {
  if (!input.userId || !process.env.SUPABASE_SERVICE_ROLE_KEY) return 'unlogged'

  try {
    const admin = createAdminClient()
    const { error } = await admin.from('email_log').insert({
      user_id: input.userId,
      recipient: input.to,
      template: input.template,
      dedupe_key: input.dedupeKey ?? '',
      provider: resolveEmailProvider(),
      status: 'QUEUED',
      subject: input.subject,
      payload: { hasText: Boolean(input.text) },
    })
    if (!error) return 'claimed'

    // 23505 = unique_violation, i.e. this exact email was already logged.
    if (error.code === '23505') return 'duplicate'

    logger.warn('[email] could not claim delivery slot', {
      template: input.template,
      code: error.code,
      message: error.message,
    })
    return 'unlogged'
  } catch (err) {
    logger.warn('[email] delivery slot claim threw', err)
    return 'unlogged'
  }
}


/** Record the outcome against the row claimed above. */
async function recordDeliveryOutcome(
  input: SendEmailInput,
  result: { status: 'SENT' | 'FAILED' | 'SKIPPED'; messageId?: string; error?: string }
): Promise<void> {
  if (!input.userId || !process.env.SUPABASE_SERVICE_ROLE_KEY) return
  try {
    const admin = createAdminClient()
    await admin
      .from('email_log')
      .update({
        status: result.status,
        provider_message_id: result.messageId ?? null,
        error: result.error ?? null,
        sent_at: result.status === 'SENT' ? new Date().toISOString() : null,
      })
      .eq('user_id', input.userId)
      .eq('template', input.template)
      .eq('dedupe_key', input.dedupeKey ?? '')
  } catch (err) {
    // Recording the outcome is best-effort; the email has already gone.
    logger.warn('[email] could not record delivery outcome', err)
  }
}

/**
 * Send one transactional email, exactly once.
 *
 * Never throws. A lifecycle email failing must not fail the request that
 * triggered it - a parent submitting a test should not see an error because
 * Resend was briefly unreachable.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const provider = resolveEmailProvider()

  if (!isPlausibleEmail(input.to)) {
    logger.warn('[email] refused to send to an implausible address', {
      template: input.template,
    })
    return { ok: false, skipped: true, provider, error: 'invalid recipient' }
  }

  const slot = await claimDeliverySlot(input)
  if (slot === 'duplicate') {
    logger.info('[email] duplicate suppressed', {
      template: input.template,
      dedupeKey: input.dedupeKey ?? '',
    })
    return { ok: true, skipped: true, provider }
  }

  // Development without credentials: print the message instead of failing, so
  // the whole lifecycle can be exercised locally.
  if (provider === 'console') {
    // The reason is distinguished because the two causes look identical from
    // here and are not: "no key yet" is the expected local state, whereas
    // "key present but no sender configured" is a production misconfiguration
    // that would otherwise log as anodyne and stay broken.
    const reason = !process.env.RESEND_API_KEY?.trim()
      ? 'no RESEND_API_KEY'
      : 'no sender address (set EMAIL_FROM or SUPPORT_EMAIL)'
    logger.info('[email] console delivery', {
      to: input.to,
      subject: input.subject,
      template: input.template,
      reason,
      text: (input.text ?? stripToText(input.html)).slice(0, 500),
    })
    await recordDeliveryOutcome(input, { status: 'SKIPPED', error: `console provider: ${reason}` })
    return { ok: true, skipped: false, provider }
  }

  // resolveEmailProvider() already requires a From address for the 'resend'
  // branch, so reaching here without one means the two checks have drifted apart.
  // Guarded rather than trusted, because the failure it prevents is a runtime
  // TypeError inside a fire-and-forget worker.
  const fromAddress = resolveFromAddress()
  if (!fromAddress) {
    const message = 'no sender address configured (set EMAIL_FROM or SUPPORT_EMAIL)'
    await recordDeliveryOutcome(input, { status: 'FAILED', error: message })
    logger.error('EMAIL_NO_SENDER', '[email] provider selected without a From address', message)
    return { ok: false, skipped: false, provider, error: message }
  }

  try {
    const outcome = await sendViaResend(input, fromAddress)
    if (outcome.error) {
      await recordDeliveryOutcome(input, { status: 'FAILED', error: outcome.error })
      logger.error('EMAIL_SEND', '[email] provider rejected the message', outcome.error)
      return { ok: false, skipped: false, provider, error: outcome.error }
    }

    await recordDeliveryOutcome(input, { status: 'SENT', messageId: outcome.id })
    return { ok: true, skipped: false, provider, messageId: outcome.id }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await recordDeliveryOutcome(input, { status: 'FAILED', error: message })
    logger.error('EMAIL_SEND', '[email] send threw', message)
    return { ok: false, skipped: false, provider, error: message }
  }
}

/**
 * Mark a hard bounce so the address is never emailed again.
 *
 * Called from the provider webhook. Continuing to mail a hard-bounced address
 * is the single fastest way to destroy domain reputation for every other parent
 * on the list.
 */
export async function suppressEmail(userId: string, reason?: string): Promise<void> {
  if (!userId || !process.env.SUPABASE_SERVICE_ROLE_KEY) return
  try {
    const admin = createAdminClient()
    await admin.from('funnel_state').update({ email_suppressed: true }).eq('user_id', userId)
    logger.info('[email] suppressed recipient', { userId, reason: reason ?? 'unspecified' })
  } catch (err) {
    logger.error('EMAIL_SUPPRESS', '[email] suppression failed', err)
  }
}

