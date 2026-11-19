import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'
import { normalizeUtm } from '@/lib/funnel/events'
import { classifyDevice } from '@/lib/funnel/device'
import { readAnonymousId, trackEvent } from '@/lib/funnel/track'
import { isHoneypotFilled, normaliseEnquiry } from '@/lib/support/enquiry-fields'
import {
  checkEnquiryThrottle,
  findEnquiryIdBySourceRef,
  ingestWebEnquiry,
  isIngestConfigured,
} from '@/lib/support/enquiries'
import { clientIpFrom, fingerprintIp, ipPepper, issueFormToken, verifyFormToken } from '@/lib/support/form-token'

/**
 * POST /api/enquiries - the web-form enquiry ingest endpoint (backlog item 21).
 *
 * WHAT THIS REPLACES
 *   Before this route existed, `/contact` was mailto-only, `public.enquiries` had
 *   zero rows, and the entire enquiry schema built in 012 - the single write
 *   path, the restricted contact table, the audited drill-down - was unreachable.
 *   The Terms promise a 14-day refund and the contact page promises a reply
 *   within one business day. Neither was measurable, because nothing was
 *   recorded. This is the live product gap, not only the A13 report.
 *
 * TRUST MODEL - the four things standing between a stranger and this database
 *   1. Honeypot (`company_website`, hidden by CSS). Cheap, catches crawlers.
 *      A hit is discarded with a 200 that looks like success, because a refusal
 *      is information about which filter fired.
 *   2. Signed form token. A server-issued timestamp, so the fill-time check
 *      cannot be satisfied by a client that sets its own clock. See
 *      ./form-token.ts for why an unsigned client timestamp proves nothing.
 *   3. Per-visitor throttle in the database (`enquiry_throttle_check`). In the DB
 *      rather than in memory because Vercel isolates instances, and an in-memory
 *      counter that resets on every cold start limits nothing.
 *   4. Closed `enquiry_type` list plus length caps, enforced before anything
 *      reaches Postgres, in `./enquiry-fields` where it is unit-tested.
 *
 *   None of the four is a bot-proof wall and none is described as one. Together
 *   they change the economics; the throttle is the one that actually carries the
 *   load, which is why it is the only one that is not optional.
 *
 * IF ENQUIRY_FORM_SECRET IS NOT SET
 *   The token check is skipped and it is logged at warn level every submission,
 *   rather than the form quietly accepting anything. This is the deliberate
 *   exception to "fail closed": refusing to take a support message because an
 *   operator has not copied one environment variable is a worse failure than a
 *   weak spam filter, and the honeypot plus the throttle still apply. A silent
 *   no-op would be the worst outcome of all - it would look configured forever.
 *
 * WHAT NEVER LEAVES THIS FILE
 *   The message body. It goes into `enquiry_contacts` inside `ingest_enquiry()`'s
 *   transaction and nowhere else - not into a log line, not into an event's
 *   props, not back in a response. Vercel stdout is a searchable drain, and a
 *   privacy complaint pasted into an info line would be a second, ungoverned copy
 *   of the one thing the restricted table exists to keep in one place.
 */

/** Body cap, in bytes. The field caps in enquiry-fields add up to well under this. */
const MAX_BODY_BYTES = 32 * 1024

/**
 * The one sentence used for every anti-abuse and infrastructure refusal.
 *
 * Deliberately not "your submission expired" or "too many requests from this
 * address": each of those names the check that caught an attacker. A genuine
 * person is not left guessing either, because the throttle path adds a real
 * Retry-After and its own copy - that one is meant to be read.
 */
const GENERIC_REFUSAL = 'Your message could not be sent. Please try again.'

/** Never reveal that a submission was discarded as bot traffic. */
const DISCARD_OK = { ok: true, reference: null }

const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * The success payload, shared by the new-submission and retry paths.
 *
 * One builder so the two cannot drift into different shapes - a client that has
 * to branch on which succeeded is a client that will eventually get it wrong.
 * 201 for a created enquiry, 200 for one that already existed.
 */
function referenceResponse(enquiryId: string, status: 200 | 201): NextResponse {
  return NextResponse.json(
    {
      ok: true,
      // A short human-readable code to quote in a follow-up email. Not a secret:
      // it grants nothing, because no read path exists for a non-admin.
      reference: enquiryId.slice(0, 8).toUpperCase(),
    },
    { status, headers: NO_STORE }
  )
}



export async function POST(req: Request) {
  // Size guard before parsing, so an oversized body is rejected rather than
  // buffered into memory first.
  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  }

  if (!isIngestConfigured()) {
    logger.error('ENQUIRY_UNCONFIGURED', '[support] ingest is not configured', 'service key absent')
    return NextResponse.json(
      { error: 'Support is temporarily unavailable. Please email us instead.' },
      { status: 503, headers: NO_STORE }
    )
  }

  let body: Record<string, unknown>
  try {
    const parsed: unknown = await req.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    body = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // (1) Honeypot. Checked before validation, so a crawler that filled nothing but
  // the trap is not told which field gave it away - or that anything else about
  // its request shape was wrong.
  if (isHoneypotFilled(body)) {
    logger.warn('[support] discarded a honeypot submission', {
      contentLength: contentLength || null,
    })
    return NextResponse.json(DISCARD_OK, { status: 200, headers: NO_STORE })
  }

  // (2) Validation. A human with a typo deserves precise, field-level feedback,
  // so this is the one place errors are itemised.
  const validated = normaliseEnquiry(body)
  if (!validated.ok) {
    return NextResponse.json(
      { error: 'Please check the highlighted fields.', fields: validated.errors },
      { status: 400 }
    )
  }

  // (3) Token. One secret serves both jobs: signing the form token and pepping
  // the IP fingerprint. See the header for what happens when it is absent.
  const secret = process.env.ENQUIRY_FORM_SECRET ?? ''
  let sourceRef: string
  let fingerprint: string | null = null

  if (!secret) {
    logger.warn('[support] ENQUIRY_FORM_SECRET is not set; the fill-time check is inactive')
    // No nonce, so no idempotency key: a retry creates a fresh enquiry, which is
    // the pre-token behaviour rather than a regression introduced here. The
    // throttle also stands down, because hashing without a pepper would store a
    // value an IPv4 enumeration can reverse back to an address.
    sourceRef = `web_form:unsigned:${crypto.randomUUID()}`
  } else {
    const tokenResult = verifyFormToken(body.formToken, secret)
    if (!tokenResult.ok) {
      logger.warn('[support] refused an enquiry submission', { reason: tokenResult.reason })
      return NextResponse.json({ error: GENERIC_REFUSAL }, { status: 400, headers: NO_STORE })
    }
    sourceRef = `web_form:${tokenResult.nonce}`
    // The pepper is derived, never the secret itself: one environment variable
    // serves two jobs, and domain separation is what stops the two being
    // interchangeable. See ipPepper().
    fingerprint = fingerprintIp(clientIpFrom(req.headers), ipPepper(secret))
  }

  // (3c) Retry check. Before the throttle, deliberately: a parent who
  // double-clicked submit is not submitting again, and answering their retry
  // with "you have sent several messages" would be a lie about a message that
  // arrived a second ago. See findEnquiryIdBySourceRef().
  const already = await findEnquiryIdBySourceRef(sourceRef)
  if (already) {
    logger.info('[support] repeat submission for an existing reference', {
      enquiryId: already,
      enquiryType: validated.value.enquiryType,
    })
    return referenceResponse(already, 200)
  }

  // (4) Throttle. Last, because every filter above it is free and this one costs
  // a database write: running it first would hand a spammer a way to spend other
  // visitors' allowance while sending nothing that would ever have been stored.
  const throttle = await checkEnquiryThrottle(fingerprint)

  if (throttle.state === 'throttled') {
    return NextResponse.json(
      {
        error:
          'You have sent several messages already. Please wait a little before sending another, or email us directly.',
        retryAfterSeconds: throttle.retryAfterSeconds,
      },
      {
        status: 429,
        headers: { ...NO_STORE, 'Retry-After': String(throttle.retryAfterSeconds) },
      }
    )
  }

  // Session identity is optional and is NEVER read from the body: an anonymous
  // caller must not be able to attach an enquiry to someone else's account. The
  // same rule /api/events applies to user_id, for the same reason.
  let parentUserId: string | null = null
  try {
    const supabase = await createClient()
    const { data } = await supabase.auth.getUser()
    parentUserId = data.user?.id ?? null
  } catch {
    parentUserId = null
  }

  const result = await ingestWebEnquiry({
    enquiryType: validated.value.enquiryType,
    contact: validated.value.contact,
    parentUserId,
    sourceRef,
    rawUtm: body.utm,
  })

  if (!result.ok) {
    // One sentence, no detail: the Postgres message can quote the contact value
    // it failed on, and that belongs in the server log rather than a response.
    return NextResponse.json({ error: GENERIC_REFUSAL }, { status: 502, headers: NO_STORE })
  }

  // Instrumentation. Awaited but never allowed to fail the submission: an
  // enquiry that reached the database must not be reported as an error because
  // an analytics row could not be written.
  await trackEvent({
    event: 'ENQUIRY_CREATED',
    userId: parentUserId,
    anonymousId: parentUserId ? null : readAnonymousId(req),
    path: '/contact',
    referrer: req.headers.get('referer')?.slice(0, 500) ?? null,
    utm: normalizeUtm(body.utm),
    device: classifyDevice(req),
    // Channel and topic only. No enquiry id: it is a row identifier in a table
    // holding a person's complaint, and the event log is read by far more people
    // than the restricted contact table is.
    props: {
      channel: 'web_form',
      enquiryType: validated.value.enquiryType,
      linked: parentUserId !== null,
    },
  })

  return referenceResponse(result.enquiryId, 201)
}

/**
 * GET /api/enquiries - mints a form token and reports whether the channel is live.
 *
 * WHY THE CLIENT FETCHES THE TOKEN RATHER THAN THE PAGE EMBEDDING IT
 *   A server-rendered token would make `/contact` dynamic, because minting one
 *   needs a fresh nonce and timestamp per render. That page is indexed marketing
 *   and legal content, and paying a database-free render per visit to save one
 *   small XHR is the wrong trade. The form is a progressive enhancement on top of
 *   a mailto address that still works without it, so a visitor who never runs
 *   JavaScript loses nothing.
 *
 *   Returning the token here costs nothing in exposure terms: a token grants no
 *   access, is single-use through the idempotency key, and expires in 30 minutes.
 *   Anyone who can reach the page can already request one.
 */
export async function GET() {
  const secret = process.env.ENQUIRY_FORM_SECRET ?? ''
  if (!secret) {
    logger.warn('[support] ENQUIRY_FORM_SECRET is not set; issuing an empty form token')
  }

  return NextResponse.json(
    {
      ok: true,
      channel: 'web_form',
      configured: isIngestConfigured(),
      formToken: secret ? issueFormToken(secret).token : null,
    },
    { headers: NO_STORE }
  )
}


