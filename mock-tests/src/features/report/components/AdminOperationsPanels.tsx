import { lagMinutes } from '@/lib/reporting/envelope'
import {
  capacitySentence,
  defaultDateRange,
  loadPlatformHealth,
  loadDataQuality,
  qualityVerdict,
  refreshLagRows,
  worstErrorRate,
  type DataQualityRow,
} from '@/lib/reporting/admin-operations'
import { ReportStateView, LagBadge } from './ReportStates'

/**
 * A14 (Platform Health) and A15 (Data Quality) panels for the admin surface.
 *
 * WHY THESE TWO SIT TOGETHER
 *   They answer the two questions an operator asks in the same breath: "is the
 *   platform coping?" and "can I trust what it is telling me?". A health
 *   dashboard with no data-quality panel invites the operator to act on numbers
 *   that stopped loading two days ago - which is worse than no dashboard,
 *   because the absence of data is at least visible.
 *
 * A-13 IS STATED ON SCREEN, NOT BURIED IN A COMMENT
 *   `concurrency_vs_cap` divides by 200, a target from the project brief that
 *   nothing in the repository corroborates as a measurement. `capacitySentence`
 *   says so in the rendered output whenever `cap_is_measured` is false. An
 *   operator deciding whether to scale must not mistake an assumption for an
 *   observation.
 */

const STATUS_STYLE: Record<string, string> = {
  OK: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700',
  WARN: 'border-amber-500/30 bg-amber-500/10 text-amber-700',
  FAIL: 'border-destructive/40 bg-destructive/10 text-destructive',
  // Grey, not red: NOT_IMPLEMENTED means "not built yet", and colouring it as a
  // failure would make A15 permanently red and train operators to ignore it.
  NOT_IMPLEMENTED: 'border-border bg-muted/50 text-muted-foreground',
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide ${
        STATUS_STYLE[status] ?? STATUS_STYLE.NOT_IMPLEMENTED
      }`}
    >
      {status.replace('_', ' ')}
    </span>
  )
}

/** Rows capped in the on-page table; the CSV export has no cap. */
const TABLE_ROW_CAP = 200

/**
 * Default A15 lookback. Seven days is enough to see whether a check started
 * failing or has been failing, which is the distinction that decides whether
 * this is an incident or a chronic problem. The endpoint caps at 366.
 */
const HISTORY_DAYS = 7

const A14_COLUMNS = ['Hour', 'Active', 'Concurrent', 'Cap %', 'Started', 'Submitted', 'Err %']

/**
 * A14 - Platform Health & Usage.
 *
 * Renders the summary an operator needs at a glance, plus a `<details>` block
 * for the hourly rows. The hourly series is the evidence behind the summary,
 * and progressive disclosure keeps the verdict on screen rather than pushing
 * it below 200 rows of table.
 */
export async function PlatformHealthPanel({
  fromDate,
  toDate,
}: {
  fromDate?: number
  toDate?: number
}) {
  const defaults = defaultDateRange(7)
  const from = fromDate ?? defaults.from
  const to = toDate ?? defaults.to

  const result = await loadPlatformHealth(from, to)

  const peakConcurrencyValue = result.hours.reduce(
    (s, h) => Math.max(s, h.peak_concurrency ?? 0),
    0
  )
  const activePeak = result.hours.reduce((s, h) => Math.max(s, h.active_users ?? 0), 0)
  const totalStarted = result.hours.reduce((s, h) => s + (h.tests_started ?? 0), 0)
  const totalSubmitted = result.hours.reduce((s, h) => s + (h.tests_submitted ?? 0), 0)
  const totalErrors = result.hours.reduce((s, h) => s + (h.errors ?? 0), 0)

  const capacity = result.hours.length > 0 ? capacitySentence(result.hours) : null
  const worst = worstErrorRate(result.hours)

  return (
    <section
      aria-labelledby="panel-A14"
      className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-6"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="panel-A14" className="text-sm font-semibold tracking-tight">
            Platform health
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A14 · refreshes every 15 minutes · {from}–{to}
          </p>
        </div>
        <LagBadge lagMinutes={lagMinutes(result.asAt)} asAt={result.asAt} reportId="A14" />
      </div>

      <ReportStateView
        state={result.error ? 'error' : result.hours.length === 0 ? 'empty' : 'ok'}
        emptyTitle="No activity recorded yet"
        emptyMessage="Health metrics appear once tests are started or events are tracked in this window."
      />

      {!result.error && result.hours.length > 0 && (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Peak concurrent tests', value: String(peakConcurrencyValue) },
              { label: 'Peak active users', value: String(activePeak) },
              { label: 'Tests started', value: String(totalStarted) },
              { label: 'Errors logged', value: String(totalErrors) },
            ].map((stat) => (
              <div key={stat.label} className="rounded-lg border border-border/70 p-3">
                <dt className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
                  {stat.label}
                </dt>
                <dd className="mt-1 text-xl font-bold tabular-nums">{stat.value}</dd>
              </div>
            ))}
          </dl>

          {/* The capacity sentence carries the A-13 qualifier inline. */}
          {capacity && <p className="text-xs text-muted-foreground">{capacity}</p>}

          {worst && (
            <p className="text-xs">
              <span className="font-medium text-destructive">
                Worst error rate {worst.rate}%
              </span>{' '}
              <span className="text-muted-foreground">
                in the hour starting {new Date(worst.hourStart).toLocaleString()}
              </span>
            </p>
          )}

          {totalStarted > 0 && (
            <p className="text-xs text-muted-foreground">
              {totalSubmitted} of {totalStarted} started tests submitted (
              {Math.round((totalSubmitted / totalStarted) * 100)}%). A low ratio is
              abandonment or a failing submit path, not a scoring problem.
            </p>
          )}

          <details className="text-xs">
            <summary className="cursor-pointer font-medium text-muted-foreground">
              Hourly detail ({result.hours.length} rows)
            </summary>
            <div className="mt-2 max-h-72 overflow-auto rounded-md border border-border">
              <table className="w-full border-collapse text-left">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                  <tr>
                    {A14_COLUMNS.map((h) => (
                      <th key={h} className="border-b border-border px-2 py-1.5 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.hours.slice(0, TABLE_ROW_CAP).map((h) => (
                    <tr key={h.hour_start} className="border-b border-border/50 last:border-0">
                      <td className="whitespace-nowrap px-2 py-1">
                        {new Date(h.hour_start).toLocaleString()}
                      </td>
                      <td className="px-2 py-1 tabular-nums">{h.active_users}</td>
                      <td className="px-2 py-1 tabular-nums">{h.peak_concurrency}</td>
                      <td className="px-2 py-1 tabular-nums">
                        {h.concurrency_vs_cap === null
                          ? '—'
                          : `${Math.round(h.concurrency_vs_cap * 100)}%`}
                      </td>
                      <td className="px-2 py-1 tabular-nums">{h.tests_started}</td>
                      <td className="px-2 py-1 tabular-nums">{h.tests_submitted}</td>
                      <td className="px-2 py-1 tabular-nums">
                        {h.test_error_rate === null ? '—' : `${h.test_error_rate}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.hours.length > TABLE_ROW_CAP && (
                <p className="px-2 py-1.5 text-muted-foreground">
                  Showing the {TABLE_ROW_CAP} most recent hours. Use the CSV export for the full
                  range.
                </p>
              )}
            </div>
          </details>
        </div>
      )}
    </section>
  )
}

/** Split lag rows so the operator sees the problem views first. */
function splitLagRows(rows: DataQualityRow[]) {
  return {
    stale: rows.filter((r) => r.status !== 'OK'),
    fresh: rows.filter((r) => r.status === 'OK'),
  }
}

/**
 * A15 - Data Quality & Reconciliation.
 *
 * "Can we trust the data?" The decision it supports is repair-before-reporting:
 * an operator who does not know that `fact_item_response` stopped loading will
 * confidently act on a trend line that quietly flattened.
 *
 * HISTORY, AND WHY IT MATTERS FOR THIS REPORT
 *   §4.6 gives A15 a `day × check` grain. The view behind it
 *   (`reporting.mv_data_quality`) is replaced on every refresh and stamps rows
 *   with CURRENT_DATE, so on its own it holds one day. Migration 038 added
 *   `reporting.data_quality_history`, which the nightly job snapshots into, and
 *   repointed `admin_data_quality()` at it - so the date range this panel sends
 *   is now real rather than decorative.
 *
 *   That matters because most A15 checks are only actionable as a trend:
 *   `untagged_items` going 0 -> 0 -> 40 names the day a bad bulk import landed,
 *   where a lone reading of 40 only says something is wrong. Same for refresh
 *   lag - history is what separates one missed nightly run from a cron job that
 *   stopped running a week ago.
 *
 * WHY THE LAG ROWS GET THEIR OWN BLOCK
 *   They gate trust in every OTHER dashboard, not just this one. Buried in an
 *   alphabetical list of integrity checks, the row saying "mv_attempt_history
 *   has not refreshed in 16 hours" is exactly the row an operator scrolls past.
 */
export async function DataQualityPanel({ days = HISTORY_DAYS }: { days?: number } = {}) {
  const range = defaultDateRange(days)
  const result = await loadDataQuality(range.from, range.to)

  const lagRows = refreshLagRows(result.checks)
  const { stale, fresh } = splitLagRows(lagRows)
  const integrityChecks = result.checks.filter((c) => c.check_name !== 'mv_refresh_lag_minutes')

  return (
    <section
      aria-labelledby="panel-A15"
      className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-6"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="panel-A15" className="text-sm font-semibold tracking-tight">
            Data quality
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A15 · nightly at 04:00 and after each refresh · last {days} days
          </p>
        </div>
        <LagBadge lagMinutes={lagMinutes(result.asAt)} asAt={result.asAt} reportId="A15" />
      </div>

      {/* No rows at all is an ERROR, not an empty state: A15 always produces
          rows once it has run, including rows reporting that other views are
          stale. An empty result means the view itself has never refreshed. */}
      <ReportStateView
        state={result.error || result.checks.length === 0 ? 'error' : 'ok'}
        compact
      />

      {!result.error && result.checks.length === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          The data-quality view has never been refreshed. Run{' '}
          <code className="rounded bg-muted px-1 py-0.5">
            SELECT reporting.safe_refresh(&apos;reporting.mv_data_quality&apos;, true);
          </code>
        </p>
      )}

      {!result.error && result.checks.length > 0 && (
        <div className="space-y-5">
          <p className="text-sm font-medium">{qualityVerdict(result.checks)}</p>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Materialised view freshness
            </h3>

            {stale.length > 0 && (
              <ul className="mb-2 space-y-1">
                {stale.map((r) => (
                  <li
                    key={r.object_name}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="min-w-0 truncate font-medium">{r.object_name}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="tabular-nums text-muted-foreground">
                        {r.metric_value === null ? 'never refreshed' : `${r.metric_value} min`}
                      </span>
                      <StatusPill status={r.status} />
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <details className="text-xs">
              <summary className="cursor-pointer font-medium text-muted-foreground">
                {fresh.length} view{fresh.length === 1 ? '' : 's'} up to date
              </summary>
              <ul className="mt-1.5 space-y-1">
                {fresh.map((r) => (
                  <li key={r.object_name} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-muted-foreground">{r.object_name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {r.metric_value} min
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Integrity checks
            </h3>
            <ul className="space-y-1.5">
              {integrityChecks.map((c) => (
                <li
                  key={`${c.check_name}-${c.object_name}`}
                  className="flex items-start justify-between gap-3 border-b border-border/50 pb-1.5 last:border-0"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium">{c.check_name.replace(/_/g, ' ')}</p>
                    <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">{c.detail}</p>
                  </div>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {c.metric_value === null ? '—' : c.metric_value}
                    </span>
                    <StatusPill status={c.status} />
                  </span>
                </li>
              ))}
            </ul>
          </div>

        </div>
      )}
    </section>
  )
}



