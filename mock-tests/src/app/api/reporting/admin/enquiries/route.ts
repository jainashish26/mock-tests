import { envelope, reportJson } from '@/lib/reporting/envelope'
import { requireReportingRole } from '@/lib/reporting/route-auth'
import { csvResponse } from '@/lib/reporting/csv'
import {
  breachRateSentence,
  enquiryCaveat,
  loadEnquiryReport,
  type EnquiryDayRow,
  type EnquirySummary,
} from '@/lib/reporting/admin-enquiries'

/**
 * A13 - Enquiry & Support Tracker. GET /api/reporting/admin/enquiries
 *
 * "Are enquiries answered in time, and do they convert?" The decision it supports
 * is staffing: whether one person can keep the promise, and whether the queue is
 * actually producing customers.
 *
 * WHY THE WINDOW DEFAULTS TO 90 DAYS
 *   A 7-day window on a support queue typically holds single-digit counts, and a
 *   breach rate computed from four enquiries is noise with a percent sign on it.
 *   The config floor (min_enquiries_for_rate) governs whether the rate is
 *   reportable at all, so a short window is still honest - but the default should
 *   not invite reading a trend out of a handful of rows.
 *
 * CSV CARRIES THE COUNTS, NOT THE RATE
 *   Anyone exporting this is going to recompute the ratio in a spreadsheet from a
 *   denominator they chose, not the one the report defends. Both the numerator and
 *   the two excluded populations (unrecorded, unmeasurable) are therefore exported
 *   as counts so the number can be rebuilt and argued with, rather than a
 *   percentage that can only be accepted.
 */

const REPORT_ID = 'A13'
const TTL_SECONDS = 900
const DEFAULT_DAYS = 90
const MAX_DAYS = 3650

const CSV_COLUMNS = [
  'date_key',
  'the_date',
  'enquiries',
  'sla_met',
  'sla_breached',
  'response_unrecorded',
  'sla_unmeasurable',
  'first_response_hours_median',
  'converted',
]

interface A13Dto {
  summary: EnquirySummary
  days: EnquiryDayRow[]
  breachRateSentence: string
  caveat: string | null
}

function intParam(sp: URLSearchParams, name: string, fallback: number, max: number): number {
  const raw = sp.get(name)
  if (raw === null) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(Math.floor(n), max)
}

function strParam(sp: URLSearchParams, name: string): string | null {
  const v = sp.get(name)
  return v && v.trim().length > 0 ? v.trim() : null
}

export async function GET(req: Request) {
  const auth = await requireReportingRole(REPORT_ID, ['ADMIN'])
  if (!auth.ok) return auth.response

  const sp = new URL(req.url).searchParams
  const windowDays = intParam(sp, 'window', DEFAULT_DAYS, MAX_DAYS)
  const channel = strParam(sp, 'channel')
  const type = strParam(sp, 'type')
  const wantCsv = sp.get('format') === 'csv'

  const result = await loadEnquiryReport(windowDays, channel, type)

  if (result.error) {
    // 42501 is the database refusing a non-admin, 22023 a bad filter, anything
    // else an unreachable warehouse. Collapsing them would hide an auth problem
    // behind a generic outage message.
    const status = result.code === '42501' ? 403 : result.code === '22023' ? 400 : 503

    if (wantCsv) {
      return new Response('Export unavailable\n', {
        status,
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    }

    return reportJson(
      envelope<A13Dto>({ reportId: REPORT_ID, data: null, asAt: result.asAt, state: 'error' }),
      { status }
    )
  }

  if (wantCsv) {
    return csvResponse(
      `enquiries-${windowDays}d.csv`,
      CSV_COLUMNS,
      result.days.map((d) => ({ ...d }))
    )
  }

  const summary = result.summary

  // A missing summary row means the RPC returned nothing. For an ADMIN that is not
  // an empty state but a failure of authorisation or deployment, so it is reported
  // as an error rather than rendered as a dashboard of zeroes.
  if (!summary) {
    return reportJson(
      envelope<A13Dto>({ reportId: REPORT_ID, data: null, asAt: result.asAt, state: 'error' }),
      { status: 503 }
    )
  }

  return reportJson(
    envelope<A13Dto>({
      reportId: REPORT_ID,
      data: {
        summary,
        days: result.days,
        breachRateSentence: breachRateSentence(summary),
        caveat: enquiryCaveat(summary),
      },
      asAt: result.asAt,
      state: 'ok',
    }),
    { status: 200, ttlSeconds: TTL_SECONDS }
  )
}
