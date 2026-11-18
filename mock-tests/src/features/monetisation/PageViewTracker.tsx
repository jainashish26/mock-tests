'use client'

import { useEffect, useRef } from 'react'
import { trackView } from '@/features/monetisation/track-client'
import type { FunnelEventName } from '@/lib/funnel/events'

/**
 * Fires an acquire-stage view event once per page load.
 *
 * WHY THIS COMPONENT EXISTS
 *   `LANDING_VIEWED` and `PRICING_VIEWED` were declared in the event catalogue but
 *   nothing fired them, so `fact_event` had no stage-1 rows at all. Report A11
 *   computes each stage's conversion rate against the PREVIOUS stage
 *   (`funnel_by_stage` joins on `stage_rank - 1`), which means with no acquire
 *   events the whole funnel had no denominator and every rate came back null. The
 *   dashboard was not broken - it was correctly reporting that it had never seen a
 *   visitor.
 *
 *   Acquire is the top of the funnel. Everything downstream is measured against it.
 *
 * WHY `once` AND A REF GUARD
 *   React 18/19 StrictMode double-invokes effects in development, and a client
 *   component can remount on navigation. Without the guard a single visit would
 *   count twice, inflating stage 1 and deflating every conversion rate below it -
 *   a silent, plausible-looking error that is very hard to spot later. The ref
 *   makes the fire-once contract explicit rather than dependent on trackView's
 *   internal behaviour.
 *
 *   This is a VIEW event, not a conversion event, so it carries no user identity
 *   beyond the anonymous id the tracker already maintains. Pre-signup traffic has
 *   no user_id by definition; that is exactly what the anonymous_id bridge in
 *   funnel_events is for, and mv_funnel_stage collapses both into one visitor key.
 */
export function PageViewTracker({
  event,
  props,
}: {
  event: FunnelEventName
  props?: Record<string, unknown>
}) {
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    fired.current = true
    trackView(event, props ?? {})
    // `props` is intentionally excluded from the dependency array: a new object
    // literal on every render would re-run the effect, and the ref guard would
    // then be the only thing preventing duplicate events. Firing once per mount is
    // the contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event])

  return null
}
