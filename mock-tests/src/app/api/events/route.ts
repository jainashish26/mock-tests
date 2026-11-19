import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'
import { EVENT_NAMES, EVENT_STEP, isKnownEvent, normalizeUtm, type FunnelEventName } from '@/lib/funnel/events'
import { trackEvents, readAnonymousId } from '@/lib/funnel/track'
import { classifyDevice } from '@/lib/funnel/device'

/**
 * POST /api/events - the funnel instrumentation endpoint.
 *
 * Accepts either a single event or a batch. Batching matters because a session
 * produces many small interactions (page views, CTA clicks, paywall impressions)
 * and one request per interaction on a serverless platform is both slow and
 * expensive.
 *
 * TRUST MODEL
 *   This endpoint is public by necessity: pre-signup acquisition events (step 1)
 *   have no session to authenticate against. That makes it a spoofing target, so
 *   three things constrain the damage:
 *
 *   1. Event names come from a closed catalogue. An unknown name is dropped
 *      silently, so nobody can invent events that pollute the funnel metrics.
 *   2. `user_id` is NEVER taken from the request body. It is read from the
 *      Supabase session. A body-supplied user_id would let anyone write events
 *      attributed to another family - both a privacy problem and a way to
 *      corrupt someone else's lifecycle state.
 *   3. Batch size and payload size are capped, which bounds what a loop can do.
 *
 *   Anonymous events carry only a browser-generated id and UTM data, which is
 *   exactly what step-1 attribution needs and nothing more.
 */

/** Hard cap on events per request. A legitimate session batches well under this. */
const MAX_BATCH = 20

/** Cap on the request body, in bytes. Guards against a pasted payload. */
const MAX_BODY_BYTES = 16 * 1024

/** Cap on free-form props, so one event cannot smuggle a large document. */
const MAX_PROPS = 12

// The anonymous-id cookie reader moved to @/lib/funnel/track, where the
// enquiries route can use the same contract rather than a second copy of it.

// Device classification lives in @/lib/funnel/device so the beacon and the
// server-side trackEvent path share ONE definition. It was duplicated here,
// which is why only beacon events (no funnel stage) ever carried a device.

interface RawEvent {
  event?: unknown
  studentId?: unknown
  props?: unknown
  path?: unknown
  utm?: unknown
}

/** Trim props to a bounded set of short, serialisable values. */
function sanitizeProps(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const source = raw as Record<string, unknown>
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(source)) {
    if (Object.keys(out).length >= MAX_PROPS) break
    if (typeof key !== 'string' || key.length > 64) continue

    if (typeof value === 'string') out[key] = value.slice(0, 256)
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
    else if (typeof value === 'boolean' || value === null) out[key] = value
    // Objects and arrays are dropped: allowing them would make the payload size
    // unbounded and the stored jsonb unqueryable.
  }

  return out
}

/** Normalise the three accepted body shapes into a flat event list. */
function extractEvents(body: unknown): RawEvent[] {
  if (Array.isArray(body)) return body as RawEvent[]
  if (!body || typeof body !== 'object') return []

  const record = body as Record<string, unknown>
  if (Array.isArray(record.events)) return record.events as RawEvent[]
  if (typeof record.event === 'string') return [record as RawEvent]
  return []
}

export async function POST(req: Request) {
  // Size guard before parsing, so an oversized body is rejected rather than
  // buffered into memory first.
  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const events = extractEvents(body).slice(0, MAX_BATCH)
  if (events.length === 0) {
    return NextResponse.json({ error: 'No events supplied' }, { status: 400 })
  }

  // Session identity wins over anything the client claims.
  let userId: string | null = null
  try {
    const supabase = await createClient()
    const { data } = await supabase.auth.getUser()
    userId = data.user?.id ?? null
  } catch {
    // An unauthenticated or expired session is normal for step-1 traffic.
    userId = null
  }

  const anonymousId = readAnonymousId(req)
  const referrer = req.headers.get('referer')?.slice(0, 500) ?? null
  const deviceClass = classifyDevice(req)

  // Filter to declared event names only.
  const accepted = events.filter(
    (event): event is RawEvent & { event: FunnelEventName } => isKnownEvent(event?.event)
  )
  const dropped = events.length - accepted.length

  if (accepted.length === 0) {
    // 200 rather than 400: a beacon that reports failure gets retried by the
    // browser, and retrying an event we will never accept is pure waste.
    return NextResponse.json({ ok: true, accepted: 0, dropped })
  }

  const written = await trackEvents(
    accepted.map((event) => {
      const claimedStudentId =
        typeof event.studentId === 'string' && event.studentId.length <= 64
          ? event.studentId
          : null

      return {
        event: event.event,
        userId,
        anonymousId,
        // A student id from the body is only honoured for a signed-in user; an
        // anonymous caller has no business naming a student profile.
        studentId: userId ? claimedStudentId : null,
        // Server-derived value is spread LAST so a client-supplied `device` prop
        // cannot override it. sanitizeProps() caps at MAX_PROPS keys, so injecting
        // after it also guarantees `device` is never dropped by that cap.
        props: { ...sanitizeProps(event.props), device: deviceClass },
        path: typeof event.path === 'string' ? event.path.slice(0, 500) : null,
        referrer,
        utm: normalizeUtm(event.utm),
      }
    })
  )

  return NextResponse.json({ ok: true, accepted: written, dropped })
}

/**
 * GET /api/events?names=1 - the declared event catalogue.
 *
 * Exposed so a QA engineer or an analytics review can confirm what the client is
 * allowed to send without reading the source. Names only; no user data.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)

  if (url.searchParams.get('names') === '1') {
    return NextResponse.json({
      events: EVENT_NAMES.map((name) => ({ name, step: EVENT_STEP[name] })),
    })
  }

  // A no-op ping, useful for verifying the endpoint is deployed.
  logger.info('[events] ping')
  return NextResponse.json({ ok: true })
}

