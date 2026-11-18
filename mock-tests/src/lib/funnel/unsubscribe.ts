import crypto from 'crypto'
import { SITE_URL } from '@/lib/seo/site-config'

/**
 * Signed unsubscribe tokens.
 *
 * WHY SIGN RATHER THAN PASS THE USER ID
 *   The one-click `List-Unsubscribe` header puts a URL in every email. If that URL
 *   were just `?u=<uuid>`, anyone who obtained a single email could unsubscribe
 *   any other user by guessing or replaying ids - and a competitor could
 *   systematically suppress a mailing list. An HMAC over the id makes the link
 *   unforgeable without adding a lookup table.
 *
 *   The signature also lets the route verify the request without a session,
 *   which is the whole point: Gmail's one-click unsubscribe is an unauthenticated
 *   POST from Google's infrastructure.
 */

/** Tokens never need to expire for the unsubscribe use case, but bound them anyway. */
const TOKEN_TTL_DAYS = 3650

function signingKey(): string {
  // Falls back to the Supabase service key so a deployment that has email
  // configured but no SESSION_SECRET still produces stable, unforgeable tokens.
  // A missing key entirely means tokens cannot be verified, and the route fails
  // closed rather than accepting unsigned input.
  return (
    process.env.UNSUBSCRIBE_SIGNING_KEY?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    ''
  )
}

/** True when tokens can be produced and verified at all. */
export function canSignTokens(): boolean {
  return signingKey().length > 0
}

function sign(payload: string): string {
  return crypto
    .createHmac('sha256', signingKey())
    .update(payload)
    .digest('base64url')
}

/**
 * Build a signed, absolute unsubscribe URL for one parent.
 *
 * Returns null when no signing key is available, so callers can omit the header
 * rather than emit a link that will fail verification.
 */
export function unsubscribeUrl(userId: string): string | null {
  if (!userId || !canSignTokens()) return null

  const expires = Date.now() + TOKEN_TTL_DAYS * 86_400_000
  const payload = `${userId}.${expires}`

  return `${SITE_URL}/api/funnel/unsubscribe?u=${encodeURIComponent(userId)}&e=${expires}&s=${sign(payload)}`
}

/** Verify and decode an unsubscribe token. */
export function verifyUnsubscribeToken(
  userId: unknown,
  expires: unknown,
  signature: unknown
): { valid: boolean; userId: string | null } {
  if (!canSignTokens()) return { valid: false, userId: null }
  if (typeof userId !== 'string' || typeof expires !== 'string' || typeof signature !== 'string') {
    return { valid: false, userId: null }
  }

  const expiresMs = Number(expires)
  if (!Number.isFinite(expiresMs) || expiresMs < Date.now()) {
    return { valid: false, userId: null }
  }

  // UUID shape check before doing any crypto, so a garbage id cannot be used to
  // probe the signature function.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    return { valid: false, userId: null }
  }

  const expected = sign(`${userId}.${expires}`)
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)

  // timingSafeEqual throws on a length mismatch, so compare lengths first.
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, userId: null }
  }

  return { valid: true, userId }
}
