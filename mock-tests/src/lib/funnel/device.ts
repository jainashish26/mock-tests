/**
 * Device classification for funnel analytics (CRO requirement C9).
 *
 * WHY THIS IS A SHARED MODULE
 *   `classifyDevice` originally lived inside `/api/events/route.ts`, and that is
 *   the whole reason C9 was unmet. The client beacon derives a device and writes
 *   it to `props.device` - but the events the beacon sends (PAGE_VIEWED and
 *   friends) have NO entry in `EVENT_STAGE`, so they never enter
 *   `reporting.mv_funnel_stage`. Every event that DOES carry a funnel stage
 *   (SIGNUP_COMPLETED, PAYWALL_TRIGGERED, CUSTOMER, ...) is written server-side by
 *   `trackEvent()`, which had no access to the classifier.
 *
 *   Net effect: device was captured only on the events that do not participate in
 *   the funnel, so every funnel row read 'unknown'. Extracting the classifier lets
 *   both paths use one definition.
 *
 * DERIVED SERVER-SIDE, NEVER TRUSTED FROM THE CLIENT
 *   A client that could set its own device segment could manufacture a
 *   100%-converting mobile cohort and make a bad channel look good. The class is
 *   computed from request headers here and written into `props.device`, which
 *   `reporting.load_event_facts()` already reads into `fact_event.device_class`.
 *
 *   Client hints are preferred over User-Agent parsing because they are
 *   structured; the UA fallback exists because hint coverage is partial,
 *   particularly on iOS.
 */

export type DeviceClass = 'mobile' | 'tablet' | 'desktop' | 'unknown'

/** Coarse device class from a request's client hints, falling back to the UA. */
export function classifyDevice(req: Request): DeviceClass {
  const mobile = req.headers.get('sec-ch-ua-mobile')
  if (mobile === '?1') return 'mobile'
  if (mobile === '?0') return 'desktop'

  const ua = req.headers.get('user-agent') ?? ''
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return 'tablet'
  if (/Mobi|Android|iPhone|iPod/i.test(ua)) return 'mobile'
  return ua ? 'desktop' : 'unknown'
}

/** True when a value is a device class we are willing to store. */
export function isDeviceClass(value: unknown): value is DeviceClass {
  return value === 'mobile' || value === 'tablet' || value === 'desktop' || value === 'unknown'
}
