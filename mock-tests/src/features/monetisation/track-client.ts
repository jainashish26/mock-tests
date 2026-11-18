'use client'

import { EVENT_STEP, type FunnelEventName } from '@/lib/funnel/events'

/**
 * Browser-side funnel tracking.
 *
 * DESIGN CONSTRAINTS
 *   - Must never block or slow an interaction. Events are queued and flushed on
 *     a timer, on `pagehide` and when the queue fills.
 *   - Must survive the navigation to Stripe Checkout, which replaces the page.
 *     That is why the flush uses `fetch(..., { keepalive: true })` and why
 *     `trackClientEvent` is awaitable: a caller that navigates immediately can
 *     await it and be sure the request left.
 *   - Must work before signup. Step-1 attribution depends on anonymous events,
 *     so identity comes from a first-party id rather than a session.
 *
 * WHY NOT A THIRD-PARTY ANALYTICS SDK
 *   The metrics that decide whether this business works are the ones in
 *   `funnel_events`, joined to `purchases`. A vendor dashboard cannot answer
 *   "of the parents who reached step 5, what proportion bought inside the offer
 *   window" without exporting and re-joining anyway. Owning the event store keeps
 *   the answer in the same database as the revenue.
 */

/** Queue size that forces an immediate flush. */
const FLUSH_AT = 8

/** Maximum time an event waits before being sent. */
const FLUSH_INTERVAL_MS = 5000

/** Cookie/localStorage key for the anonymous id. */
const ANON_KEY = 'mt_aid'

/** UTM keys worth capturing. Mirrors `normalizeUtm` on the server. */
const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'] as const

interface QueuedEvent {
  event: FunnelEventName
  props: Record<string, unknown>
  path: string
  studentId?: string | null
  utm?: Record<string, string> | null
}

let queue: QueuedEvent[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let flushing = false
let started = false

/** Cryptographically random, URL-safe, 21 characters. */
function newAnonymousId(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
    .slice(0, 21)
}

/**
 * Get or create the anonymous id.
 *
 * Stored in both localStorage and a cookie: localStorage is read by this module,
 * the cookie is read by `/api/events` so the server can attach the same id to a
 * request that carries no session.
 */
export function getAnonymousId(): string | null {
  if (typeof window === 'undefined') return null

  try {
    let id = window.localStorage.getItem(ANON_KEY)
    if (!id) {
      id = newAnonymousId()
      window.localStorage.setItem(ANON_KEY, id)
    }

    // One year, SameSite=Lax so it is sent on top-level navigations (including
    // the return from Stripe) but not on cross-site subresource requests.
    document.cookie = `${ANON_KEY}=${encodeURIComponent(id)};path=/;max-age=31536000;SameSite=Lax`
    return id
  } catch {
    // Private browsing modes can throw on localStorage access. Tracking degrades
    // to session-only rather than breaking the page.
    return null
  }
}

/**
 * Capture UTM parameters once per session.
 *
 * Stored in sessionStorage on first sight so later events carry the *original*
 * source. Without that, a parent who arrives from a Google ad, browses three
 * pages and then signs up is attributed to "direct" - which is how paid
 * channels end up looking worthless in the funnel report.
 */
function captureUtm(): Record<string, string> | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.sessionStorage.getItem('mt_utm')
    if (stored) return JSON.parse(stored) as Record<string, string>

    const params = new URLSearchParams(window.location.search)
    const utm: Record<string, string> = {}
    for (const key of UTM_KEYS) {
      const value = params.get(`utm_${key}`)
      if (value) utm[key] = value.slice(0, 200)
    }

    // A referral code in the URL is attribution too, and outranks UTM: a named
    // parent is a more specific source than "facebook/cpc".
    const ref = params.get('ref')
    if (ref) utm.content = `ref:${ref.slice(0, 32)}`

    if (Object.keys(utm).length === 0) return null
    window.sessionStorage.setItem('mt_utm', JSON.stringify(utm))
    return utm
  } catch {
    return null
  }
}

/** Send the queue. Safe to call repeatedly; concurrent calls coalesce. */
export async function flushEvents(): Promise<void> {
  if (flushing || queue.length === 0) return
  flushing = true

  const batch = queue
  queue = []

  try {
    await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // keepalive lets the request outlive the page, which is exactly what is
      // needed when the very next statement navigates to Stripe.
      keepalive: true,
      body: JSON.stringify({ events: batch }),
    })
  } catch {
    // Re-queue once so a transient failure does not lose the events, but never
    // grow without bound: an unreachable endpoint must not become a memory leak.
    if (queue.length + batch.length < 50) queue = [...batch, ...queue]
  } finally {
    flushing = false
  }
}

function scheduleFlush(): void {
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    void flushEvents()
  }, FLUSH_INTERVAL_MS)
}

/**
 * Install the pagehide flush exactly once.
 *
 * `pagehide` rather than `unload`: mobile Safari and bfcache-capable browsers do
 * not fire `unload` reliably, and losing the last events of a session means
 * losing precisely the ones that explain an abandonment.
 */
function ensureStarted(): void {
  if (started || typeof window === 'undefined') return
  started = true

  window.addEventListener('pagehide', () => void flushEvents())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushEvents()
  })
}

/**
 * Queue a funnel event.
 *
 * Awaitable so a caller about to navigate can guarantee the event was sent:
 *
 *   await trackClientEvent('OFFER_CTA_CLICKED', { offerSlug })
 *   window.location.href = checkoutUrl
 */
export async function trackClientEvent(
  event: FunnelEventName,
  props: Record<string, unknown> = {},
  options: { studentId?: string | null; immediate?: boolean } = {}
): Promise<void> {
  if (typeof window === 'undefined') return
  ensureStarted()

  // Establishes identity for anonymous traffic before the first send.
  getAnonymousId()

  queue.push({
    event,
    // `step` is attached client-side as well as stored server-side so an event
    // can be grouped by funnel stage without a join.
    props: { ...props, step: EVENT_STEP[event] },
    path: window.location.pathname + window.location.search,
    studentId: options.studentId ?? null,
    utm: captureUtm(),
  })

  if (options.immediate || queue.length >= FLUSH_AT) {
    await flushEvents()
    return
  }
  scheduleFlush()
}

/** Fire-and-forget variant for render-time events such as paywall impressions. */
export function trackView(event: FunnelEventName, props: Record<string, unknown> = {}): void {
  void trackClientEvent(event, props)
}

