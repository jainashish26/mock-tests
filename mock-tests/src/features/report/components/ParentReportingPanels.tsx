import {
  loadParentHistory,
  primaryFamily,
  sectionTrends,
  trendSentence,
} from '@/lib/reporting/parent-history'
import {
  loadParentBehaviour,
  adherencePct,
  behaviourSentence,
  formatDuration,
  paceLabel,
} from '@/lib/reporting/parent-behaviour'
import {
  loadParentRecommendations,
  actionSentence,
  accuracySentence,
} from '@/lib/reporting/parent-recommendations'
import { loadParentProjection, noProjectionSentence, projectionBandSentence } from '@/lib/reporting/parent-projection'
import { loadParentMastery, masteryHeadline, splitBySignal } from '@/lib/reporting/parent-mastery'
import {
  loadParentPercentile,
  cohortContextSentence,
  percentileSentence,
  progressPairingSentence,
} from '@/lib/reporting/parent-percentile'
import { MasteryHeatmap } from './charts/MasteryHeatmap'
import { CONFIDENCE_LABEL } from '@/lib/report/readiness'
import { ReportStateView, LagBadge } from './ReportStates'

/**
 * Parent-facing Phase 1 report panels: P1 projection, P4 trends, P7 behaviour,
 * P8 recommendations.
 *
 * A SERVER COMPONENT THAT LOADS ITS OWN DATA
 *   Each panel calls its reporting module directly rather than fetching the
 *   JSON API. The APIs exist because §12.2 specifies them and because the P9
 *   plan form is a client component that must PUT; but a server component
 *   calling `/api/reporting/...` over HTTP would be a loopback request with a
 *   serialisation round trip and no benefit. Both paths go through the same
 *   SECURITY DEFINER functions, so the authorisation is identical.
 *
 * THE RULE THESE PANELS FOLLOW
 *   §4.4: plain English, at most five key visuals per screen, one clear next
 *   action per screen, and every prediction showing its uncertainty. So each
 *   panel renders ONE headline sentence plus a small supporting detail, not a
 *   grid of numbers. A parent given nine metrics makes no decision; a parent
 *   given one sentence and one action makes the decision the report exists to
 *   support.
 */

interface PanelShellProps {
  title: string
  reportId: string
  asAt: string | null
  lagMinutes: number | null
  children: React.ReactNode
}

/** Card + heading + lag badge. Every panel shows its lag (§12.1). */
function Panel({ title, reportId, asAt, lagMinutes, children }: PanelShellProps) {
  return (
    <section
      aria-labelledby={`panel-${reportId}`}
      className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 id={`panel-${reportId}`} className="text-sm font-semibold tracking-tight">
          {title}
        </h3>
        <LagBadge lagMinutes={lagMinutes} asAt={asAt} reportId={reportId} />
      </div>
      {children}
    </section>
  )
}

/** Minutes since an ISO timestamp, for panels whose module has no lag lookup. */
function lagFrom(asAt: string | null): number | null {
  if (!asAt) return null
  const then = new Date(asAt).getTime()
  if (Number.isNaN(then)) return null
  return Math.max(0, Math.floor((Date.now() - then) / 60000))
}

/**
 * P1 - the projection range, and only that.
 *
 * The readiness score, bands and topic gaps already render on
 * /parent/readiness/[childId] via ReadinessReportView. This panel adds the one
 * thing that report lacks: a projection with an explicit range. Duplicating the
 * readiness score here would create a second place for the two to disagree.
 *
 * When `eligible` is false there are NO NUMBERS AT ALL - not a greyed-out
 * forecast, not a low-confidence figure. The reason from SQL is shown instead,
 * and that reason is itself the next action ("2 of 3 tests completed").
 */
function ProjectionPanel({
  projection,
  asAt,
  error,
}: {
  projection: Awaited<ReturnType<typeof loadParentProjection>>['projection']
  asAt: string | null
  error: boolean
}) {
  const lag = lagFrom(asAt)

  return (
    <Panel title="Projected outcome" reportId="P1" asAt={asAt} lagMinutes={lag}>
      <ReportStateView state={error ? 'error' : 'ok'} compact />

      {!error && !projection?.eligible && (
        <p className="text-sm text-muted-foreground">
          {noProjectionSentence(projection)}
        </p>
      )}

      {!error && projection?.eligible && (
        <div className="space-y-2">
          <p className="text-sm">
            <span className="font-semibold text-foreground">
              {projectionBandSentence(projection)}
            </span>{' '}
            by exam day
          </p>

          {/* The range is shown, not just the point. A single number would read
              as a forecast; a band with a confidence label reads as an estimate. */}
          <p className="text-xs text-muted-foreground">
            Based on {projection.attempts_completed} completed tests and
            {projection.weeks_to_exam !== null ? ` ${projection.weeks_to_exam} weeks` : ''} of
            practice to go. {CONFIDENCE_LABEL[projection.confidence]}.
          </p>

          <p className="text-xs text-muted-foreground">
            This is an estimate from your child&rsquo;s own results on this platform, not a
            predicted exam score.
          </p>
        </div>
      )}
    </Panel>
  )
}

/**
 * P4 - Test history & trends.
 *
 * Leads with the trend sentence for the family with the most attempts, then a
 * `<details>` table of the underlying rows. §13 of 13-...md specifies
 * progressive disclosure for row-level data: the headline answer is visible
 * without interaction, and the numbers behind it are one click away rather
 * than occupying the screen.
 */
function HistoryPanel({
  history,
}: {
  history: Awaited<ReturnType<typeof loadParentHistory>>
}) {
  const lead = primaryFamily(history.summary)
  const sections = lead ? sectionTrends(history.attempts, lead.family_group) : []

  return (
    <Panel
      title="Progress & trends"
      reportId="P4"
      asAt={history.asAt}
      lagMinutes={lagFrom(history.asAt)}
    >
      <ReportStateView
        state={history.error ? 'error' : history.attempts.length === 0 ? 'empty' : 'ok'}
        emptyTitle="No completed tests yet"
        emptyMessage="Trends appear once your child has sat a test."
        compact
      />

      {!history.error && history.attempts.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium">{trendSentence(lead)}</p>

          {sections.length > 0 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {sections.map((s) => (
                <li key={s.section}>
                  {s.section}:{' '}
                  <span className="font-medium text-foreground">{Math.round(s.latest)}%</span>
                  {s.delta !== null && (
                    <span className={s.delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                      {' '}
                      ({s.delta >= 0 ? '+' : ''}
                      {Math.round(s.delta)})
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          <details className="text-sm">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              Show all {history.attempts.length} tests
            </summary>
            <ul className="mt-2 space-y-1.5">
              {history.attempts.map((a) => (
                <li
                  key={a.attempt_id}
                  className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5 last:border-0"
                >
                  <span className="min-w-0 truncate text-xs">
                    {a.test_title}
                    <span className="ml-1.5 text-muted-foreground">
                      {new Date(a.started_at).toLocaleDateString()}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold">
                    {a.score === null ? '—' : `${Math.round(a.score)}%`}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </Panel>
  )
}

/**
 * P7 - Study behaviour.
 *
 * The next action is "adjust the plan" (§4.4), so the panel links to P9 rather
 * than ending in a number with nowhere to go.
 *
 * Pace is NEVER rendered on its own: `paceLabel()` takes accuracy as a required
 * second argument and returns null without it. Fast + wrong is guessing, slow +
 * right is labouring, and a pace figure shown alone tells a parent their careful
 * child is "too slow".
 */
function BehaviourPanel({
  behaviour,
  latestAccuracy,
  studentId,
}: {
  behaviour: Awaited<ReturnType<typeof loadParentBehaviour>>
  /** Overall accuracy from the child's attempts, required to interpret pace. */
  latestAccuracy: number | null
  studentId: string
}) {
  const latest = behaviour.weeks[0] ?? null
  const adherence = latest ? adherencePct(latest) : null
  const pace = latest ? paceLabel(latest.pace_vs_expected, latestAccuracy) : null

  return (
    <Panel
      title="How they practise"
      reportId="P7"
      asAt={behaviour.asAt}
      lagMinutes={lagFrom(behaviour.asAt)}
    >
      <ReportStateView
        state={behaviour.error ? 'error' : behaviour.weeks.length === 0 ? 'empty' : 'ok'}
        emptyTitle="No practice recorded yet"
        emptyMessage="Sessions, time on task and adherence appear after the first test."
        compact
      />

      {!behaviour.error && latest && (
        <div className="space-y-2">
          <p className="text-sm">{behaviourSentence(latest)}</p>

          {adherence !== null && (
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
              role="img"
              aria-label={`${adherence}% of the weekly practice goal`}
            >
              <div className="h-full rounded-full bg-primary" style={{ width: `${adherence}%` }} />
            </div>
          )}

          {pace && <p className="text-xs text-muted-foreground">{pace}</p>}

          {/* The two proxy metrics are labelled as estimates. Presenting an
              inference as a measurement of a child's intent is a claim the
              data cannot support. */}
          <p className="text-xs text-muted-foreground">
            Week of {new Date(latest.week_start).toLocaleDateString()} ·{' '}
            {formatDuration(latest.time_on_task_seconds)} on task
            {latest.skip_rate !== null && ` · ${latest.skip_rate}% skipped`}
            {latest.guess_rate !== null && ` · ~${latest.guess_rate}% answered very quickly and wrong (estimate)`}
          </p>

          <a href={`/parent/child/${studentId}#plan`} className="text-xs font-medium text-primary underline-offset-2 hover:underline">
            Adjust the plan →
          </a>
        </div>
      )}
    </Panel>
  )
}

/**
 * P8 - Recommended next actions.
 *
 * At most three items, enforced by `LIMIT 3` in SQL. The empty state is worded
 * carefully: it means no topic has five or more responses yet, so there is no
 * signal to rank. That is NOT "your child has no gaps", and the copy says so -
 * a parent reading the second interpretation would stop practising.
 *
 * `expected_impact_score` is never rendered. It is a ranking key, not a
 * predicted score gain, and showing it as a number would imply a precision the
 * heuristic does not have.
 */
function RecommendationsPanel({
  recommendations,
}: {
  recommendations: Awaited<ReturnType<typeof loadParentRecommendations>>
}) {
  return (
    <Panel
      title="What to practise next"
      reportId="P8"
      asAt={recommendations.asAt}
      lagMinutes={lagFrom(recommendations.asAt)}
    >
      <ReportStateView
        state={recommendations.error ? 'error' : recommendations.recommendations.length === 0 ? 'empty' : 'ok'}
        emptyTitle="Not enough practice to recommend yet"
        emptyMessage="Recommendations appear once your child has answered at least five questions in a topic. This is not a sign that there are no gaps - it means there is not enough evidence to name one."
        compact
      />

      {!recommendations.error && recommendations.recommendations.length > 0 && (
        <ol className="space-y-2.5">
          {recommendations.recommendations.map((r) => (
            <li key={`${r.subject}-${r.topic}`} className="flex gap-2.5">
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[0.6875rem] font-bold text-primary"
              >
                {r.recommendation_rank}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium leading-snug">{actionSentence(r)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{accuracySentence(r)}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}

/**
 * P3 - Curriculum mastery map (Phase 2).
 *
 * Renders the heatmap plus a `<details>` table of the underlying numbers, per
 * §13 of 13-...md: the visual answers the question at a glance, and the data
 * behind it is one click away rather than occupying the screen.
 *
 * The unsignalled topics are listed in the table too, but under their own
 * heading and never coloured as a verdict. A parent who sees "Fractions — 2
 * questions, too few to judge" is told the truth; one who sees a red Fractions
 * cell after two questions is told something the data cannot support.
 */
function MasteryPanel({ mastery }: { mastery: Awaited<ReturnType<typeof loadParentMastery>> }) {
  const { judged, insufficient } = splitBySignal(mastery.topics)

  return (
    <Panel
      title="Mastery by topic"
      reportId="P3"
      asAt={mastery.asAt}
      lagMinutes={lagFrom(mastery.asAt)}
    >
      <ReportStateView
        state={mastery.error ? 'error' : mastery.topics.length === 0 ? 'empty' : 'ok'}
        emptyTitle="No topics practised yet"
        emptyMessage="The mastery map fills in as your child answers questions across topics."
        compact
      />

      {!mastery.error && mastery.topics.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm">{masteryHeadline(mastery.topics)}</p>

          <MasteryHeatmap topics={mastery.topics} />

          <details className="text-xs">
            <summary className="cursor-pointer font-medium text-muted-foreground">
              Show the numbers ({judged.length} judged
              {insufficient.length > 0 ? `, ${insufficient.length} too few to judge` : ''})
            </summary>

            <table className="mt-2 w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-1 pr-2 font-medium">Topic</th>
                  <th className="py-1 pr-2 font-medium">Subject</th>
                  <th className="py-1 pr-2 text-right font-medium">Correct</th>
                  <th className="py-1 text-right font-medium">Questions</th>
                </tr>
              </thead>
              <tbody>
                {judged.map((t) => (
                  <tr key={`${t.subject}-${t.topic}`} className="border-b border-border/50 last:border-0">
                    <td className="py-1 pr-2">
                      {t.topic}
                      <span className="ml-1.5 text-muted-foreground">{t.mastery_label}</span>
                    </td>
                    <td className="py-1 pr-2 text-muted-foreground">{t.subject}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">
                      {t.accuracy_pct === null ? '—' : `${t.accuracy_pct}%`}
                    </td>
                    <td className="py-1 text-right tabular-nums text-muted-foreground">
                      {t.items_answered}
                    </td>
                  </tr>
                ))}
                {insufficient.map((t) => (
                  <tr
                    key={`${t.subject}-${t.topic}`}
                    className="border-b border-border/50 text-muted-foreground last:border-0"
                  >
                    <td className="py-1 pr-2">{t.topic}</td>
                    <td className="py-1 pr-2">{t.subject}</td>
                    <td className="py-1 pr-2 text-right">—</td>
                    <td className="py-1 text-right tabular-nums">{t.items_answered} (too few)</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      )}
    </Panel>
  )
}

/**
 * P2 - Percentile & cohort context.
 *
 * B1 IS NOT A RENDERING CHOICE. The wrapper refuses (42501) when P1 does not
 * resolve, and this panel renders that refusal as the next action - "sit a
 * first test" - rather than as an error. When a figure IS shown, the cohort
 * context and the progress pairing render beside it by construction: they are
 * part of the same payload, and there is no branch that shows the headline
 * without them.
 *
 * Suppressed cohorts show the cohort SIZE (always displayed, §5.2) and the
 * reason, never a greyed-out number.
 */
function PercentilePanel({
  percentile,
}: {
  percentile: Awaited<ReturnType<typeof loadParentPercentile>>
}) {
  const lead = percentile.rows[0] ?? null
  const allSuppressed = percentile.rows.length > 0 && percentile.rows.every((r) => r.suppressed)
  // B1 refusal: P1 does not resolve yet. Not an error - the next action.
  const needsFirstTest = percentile.error && percentile.code === '42501'

  return (
    <Panel
      title="How this compares"
      reportId="P2"
      asAt={percentile.asAt}
      lagMinutes={lagFrom(percentile.asAt)}
    >
      {needsFirstTest && (
        <p className="text-sm text-muted-foreground">
          Comparisons appear after your child completes their first test.
        </p>
      )}

      {!needsFirstTest && (
        <ReportStateView
          state={
            percentile.error ? 'error'
            : percentile.rows.length === 0 ? 'empty'
            : 'ok'
          }
          emptyTitle="No comparison yet"
          emptyMessage="The cohort refreshes nightly after completed tests."
          compact
        />
      )}

      {!needsFirstTest && !percentile.error && lead && (
        <div className="space-y-2">
          {allSuppressed ? (
            /* Suppression is low_data, not empty: the cohort SIZE is always
               displayed (§5.2), with the reason and no figure of any kind. */
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
              <p className="font-semibold">Cohort still too small</p>
              <p className="mt-1 text-muted-foreground">{percentileSentence(lead)}</p>
            </div>
          ) : (
            <p className="text-sm font-medium">{percentileSentence(lead)}</p>
          )}

          {/* B1 pairing: the child's own progress beside every comparison. */}
          <p className="text-xs text-muted-foreground">
            {progressPairingSentence(lead.personal_progress_delta)}
          </p>

          {/* Mandatory cohort context: size, window, platform disclaimer. */}
          <p className="text-xs text-muted-foreground">{cohortContextSentence(lead)}</p>

          {percentile.rows.length > 1 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                Other exam families ({percentile.rows.length - 1})
              </summary>
              <ul className="mt-2 space-y-1.5">
                {percentile.rows.slice(1).map((r) => (
                  <li key={r.family_group} className="border-b border-border/60 pb-1.5 last:border-0">
                    <p className="text-xs font-medium">{percentileSentence(r)}</p>
                    <p className="text-xs text-muted-foreground">{cohortContextSentence(r)}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Panel>
  )
}

/**
 * The parent panels, loaded in parallel.
 *
 * Each load is independent and each has its own error state, so one failing
 * view degrades one panel rather than the screen. `Promise.all` is safe here
 * only because every loader catches internally and returns `{ error: true }`
 * rather than throwing - a rejected promise would take the whole page down.
 */
export async function ParentReportingPanels({ studentId }: { studentId: string }) {
  const [projection, history, behaviour, recommendations, mastery, percentile] = await Promise.all([
    loadParentProjection(studentId),
    loadParentHistory(studentId),
    loadParentBehaviour(studentId, 8),
    loadParentRecommendations(studentId),
    loadParentMastery(studentId),
    loadParentPercentile(studentId),
  ])

  // Mean of completed attempt scores, used ONLY to interpret pace in P7.
  //
  // Derived here rather than passed in by the page, because P7's own view has
  // no accuracy column - accuracy belongs to P4 (11-...md §4.4 assigns
  // `attempt_score` to P4, `pace_vs_expected` to P7). Recomputing it from the
  // history this component already loaded keeps one owner for the figure and
  // avoids the page having to run a second query for it.
  //
  // It is a score mean, not a raw correct/total accuracy, and that is fine for
  // the only use it has here: `paceLabel()` needs to know whether the child is
  // generally getting things right before it says anything about their speed.
  const scored = history.attempts.filter(
    (a): a is typeof a & { score: number } => a.score !== null
  )
  const overallAccuracy =
    scored.length > 0 ? scored.reduce((sum, a) => sum + a.score, 0) / scored.length : null

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <ProjectionPanel
        projection={projection.projection}
        asAt={projection.asAt}
        error={projection.error}
      />
      <HistoryPanel history={history} />
      {/* P2 sits beside P4: the comparison and the child's own progress are
          the two halves of B1's pairing, so they read together. */}
      <PercentilePanel percentile={percentile} />
      <BehaviourPanel
        behaviour={behaviour}
        latestAccuracy={overallAccuracy}
        studentId={studentId}
      />
      <RecommendationsPanel recommendations={recommendations} />
      {/* The map is four cells wide, so it spans the full row rather than being
          squeezed into one grid column where the labels would not fit. */}
      <div className="sm:col-span-2">
        <MasteryPanel mastery={mastery} />
      </div>
    </div>
  )
}



