import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * A signed form token for POST /api/enquiries.
 *
 * WHY THIS EXISTS AT ALL
 *   A honeypot catches naive crawlers. It does not catch a deliberate scraper,
 *   and the only cheap thing that does is a fill-time check: no human types a
 *   name, an email, a topic and a paragraph in under four seconds. But a
 *   fill-time check based on a client-supplied timestamp proves nothing, because
 *   the client can set that timestamp to anything. The timestamp has to come
 *   from the server, and a server value that travels through the browser has to
 *   be signed or it is just a client value with extra steps.
 *
 * WHAT IT IS NOT
 *   This is not a CAPTCHA and it does not claim to stop a determined attacker
 *   that replays a token through a real browser after waiting. It is one of three
 *   independent filters - honeypot, fill-time, throttle - and the weakest of
 *   them. It is here because it is cheap and because it changes the economics: a
 *   bot now has to hold a session open and behave like a person, at which point
 *   the daily cap does the work.
 *
 * THE NONCE IS ALSO THE IDEMPOTENCY KEY
 *   The route writes `'web_form:' + nonce` into `enquiries.ingest_source_ref`,
 *   which is UNIQUE with channel. So a parent who double-clicks, or whose network
 *   retries the POST while the form still holds the same token, cannot create two
 *   enquiries - `ingest_enquiry()` returns the existing id. That is the property
 *   012 built the column for, and this is where it gets used.
 *
 *   The corollary is a real trade-off, stated rather than buried: resubmitting a
 *   spent token is a no-op that returns success without creating anything. A
 *   parent whose submission genuinely landed re-renders the page and gets a fresh
 *   token, so the only way to be stranded is to submit the same page twice in one
 *   view - which is exactly the case the de-duplication exists to catch.
 */

/** How long a rendered form stays submittable. Generous: people get interrupted. */
export const TOKEN_MAX_AGE_MS = 30 * 60 * 1000

/**
 * The shortest credible time to complete the form.
 *
 * Four seconds is not a guess about bots, it is a guess about people: a parent
 * who pastes a prepared complaint into a fresh page can beat it, and the answer
 * when they do is the same one the throttle gives - try once more. Anything
 * higher starts refusing real users on a support channel, which is the worst
 * possible outcome for an anti-abuse feature.
 */
export const TOKEN_MIN_AGE_MS = 4000

export type TokenRejection = 'malformed' | 'unsigned' | 'too_fast' | 'too_old'

export type TokenResult =
  | { ok: true; nonce: string; ageMs: number }
  | { ok: false; reason: TokenRejection }

const NONCE_BYTES = 16
const PAYLOAD_SHAPE = /^([0-9a-f]{32})\.(\d{1,20})$/

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

/**
 * Mint a token for a freshly rendered form.
 *
 * `nowMs` exists for tests: without a controllable clock, a suite that asserts
 * "an expired token is refused" would have to sleep for thirty minutes or
 * compare against the real wall clock, and either choice makes the assertion
 * time-dependent. Production callers omit it and get Date.now().
 */
export function issueFormToken(secret: string, nowMs?: number): { token: string; nonce: string } {
  const nonce = randomBytes(NONCE_BYTES).toString('hex')
  const payload = `${nonce}.${nowMs ?? Date.now()}`
  return { token: `${payload}.${sign(secret, payload)}`, nonce }
}


/**
 * Verify a submitted token, and report *why* it failed.
 *
 * The reason is for server-side logs only. The route answers every rejection
 * with the same indistinguishable "message could not be sent" a person sees,
 * because a form that says "your token expired" is a form teaching an attacker
 * which check they tripped.
 */
export function verifyFormToken(
  token: unknown,
  secret: string,
  opts: { nowMs?: number; minAgeMs?: number; maxAgeMs?: number } = {}
): TokenResult {
  if (typeof token !== 'string') return { ok: false, reason: 'malformed' }

  const dot = token.lastIndexOf('.')
  if (dot <= 0) return { ok: false, reason: 'malformed' }
  const payload = token.slice(0, dot)
  const signature = token.slice(dot + 1)

  const match = PAYLOAD_SHAPE.exec(payload)
  if (!match) return { ok: false, reason: 'malformed' }

  // Constant-time comparison, guarded for length: timingSafeEqual throws on a
  // size mismatch, and a throw here would surface as a 500 on a form that a
  // browser could have filled with anything.
  const expected = sign(secret, payload)
  if (signature.length !== expected.length) return { ok: false, reason: 'unsigned' }
  if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) {
    return { ok: false, reason: 'unsigned' }
  }

  const issuedAt = Number(match[2])
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) return { ok: false, reason: 'malformed' }

  const nowMs = opts.nowMs ?? Date.now()
  const minAgeMs = opts.minAgeMs ?? TOKEN_MIN_AGE_MS
  const maxAgeMs = opts.maxAgeMs ?? TOKEN_MAX_AGE_MS
  const ageMs = nowMs - issuedAt

  // too_old before too_fast: a stale token is also, trivially, older than the
  // minimum, and reporting "you filled that in too quickly" about a token from
  // yesterday would be an absurd message to put in front of a person.
  if (ageMs > maxAgeMs) return { ok: false, reason: 'too_old' }
  if (ageMs < minAgeMs) return { ok: false, reason: 'too_fast' }

  return { ok: true, nonce: match[1], ageMs }
}

/**
 * The pepper used to hash client IPs, derived from the same secret as the form
 * token rather than a second one.
 *
 * One secret means one thing an operator can forget to set, and forgetting it is
 * then visible in exactly one place instead of two. The derivations are
 * domain-separated, so a token can never be mistaken for a pepper or the
 * reverse.
 */
export function ipPepper(secret: string): string {
  return createHmac('sha256', secret).update('mock-tests:enquiry-ip-pepper:v1').digest('hex')
}

/**
 * The 64-hex fingerprint stored in `public.enquiry_throttle`.
 *
 * `null` for an address that cannot be resolved. The route treats an
 * unresolvable address as "no throttle evidence" rather than collapsing every
 * unresolvable visitor onto one shared bucket - a single proxy or a
 * misconfigured header would otherwise let one visitor spend the whole daily
 * allowance for everyone behind it.
 */
export function fingerprintIp(ip: string | null, pepper: string): string | null {
  if (!ip) return null
  const trimmed = ip.trim()
  if (!trimmed) return null
  return createHmac('sha256', pepper).update(trimmed).digest('hex')
}

/**
 * The client address, as the platform reports it.
 *
 * WHY THIS IS SAFE TO TRUST
 *   A self-supplied `x-forwarded-for` would make the throttle both bypassable
 *   (send a new fake address per request) and weaponisable (send someone else's
 *   address and get them blocked from support). It is neither, because Vercel
 *   documents that it populates `X-Forwarded-For` itself from the TCP connection
 *   and **overwrites any incoming value**, explicitly "to prevent IP spoofing"
 *   (vercel.com/docs/headers/request-headers). `x-real-ip` is documented as
 *   identical to it. So on this deployment the value is the platform's, not the
 *   caller's, and there is no chain to parse and no trust decision to get wrong.
 *
 *   `x-real-ip` is read first anyway: it is a single address, so there is no
 *   leftmost-entry rule to remember, and a future multi-hop change cannot
 *   silently start reading a different value out of a comma list.
 *
 *   TWO BOUNDARY CONDITIONS, BOTH TRUE AND BOTH DOCUMENTED RATHER THAN ASSUMED
 *   1. If a CDN or reverse proxy is ever placed in front of Vercel, Vercel sees
 *      that proxy as the client. Every visitor then shares one bucket, so one
 *      abuser blocks a region. Vercel does not expose the true client behind an
 *      upstream proxy on non-Enterprise plans. This deployment has no proxy in
 *      front, so the hazard is hypothetical - but it becomes real the day
 *      someone puts Cloudflare in front, and it should be found here, not in an
 *      inbox full of blocked families.
 *   2. `next dev` and `next start` locally set neither header. A local request
 *      therefore has no fingerprint and is not throttled, which is the correct
 *      fail-open for development; a locally-supplied `x-forwarded-for` IS
 *      honoured so the throttle path can be exercised, and that override is
 *      exactly why it must never be mistaken for the production guarantee.
 */
export function clientIpFrom(headers: Headers): string | null {
  const realIp = headers.get('x-real-ip')?.trim()
  if (realIp) return realIp

  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return null
}

