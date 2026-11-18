import type { ReportState } from '@/lib/reporting/envelope'
import { UNKNOWN_LAG } from '@/lib/reporting/envelope'
import { formatLag } from '@/lib/reporting/lag'

/**
 * The four states every reporting screen must render (13-...md §12.1).
 *
 * WHY THESE ARE SHARED COMPONENTS AND NOT PER-SCREEN COPY
 *   The failure mode this prevents is specific and expensive: a screen that
 *   renders its `empty` state when the query actually FAILED. "No completed
 *   tests yet" and "we could not load this" look identical if each screen
 *   writes its own fallback, and the first tells a parent something untrue
 *   about their child. One component, one wording, one rule: an error never
 *   renders as empty.
 *
 * WHY `low_data` IS ITS OWN STATE
 *   A figure computed from too little data is not wrong and not absent - it is
 *   untrustworthy. Suppressing it silently would leave a hole the parent
 *   fills with a guess; showing it unqualified would be a misleading claim
 *   about a child. So it renders with an explicit explanation of what would
 *   firm it up, which is also the reason to sit another test.
 */

interface ReportStateViewProps {
  state: ReportState
  /** Heading for the empty state, e.g. "No completed tests yet". */
  emptyTitle?: string
  /** Supporting sentence for the empty state. */
  emptyMessage?: string
  /** What would make the data trustworthy, for the low_data state. */
  lowDataMessage?: string
  /** Compact variant for narrow panels. */
  compact?: boolean
}

/**
 * Render the non-ok states. Returns null for `ok`, so a caller can place this
 * beside its real content without a conditional.
 */
export function ReportStateView({
  state,
  emptyTitle = 'Nothing to show yet',
  emptyMessage = 'There is no data for this report yet.',
  lowDataMessage = 'There is not enough practice behind this figure to show it responsibly yet.',
  compact = false,
}: ReportStateViewProps) {
  if (state === 'ok') return null

  const pad = compact ? 'p-3' : 'p-5'

  if (state === 'error') {
    return (
      <div
        role="alert"
        className={`${pad} rounded-lg border border-destructive/30 bg-destructive/5 text-sm`}
      >
        <p className="font-semibold text-destructive">We could not load this</p>
        {/* Never "no data": an error rendered as an absence tells the reader
            something untrue about their child. */}
        <p className="mt-1 text-muted-foreground">
          This is a problem on our side, not a result. Please try again shortly.
        </p>
      </div>
    )
  }

  if (state === 'low_data') {
    return (
      <div className={`${pad} rounded-lg border border-amber-500/30 bg-amber-500/5 text-sm`}>
        <p className="font-semibold">Not enough practice yet</p>
        <p className="mt-1 text-muted-foreground">{lowDataMessage}</p>
      </div>
    )
  }

  // 'empty'
  return (
    <div className={`${pad} rounded-lg border border-dashed border-border text-sm`}>
      <p className="font-medium text-foreground">{emptyTitle}</p>
      <p className="mt-1 text-muted-foreground">{emptyMessage}</p>
    </div>
  )
}

interface LagBadgeProps {
  /** Minutes since the underlying view last refreshed. */
  lagMinutes: number | null | undefined
  /** ISO timestamp, used for the accessible full timestamp. */
  asAt?: string | null
  /** Report ID, for the tooltip - tells an operator WHICH view is stale. */
  reportId?: string
}

/**
 * The refresh-lag badge. Required on every dashboard (§12.1).
 *
 * A stale materialised view is indistinguishable from a correct one, so this
 * badge is the only defence against acting on yesterday's number as today's.
 * It renders an unknown lag as "unknown" rather than omitting itself: a
 * missing badge reads as "fresh", which is the exact misreading it exists to
 * prevent.
 */
export function LagBadge({ lagMinutes, asAt, reportId }: LagBadgeProps) {
  // The UNKNOWN_LAG sentinel is finite, so `isFinite` alone does not catch it.
  // Without the explicit comparison an unknown lag would render as a colossal
  // "days ago" figure - a confident wrong number where honesty belongs.
  const unknown =
    lagMinutes === null ||
    lagMinutes === undefined ||
    !Number.isFinite(lagMinutes) ||
    lagMinutes >= UNKNOWN_LAG

  // Over 24h the view has missed its nightly refresh. That is an operational
  // fault, not a normal state, so it is coloured rather than merely labelled.
  const stale = !unknown && lagMinutes > 1440

  const label = unknown ? 'Data freshness unknown' : formatLag(lagMinutes)

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium ${
        stale
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : 'border-border bg-muted/40 text-muted-foreground'
      }`}
      title={
        asAt
          ? `${reportId ? `${reportId} · ` : ''}Data as at ${new Date(asAt).toLocaleString()}`
          : reportId
            ? `${reportId} · refresh time unknown`
            : undefined
      }
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${stale ? 'bg-destructive' : 'bg-muted-foreground/60'}`} />
      {label}
    </span>
  )
}
