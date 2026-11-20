import { callReportingFunction } from './connection'
import { asAtFor } from './lag'
import type { EnquiryDayRow, EnquirySummary } from './enquiry-format'

/**
 * A13 - Enquiry & Support Tracker: the read side.
 *
 * WHY THE VERDICT IS NOT RECOMPUTED HERE
 *   `admin_enquiry_summary` and `admin_enquiry_series` derive every SLA verdict
 *   from `reporting.fact_enquiry`, and `admin_enquiry_queue` derives the same
 *   verdict for the operator's screen from the same deadline. Three copies of
 *   "was this answered in time" in three places is how a board chart and the
 *   queue the team works from start disagreeing about the same enquiry with no
 *   way to say which is right. This module fetches; the database judges;
 *   ./enquiry-format words.
 */

export type { EnquiryDayRow, EnquirySummary } from './enquiry-format'
export { breachRateSentence, enquiryCaveat, measurableCount } from './enquiry-format'

export interface EnquiryReportResult {
  summary: EnquirySummary | null
  days: EnquiryDayRow[]
  asAt: string | null
  error: boolean
  code?: string
}

export async function loadEnquiryReport(
  windowDays: number,
  channel: string | null,
  type: string | null
): Promise<EnquiryReportResult> {
  const [sum, series, asAt] = await Promise.all([
    callReportingFunction<EnquirySummary>('admin_enquiry_summary', {
      p_days: windowDays,
      p_channel: channel,
      p_type: type,
    }),
    callReportingFunction<EnquiryDayRow>('admin_enquiry_series', {
      p_days: windowDays,
      p_channel: channel,
      p_type: type,
    }),
    // The headline reads the fact table and the series reads the rollup, so the
    // freshness stamp shown must be the rollup's: it is the staler of the two,
    // and labelling a fresh number with an old timestamp would be the reverse of
    // the mistake this whole report is trying not to make.
    asAtFor('mv_enquiry_daily'),
  ])

  if (sum.error || series.error) {
    return {
      summary: null,
      days: [],
      asAt,
      error: true,
      code: sum.code ?? series.code,
    }
  }

  return { summary: sum.rows[0] ?? null, days: series.rows, asAt, error: false }
}
