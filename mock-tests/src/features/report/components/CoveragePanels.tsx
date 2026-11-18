import { lagMinutes } from '@/lib/reporting/envelope'
import {
  coverageCaveat,
  coverageStatusLabel,
  draftAgeNote,
  loadCoverageGaps,
  loadProductionQueue,
} from '@/lib/reporting/admin-coverage'
import { ReportStateView, LagBadge } from './ReportStates'

/**
 * A3 (Curriculum Coverage Gaps, admin) and TC1 (Production Queue, creator).
 *
 * Both read `reporting.mv_topic_coverage`, so the commissioning view and the
 * authoring view cannot disagree about the same sub-topic - §4.5 gives them the
 * same owning metrics for exactly that reason.
 *
 * THE CAVEAT IS RENDERED FIRST, AND UNCONDITIONALLY WHEN PRESENT
 *   `coverage_thresholds.min_items_per_subtopic` is NULL, which disables the
 *   TOO_FEW branch of `coverage_status`. Every sub-topic currently reports
 *   ADEQUATE, including ones with a single published item. So the caveat is not
 *   a footnote - it is what stops a reader taking the table below it as a clean
 *   bill of health. Placing it above the rows is deliberate: a warning under a
 *   long table is a warning nobody reads.
 *
 *   `coverageStatusLabel()` refuses to print "Adequate" while the threshold is
 *   unset, rendering "Unclassified" instead. Putting that in the label function
 *   rather than in each screen means no surface can accidentally render the raw
 *   status as a verdict.
 */

/** Shared card shell. Local rather than imported: the parent panels' version is
 *  keyed on an h3 and a reportId-derived aria id, these use an h2. */
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

/** The unconfigured-threshold warning. Rendered above any data, never below. */
function Caveat({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <p
      role="note"
      className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs"
    >
      {text}
    </p>
  )
}

const A3_COLUMNS = ['Subject', 'Topic', 'Sub-topic', 'Exam type', 'Published', 'Drafts', 'Status']

/** Rows shown before the table points at the CSV export instead. */
const A3_ROW_CAP = 200

/** A3 - Curriculum Coverage Gaps. ADMIN only (enforced in SQL). */
export async function CoverageGapsPanel({ examType }: { examType?: string | null } = {}) {
  const result = await loadCoverageGaps(examType ?? null)
  const caveat = coverageCaveat(result.gaps)
  const nonePublished = result.gaps.filter((g) => g.coverage_status === 'NONE_PUBLISHED').length

  return (
    <Card
      title="Curriculum coverage gaps"
      reportId="A3"
      subtitle="where the item bank is too thin to serve"
      asAt={result.asAt}
    >
      <ReportStateView
        state={result.error ? 'error' : result.gaps.length === 0 ? 'empty' : 'ok'}
        // The empty wording differs by whether the threshold is set, because the
        // two empties mean different things: "nothing is missing" versus
        // "nothing is at zero, and the rest cannot be classified".
        emptyTitle={caveat ? 'No sub-topic is missing published items entirely' : 'No coverage gaps'}
        emptyMessage={
          caveat
            ? 'Nothing is at zero. Whether the rest is thick enough cannot be answered until the minimum-items threshold is configured.'
            : 'Every sub-topic meets the configured minimum.'
        }
      />

      <Caveat text={caveat} />

      {!result.error && result.gaps.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm">
            {result.gaps.length} sub-topic{result.gaps.length === 1 ? '' : 's'} listed
            {nonePublished > 0 ? `, ${nonePublished} with nothing published at all` : ''}.
          </p>

          {/* Open by default only when something is genuinely at zero: that is
              the case an operator must see without clicking. */}
          <details className="text-xs" open={nonePublished > 0}>
            <summary className="cursor-pointer font-medium text-muted-foreground">
              Coverage table
            </summary>
            <div className="mt-2 max-h-80 overflow-auto rounded-md border border-border">
              <table className="w-full border-collapse text-left">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                  <tr>
                    {A3_COLUMNS.map((h) => (
                      <th key={h} className="border-b border-border px-2 py-1.5 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.gaps.slice(0, A3_ROW_CAP).map((g) => (
                    <tr
                      key={`${g.subject}-${g.topic}-${g.sub_topic}-${g.exam_type}`}
                      className="border-b border-border/50 last:border-0"
                    >
                      <td className="px-2 py-1">{g.subject}</td>
                      <td className="px-2 py-1">{g.topic}</td>
                      <td className="px-2 py-1">{g.sub_topic}</td>
                      <td className="px-2 py-1 text-muted-foreground">{g.exam_type}</td>
                      <td className="px-2 py-1 tabular-nums">{g.published_count}</td>
                      <td className="px-2 py-1 tabular-nums text-muted-foreground">
                        {g.draft_count}
                      </td>
                      <td className="px-2 py-1">
                        {/* Never the raw status while the threshold is unset. */}
                        <span
                          className={
                            g.coverage_status === 'NONE_PUBLISHED'
                              ? 'font-medium text-destructive'
                              : 'text-muted-foreground'
                          }
                        >
                          {coverageStatusLabel(g)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.gaps.length > A3_ROW_CAP && (
                <p className="px-2 py-1.5 text-muted-foreground">
                  Showing {A3_ROW_CAP} of {result.gaps.length}. Use the CSV export for the full
                  list.
                </p>
              )}
            </div>
          </details>
        </div>
      )}
    </Card>
  )
}

/** Rows rendered inline; the rest are available via the CSV export. */
const TC1_ROW_CAP = 25

/** TC1 - Content Coverage & Production Queue. TEST_CREATOR / ADMIN. */
export async function ProductionQueuePanel({ limit = 50 }: { limit?: number } = {}) {
  const result = await loadProductionQueue(limit)
  const caveat = coverageCaveat(result.queue)

  return (
    <Card title="Production queue" reportId="TC1" subtitle="what to write next, ranked" asAt={result.asAt}>
      <ReportStateView
        state={result.error ? 'error' : result.queue.length === 0 ? 'empty' : 'ok'}
        emptyTitle="Nothing queued"
        emptyMessage="Every sub-topic meets the configured coverage minimum."
      />

      <Caveat text={caveat} />

      {!result.error && result.queue.length > 0 && (
        <ol className="space-y-1.5">
          {result.queue.slice(0, TC1_ROW_CAP).map((row) => {
            const note = draftAgeNote(row)
            return (
              <li
                key={`${row.subject}-${row.topic}-${row.sub_topic}-${row.exam_type}`}
                className="flex items-start justify-between gap-3 border-b border-border/50 pb-1.5 text-xs last:border-0"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    <span className="mr-1.5 tabular-nums text-muted-foreground">
                      {row.production_priority}.
                    </span>
                    {row.sub_topic}
                    <span className="ml-1.5 font-normal text-muted-foreground">
                      {row.topic} · {row.subject}
                    </span>
                  </p>
                  <p className="mt-0.5 text-muted-foreground">
                    {row.exam_type} · {row.published_count} published
                    {row.draft_count > 0 ? ` · ${row.draft_count} draft` : ''}
                    {/* The deficit is stated only when a threshold exists.
                        Printing "0 more needed" would be the opposite of the
                        truth, and printing nothing at all is what NULL is for. */}
                    {row.deficit !== null ? ` · ${row.deficit} more needed` : ''}
                    {note ? ` · ${note}` : ''}
                  </p>
                </div>
                {row.coverage_status === 'NONE_PUBLISHED' && (
                  <span className="shrink-0 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-destructive">
                    None live
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </Card>
  )
}


