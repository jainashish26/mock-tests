/**
 * A13 - Enquiry & Support Tracker: the pure half.
 *
 * Lives apart from ./admin-enquiries for the same reason `formatLag` sits in
 * ./format rather than beside the RPC callers: ./connection pulls in
 * `next/headers`, so anything declared here would otherwise be untestable in
 * Node. These three functions decide how an uncertain number is *worded*, which
 * is precisely the part that must be asserted rather than eyeballed once.
 *
 * THE RULE THEY ENFORCE
 *   "We do not know" and "we never miss" must never render the same way. A
 *   support queue spends its first weeks near empty, and a report that shows
 *   0.0% breaches when it has measured nothing is a report that will be
 *   believed, cited, and acted on.
 */

export interface EnquirySummary {
  window_days: number
  enquiries: number
  sla_met: number
  sla_breached: number
  sla_at_risk: number
  sla_within: number
  sla_unmeasurable: number
  response_unrecorded: number
  response_recorded: number
  sla_breach_rate: number | null
  rate_is_reportable: boolean
  min_enquiries_for_rate: number
  resolution_over_sla: number
  resolution_sla_hours: number
  /** Only populated under the 'calendar' basis. */
  sla_minutes: number | null
  first_response_hours_median: number | null
  resolution_hours_median: number | null
  converted: number
  conversion_rate: number | null
  conversion_window_days: number
  sla_basis: string
  sla_business_days: number
  sla_is_confirmed: boolean
}

export interface EnquiryDayRow {
  date_key: number
  the_date: string | null
  enquiries: number
  sla_met: number
  sla_breached: number
  response_unrecorded: number
  sla_unmeasurable: number
  first_response_hours_median: number | null
  converted: number
}

/** The denominator the breach rate actually uses, exposed so callers cannot
 *  quietly divide by something else. */
export function measurableCount(s: EnquirySummary): number {
  return s.sla_met + s.sla_breached
}

/**
 * The sentence under the breach rate.
 *
 * Three honest states, chosen by which condition holds: nothing measured, a
 * sample below the reporting floor, and a real rate. The middle case is the one
 * most reports get wrong - they print the percentage anyway and add an asterisk
 * nobody reads.
 */
export function breachRateSentence(s: EnquirySummary): string {
  const measured = measurableCount(s)

  if (measured === 0) {
    if (s.sla_unmeasurable > 0 || s.response_unrecorded > 0) {
      return (
        `No verdict is available yet: ${s.sla_unmeasurable} ${
          s.sla_unmeasurable === 1 ? 'enquiry has' : 'enquiries have'
        } no computable deadline and ${s.response_unrecorded} ${
          s.response_unrecorded === 1 ? 'was' : 'were'
        } closed without a recorded response.`
      )
    }
    return 'Nothing has been measured in this window yet.'
  }

  if (!s.rate_is_reportable) {
    return (
      `${s.sla_breach_rate ?? 0}% of ${measured} measured ${
        measured === 1 ? 'enquiry' : 'enquiries'
      } breached, but that is below the ${s.min_enquiries_for_rate} needed to report a rate. ` +
      'Read it as a count, not a trend.'
    )
  }

  const promise =
    s.sla_basis === 'business'
      ? `${s.sla_business_days}-business-day promise`
      : `${Math.round((s.sla_minutes ?? 0) / 1440)}-day calendar promise`

  return `${s.sla_breach_rate}% of ${measured} measured ${
    measured === 1 ? 'enquiry' : 'enquiries'
  } breached the ${promise}.`
}

/**
 * Whether the human sign-off on the promise is still outstanding.
 *
 * `sla_is_confirmed` was introduced in 104 and deliberately left false by 109:
 * the clock is real now, the agreement that it measures the right promise is not.
 * Rendering a breach rate without this line would present an unconfirmed reading
 * as a settled one on the screen used to decide staffing.
 */
export function enquiryCaveat(s: EnquirySummary): string | null {
  if (s.sla_is_confirmed) return null
  return (
    'The response promise is measured in business days on the Victorian ' +
    'public-holiday calendar (decision 1-B). Nobody has confirmed that reading yet, ' +
    'so these figures describe a promise that is still provisional.'
  )
}
