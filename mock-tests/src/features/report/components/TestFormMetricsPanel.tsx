import Link from 'next/link'

import {
  abandonmentSentence,
  attentionFlags,
  formatCoefficient,
  formatPct,
  distributionSummary,
  loadTestFormMetrics,
  reliabilityCaveat,
  reliabilityLabel,
  type TestFormDistributionLike,
  type TestFormThresholds,
} from '@/lib/reporting/test-forms'

import { ReportStateView } from './ReportStates'

/**
 * A4 - Test-Form Metrics.
 *
 * "Is this test form fit to stay live?" -> publish, revise or withdraw.
 *
 * TWO QUESTIONS, TWO SHAPES (§13.4)
 *   The table answers "which forms need attention"; the histogram answers "what
 *   shape is this form's score distribution". Distribution SHAPE is the question
 *   - bimodal, ceiling- or floor-clumped - and a histogram is the only chart
 *   that shows it, which is why it is not replaced by a mean and a median.
 *
 * WHY EVERY RATE IS SHOWN WITH ITS n
 *   §13.4 requires a segment below the volume floor to be "shown greyed with its
 *   n, never suppressed silently, so an admin can distinguish 'small' from
 *   'broken'". So a form with four attempts still renders - dimmed, flagged
 *   "Small sample", with 4 visible - instead of vanishing from the table and
 *   leaving the reader to wonder whether it had any attempts at all.
 *
 * WHAT IT REFUSES TO SHOW
 *   A reliability coefficient it does not have. When the item matrix is
 *   incomplete the cell reads "Not computable: ..." with the reason from SQL, and
 *   the caveat above the table says why. A blank cell would read as zero; a dash
 *   alone would read as missing data rather than as an unmet precondition.
 */

interface Props {
  fromDate: number
  toDate: number
  /** Page path used to build row links, e.g. '/admin/reports'. */
  basePath: string
  selectedTestId?: string | null
}

function ThresholdsLine({ thresholds }: { thresholds: TestFormThresholds | null }) {
  if (!thresholds) {
    return (
      <p className="text-xs text-muted-foreground">
        Floors could not be read, so no form is judged against one.
      </p>
    )
  }

  return (
    <p className="text-xs text-muted-foreground">
      Floors: completion needs {thresholds.min_attempts_for_completion} started attempts ·
      reliability needs {thresholds.min_attempts_for_reliability} complete attempts and{' '}
      {thresholds.reliability_floor} · abandonment is flagged above {thresholds.abandonment_alert_pct}%
    </p>
  )
}

function Histogram({
  rows,
  itemsInForm,
}: {
  rows: TestFormDistributionLike[]
  itemsInForm: number
}) {
  const { total, peak } = distributionSummary(rows)

  if (total === 0 || rows.length === 0) {
    return (
      <p className="rounded-lg border border-border px-3 py-6 text-center text-sm text-muted-foreground">
        No scored attempts in this window, so there is no distribution to draw.
        Widening the date range is the first thing to try.
      </p>
    )
  }

  const max = peak?.attempts ?? 0

  return (
    <figure className="mt-3">
      <figcaption className="text-xs text-muted-foreground">
        Score distribution · {total} scored attempts across {itemsInForm} items
        {peak ? ` · tallest bucket ${peak.score_from}-${peak.score_to} (${peak.attempts})` : ''}
      </figcaption>

      {/* Deciles on the x axis, counts on the bar's accessible label. The bar
          heights are the finding; the numbers are in the caption and the title
          attribute so the shape is readable without reading ten labels. */}
      <div className="mt-2 flex h-32 items-end gap-1" role="img" aria-label={`Score distribution, ${total} attempts`}>
        {rows.map((row) => {
          const heightPct = max > 0 ? Math.round((row.attempts / max) * 100) : 0
          return (
            <div key={row.bucket} className="flex flex-1 flex-col items-center justify-end">
              <div
                className="w-full rounded-t bg-primary/70"
                style={{ height: `${Math.max(heightPct, row.attempts > 0 ? 4 : 1)}%` }}
                title={`${row.score_from}-${row.score_to}: ${row.attempts} attempts`}
              />
            </div>
          )
        })}
      </div>

      <div className="mt-1 flex gap-1">
        {rows.map((row) => (
          <span key={row.bucket} className="flex-1 text-center text-[10px] text-muted-foreground">
            {row.score_from}
          </span>
        ))}
      </div>
    </figure>
  )
}

export async function TestFormMetricsPanel({
  fromDate,
  toDate,
  basePath,
  selectedTestId = null,
}: Props) {
  const result = await loadTestFormMetrics({ fromDate, toDate, testId: selectedTestId })

  const heading = (
    <div>
      <h2 className="text-sm font-semibold">A4 · Test-form metrics</h2>
      <p className="text-xs text-muted-foreground">
        Completion, abandonment and score shape per form. Reliability is shown only when the
        item matrix behind it is complete.
      </p>
    </div>
  )

  if (result.error) {
    return (
      <section
        className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-6"
        aria-label="A4 test-form metrics"
      >
        {heading}
        <ReportStateView state="error" compact />
      </section>
    )
  }

  if (result.forms.length === 0) {
    return (
      <section
        className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-6"
        aria-label="A4 test-form metrics"
      >
        {heading}
        <ReportStateView
          state="empty"
          compact
          emptyTitle="No forms had attempts in this window"
          emptyMessage="No test attempt started in the selected date range. Widen the range to see a form's history."
        />
      </section>
    )
  }

  const caveat = reliabilityCaveat(result.forms)
  const focus =
    (selectedTestId && result.forms.find((f) => f.test_id === selectedTestId)) ||
    result.forms[0]

  return (
    <section
      className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-6"
      aria-label="A4 test-form metrics"
    >
      {heading}

      <div className="mt-2">
        <ThresholdsLine thresholds={result.thresholds} />
      </div>

      {caveat ? (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {caveat}
        </p>
      ) : null}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">
            One row per test form: attempts started and submitted, completion, abandonment,
            reliability and score summary.
          </caption>
          <thead className="text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="py-2 pr-3">Form</th>
              <th scope="col" className="py-2 pr-3">Started / submitted</th>
              <th scope="col" className="py-2 pr-3">Completion</th>
              <th scope="col" className="py-2 pr-3">Abandonment</th>
              <th scope="col" className="py-2 pr-3">Reliability</th>
              <th scope="col" className="py-2 pr-3">Score</th>
            </tr>
          </thead>
          <tbody>
            {result.forms.map((form) => {
              const flags = attentionFlags(form)
              const isFocus = form.test_id === focus.test_id
              // §13.4: a below-floor form is dimmed with its n, never hidden.
              const dim = !form.completion_reportable

              return (
                <tr
                  key={form.test_id}
                  className={`border-t border-border align-top ${isFocus ? 'bg-primary/5' : ''} ${
                    dim ? 'opacity-60' : ''
                  }`}
                >
                  <td className="py-2 pr-3">
                    <Link
                      href={`${basePath}?testId=${form.test_id}`}
                      className="font-medium underline-offset-2 hover:underline"
                      aria-current={isFocus ? 'true' : undefined}
                    >
                      {form.test_title ?? 'Untitled form'}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {[form.family_group, form.exam_type, form.content_status]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    {flags.length > 0 ? (
                      <p className="mt-1 flex flex-wrap gap-1">
                        {flags.map((flag) => (
                          <span
                            key={flag}
                            className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                          >
                            {flag}
                          </span>
                        ))}
                      </p>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    {form.attempts_started} / {form.attempts_submitted}
                    <p className="text-xs text-muted-foreground">{form.score_n} scored</p>
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    {formatPct(form.completion_rate_pct)}
                    {!form.completion_reportable ? (
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        below floor
                      </p>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 text-xs">{abandonmentSentence(form)}</td>
                  <td className="py-2 pr-3 tabular-nums">
                    {formatCoefficient(form.reliability_coefficient)}
                    <p className="text-[10px] text-muted-foreground">
                      {reliabilityLabel(form.reliability_state)}
                    </p>
                    {form.items_answered_by_all === 0 && form.items_in_form > 1 ? (
                      <p className="text-[10px] text-muted-foreground">
                        no item seen by every attempt
                      </p>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-xs">
                    mean {formatPct(form.mean_score)} · median {formatPct(form.median_score)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <p className="text-xs font-medium">
          Score distribution · {focus.test_title ?? 'Untitled form'}
        </p>
        <Histogram rows={result.distribution} itemsInForm={focus.items_in_form} />
      </div>
    </section>
  )
}
