import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logging/logger'
import { EVENT_STAGE, toEventRow, type FunnelEventName, type TrackEventInput } from './events'
import { isDeviceClass, type DeviceClass } from './device'

/**
 * Server-side funnel instrumentation.
 *
 * Writes go through the service-role client because `funnel_events` has no
 * client RLS policy by design (see migration 011): a browser that could INSERT
 * directly could also forge its own conversion metrics. Every call therefore
 * originates from an API route or server component that has already
 * authenticated the caller.
 *
 * `trackEvent` never throws. Instrumentation that can take down a submission
 * path is worse than no instrumentation - if the event write fails the parent's
 * test must still be scored and their purchase must still complete.
 */

/** Is the instrumentation layer usable at all? */
export function isFunnelConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

/**
 * The visitor's most recent known device class, or null.
 *
 * WHY THIS EXISTS
 *   C9 requires every funnel number split by device. The client beacon already
 *   derives one, but the events it sends have no EVENT_STAGE entry and so never
 *   reach mv_funnel_stage. Every stage-bearing event is written server-side -
 *   often by the lifecycle worker on a cron tick, with no Request in scope at all.
 *   Rather than leave those 'unknown', they inherit the device the same visitor
 *   was last seen on, which is a real observation rather than a guess.
 *
 * COST CONTROL
 *   Called only for events that carry a stage. ITEM_ANSWERED and the other
 *   high-volume behavioural events have no stage, never enter the funnel, and
 *   therefore never trigger this lookup - so a test session's answer batch does
 *   not pay for a read per answer. Stage events fire roughly once per journey.
 *
 *   Both lookup paths are covered by existing partial indexes
 *   (idx_funnel_events_user_time, idx_funnel_events_anon), each ordered
 *   created_at DESC, so this is a short index scan rather than a sort.
 *
 * FAILS OPEN
 *   Any failure returns null and the event is written without a device. Losing a
 *   device segment is an analytics gap; blocking a signup or a purchase over it
 *   would be a product outage.
 */
async function lastKnownDevice(
  userId: string | null,
  anonymousId: string | null
): Promise<DeviceClass | null> {
  if (!userId && !anonymousId) return null

  // Try the authenticated identity first, then the anonymous one. The order
  // matters at signup: a brand-new user_id has no history, but the same visitor
  // was browsing under the mt_aid cookie seconds earlier and the beacon recorded
  // a device there. Without the anonymous fallback, the very first stage event
  // of every journey - the one A11 most needs - would be 'unknown'.
  const identities: Array<{ column: 'user_id' | 'anonymous_id'; value: string }> = []
  if (userId) identities.push({ column: 'user_id', value: userId })
  if (anonymousId) identities.push({ column: 'anonymous_id', value: anonymousId })

  try {
    const admin = createAdminClient()

    for (const identity of identities) {
      const { data, error } = await admin
        .from('funnel_events')
        .select('props')
        .eq(identity.column, identity.value)
        .order('created_at', { ascending: false })
        .limit(5)

      if (error || !data) continue

      for (const row of data) {
        const device = (row.props as Record<string, unknown> | null)?.device
        if (isDeviceClass(device) && device !== 'unknown') return device
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Stamp a device onto a row when the caller had no Request to derive one from.
 * Mutates `row.props` in place; the row is freshly built by toEventRow so this
 * cannot affect a caller's own object.
 */
async function ensureDevice(
  row: { user_id: string | null; anonymous_id: string | null; props: Record<string, unknown> },
  eventName: FunnelEventName
): Promise<void> {
  // Only funnel-stage events need a device. See lastKnownDevice for why.
  if (!EVENT_STAGE[eventName]) return
  if (isDeviceClass(row.props.device) && row.props.device !== 'unknown') return

  const known = await lastKnownDevice(row.user_id, row.anonymous_id)
  if (known) row.props.device = known
}

/**
 * Persist one funnel event and advance the lifecycle stage if the event implies
 * a new one.
 *
 * Returns true when the row was written. Callers should not branch on this -
 * it exists for tests and for the lifecycle worker, which needs to know whether
 * its own bookkeeping succeeded.
 */
export async function trackEvent(input: TrackEventInput): Promise<boolean> {
  if (!isFunnelConfigured()) {
    // Local dev without Supabase credentials: log rather than fail, matching
    // how `src/lib/pricing/catalog.ts` degrades when Stripe is unconfigured.
    logger.info('[funnel] not configured, event dropped', { event: input.event })
    return false
  }

  const row = toEventRow(input)
  if (!row) {
    logger.warn('[funnel] event rejected: no user_id or anonymous_id', {
      event: input.event,
    })
    return false
  }

  try {
    const admin = createAdminClient()

    // C9: give stage-bearing events a device even when this call site had no
    // Request (lifecycle worker, cron, webhook). No-op for behavioural events.
    await ensureDevice(row, input.event)

    const { error } = await admin.from('funnel_events').insert(row)
    if (error) {
      logger.error('FUNNEL_EVENT_INSERT', '[funnel] insert failed', error.message)
      return false
    }

    // Stage advancement is a separate call rather than part of the insert
    // because it is a monotonic merge (see `advance_funnel_stage`) and must run
    // even when the event row was a duplicate.
    const nextStage = EVENT_STAGE[input.event]
    if (nextStage && row.user_id) {
      const { error: stageError } = await admin.rpc('advance_funnel_stage', {
        target_user_id: row.user_id,
        new_stage: nextStage,
      })
      if (stageError) {
        logger.error(
          'FUNNEL_STAGE_ADVANCE',
          '[funnel] stage advance failed',
          stageError.message,
          undefined
        )
      }
    }

    return true
  } catch (err) {
    logger.error('FUNNEL_EVENT_THROW', '[funnel] unexpected error', err)
    return false
  }
}

/**
 * Persist several events in one round trip.
 *
 * Used by the client beacon, which batches page-view and click events so a
 * session produces a handful of requests instead of dozens. Unknown names are
 * filtered out before the insert so one bad event cannot poison the batch.
 */
export async function trackEvents(inputs: TrackEventInput[]): Promise<number> {
  if (!isFunnelConfigured() || inputs.length === 0) return 0

  const pairs = inputs
    .map((input) => ({ input, row: toEventRow(input) }))
    .filter(
      (p): p is { input: TrackEventInput; row: NonNullable<ReturnType<typeof toEventRow>> } =>
        p.row !== null
    )

  if (pairs.length === 0) return 0

  try {
    const admin = createAdminClient()

    // C9, resolved once per DISTINCT visitor rather than once per event: a batch
    // is almost always a single session, so this is typically one lookup for the
    // whole batch. Behavioural events (no stage) are skipped entirely.
    const deviceCache = new Map<string, DeviceClass | null>()
    for (const { input, row } of pairs) {
      if (!EVENT_STAGE[input.event]) continue
      if (isDeviceClass(row.props.device) && row.props.device !== 'unknown') continue

      const key = row.user_id ?? `anon:${row.anonymous_id}`
      if (!deviceCache.has(key)) {
        deviceCache.set(key, await lastKnownDevice(row.user_id, row.anonymous_id))
      }
      const known = deviceCache.get(key)
      if (known) row.props.device = known
    }

    const { error } = await admin.from('funnel_events').insert(pairs.map((p) => p.row))
    if (error) {
      logger.error('FUNNEL_EVENTS_INSERT', '[funnel] batch insert failed', error.message)
      return 0
    }
    return pairs.length
  } catch (err) {
    logger.error('FUNNEL_EVENTS_THROW', '[funnel] batch insert threw', err)
    return 0
  }
}

/**
 * Record a stage change that has no corresponding behavioural event - for
 * example the Stripe webhook marking a user CUSTOMER, or the lifecycle worker
 * expiring an offer.
 */
export async function advanceStage(userId: string, stage: string): Promise<boolean> {
  if (!isFunnelConfigured() || !userId) return false
  try {
    const admin = createAdminClient()
    const { error } = await admin.rpc('advance_funnel_stage', {
      target_user_id: userId,
      new_stage: stage,
    })
    if (error) {
      logger.error('FUNNEL_STAGE_ADVANCE', '[funnel] advanceStage failed', error.message)
      return false
    }
    return true
  } catch (err) {
    logger.error('FUNNEL_STAGE_THROW', '[funnel] advanceStage threw', err)
    return false
  }
}

/**
 * Has this user already emitted this event?
 *
 * WHY IT EXISTS
 *   Some events mark a milestone that happens ONCE per journey but are detected
 *   on a page that can be visited many times - ONBOARDING_STARTED and
 *   ONBOARDING_COMPLETED are both derived from rendering /onboarding, which a
 *   parent returns to whenever they add another child. Without a check, every
 *   revisit would re-fire the milestone and the event log would claim the same
 *   parent onboarded a dozen times. `mv_funnel_stage` counts distinct visitors
 *   so the stage conversion would survive, but raw event counts and any future
 *   per-event metric would not.
 *
 * WHY IT FAILS OPEN
 *   If the lookup cannot run, the caller emits the event. A duplicate milestone
 *   is a minor analytics annoyance; a MISSING one silently understates
 *   conversion, and understated conversion is the error that causes a working
 *   funnel step to be "fixed" into a broken one.
 *
 * Reads through the service client because `funnel_events` has no client SELECT
 * policy (migration 011) - the same reason writes go through it.
 */
export async function hasFiredEvent(
  userId: string,
  event: FunnelEventName
): Promise<boolean> {
  if (!isFunnelConfigured() || !userId) return false

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('funnel_events')
      .select('id')
      .eq('user_id', userId)
      .eq('event', event)
      .limit(1)
      .maybeSingle()

    if (error) {
      logger.warn('[funnel] hasFiredEvent lookup failed, failing open', { event })
      return false
    }
    return Boolean(data)
  } catch (err) {
    logger.warn('[funnel] hasFiredEvent threw, failing open', { event, err })
    return false
  }
}

/**
 * Emit an event at most once per user.
 *
 * Combines the check and the write so every once-per-journey call site gets the
 * same fail-open semantics rather than each reimplementing them slightly
 * differently.
 */
export async function trackEventOnce(
  input: TrackEventInput
): Promise<boolean> {
  if (!input.userId) return trackEvent(input)
  if (await hasFiredEvent(input.userId, input.event)) return false
  return trackEvent(input)
}

