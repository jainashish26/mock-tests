import type { ItemStatisticsRow } from '@/lib/reporting/types'
import type { ItemThresholds } from '@/lib/reporting/admin-items'

/**
 * A1 item statistics, rendered as server-side SVG.
 *
 * §12 specifies this exact visualisation and the reason it gives is the right one:
 * "Which items are defective" is a TWO-VARIABLE outlier problem, so a scatter shows
 * the defective quadrant directly whereas a table needs two sorts for the same
 * insight. Difficulty on x, discrimination on y, point size = response count.
 *
 * FLAGGED BY SHAPE AS WELL AS COLOUR, per §12's "flagged items marked by shape as
 * well as colour" and its note that "shape encoding keeps it colour-blind safe".
 * Acceptable items are circles, flagged ones are diamonds. Roughly 8% of men cannot
 * separate red from green, and an admin printing this to paper loses colour
 * entirely - in both cases shape is the only channel left, so it carries the whole
 * meaning on its own. This mirrors MasteryHeatmap's decal approach.
 *
 * HAND-ROLLED SVG, NOT A CHART LIBRARY. Same reasoning as MasteryHeatmap: ECharts
 * is not a dependency, this must render on the server, and a scatter of a few
 * hundred points with two threshold lines is a few dozen lines of SVG that ship no
 * client runtime and cannot flash or reflow after hydration.
 *
 * ITEMS BELOW THE EVIDENCE FLOOR ARE NOT PLOTTED. They have a null p_value, so
 * there is no coordinate to place them at. Inventing one - plotting them at zero,
 * for instance - would put "not enough data" in the same visual position as "every
 * student got it wrong", which are opposite facts. The caller states their count in
 * words instead.
 */

const W = 660
const H = 380
const M = { top: 16, right: 20, bottom: 46, left: 52 }

const PLOT_W = W - M.left - M.right
const PLOT_H = H - M.top - M.bottom

interface Point {
  row: ItemStatisticsRow
  x: number
  y: number
  r: number
}

/** Symmetric-ish y domain that always contains zero and the discrimination band. */
function yDomain(rows: ItemStatisticsRow[], pbMin: number | null): [number, number] {
  const values = rows
    .map((r) => r.point_biserial)
    .filter((v): v is number => v !== null && Number.isFinite(v))

  const candidates = [0, ...(pbMin !== null ? [pbMin] : [])]
  const lo = values.length > 0 ? Math.min(...values, ...candidates) : Math.min(...candidates)
  const hi = values.length > 0 ? Math.max(...values, ...candidates) : Math.max(...candidates)

  // Pad so points never sit exactly on the frame, and keep a usable span when
  // every item discriminates identically.
  const span = Math.max(hi - lo, 0.2)
  return [Math.floor((lo - span * 0.1) * 10) / 10, Math.ceil((hi + span * 0.1) * 10) / 10]
}

export function ItemScatter({
  rows,
  thresholds,
}: {
  rows: ItemStatisticsRow[]
  thresholds: ItemThresholds | null
}) {
  const plotted = rows.filter((r) => r.p_value !== null && Number.isFinite(r.p_value))

  if (plotted.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No item has enough responses to plot. Difficulty and discrimination are only reported once
        an item passes the configured minimum response count.
      </p>
    )
  }

  const [yLo, yHi] = yDomain(plotted, thresholds?.point_biserial_min ?? null)
  const maxResponses = Math.max(...plotted.map((r) => r.responses), 1)

  const xOf = (p: number) => M.left + p * PLOT_W
  const yOf = (v: number) => M.top + ((yHi - v) / (yHi - yLo)) * PLOT_H

  const points: Point[] = plotted.map((row) => ({
    row,
    x: xOf(row.p_value as number),
    y: yOf(row.point_biserial ?? 0),
    // Area proportional to count, so radius scales with the square root. A linear
    // radius would make a 200-response item look four times as important as a
    // 50-response one rather than four times as well-evidenced.
    r: 2.5 + 5.5 * Math.sqrt(row.responses / maxResponses),
  }))

  const flagged = points.filter((p) => p.row.is_defective).length

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Scatter of ${plotted.length} items: difficulty on the horizontal axis against discrimination on the vertical axis. ${flagged} flagged.`}
      >
        <desc>
          Each point is one item. Horizontal position is the proportion of responses marked correct;
          vertical position is its correlation with the rest of the test. Larger points have more
          responses. Circles are within the configured bands, diamonds are flagged.
        </desc>

        <rect x={M.left} y={M.top} width={PLOT_W} height={PLOT_H} fill="#fafafa" stroke="#e4e4e7" />

        {/* Configured bands, drawn from the thresholds table rather than hardcoded. */}
        {thresholds && (
          <g stroke="#f59e0b" strokeWidth={1} strokeDasharray="4 3">
            <line x1={xOf(thresholds.p_value_floor)} y1={M.top} x2={xOf(thresholds.p_value_floor)} y2={M.top + PLOT_H} />
            <line x1={xOf(thresholds.p_value_ceiling)} y1={M.top} x2={xOf(thresholds.p_value_ceiling)} y2={M.top + PLOT_H} />
            <line x1={M.left} y1={yOf(thresholds.point_biserial_min)} x2={M.left + PLOT_W} y2={yOf(thresholds.point_biserial_min)} />
          </g>
        )}

        {/* Zero discrimination: the line an item that measures nothing sits on. */}
        {yLo < 0 && yHi > 0 && (
          <line x1={M.left} y1={yOf(0)} x2={M.left + PLOT_W} y2={yOf(0)} stroke="#a1a1aa" strokeWidth={1} />
        )}

        <Axes xOf={xOf} yOf={yOf} yLo={yLo} yHi={yHi} />

        {points.map((p) => (
          <Shape key={p.row.item_id} p={p} />
        ))}
      </svg>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.6875rem] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <circle cx="6" cy="6" r="4" fill="#a1a1aa" />
          </svg>
          Within bands ({plotted.length - flagged})
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <polygon points="6,1.5 10.5,6 6,10.5 1.5,6" fill="#d97706" />
          </svg>
          Flagged ({flagged})
        </span>
        <span>Dashed lines are the configured thresholds.</span>
      </figcaption>
    </figure>
  )
}

/**
 * Circle for an item inside the bands, diamond for a flagged one.
 *
 * Shape carries the flag on its own, so the meaning survives greyscale printing
 * and red-green colour vision deficiency. Colour is redundant reinforcement, not
 * the signal.
 */
function Shape({ p }: { p: Point }) {
  const { row, x, y, r } = p
  const label = `${row.topic ?? row.item_id}: ${Math.round((row.p_value ?? 0) * 100)}% correct, discrimination ${
    row.point_biserial ?? 'n/a'
  }, ${row.responses} responses.`

  if (row.is_defective) {
    const d = r * 1.35
    return (
      <polygon
        points={`${x},${y - d} ${x + d},${y} ${x},${y + d} ${x - d},${y}`}
        fill="#d97706"
        fillOpacity={0.75}
        stroke="#92400e"
        strokeWidth={0.75}
      >
        <title>{`${label} Flagged: ${row.defect_reasons.join(', ')}`}</title>
      </polygon>
    )
  }

  return (
    <circle cx={x} cy={y} r={r} fill="#71717a" fillOpacity={0.55} stroke="#52525b" strokeWidth={0.75}>
      <title>{`${label} No flags.`}</title>
    </circle>
  )
}

/** Axis ticks and labels. */
function Axes({
  xOf,
  yOf,
  yLo,
  yHi,
}: {
  xOf: (p: number) => number
  yOf: (v: number) => number
  yLo: number
  yHi: number
}) {
  const xTicks = [0, 0.2, 0.4, 0.6, 0.8, 1]
  const step = (yHi - yLo) / 5
  const yTicks = Array.from({ length: 6 }, (_, i) => Math.round((yLo + step * i) * 100) / 100)

  return (
    <g fontSize={10} fill="#71717a">
      {xTicks.map((t) => (
        <g key={`x${t}`}>
          <line x1={xOf(t)} y1={M.top + PLOT_H} x2={xOf(t)} y2={M.top + PLOT_H + 4} stroke="#a1a1aa" />
          <text x={xOf(t)} y={M.top + PLOT_H + 16} textAnchor="middle">
            {Math.round(t * 100)}%
          </text>
        </g>
      ))}
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line x1={M.left - 4} y1={yOf(t)} x2={M.left} y2={yOf(t)} stroke="#a1a1aa" />
          <text x={M.left - 7} y={yOf(t) + 3} textAnchor="end">
            {t.toFixed(2)}
          </text>
        </g>
      ))}
      <text x={M.left + PLOT_W / 2} y={H - 8} textAnchor="middle" fill="#52525b">
        Difficulty — proportion of responses marked correct
      </text>
      <text
        x={14}
        y={M.top + PLOT_H / 2}
        textAnchor="middle"
        fill="#52525b"
        transform={`rotate(-90 14 ${M.top + PLOT_H / 2})`}
      >
        Discrimination (point-biserial)
      </text>
    </g>
  )
}