/**
 * Shared authentication for /api/cron/* endpoints.
 *
 * Extracted from the lifecycle cron route so every scheduled endpoint verifies
 * the same secret the same way. When no secret is configured the endpoint
 * REFUSES to run rather than running unauthenticated - an open trigger for
 * email sends or paid API calls is exactly the kind of endpoint that gets
 * found by scanners within days of deploy.
 */

/** Constant-time comparison so the secret check cannot be timed. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

export function isAuthorizedCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return false

  const header = req.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (token && safeEqual(token, secret)) return true

  // Vercel Cron also forwards the secret as a query param on some runtimes.
  try {
    const url = new URL(req.url)
    const param = url.searchParams.get('secret') ?? ''
    return Boolean(param) && safeEqual(param, secret)
  } catch {
    return false
  }
}