import { loadExperimentResults, groupByExperiment } from '@/lib/reporting/admin-experiments'
import {
  ciCrossesZero,
  experimentDecisionLabel,
  experimentHeadline,
  forestDomain,
  forestPosition,
} from '@/lib/reporting/format'
import type { ExperimentResultRow } from '@/lib/reporting/types'
import { ReportStateView } from './ReportStates'

/**
 * A12 - Experiment Results, as a forest plot.
 *
 * WHY A FOREST PLOT AND NOT A BAR CHART
 *   `13-...md` §13 is explicit: "The decision is 'is the interval clear of zero,
 *   and is the effect big enough'. A forest plot answers both; a two-bar chart
 *   answers neither." Two bars showing 50% vs 75% look like a decisive loss; the
 *   interval around that difference on four users per arm spans -65 to +32 points
 *   and says the opposite. The chart has to show the uncertainty or it will
 *   manufacture confidence.
 *
 * COLOUR IS NOT THE ONLY CHANNEL
 *   An interval that crosses zero is drawn DASHED with a hollow marker; one that
 *   clears zero is SOLID with a filled marker. A reader printing in greyscale, or
 *   with red-green colour vision deficiency, still sees the distinction - which
 *   matters because "clear of zero" is the whole decision.
 *
 * SERVER-RENDERED SVG
 *   Same reasoning as the mastery heatmap: no chart library is a dependency, the
 *   plot is a handful of lines and circles, and rendering it on the server means
 *   it is in the initial HTML rather than appearing after hydration.
 */

const PLOT_LEFT = 150
const PLOT_RIGHT = 560
const ROW_H = 34

/** One arm's whisker + marker, on the shared axis. */
function ForestRow({
  row,
  domain,
  y,
}: {
  row: ExperimentResultRow
  domain: { min: number; max: number }
  y: number
}) {
  const crosses = ciCrossesZero(row)
  const hasCi = row.ci_lower_pp !== null && row.ci_upper_pp !== null && row.diff_pp !== null

  const x = (v: number) =>
    PLOT_LEFT + (forestPosition(v, domain) / 100) * (PLOT_RIGHT - PLOT_LEFT)

  const colour = crosses ? '#71717a' : row.diff_pp! > 0 ? '#059669' : '#dc2626'

  return (
    <g>
      <title>
        {`${row.variant}: ${row.conversions}/${row.sample_size} converted` +
          (hasCi
            ? `, difference ${row.diff_pp} pp, 95% interval ${row.ci_lower_pp} to ${row.ci_upper_pp} pp`
            : '')}
      </title>
      <text x={4} y={y + 4} fontSize={10.5} fill="currentColor">
        {row.variant}
      </text>
      <text x={4} y={y + 16} fontSize={9} fill="#71717a">
        {row.conversions}/{row.sample_size} · {row.variant_conversion_rate ?? 0}%
      </text>

      {hasCi ? (
        <>
          {/* Whisker: dashed when the interval includes zero, so the "direction
              not established" case is visible without relying on hue. */}
          <line
            x1={x(row.ci_lower_pp!)}
            x2={x(row.ci_upper_pp!)}
            y1={y}
            y2={y}
            stroke={colour}
            strokeWidth={2}
            strokeDasharray={crosses ? '4 3' : undefined}
          />
          <line x1={x(row.ci_lower_pp!)} x2={x(row.ci_lower_pp!)} y1={y - 5} y2={y + 5} stroke={colour} strokeWidth={2} />
          <line x1={x(row.ci_upper_pp!)} x2={x(row.ci_upper_pp!)} y1={y - 5} y2={y + 5} stroke={colour} strokeWidth={2} />
          <circle
            cx={x(row.diff_pp!)}
            cy={y}
            r={4.5}
            fill={crosses ? '#ffffff' : colour}
            stroke={colour}
            strokeWidth={2}
          />
        </>
      ) : (
        <text x={PLOT_LEFT} y={y + 4} fontSize={9.5} fill="#71717a">
          no interval yet
        </text>
      )}
    </g>
  )
}

export async function ExperimentsPanel() {
  const result = await loadExperimentResults()
  const groups = groupByExperiment(result.rows)

  return (
    <section
      aria-labelledby="panel-A12"
      className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-6"
    >
      <div className="mb-3">
        <h2 id="panel-A12" className="text-sm font-semibold tracking-tight">
          Experiments
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          A12 · difference vs control with 95% intervals · computed on read
        </p>
      </div>

      <ReportStateView
        state={result.error ? 'error' : result.rows.length === 0 ? 'empty' : 'ok'}
        emptyTitle="No experiments running"
        emptyMessage="Results appear once an experiment is RUNNING and its arms have been exposed."
      />

      {!result.error && groups.length > 0 && (
        <div className="space-y-5">
          <p className="text-sm font-medium">{experimentHeadline(result.rows)}</p>

          {groups.map((group) => {
            const arms = group.arms.filter((a) => !a.is_control)
            const control = group.arms.find((a) => a.is_control) ?? null
            const domain = forestDomain(arms)
            const height = Math.max(arms.length, 1) * ROW_H + 26
            const zeroX =
              PLOT_LEFT + (forestPosition(0, domain) / 100) * (PLOT_RIGHT - PLOT_LEFT)

            return (
              <div key={group.key} className="rounded-lg border border-border p-3">
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-xs font-semibold">{group.name}</h3>
                  <span className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
                    {group.status}
                  </span>
                </div>
                {control && (
                  <p className="mb-2 text-[0.6875rem] text-muted-foreground">
                    Control “{control.variant}”: {control.conversions}/{control.sample_size} converted
                    ({control.variant_conversion_rate ?? 0}%)
                  </p>
                )}

                <svg
                  viewBox={`0 0 580 ${height}`}
                  width="100%"
                  height={height}
                  role="img"
                  aria-label={`Difference from control with 95% confidence intervals for ${group.name}`}
                  style={{ display: 'block', maxWidth: '100%', color: 'var(--foreground)' }}
                >
                  {/* Zero reference line. Everything is judged against it. */}
                  <line x1={zeroX} x2={zeroX} y1={6} y2={height - 20} stroke="#a1a1aa" strokeWidth={1} strokeDasharray="3 3" />
                  <text x={zeroX} y={height - 8} fontSize={9} fill="#71717a" textAnchor="middle">
                    no difference
                  </text>
                  <text x={PLOT_LEFT} y={height - 8} fontSize={9} fill="#71717a">
                    {domain.min} pp
                  </text>
                  <text x={PLOT_RIGHT} y={height - 8} fontSize={9} fill="#71717a" textAnchor="end">
                    +{domain.max} pp
                  </text>

                  {arms.map((arm, i) => (
                    <ForestRow key={arm.variant} row={arm} domain={domain} y={20 + i * ROW_H} />
                  ))}
                </svg>
                {/* Verdict AND reason. The reason is required by §5.4 so a human
                    can disagree; a verdict alone would read as an instruction. */}
                <ul className="mt-2 space-y-1.5">
                  {arms.map((arm) => (
                    <li key={arm.variant} className="text-xs">
                      <span className="font-semibold">{arm.variant}</span>
                      <span className="ml-1.5 rounded-full border border-border px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wide">
                        {experimentDecisionLabel(arm.recommended_decision)}
                      </span>
                      <p className="mt-0.5 text-muted-foreground">{arm.decision_reason}</p>
                    </li>
                  ))}
                </ul>

                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer font-medium text-muted-foreground">
                    Show the numbers
                  </summary>
                  <table className="mt-2 w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        {['Arm', 'Exposed', 'Converted', 'Rate', 'Diff (pp)', '95% interval', 'p'].map((h) => (
                          <th key={h} className="py-1 pr-2 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {group.arms.map((arm) => (
                        <tr key={arm.variant} className="border-b border-border/50 last:border-0">
                          <td className="py-1 pr-2">{arm.variant}{arm.is_control ? ' (control)' : ''}</td>
                          <td className="py-1 pr-2 tabular-nums">{arm.sample_size}</td>
                          <td className="py-1 pr-2 tabular-nums">{arm.conversions}</td>
                          <td className="py-1 pr-2 tabular-nums">{arm.variant_conversion_rate ?? '—'}%</td>
                          <td className="py-1 pr-2 tabular-nums">{arm.diff_pp ?? '—'}</td>
                          <td className="py-1 pr-2 tabular-nums">
                            {arm.ci_lower_pp === null ? '—' : `[${arm.ci_lower_pp}, ${arm.ci_upper_pp}]`}
                          </td>
                          <td className="py-1 tabular-nums">{arm.p_value_experiment ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

