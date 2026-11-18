import type { MasteryRow } from '@/lib/reporting/types'

/**
 * P3 mastery map, rendered as server-side SVG.
 *
 * WHY HAND-ROLLED SVG AND NOT A CHART LIBRARY
 *   14-...md §16 budgets an "ECharts wrapper, SSR-to-SVG" line item, but ECharts
 *   is not a dependency of this project and adding one to draw a grid of
 *   rectangles would cost hundreds of KB of client JavaScript for a chart that
 *   must render on the server anyway. A mastery map is a labelled grid; SVG
 *   expresses it directly, ships no runtime, and is present in the initial HTML
 *   so it cannot flash or reflow after hydration. A chart with real axes,
 *   tooltips and interaction would be the point to reconsider - this is not one.
 *
 * GREYSCALE / COLOUR-VISION SAFETY (the spec's "decal config")
 *   Colour alone is not a channel: a parent printing the report, or one of the
 *   ~8% of men with red-green colour vision deficiency, cannot reliably separate
 *   red from green - and those are precisely the two levels that matter most
 *   here. Every cell therefore carries BOTH a fill and an SVG `<pattern>` decal
 *   (dots / diagonal hatch / solid), so the levels stay distinguishable in
 *   greyscale and in print. Decals are defined once in `<defs>` and referenced by
 *   id, which is why each instance needs a unique id prefix: two maps on one page
 *   would otherwise share pattern definitions and render identically.
 *
 * This is a server component: data in, markup out. No hooks, nothing to hydrate.
 */

/**
 * Deterministic id seed for this instance's `<defs>`.
 *
 * This used to be a module-level counter incremented during render, which the
 * React compiler correctly rejects: mutating a variable outside the component
 * during render is a side effect, and under StrictMode's double render or
 * concurrent rendering the same map would get different ids on different passes
 * - so a `fill="url(#mh3-dots)"` could point at a pattern defined as `mh4-dots`
 * and the cells would silently render as plain fills.
 *
 * Deriving the id from the content is pure and stable across renders. Two maps
 * with different topics get different ids; two maps with IDENTICAL topics would
 * share one, which is harmless because their `<defs>` blocks are then identical
 * anyway. A simple djb2 hash is enough - these ids never leave the document.
 */
function stableId(topics: MasteryRow[]): string {
  let hash = 5381
  const key = topics.map((t) => `${t.subject}/${t.topic}`).join('|')
  for (let i = 0; i < key.length; i += 1) {
    hash = ((hash << 5) + hash + key.charCodeAt(i)) >>> 0
  }
  return hash.toString(36)
}

interface LevelStyle {
  fill: string
  /** Decal pattern id suffix; null means a solid fill with no overlay. */
  decal: 'dots' | 'hatch' | null
  label: string
}

const LEVEL_STYLE: Record<string, LevelStyle> = {
  critical: { fill: '#dc2626', decal: 'dots', label: 'Needs work' },
  watch: { fill: '#d97706', decal: 'hatch', label: 'Watch this' },
  secure: { fill: '#059669', decal: null, label: 'Solid' },
  // Unsignalled topics are rendered, not hidden - a map with holes looks broken.
  // But they are grey and unpatterned, so they read as "no data yet" rather than
  // as a fourth verdict on the child.
  unknown: { fill: '#d4d4d8', decal: null, label: 'Not enough practice' },
}

const LEVEL_ORDER = ['critical', 'watch', 'secure', 'unknown'] as const

const CELL_W = 92
const CELL_H = 34
const CELL_GAP = 6
const COLS = 4
const PAD = 4

/** CSS approximation of each decal, so the legend matches the cells. */
function legendSwatchStyle(level: string): React.CSSProperties {
  const base: React.CSSProperties = {
    width: 11,
    height: 11,
    borderRadius: 2,
    background: LEVEL_STYLE[level].fill,
  }
  if (LEVEL_STYLE[level].decal === 'dots') {
    return {
      ...base,
      backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1.2px)',
      backgroundSize: '5px 5px',
    }
  }
  if (LEVEL_STYLE[level].decal === 'hatch') {
    return {
      ...base,
      backgroundImage: 'repeating-linear-gradient(45deg, #fff 0 1px, transparent 1px 4px)',
    }
  }
  return base
}

export function MasteryHeatmap({
  topics,
  caption,
}: {
  /** Rows to render, already ordered weakest-first. */
  topics: MasteryRow[]
  caption?: string
}) {
  if (topics.length === 0) return null

  const uid = `mh${stableId(topics)}`
  const cols = Math.min(COLS, topics.length)
  const rows = Math.ceil(topics.length / cols)
  const width = cols * CELL_W + (cols - 1) * CELL_GAP + PAD * 2
  const height = rows * CELL_H + (rows - 1) * CELL_GAP + PAD * 2

  return (
    <figure style={{ margin: 0 }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={caption ?? 'Mastery by topic'}
        style={{ display: 'block', maxWidth: '100%' }}
      >
        <defs>
          <pattern id={`${uid}-dots`} width="6" height="6" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="#dc2626" />
            <circle cx="3" cy="3" r="1.4" fill="#ffffff" opacity="0.85" />
          </pattern>
          {/* Diagonal hatch: distinct from dots in greyscale, where both would
              otherwise collapse to a mid-grey fill. */}
          <pattern id={`${uid}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="#d97706" />
            <path d="M0,6 L6,0" stroke="#ffffff" strokeWidth="1.4" opacity="0.85" />
          </pattern>
        </defs>

        {topics.map((t, i) => {
          const col = i % cols
          const row = Math.floor(i / cols)
          const x = PAD + col * (CELL_W + CELL_GAP)
          const y = PAD + row * (CELL_H + CELL_GAP)

          // An unsignalled topic is forced to 'unknown' whatever the database
          // banded it as: two responses are not a verdict, and rendering them red
          // would tell a parent their child failed something they barely tried.
          const level = t.has_signal ? t.mastery_level : 'unknown'
          const style = LEVEL_STYLE[level] ?? LEVEL_STYLE.unknown
          const fill = style.decal ? `url(#${uid}-${style.decal})` : style.fill
          const light = level === 'unknown'

          // Truncated for the cell; the full name is in the <title> and in the
          // data table below, so nothing is lost by shortening it here.
          const short = t.topic.length > 15 ? `${t.topic.slice(0, 14)}…` : t.topic

          return (
            <g key={`${t.subject}-${t.topic}`}>
              <title>
                {`${t.subject} — ${t.topic}: ${style.label}${
                  t.has_signal && t.accuracy_pct !== null
                    ? `, ${t.accuracy_pct}% correct across ${t.items_answered} questions`
                    : `, ${t.items_answered} question${t.items_answered === 1 ? '' : 's'} so far`
                }`}
              </title>
              <rect
                x={x}
                y={y}
                width={CELL_W}
                height={CELL_H}
                rx={5}
                fill={fill}
                stroke="rgba(0,0,0,0.12)"
                strokeWidth={1}
              />
              <text x={x + 7} y={y + 14} fontSize={9.5} fontWeight={600} fill={light ? '#3f3f46' : '#ffffff'}>
                {short}
              </text>
              <text x={x + 7} y={y + 26} fontSize={8.5} fill={light ? '#52525b' : 'rgba(255,255,255,0.9)'}>
                {t.has_signal && t.accuracy_pct !== null
                  ? `${t.accuracy_pct}% · ${t.items_answered}q`
                  : `${t.items_answered}q — too few`}
              </text>
            </g>
          )
        })}
      </svg>
      {/* The legend states what each decal means, because a pattern without a
          key is decoration. Swatches repeat fill AND decal so the legend is
          itself greyscale-safe - a legend that relies on colour to explain a
          chart that must not rely on colour would defeat the point. */}
      <ul
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.75rem',
          margin: '0.625rem 0 0',
          padding: 0,
          listStyle: 'none',
          fontSize: '0.6875rem',
          color: 'var(--muted-foreground)',
        }}
      >
        {LEVEL_ORDER.map((level) => (
          <li key={level} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <span aria-hidden="true" style={legendSwatchStyle(level)} />
            {LEVEL_STYLE[level].label}
          </li>
        ))}
      </ul>

      {caption && (
        <figcaption
          style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--muted-foreground)' }}
        >
          {caption}
        </figcaption>
      )}
    </figure>
  )
}

