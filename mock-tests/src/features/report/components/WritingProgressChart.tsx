import type { WritingProgressPoint } from '@/lib/writing/types'

/**
 * Hand-rolled SVG line chart for writing progress. Follows the item-scatter /
 * mastery-heatmap convention (no chart dependency, server-rendered). X is the
 * chronological attempt/practice index, Y is a 0-100 score. The overall score
 * is the bold line; the five rubric categories are faint context lines.
 */

const W = 660
const H = 340
const M = { top: 20, right: 24, bottom: 48, left: 46 }

const CATEGORY_KEYS = [
  'language_mechanics',
  'vocabulary',
  'cohesion_structure',
  'content_ideas',
  'engagement_style',
] as const

const CATEGORY_COLOURS: Record<(typeof CATEGORY_KEYS)[number], string> = {
  language_mechanics: '#94a3b8',
  vocabulary: '#a5b4fc',
  cohesion_structure: '#6ee7b7',
  content_ideas: '#fcd34d',
  engagement_style: '#f9a8d4',
}

const CATEGORY_LABELS: Record<(typeof CATEGORY_KEYS)[number], string> = {
  language_mechanics: 'Language Mechanics',
  vocabulary: 'Vocabulary',
  cohesion_structure: 'Cohesion & Structure',
  content_ideas: 'Content & Ideas',
  engagement_style: 'Engagement & Style',
}

function xOf(i: number, n: number) {
  return M.left + (n <= 1 ? 0.5 : i / (n - 1)) * (W - M.left - M.right)
}
function yOf(v: number) {
  return M.top + ((100 - v) / 100) * (H - M.top - M.bottom)
}

export function WritingProgressChart({ points }: { points: WritingProgressPoint[] }) {
  if (points.length === 0) {
    return (
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
        No writing results yet. Once a writing task or practice is graded, the trend will appear here.
      </p>
    )
  }

  const n = points.length
  const dateLabel = (p: WritingProgressPoint) => {
    const d = new Date(p.date)
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Writing score trend over time" style={{ width: '100%', height: 'auto' }}>
        {[0, 25, 50, 75, 100].map((t) => (
          <g key={t}>
            <line x1={M.left} y1={yOf(t)} x2={W - M.right} y2={yOf(t)} stroke="#e2e8f0" strokeWidth={1} />
            <text x={M.left - 8} y={yOf(t) + 3} textAnchor="end" fontSize={10} fill="#71717a">
              {t}
            </text>
          </g>
        ))}

        {CATEGORY_KEYS.map((k) => {
          const valid = points.filter((p) => p.categories[k] !== null)
          if (valid.length === 0) return null
          return (
            <polyline
              key={k}
              points={points.map((p, i) => `${xOf(i, n)},${yOf(p.categories[k] ?? 0)}`).join(' ')}
              fill="none"
              stroke={CATEGORY_COLOURS[k]}
              strokeWidth={1}
              strokeOpacity={0.6}
            />
          )
        })}

        <polyline
          points={points.map((p, i) => `${xOf(i, n)},${yOf(p.score)}`).join(' ')}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth={2.5}
        />

        {points.map((p, i) => (
          <circle key={i} cx={xOf(i, n)} cy={yOf(p.score)} r={4} fill="var(--color-primary)">
            <title>{`${dateLabel(p)} — ${Math.round(p.score)}%`}</title>
          </circle>
        ))}

        {points.map((p, i) => (
          <text key={`x${i}`} x={xOf(i, n)} y={H - 22} textAnchor="middle" fontSize={9} fill="#71717a">
            {dateLabel(p)}
          </text>
        ))}

        <text x={M.left + (W - M.left - M.right) / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="#52525b">
          Most recent →
        </text>
        <text x={14} y={M.top + (H - M.top - M.bottom) / 2} textAnchor="middle" fontSize={10} fill="#52525b" transform={`rotate(-90 14 ${M.top + (H - M.top - M.bottom) / 2})`}>
          Score (%)
        </text>
      </svg>

      <figcaption style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem', marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
          <span style={{ width: '10px', height: '3px', background: 'var(--color-primary)', display: 'inline-block' }} /> Overall score
        </span>
        {CATEGORY_KEYS.map((k) =>
          points.some((p) => p.categories[k] !== null) ? (
            <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ width: '10px', height: '3px', background: CATEGORY_COLOURS[k], display: 'inline-block' }} /> {CATEGORY_LABELS[k]}
            </span>
          ) : null
        )}
      </figcaption>
    </figure>
  )
}