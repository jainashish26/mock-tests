import { createHash, timingSafeEqual } from 'node:crypto'

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logging/logger'

/**
 * POST /api/webhooks/resend-inbound — inbound support email, SHIPPED DARK.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *   It stores the delivery and creates nothing. Decision 3-A builds the path and
 *   leaves it switched off, because the address has no domain behind it (A-8) and
 *   therefore this repository has never seen a real payload from this provider.
 *   Writing a parser now would mean guessing at a wire format and auto-creating
 *   records from the guess — the fastest route to a support queue full of
 *   half-parsed rows attributed to the wrong family.
 *
 *   The first genuine message is the thing that should shape the parser. Until
 *   then, capture is the only honest step, and `disposition` stays 'pending' for
 *   every row so nobody mistakes stored for handled.
 *
 * TWO INDEPENDENT SWITCHES
 *   1. `RESEND_INBOUND_SIGNING_SECRET` unset  -> 503, nothing touched. Deployment.
 *   2. `enquiry_thresholds.inbound_email_enabled` false -> stored=false,
 *      reason='disabled', decided in the database by `record_inbound_email`.
 *   They are separate because rotating a secret is not the same act as deciding
 *   to collect the public's mail, and conflating them would let an operations
 *   task silently change a product decision. Switch 2 ships false, which is why
 *   this endpoint can exist in production without capturing anything yet.
 */

const MAX_BODY_BYTES = 512 * 1024

/**
 * Constant-time comparison, on digests rather than raw values.
 *
 * Hashing both sides first is not paranoia about the secret's length:
 * timingSafeEqual throws when the buffers differ in size, and a naive
 * length-check-then-compare is exactly the leak that makes a secret guessable one
 * byte at a time. Equal-length digests mean the comparison is always the same
 * length regardless of what the caller sent.
 */
function secretMatches(presented: string, expected: string): boolean {
  const a = createHash('sha256').update(presented).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

export async function POST(req: Request) {
  const expected = process.env.RESEND_INBOUND_SIGNING_SECRET

  if (!expected) {
    // Loud in the log, unhelpful to the caller. A 200 here would tell a provider
    // the delivery was accepted when nothing was stored, and providers stop
    // retrying what they believe succeeded.
    logger.error('INBOUND_EMAIL_MISCONFIG', '[support] inbound webhook hit but no secret configured')
    return NextResponse.json(
      { ok: false, error: 'Inbound email capture is not configured.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  const presented = req.headers.get('authorization') ?? req.headers.get('x-inbound-secret') ?? ''
  if (!secretMatches(presented.replace(/^Bearer\s+/i, ''), expected)) {
    logger.error('INBOUND_EMAIL_AUTH', '[support] inbound webhook rejected an unauthenticated delivery')
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 })
  }

  const raw = await req.text()
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: 'Payload too large.' }, { status: 413 })
  }

  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, error: 'Body was not valid JSON.' }, { status: 400 })
  }

  // Read defensively: absent fields must not be invented. `header('from')` is
  // tried alongside the flat shape because the two differ between provider
  // versions, and guessing wrong here writes a wrong address into a table that
  // will be used to reply to a parent.
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() !== '' ? v.trim() : null

  const headers = (body.headers ?? {}) as Record<string, unknown>
  const messageId = str(body.message_id) ?? str(body.id) ?? str(headers['message-id'])
  const from = str(body.from) ?? str(headers['from']) ?? str(body.sender)
  const to = str(body.to) ?? str(headers['to']) ?? str(headers['delivered-to'])

  if (!messageId || !from || !to) {
    // 400, and stored nowhere. A row with no message id cannot be deduplicated,
    // so accepting it would convert every provider retry into a fresh capture.
    return NextResponse.json(
      { ok: false, error: 'The delivery did not carry a message id, sender or recipient.' },
      { status: 400 }
    )
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('record_inbound_email', {
    p_provider_message_id: messageId,
    p_from_address: from,
    p_to_address: to,
    p_subject: str(body.subject),
    p_payload: body,
  })

  if (error) {
    logger.error('INBOUND_EMAIL_STORE', '[support] inbound delivery could not be recorded')
    return NextResponse.json({ ok: false, error: 'The delivery could not be recorded.' }, { status: 503 })
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { created: boolean; accepted: boolean; reason: string }
    | undefined

  // 200 only for a result the provider should stop retrying on. 'disabled' is
  // returned as 202 rather than 200 so the difference is visible in the provider
  // dashboard: the endpoint worked, collection is off.
  const status = row?.reason === 'disabled' ? 202 : 200

  return NextResponse.json(
    {
      ok: true,
      stored: Boolean(row?.created),
      // Never echo the address back: this response can end up in provider logs.
      reason: row?.reason ?? 'unknown',
    },
    { status, headers: { 'Cache-Control': 'no-store' } }
  )
}
