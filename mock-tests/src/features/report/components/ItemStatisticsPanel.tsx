import { lagMinutes } from '@/lib/reporting/envelope'
import {
  defectReasonLabel,
  formatPValue,
  itemStatisticsHeadline,
  loadItemStatistics,
  markingCaveat,
  skipRateCaveat,
  topDistractor,
} from '@/lib/reporting/admin-items'
import { ReportStateView, LagBadge } from './ReportStates'
import { ItemScatter } from './charts/ItemScatter'

/**
 * A1 - Item Statistics. "Which items are defective?" -> retire, rewrite or
 * recalibrate. ADMIN only, enforced in SQL by has_role('ADMIN').
 *
 * THE CAVEATS RENDER ABOVE THE CHART, UNCONDITIONALLY WHEN PRESENT. Following the
 * A3 panel's precedent: a warning placed under a long table is a warning nobody
 * reads, and here the caveat is not a footnote but the thing that stops an admin
 * acting on the picture below it. `marking_reliable` is false while
 * responses.is_correct contradicts the authored key, which currently means
 * difficulty and discrimination are computed correctly from a column that does not
 * measure right answers. Both caveats are derived in SQL, so they vanish by
 * themselves once the underlying defect is fixed.
 *
 * THE SCATTER IS THE PRIMARY VIEW because §12 says so, and its reasoning is sound:
 * defectiveness here is a two-variable outlier problem, and a table would need two
 * sorts to show the same quadrant. The table below it exists for the drill-down and
 * for the CSV link, not as the main instrument.
 *
 * A ROW CAP WITH A STATED COUNT. 340 items is too many to render as rows and
 * pretending otherwise just makes the panel unusable, so the table shows the
 * best-evidenced flagged items and says how many remain in the CSV. Silently
 * truncating would hide items from the person whose job is to review them.
 */

/** Rows shown before the panel points at the CSV export instead. */
const ROW_CAP = 25

function Card({
  title,
  reportId,
  subtitle,
  asAt,
  children,
}: {
  title: string
  reportId: string
  subtitle: string
  asAt: string | null
  children: React.ReactNode
}) {
  return (
    <section
      aria-labelledby={`panel-${reportId}`}
      className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-6"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id={`panel-${reportId}`} className="text-sm font-semibold tracking-tight">
            {title}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {reportId} · {subtitle}
          </p>
        </div>
        <LagBadge lagMinutes={lagMinutes(asAt)} asAt={asAt} reportId={reportId} />
      </div>
      {children}
    </section>
  )
}

/** Data-integrity warning. Always above the data, never below it. */
function Caveat({ text, tone }: { text: string | null; tone: 'warn' | 'muted' }) {
  if (!text) return null
  const style =
    tone === 'warn'
      ? 'border-amber-500/30 bg-amber-500/5'
      : 'border-border bg-muted/40 text-muted-foreground'
  return (
    <p role="note" className={`mb-3 rounded-md border px-3 py-2 text-xs ${style}`}>
      {text}
    </p>
  )
}

export async function ItemStatisticsPanel({ testId }: { testId?: string | null } = {}) {
  const result = await loadItemStatistics(testId ?? null)
  const marking = markingCaveat(result.items)
  const skip = skipRateCaveat(result.items)

  // Flagged first, then best-evidenced: the review queue should lead with the items
  // most likely to be worth a decision, not the ones with the least data.
  const flagged = result.items
    .filter((r) => r.is_defective)
    .sort((a, b) => b.responses - a.responses)
  const shown = flagged.slice(0, ROW_CAP)
  const hidden = flagged.length - shown.length

  return (
    <Card
      title="Item statistics"
      reportId="A1"
      subtitle="which items are defective, and on what evidence"
      asAt={result.asAt}
    >
      <ReportStateView
        state={result.error ? 'error' : result.items.length === 0 ? 'empty' : 'ok'}
        emptyTitle="No item responses yet"
        emptyMessage="Item statistics appear once students have answered questions in a published test."
      />

      {!result.error && result.items.length > 0 && (
        <>
          <Caveat text={marking} tone="warn" />
          <Caveat text={skip} tone="muted" />

          <p className="mb-3 text-xs text-muted-foreground">
            {itemStatisticsHeadline(result.items)}
          </p>

          <ItemScatter rows={result.items} thresholds={result.thresholds} />
          {shown.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-xs font-semibold">
                  Flagged items — {flagged.length} of {result.items.length}
                </h3>
                <a
                  href={`/api/reporting/admin/item-statistics?format=csv${
                    testId ? `&testId=${encodeURIComponent(testId)}` : ''
                  }`}
                  className="text-xs underline decoration-dotted underline-offset-2"
                >
                  Export all as CSV
                </a>
              </div>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="bg-muted/60">
                    <tr>
                      {['Item', 'Difficulty', 'n', 'Discrimination', 'Top distractor', 'Why flagged'].map(
                        (h) => (
                          <th key={h} className="border-b border-border px-2 py-1.5 font-medium">
                            {h}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => {
                      const top = topDistractor(r)
                      return (
                        <tr key={r.item_id} className="border-b border-border/50 last:border-0">
                          <td className="px-2 py-1.5">
                            <span className="font-medium">{r.topic ?? 'Untitled'}</span>
                            {r.subject && (
                              <span className="text-muted-foreground"> · {r.subject}</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 tabular-nums">{formatPValue(r.p_value)}</td>
                          <td className="px-2 py-1.5 tabular-nums text-muted-foreground">
                            {r.responses}
                          </td>
                          <td className="px-2 py-1.5 tabular-nums">
                            {r.point_biserial ?? '—'}
                          </td>
                          <td className="px-2 py-1.5 tabular-nums">
                            {top
                              ? `${top.option}${top.share_pct !== null ? ` · ${top.share_pct}%` : ''}`
                              : '—'}
                          </td>
                          {/* The reason in words. §4.6 leaves retire/rewrite/recalibrate
                              to a person who can read the stem, so this states the
                              observation and stops there. */}
                          <td className="px-2 py-1.5 text-muted-foreground">
                            {r.defect_reasons.map(defectReasonLabel).join('; ')}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {hidden > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Showing the {shown.length} best-evidenced of {flagged.length} flagged items. The
                  remaining {hidden} are in the CSV export.
                </p>
              )}
            </div>
          )}

          {result.thresholds && (
            <p className="mt-3 text-[0.6875rem] text-muted-foreground">
              Flagged when: difficulty is outside {(result.thresholds.p_value_floor * 100).toFixed(0)}–
              {(result.thresholds.p_value_ceiling * 100).toFixed(0)}%, discrimination is below{' '}
              {result.thresholds.point_biserial_min}, median time exceeds{' '}
              {result.thresholds.median_time_max_seconds}s, an authored option is never chosen, or a
              wrong option beats the key. Statistics are withheld below{' '}
              {result.thresholds.min_responses_per_item} responses per item. All of these are
              configurable in <code>reporting.item_thresholds</code>.
            </p>
          )}
        </>
      )}
    </Card>
  )
}
