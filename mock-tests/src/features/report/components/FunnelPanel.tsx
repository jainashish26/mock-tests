import { lagMinutes } from '@/lib/reporting/envelope'
import { loadFunnel } from '@/lib/reporting/admin-funnel'
import { funnelHeadline, rateLabel, stageLabel, weakestStage } from '@/lib/reporting/format'
import type { FunnelSegment } from '@/lib/reporting/types'
import { ReportStateView, LagBadge } from './ReportStates'

/**
 * A11 - Conversion Funnel. "Where are we losing people?"
 *
 * THIS IS THE PANEL THAT MAKES THE INSTRUMENTATION WORTH ANYTHING
 *   The funnel was fully instrumented and nothing read it. `15-...md` §2.2 calls
 *   that out: every conversion lever - sibling offer, locked-click
 *   personalisation, re-purchase - needs this first, because without it each one
 *   is a guess. It also turns out the underlying SQL had never worked at all
 *   (migration 054): the stage ranker matched the wrong vocabulary, so the report
 *   returned zero rows for any date range.
 *
 * DESIGN RULES ENFORCED HERE
 *   1. Drop-off is shown BESIDE the percentage, never instead of it. §5.4's own
 *      caveat: "A 50% drop on 2 users is not a finding."
 *   2. Suppressed rows say "too small" rather than printing a rate. A 62% computed
 *      from 5 visitors looks identical to one computed from 500, and treating them
 *      alike is how a team spends a sprint chasing noise.
 *   3. `prev_stage` is rendered. Chaining skips empty stages (056), so a rate may
 *      be measured against a stage further up the funnel; hiding which one would
 *      mislabel the measurement.
 *   4. The device gap is reported only when it is real. C9 is now met - device is
 *      derived server-side and inherited by stage events - but `deviceGap` is
 *      computed from the data rather than hardcoded, so if capture ever regresses
 *      the panel says so instead of rendering a one-row "unknown" breakdown that
 *      looks like a finding.
 */

/** Rows shown inline; the CSV export carries the rest. */
const ROW_CAP = 40

const SEGMENT_LABEL: Record<FunnelSegment, string> = {
  none: 'all traffic',
  channel: 'by channel',
  campaign: 'by campaign',
  device: 'by device',
}

/** One outcome figure, always with the denominator it was computed from. */
function Metric({ label, value, basis }: { label: string; value: string; basis: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
      {/* C5 requires the denominator to be stated explicitly, not implied. */}
      <dd className="mt-0.5 text-[0.6875rem] text-muted-foreground">{basis}</dd>
    </div>
  )
}

export async function FunnelPanel({
  fromDate,
  toDate,
  segment = 'none',
  showOutcomes = true,
}: {
  fromDate: number
  toDate: number
  segment?: FunnelSegment
  /**
   * Outcome metrics are NOT segmented (free-to-paid, abandonment and
   * time-to-first-value are whole-funnel figures), so a segmented panel must not
   * repeat them beside a device breakdown - that would imply the rates above were
   * device-specific when they are not.
   */
  showOutcomes?: boolean
}) {
  const result = await loadFunnel(fromDate, toDate, segment)
  const o = result.outcomes
  const weakest = weakestStage(result.stages)
  const deviceGap = result.stages.every((s) => s.device_class === 'unknown')

  return (
    <section
      aria-labelledby="panel-A11"
      className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-6"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="panel-A11" className="text-sm font-semibold tracking-tight">
            Conversion funnel
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A11 · {SEGMENT_LABEL[segment]} · refreshed hourly at :05
          </p>
        </div>
        <LagBadge lagMinutes={lagMinutes(result.asAt)} asAt={result.asAt} reportId="A11" />
      </div>

      <ReportStateView
        state={result.error ? 'error' : result.stages.length === 0 ? 'empty' : 'ok'}
        emptyTitle="No funnel activity in this period"
        emptyMessage="Stage counts appear once visitors move through signup."
      />

      {!result.error && result.stages.length > 0 && (
        <div className="space-y-4">
          <p className="text-sm font-medium">{funnelHeadline(result.stages)}</p>

          {showOutcomes && o && (
            <dl className="grid gap-3 sm:grid-cols-3">
              <Metric
                label="Free → paid"
                value={rateLabel(o.free_to_paid_rate, o.suppressed)}
                basis={`${o.paying} of ${o.reached_paywall} who reached the paywall`}
              />
              <Metric
                label="Checkout abandonment"
                value={rateLabel(o.checkout_abandonment_rate, o.suppressed)}
                basis={`${o.checkout_abandoned} of ${o.checkout_started} who started checkout`}
              />
              <Metric
                label="Time to first value"
                value={
                  o.median_hours_to_first_value === null ? '—' : `${o.median_hours_to_first_value} h`
                }
                basis={`median of ${o.activated} activated of ${o.signup_cohort} signups`}
              />
            </dl>
          )}

          {showOutcomes && o?.suppressed && (
            <p
              role="note"
              className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs"
            >
              At least one denominator is below the 20-visitor reporting floor, so the rates above
              are marked “too small” rather than shown. Widen the date range for a reliable figure.
            </p>
          )}

          {deviceGap && (
            <p className="text-xs text-muted-foreground">
              Device split (C9) is unavailable: no device or user-agent is captured on funnel
              events, so every row reads “unknown”. Capturing it at ingest would make the breakdown
              real.
            </p>
          )}
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="bg-muted/60">
                <tr>
                  {['Stage', 'Visitors', 'Measured from', 'Conversion', 'Lost'].map((h) => (
                    <th key={h} className="border-b border-border px-2 py-1.5 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.stages.slice(0, ROW_CAP).map((s) => {
                  const isWeakest = weakest !== null && s.stage === weakest.stage && !s.suppressed
                  return (
                    <tr
                      key={`${s.stage}-${s.channel}-${s.campaign}-${s.device_class}`}
                      className={
                        isWeakest
                          ? 'border-b border-border/50 bg-destructive/5'
                          : 'border-b border-border/50'
                      }
                    >
                      <td className="px-2 py-1">
                        {stageLabel(s.stage)}
                        {segment !== 'none' && (
                          <span className="ml-1.5 text-muted-foreground">
                            {s.channel !== '(all)' ? s.channel : ''}
                            {s.campaign !== '(all)' ? ` · ${s.campaign}` : ''}
                            {s.device_class !== '(all)' ? ` · ${s.device_class}` : ''}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1 tabular-nums">{s.visitors}</td>
                      {/* The stage this rate is measured against, because chaining
                          skips empty stages. Omitting it mislabels the number. */}
                      <td className="px-2 py-1 text-muted-foreground">
                        {s.prev_stage === null ? '—' : stageLabel(s.prev_stage)}
                      </td>
                      <td className="px-2 py-1 tabular-nums">
                        {rateLabel(s.stage_conversion_rate, s.suppressed)}
                      </td>
                      <td className="px-2 py-1 tabular-nums">
                        {isWeakest ? (
                          <span className="font-semibold text-destructive">
                            −{s.stage_dropoff_count}
                          </span>
                        ) : (
                          `−${s.stage_dropoff_count}`
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {result.stages.length > ROW_CAP && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                Showing {ROW_CAP} of {result.stages.length} rows. Use ?format=csv for the full set.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
