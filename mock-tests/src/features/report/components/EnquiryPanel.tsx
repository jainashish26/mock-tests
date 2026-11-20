import type { ReactNode } from 'react'

import {
  breachRateSentence,
  enquiryCaveat,
  loadEnquiryReport,
  type EnquiryDayRow,
  type EnquirySummary,
} from '@/lib/reporting/admin-enquiries'

/**
 * A13 - Enquiry & Support Tracker.
 *
 * Sits under A12 on the reports page because the three are read together: A11 says
 * where the funnel leaks, A12 says whether a change fixed it, and A13 says whether
 * the human side of the promise is being kept. A conversion rate that looks healthy
 * while enquiries rot unanswered is not a healthy funnel.
 *
 * WHAT THIS PANEL REFUSES TO DO
 *   Show a percentage it cannot defend. Three states stay visibly separate rather
 *   than folding into one number:
 *     * enquiries closed with no recorded response - unknown, neither met nor slow
 *     * enquiries with no computable deadline - excluded from the rate's
 *       denominator, and counted so the exclusion is visible
 *     * a measured sample below min_enquiries_for_rate - rendered as a count with
 *       an explanation, never as a trend
 *   Each is a place where a plausible-looking number would be more dangerous than
 *   no number at all.
 */

const WINDOW_DAYS = 90

function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold ${tone ?? 'text-foreground'}`}>{value}</p>
    </div>
  )
}

function EnquiryBody({ summary: s, days }: { summary: EnquirySummary; days: EnquiryDayRow[] }) {
  const caveat = enquiryCaveat(s)

  return (
    <>
      {caveat ? (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {caveat}
        </p>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Enquiries" value={String(s.enquiries)} />
        <Tile
          label="Breached"
          value={String(s.sla_breached)}
          tone={s.sla_breached > 0 ? 'text-destructive' : 'text-foreground'}
        />
        <Tile label="Reply not recorded" value={String(s.response_unrecorded)} tone="text-slate-600" />
        <Tile label="Converted" value={String(s.converted)} />
      </div>

      {/* The one line that must never render a bare percentage. */}
      <p className="mt-3 text-sm font-medium">{breachRateSentence(s)}</p>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
        <Row
          label="Median first reply"
          value={s.first_response_hours_median === null ? '—' : `${s.first_response_hours_median} h`}
        />
        <Row
          label="Median resolution"
          value={s.resolution_hours_median === null ? '—' : `${s.resolution_hours_median} h`}
        />
        <Row label={`Over ${s.resolution_sla_hours} h`} value={s.resolution_over_sla} />
        <Row label="Still within" value={s.sla_within} />
        <Row label="At risk" value={s.sla_at_risk} />
        <Row
          label="No deadline computable"
          value={
            <>
              {s.sla_unmeasurable}
              {s.sla_unmeasurable > 0 ? (
                <span className="ml-1 text-xs text-amber-700">(holiday calendar gap)</span>
              ) : null}
            </>
          }
        />
      </dl>

      {/*
        Stated rather than assumed, because a zero here is the easiest number on
        the page to misread as "enquiries do not convert". Conversions are recorded
        against a specific order; nothing infers them from a matching account.
      */}
      <p className="mt-3 text-xs text-muted-foreground">
        {s.converted === 0
          ? 'Conversion is recorded by an admin against a specific order or subscription, never inferred from a matching account — so a zero here means nobody has recorded one yet, not that none happened.'
          : `The ${s.converted} ${
              s.converted === 1 ? 'conversion' : 'conversions'
            } above counted only within the ${
              s.conversion_window_days
            }-day window, and conversion is recorded by an admin against a specific order rather than inferred from a matching account.`}
      </p>

      {days.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium">
            Daily detail ({days.length} {days.length === 1 ? 'day' : 'days'})
          </summary>
          <table className="mt-2 w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 font-medium">Day</th>
                <th className="py-1 pr-3 font-medium">Enquiries</th>
                <th className="py-1 pr-3 font-medium">Met</th>
                <th className="py-1 pr-3 font-medium">Breached</th>
                <th className="py-1 pr-3 font-medium">Unrecorded</th>
                <th className="py-1 pr-3 font-medium">No deadline</th>
                <th className="py-1 font-medium">Converted</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date_key} className="border-t border-border">
                  <td className="py-1 pr-3 font-mono">{d.the_date ?? d.date_key}</td>
                  <td className="py-1 pr-3">{d.enquiries}</td>
                  <td className="py-1 pr-3">{d.sla_met}</td>
                  <td className="py-1 pr-3">{d.sla_breached}</td>
                  <td className="py-1 pr-3">{d.response_unrecorded}</td>
                  <td className="py-1 pr-3">{d.sla_unmeasurable}</td>
                  <td className="py-1">{d.converted}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">
            The series is read from the daily rollup, so its per-day reply median is
            the mean of that day&apos;s group medians rather than a true median of the
            underlying enquiries. The headline figure above is the true one.
          </p>
        </details>
      ) : null}
    </>
  )
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}

export async function EnquiryPanel() {
  const result = await loadEnquiryReport(WINDOW_DAYS, null, null)

  return (
    <section
      aria-labelledby="a13-enquiries"
      className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="a13-enquiries" className="text-lg font-semibold">
          A13 · Enquiries &amp; support
        </h2>
        <span className="text-xs text-muted-foreground">
          Last {WINDOW_DAYS} days
          {result.asAt ? ` · figures as at ${new Date(result.asAt).toLocaleString()}` : ''}
        </span>
      </div>

      {result.error ? (
        <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          The enquiry report could not be loaded.
        </p>
      ) : !result.summary ? (
        <p className="mt-3 text-sm text-muted-foreground">
          The tracker returned nothing. That is not the same as no enquiries: it
          means the report could not be computed.
        </p>
      ) : (
        <EnquiryBody
          summary={result.summary}
          days={result.days}
        />
      )}
    </section>
  )
}
