import type {
  AttemptHistoryRow,
  CoverageGapRow,
  DataQualityRow,
  ExperimentDecision,
  ExperimentResultRow,
  FunnelStageRow,
  ItemDefectReason,
  ItemStatisticsRow,
  MasteryRow,
  PlatformHealthRow,
  ProductionQueueRow,
  ProgressSummaryRow,
  QualityStatus,
  ReadinessProjection,
  RecommendationRow,
  SectionTrendPoint,
  StudyBehaviourRow,
} from './types'
// Type-only, and plan-types.ts has no imports of its own, so this keeps the
// module safe for both the Node test runner and client bundles.
import type { PracticePlan } from './plan-types'
// A VALUE import, but envelope.ts is itself dependency-free (no `next/headers`,
// no database client), so pulling the sentinel in does not compromise this
// module's ability to run in Node or in a client bundle.
import { UNKNOWN_LAG } from './envelope'

/**
 * Pure presentation logic for the Phase 1 reports.
 *
 * WHY THIS IS SEPARATE FROM THE LOADERS
 *   Every rule in this file is a rule about what a parent or an operator is
 *   TOLD - the guardrails from 11-...md §4.4 (B3, B12, B13) as they surface in
 *   copy. Those rules are the part most worth testing, and they are pure: no
 *   database, no request, no clock beyond what is passed in.
 *
 *   The loaders (`parent-history.ts` etc.) cannot be imported by a Node test,
 *   because they pull in `./connection` -> `@/lib/supabase/server` ->
 *   `next/headers`. Keeping the wording rules here means
 *   `scripts/reporting.test.mts` can assert them directly.
 *
 *   This module imports TYPES ONLY. Adding a runtime import here would break
 *   both the test suite and any client component that reaches it.
 *
 * The loaders re-export everything below, so existing import paths such as
 * `@/lib/reporting/parent-history` keep working unchanged.
 */

// ---------------------------------------------------------------------------
// Refresh lag
// ---------------------------------------------------------------------------

/** Human-readable lag for a badge. Never claims freshness it cannot verify. */
export function formatLag(lagMinutes: number | null | undefined): string {
  if (lagMinutes === null || lagMinutes === undefined) return 'Data freshness unknown'
  if (!Number.isFinite(lagMinutes)) return 'Data freshness unknown'
  // The sentinel is finite, so `isFinite` above does NOT catch it. Without this
  // check an unknown lag renders as "Updated 6254999482459 days ago" - a
  // confident, absurd number where an honest "unknown" belongs.
  if (lagMinutes >= UNKNOWN_LAG) return 'Data freshness unknown'
  if (lagMinutes < 1) return 'Updated just now'
  if (lagMinutes < 60) return `Updated ${lagMinutes} min ago`

  const hours = Math.floor(lagMinutes / 60)
  if (hours < 24) return `Updated ${hours} hr${hours === 1 ? '' : 's'} ago`

  const days = Math.floor(hours / 24)
  return `Updated ${days} day${days === 1 ? '' : 's'} ago`
}


// ---------------------------------------------------------------------------
// P4 - history & trends
// ---------------------------------------------------------------------------

/** The family with the most attempts - the one the header should lead with. */
export function primaryFamily(summary: ProgressSummaryRow[]): ProgressSummaryRow | null {
  if (summary.length === 0) return null
  return [...summary].sort((a, b) => b.attempts_completed - a.attempts_completed)[0]
}

/**
 * Plain-English framing for a trend (rules B3, B13).
 *
 * Positive or neutral framing only. There is no "your child is falling behind"
 * wording: a parent reading a loss frame about their own child is the audience
 * least able to act on it calmly, and the decision P4 supports is "continue the
 * plan", not "panic".
 *
 * `NOT_ENOUGH_DATA` is honest rather than optimistic - with one attempt there
 * is no trend, and inventing one is how a report loses credibility.
 */
export function trendSentence(row: ProgressSummaryRow | null): string {
  if (!row) return 'No completed tests yet.'

  if (row.trend === 'NOT_ENOUGH_DATA') {
    return `One ${row.family_group_label.toLowerCase()} test completed so far - sit another to see a trend.`
  }

  const delta = Math.abs(Math.round(row.overall_delta ?? 0))
  const points = `${delta} point${delta === 1 ? '' : 's'}`
  const label = row.family_group_label.toLowerCase()

  switch (row.trend) {
    case 'IMPROVING':
      return `Up ${points} across ${row.attempts_completed} ${label} tests.`
    case 'DECLINING':
      // Framed as something to review, not a judgement on the child.
      return `Down ${points} across ${row.attempts_completed} ${label} tests - worth reviewing what changed.`
    case 'STEADY':
      return `Holding steady across ${row.attempts_completed} ${label} tests.`
    default:
      return 'No completed tests yet.'
  }
}

/**
 * Per-section trend, flattened for display.
 *
 * `section_scores` is a jsonb object whose keys are section names. Comparing
 * the latest attempt against the previous one in the same family is the
 * smallest honest unit of "section trend" available: there is no section-level
 * history table, and aggregating sections across families would mix papers
 * that are not comparable with each other.
 */
export function sectionTrends(
  attempts: AttemptHistoryRow[],
  familyGroup: string
): SectionTrendPoint[] {
  const inFamily = attempts
    .filter((a) => a.family_group === familyGroup && a.section_scores)
    // Newest first, matching how the table renders.
    .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())

  const latest = inFamily[0]
  const previous = inFamily[1]
  if (!latest?.section_scores) return []

  return Object.entries(latest.section_scores)
    .filter(([, v]) => typeof v === 'number')
    .map(([section, value]) => {
      const prev = previous?.section_scores?.[section]
      const prevValue = typeof prev === 'number' ? prev : null
      return {
        section,
        latest: value as number,
        previous: prevValue,
        delta: prevValue === null ? null : (value as number) - prevValue,
      }
    })
    .sort((a, b) => a.section.localeCompare(b.section))
}

// ---------------------------------------------------------------------------
// P7 - study behaviour
// ---------------------------------------------------------------------------

/** Seconds as "1h 05m" / "12m" / "45s". */
export function formatDuration(totalSeconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(totalSeconds ?? 0))
  if (s < 60) return `${s}s`

  const mins = Math.round(s / 60)
  if (mins < 60) return `${mins}m`

  const hours = Math.floor(mins / 60)
  const rest = mins % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${String(rest).padStart(2, '0')}m`
}

/**
 * Characterise pace - but only alongside accuracy.
 *
 * Returns null when either input is missing, because a pace figure without
 * accuracy is uninterpretable and rendering one invites the wrong conclusion:
 * fast + wrong is guessing, slow + right is labouring, and "too slow" said
 * about a careful child is simply wrong.
 */
export function paceLabel(
  paceVsExpected: number | null | undefined,
  accuracyPct: number | null | undefined
): string | null {
  if (paceVsExpected === null || paceVsExpected === undefined) return null
  if (accuracyPct === null || accuracyPct === undefined) return null

  const fast = paceVsExpected < 0.85
  const slow = paceVsExpected > 1.15
  const accurate = accuracyPct >= 70

  if (fast && !accurate) return 'Moving quickly but missing accuracy - worth slowing down.'
  if (fast && accurate) return 'Working quickly and accurately.'
  if (slow && accurate) return 'Taking time, and getting it right.'
  if (slow && !accurate) return 'Taking time without the accuracy yet - this is the one to work on.'
  return 'Pace is close to typical for this year level.'
}

/** Adherence as a percentage, capped at 100 by the view. */
export function adherencePct(row: StudyBehaviourRow): number | null {
  if (row.target_adherence === null) return null
  return Math.round(row.target_adherence * 100)
}

/**
 * Plain-English summary of the most recent week.
 *
 * Leads with what was done, not what was missed. A parent opening this screen
 * after a week where their child sat one test should see the one test, not a
 * statement about the two they did not sit.
 */
export function behaviourSentence(row: StudyBehaviourRow | null): string {
  if (!row) return 'No practice recorded yet.'

  const parts: string[] = [
    `${row.sessions} session${row.sessions === 1 ? '' : 's'}, ${row.items_answered} question${
      row.items_answered === 1 ? '' : 's'
    }`,
    formatDuration(row.time_on_task_seconds),
  ]

  const adherence = adherencePct(row)
  if (adherence !== null && row.weekly_sessions_goal) {
    parts.push(`${adherence}% of the ${row.weekly_sessions_goal}-session goal`)
  }

  return parts.join(' · ')
}

// ---------------------------------------------------------------------------
// P8 - recommendations
// ---------------------------------------------------------------------------

/**
 * An action a parent can actually take.
 *
 * P8's next action in §4.4 is "Start practice set". There is no practice-set
 * builder yet, so the honest action is to name the area rather than link to a
 * screen that does not exist. A button that goes nowhere teaches a parent to
 * ignore the panel.
 */
export function actionSentence(row: RecommendationRow): string {
  return `Practise ${row.topic} in ${row.subject} this week.`
}

/**
 * Accuracy framed for a parent.
 *
 * Deliberately avoids "failed" / "poor" vocabulary, and always pairs the
 * percentage with the volume behind it: "40%" from three questions and "40%"
 * from forty mean very different things, and a parent cannot tell them apart
 * without the count.
 */
export function accuracySentence(row: RecommendationRow): string {
  const pct = row.accuracy_pct === null ? 'no' : `${row.accuracy_pct}%`
  return `${pct} correct across ${row.items_answered} question${
    row.items_answered === 1 ? '' : 's'
  }.`
}

/**
 * Sort by rank and cap the list (rule B12).
 *
 * Defence in depth. The authoritative cap is `LIMIT 3` inside
 * `public.parent_recommendations()`; this exists so that if a future migration
 * ever dropped that LIMIT, the TypeScript surface would still honour the
 * contract rather than silently rendering an eight-item list. Sorting first
 * matters: capping an unsorted list would drop whichever rows happened to come
 * back last, not the lowest-ranked ones.
 */
export function capRecommendations(
  rows: RecommendationRow[],
  max: number
): RecommendationRow[] {
  return rows
    .slice()
    .sort((a, b) => a.recommendation_rank - b.recommendation_rank)
    .slice(0, max)
}


// ---------------------------------------------------------------------------
// P1 - projection
// ---------------------------------------------------------------------------

/**
 * The projected outcome as a named band range, never a decimal (guardrail 3).
 *
 * When both ends land in the same band the answer is a single band name; when
 * they straddle two it reads "Between X and Y". Returning a numeric range from
 * this helper would defeat the guardrail, so it returns words - the numbers are
 * in the DTO for anyone who needs them, but the parent-facing surface is a
 * band.
 */
export function projectionBandSentence(p: ReadinessProjection | null): string | null {
  if (!p?.eligible) return null
  if (!p.projected_band_low || !p.projected_band_high) return null

  if (p.projected_band_low === p.projected_band_high) return p.projected_band_low
  return `Between ${p.projected_band_low} and ${p.projected_band_high}`
}

/**
 * What to show when there is no projection.
 *
 * The `reason` from SQL is already parent-facing wording, and it is itself the
 * next action ("2 of 3 tests completed", "Set an exam date"). Inventing
 * separate UI copy would risk contradicting the database about why.
 */
export function noProjectionSentence(p: ReadinessProjection | null): string {
  if (p?.reason) return p.reason
  return 'Not enough practice yet to project.'
}

// ---------------------------------------------------------------------------
// P9 - plan controls
// ---------------------------------------------------------------------------

/**
 * Plain-English framing for the overload flag.
 *
 * The parent-facing counterpart to the child's capped daily number. It
 * explains WHY the number the child sees is lower than the plan implies, and
 * what to do about it - which is the decision P9 exists to support.
 *
 * The cap is stated as a limit for the year level rather than as a personal
 * restriction on this child: the same cap applies to every child in the year,
 * and framing it that way is both accurate and less confrontational.
 */
export function overloadSentence(plan: PracticePlan | null): string | null {
  if (!plan?.plan_overload_flag) return null

  const required = plan.required_daily === null ? null : Math.ceil(Number(plan.required_daily))
  const cap = plan.effective_cap
  const units = plan.unit_kind ?? 'units'

  if (required === null || cap === null) {
    return 'This plan needs more practice per day than is appropriate for this year level. Consider moving the exam date out, or reducing the total target.'
  }

  return `Finishing in time would need about ${required} ${units} a day, but ${cap} a day is the limit for this year level. Moving the exam date out, or lowering the total target, brings the plan back inside the cap.`
}

// ---------------------------------------------------------------------------
// A14 - platform health
// ---------------------------------------------------------------------------

/** Format a Date as the YYYYMMDD integer the admin functions expect. */
export function dateKey(d: Date): number {
  return Number(
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
      d.getDate()
    ).padStart(2, '0')}`
  )
}

/** Default admin window: the last `days` days, inclusive. */
export function defaultDateRange(days = 7): { from: number; to: number } {
  const to = new Date()
  const from = new Date()
  from.setDate(to.getDate() - (days - 1))
  return { from: dateKey(from), to: dateKey(to) }
}

/** Peak concurrency across the window - the figure a scaling decision needs. */
export function peakConcurrency(hours: PlatformHealthRow[]): number {
  return hours.reduce((max, h) => Math.max(max, h.peak_concurrency ?? 0), 0)
}

/**
 * Capacity headroom as a sentence.
 *
 * States whether the cap is measured. A capacity decision taken on a
 * brief-stated target without knowing it is brief-stated is a decision taken
 * on an assumption someone mistook for a measurement (A-13).
 */
export function capacitySentence(hours: PlatformHealthRow[]): string | null {
  if (hours.length === 0) return null

  const cap = hours[0].peak_concurrency_cap
  const measured = hours[0].cap_is_measured
  const peak = peakConcurrency(hours)
  const pct = cap > 0 ? Math.round((peak / cap) * 100) : null

  const qualifier = measured
    ? 'the measured capacity ceiling'
    : 'a target from the project brief, not a measured ceiling'

  if (pct === null) {
    return `Peak ${peak} concurrent attempts against a cap of ${cap} (${qualifier}).`
  }
  return `Peak ${peak} concurrent attempts - ${pct}% of the ${cap} cap (${qualifier}).`
}

/** Worst error rate in the window, and the hour it occurred. */
export function worstErrorRate(
  hours: PlatformHealthRow[]
): { rate: number; hourStart: string } | null {
  const withRate = hours.filter((h) => h.test_error_rate !== null && h.test_error_rate > 0)
  if (withRate.length === 0) return null

  const worst = withRate.reduce((a, b) =>
    (b.test_error_rate ?? 0) > (a.test_error_rate ?? 0) ? b : a
  )
  return { rate: worst.test_error_rate ?? 0, hourStart: worst.hour_start }
}

// ---------------------------------------------------------------------------
// A15 - data quality
// ---------------------------------------------------------------------------

/** Counts by status, for a header summary. */
export function qualitySummary(checks: DataQualityRow[]): Record<QualityStatus, number> {
  const out: Record<QualityStatus, number> = { OK: 0, WARN: 0, FAIL: 0, NOT_IMPLEMENTED: 0 }
  for (const c of checks) out[c.status] = (out[c.status] ?? 0) + 1
  return out
}

/**
 * The headline verdict for the A15 screen.
 *
 * NOT_IMPLEMENTED is deliberately NOT counted as a failure. It means "this
 * check has not been built yet" - specifically `stripe_reconciliation`, which
 * is Phase 3 - and treating it as a failure would train operators to ignore a
 * screen that always shows red. It is reported separately so the truth is
 * visible without being alarmist.
 */
export function qualityVerdict(checks: DataQualityRow[]): string {
  if (checks.length === 0) return 'No data-quality checks have run yet.'

  const s = qualitySummary(checks)

  if (s.FAIL > 0) {
    return `${s.FAIL} check${s.FAIL === 1 ? '' : 's'} failing - repair before reporting on this data.`
  }
  if (s.WARN > 0) {
    return `${s.WARN} check${s.WARN === 1 ? '' : 's'} above threshold. Nothing is blocking.`
  }
  if (s.NOT_IMPLEMENTED > 0) {
    return `All implemented checks passing. ${s.NOT_IMPLEMENTED} check${
      s.NOT_IMPLEMENTED === 1 ? '' : 's'
    } not yet implemented.`
  }
  return 'All checks passing.'
}

/**
 * Refresh-lag rows only, for a lag panel.
 *
 * A stale materialised view is indistinguishable from a correct one, so the
 * per-view lag is surfaced on its own rather than buried among integrity
 * checks: it is the one row an operator needs before trusting ANY number on
 * ANY dashboard.
 */
export function refreshLagRows(checks: DataQualityRow[]): DataQualityRow[] {
  return checks.filter((c) => c.check_name === 'mv_refresh_lag_minutes')
}

// ---------------------------------------------------------------------------
// P3 - mastery map
// ---------------------------------------------------------------------------

/**
 * Minimum responses before a topic's mastery may be stated.
 *
 * The same floor P8 uses for recommendations, declared once so the two reports
 * cannot disagree about whether a topic has enough evidence to name. Below this,
 * one missed question would paint a topic red and send a parent to work on
 * something their child got wrong once.
 */
export const MIN_ITEMS_FOR_SIGNAL = 5

/**
 * Split the map into what can be judged and what cannot.
 *
 * Rows below the floor are still returned by the API - a map with holes looks
 * broken - but they must be rendered as "not enough practice yet", never as a
 * verdict. Keeping the split here rather than in each screen means no surface
 * can forget to make it.
 */
export function splitBySignal(topics: MasteryRow[]): {
  judged: MasteryRow[]
  insufficient: MasteryRow[]
} {
  return {
    judged: topics.filter((t) => t.has_signal),
    insufficient: topics.filter((t) => !t.has_signal),
  }
}

/** Topics needing work, weakest first. The answer to "what should we focus on?" */
export function weakTopics(topics: MasteryRow[], limit = 3): MasteryRow[] {
  return topics
    .filter((t) => t.has_signal && (t.mastery_level === 'critical' || t.mastery_level === 'watch'))
    .slice(0, limit)
}

/**
 * Count by mastery level, for a summary line.
 *
 * Counts only topics with signal. Including unsignalled topics would let a child
 * who has answered two questions in eleven topics show a map that is mostly
 * "unknown", which reads as a broken report rather than a new one.
 */
export function masteryCounts(topics: MasteryRow[]): Record<string, number> {
  const out: Record<string, number> = { critical: 0, watch: 0, secure: 0 }
  for (const t of topics) {
    if (!t.has_signal) continue
    out[t.mastery_level] = (out[t.mastery_level] ?? 0) + 1
  }
  return out
}

/**
 * The one-sentence headline for the mastery map.
 *
 * Leads with what is secure when everything is secure. A map that always opens
 * with the weakest topic tells a parent their child is failing even when nine of
 * ten topics are solid - and that parent stops opening the report.
 */
export function masteryHeadline(topics: MasteryRow[]): string {
  const judged = topics.filter((t) => t.has_signal)
  if (judged.length === 0) {
    return `Not enough practice yet to map mastery. Topics appear here once your child has answered ${MIN_ITEMS_FOR_SIGNAL} or more questions in each.`
  }

  const c = masteryCounts(topics)
  const weak = c.critical + c.watch
  const noun = judged.length === 1 ? 'topic' : 'topics'

  if (weak === 0) return `Solid across all ${judged.length} practised ${noun}.`

  const first = weakTopics(topics, 1)[0]
  return first
    ? `${weak} of ${judged.length} ${noun} need${weak === 1 ? 's' : ''} work - ${first.topic} is the weakest at ${first.accuracy_pct}%.`
    : `${weak} of ${judged.length} ${noun} need work.`
}

// ---------------------------------------------------------------------------
// A3 / TC1 - content coverage
// ---------------------------------------------------------------------------

/** True when the coverage threshold is unset, so `coverage_status` means nothing. */
export function thresholdMissing(rows: { threshold_configured: boolean }[]): boolean {
  return rows.length > 0 && rows.every((r) => !r.threshold_configured)
}

/**
 * The caveat the UI MUST show whenever the coverage threshold is unset.
 *
 * Returned as a sentence rather than a boolean so the wording lives in one place
 * and cannot be softened or dropped by a screen that finds it inconvenient.
 * Null means "no caveat needed".
 *
 * This exists because `coverage_thresholds.min_items_per_subtopic` is NULL in
 * the live database, which disables the TOO_FEW branch of `coverage_status`.
 * Every sub-topic then reports ADEQUATE - including ones with a single published
 * item - so an A3 or TC1 screen without this caveat would read as a clean bill
 * of health rather than as an unclassifiable one.
 */
export function coverageCaveat(rows: { threshold_configured: boolean }[]): string | null {
  if (!thresholdMissing(rows)) return null

  return 'The minimum-items-per-sub-topic threshold is not configured, so coverage cannot be classified as adequate or too few. Rows are ordered scarcest-first by published item count, and any "ADEQUATE" label on them is a placeholder rather than a verdict. Set reporting.coverage_thresholds.min_items_per_subtopic to enable real gap detection.'
}

/**
 * Label for a coverage_status value, honest about the unconfigured case.
 *
 * Never renders 'ADEQUATE' as "Adequate" while the threshold is unset: that
 * would tell a commissioning editor no content is needed, when the truth is that
 * nobody has defined how much is enough. This function is the enforcement point,
 * so no screen can render the raw status as a verdict by accident.
 */
export function coverageStatusLabel(row: CoverageGapRow): string {
  if (!row.threshold_configured) {
    return row.coverage_status === 'NONE_PUBLISHED' ? 'Nothing published' : 'Unclassified'
  }
  switch (row.coverage_status) {
    case 'NONE_PUBLISHED':
      return 'Nothing published'
    case 'TOO_FEW':
      return 'Too few items'
    default:
      return 'Adequate'
  }
}

/**
 * Draft-age warning for TC1.
 *
 * A draft untouched for months is a different problem from a gap with no draft at
 * all: the first is stalled work someone should finish, the second is work nobody
 * has started. Conflating them means chasing authors for items that do not exist.
 * The underlying figure is the MAX draft age, not an average, for the same
 * reason - an average hides a four-month-old draft behind two written yesterday.
 */
export function draftAgeNote(row: ProductionQueueRow): string | null {
  if (row.oldest_draft_age_days === null) {
    return row.draft_count > 0 ? 'Drafts exist but have no recorded creation date.' : null
  }
  if (row.oldest_draft_age_days >= 90) {
    return `Oldest draft has been sitting for ${row.oldest_draft_age_days} days.`
  }
  return null
}

// ---------------------------------------------------------------------------
// A11 - conversion funnel
// ---------------------------------------------------------------------------

/**
 * Human-readable funnel stage names.
 *
 * The stored values are the internal stage identifiers. Showing "PAYWALL_READY" to
 * an operator is acceptable jargon, but showing it in a sentence alongside prose
 * reads like a database dump. These labels are the same words the stage means in
 * the product, not a translation of the enum.
 */
const STAGE_LABELS: Record<string, string> = {
  SIGNED_UP: 'Signed up',
  STUDENT_ADDED: 'Added a child',
  DIAGNOSTIC_STARTED: 'Started the diagnostic',
  FIRST_VALUE: 'Completed the diagnostic',
  REPORT_SENT: 'Received the report',
  SECOND_OFFERED: 'Offered a second session',
  PAYWALL_READY: 'Reached the paywall',
  OFFER_MADE: 'Received an offer',
  CUSTOMER: 'Purchased',
  ONBOARDED: 'Set up a study plan',
  EXPANDED: 'Bought a second product',
  RENEWED: 'Renewed',
}

export function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage
}

/**
 * Format a rate that may be absent or suppressed.
 *
 * Three distinct states must not collapse into one: no data (null rate), too
 * small to report (suppressed), and a real figure. Rendering a suppressed 62%
 * next to a genuine 62% invites exactly the "50% drop on 2 users" misreading that
 * §5.4 warns about.
 */
export function rateLabel(rate: number | null, suppressed: boolean): string {
  if (rate === null) return '—'
  if (suppressed) return 'too small'
  return `${rate}%`
}

/**
 * The stage losing the most people - the answer to A11's question.
 *
 * Ranks by ABSOLUTE drop-off among non-suppressed stages, not by conversion rate.
 * A stage losing 17 of 58 people (71% conversion) is a bigger problem than one
 * losing 1 of 3 (67% conversion), and sorting by rate would put the tiny segment
 * first. Suppressed stages are excluded entirely: their numbers are noise, so
 * naming one as "the weakest stage" would send the team after a phantom.
 */
export function weakestStage(stages: FunnelStageRow[]): FunnelStageRow | null {
  const candidates = stages.filter((s) => !s.suppressed && s.prev_stage !== null)
  if (candidates.length === 0) return null

  return candidates.reduce((worst, s) =>
    s.stage_dropoff_count > worst.stage_dropoff_count ? s : worst
  )
}

/**
 * One-sentence summary of where the funnel is leaking.
 *
 * Says so plainly when nothing can be concluded, rather than defaulting to the
 * first row: with small cohorts every stage may be suppressed, and inventing a
 * headline from suppressed data is worse than reporting that there is none.
 */
export function funnelHeadline(stages: FunnelStageRow[]): string {
  if (stages.length === 0) {
    return 'No funnel activity in this period.'
  }

  const weakest = weakestStage(stages)
  if (!weakest) {
    const suppressed = stages.every((s) => s.suppressed)
    return suppressed
      ? 'Every stage in this period is below the 20-visitor reporting floor, so no conversion rate is reliable enough to act on.'
      : 'Not enough stage-to-stage movement to identify a weakest point.'
  }

  return `Biggest leak: ${weakest.stage_dropoff_count} people lost entering "${stageLabel(weakest.stage)}"` +
    ` (${weakest.stage_conversion_rate}% of the ${weakest.prev_stage_visitors} who reached "${stageLabel(weakest.prev_stage!)}").`
}

// ---------------------------------------------------------------------------
// A12 - experiment results
// ---------------------------------------------------------------------------

/** Human wording for a verdict. INSUFFICIENT_DATA must not read as "no difference". */
export function experimentDecisionLabel(decision: ExperimentDecision): string {
  switch (decision) {
    case 'SHIP':
      return 'Ship it'
    case 'REVERT':
      return 'Revert'
    case 'EXTEND':
      return 'Keep running'
    case 'INSUFFICIENT_DATA':
      return 'Not enough data yet'
    case 'CONTROL':
      return 'Control'
    default:
      return decision
  }
}

/**
 * True when the interval includes zero - i.e. the direction of the effect is not
 * established. This is the question a forest plot answers at a glance, and it is
 * deliberately separate from significance: an interval can exclude zero while
 * the effect is still too small to be worth shipping.
 */
export function ciCrossesZero(row: ExperimentResultRow): boolean {
  if (row.ci_lower_pp === null || row.ci_upper_pp === null) return true
  return row.ci_lower_pp <= 0 && row.ci_upper_pp >= 0
}

/**
 * Shared x-axis domain for a forest plot, in percentage points.
 *
 * Every arm must be plotted on the SAME axis or the intervals are not
 * comparable, which is the entire point of the chart. The domain covers every
 * interval, always includes zero (the reference line), and is padded so no
 * whisker touches the edge.
 *
 * Returns a symmetric domain around zero when the data is roughly balanced, so
 * the zero line sits in the middle and a reader can judge direction without
 * measuring pixels.
 */
export function forestDomain(rows: ExperimentResultRow[]): { min: number; max: number } {
  const values: number[] = [0]
  for (const r of rows) {
    if (r.ci_lower_pp !== null) values.push(r.ci_lower_pp)
    if (r.ci_upper_pp !== null) values.push(r.ci_upper_pp)
    if (r.diff_pp !== null) values.push(r.diff_pp)
  }

  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = Math.max(Math.abs(lo), Math.abs(hi), 1)
  const padded = Math.ceil(span * 1.15)

  return { min: -padded, max: padded }
}

/** Map a percentage-point value to a 0-100 position on the shared axis. */
export function forestPosition(value: number, domain: { min: number; max: number }): number {
  const span = domain.max - domain.min
  if (span <= 0) return 50
  const pct = ((value - domain.min) / span) * 100
  return Math.min(100, Math.max(0, pct))
}

/**
 * One-sentence summary of what the experiments currently support.
 *
 * Leads with the count of actionable verdicts, and says plainly when there are
 * none - an experiment panel that always finds something to report trains its
 * reader to distrust it.
 */
export function experimentHeadline(rows: ExperimentResultRow[]): string {
  const arms = rows.filter((r) => !r.is_control)
  if (arms.length === 0) return 'No experiments are collecting exposures yet.'

  const actionable = arms.filter(
    (r) => r.recommended_decision === 'SHIP' || r.recommended_decision === 'REVERT'
  )
  if (actionable.length > 0) {
    const plural = actionable.length === 1
    return `${actionable.length} arm${plural ? '' : 's'} ${plural ? 'has' : 'have'} a verdict worth acting on.`
  }

  const insufficient = arms.filter((r) => r.recommended_decision === 'INSUFFICIENT_DATA')
  if (insufficient.length === arms.length) {
    return 'No experiment has enough exposures for a verdict yet. This is not evidence that the changes do nothing.'
  }

  return 'No arm has reached a ship-or-revert verdict; the rest are still within noise.'
}

// ---------------------------------------------------------------------------
// A1 / T4 - item statistics
// ---------------------------------------------------------------------------

/**
 * The caveat A1 and T4 MUST show while marking disagrees with the answer key.
 *
 * `marking_reliable` comes out of SQL, computed from the data rather than
 * hardcoded, so this sentence disappears by itself once the marking source is
 * fixed. That is the point: a warning written into a component would survive the
 * fix and start lying.
 *
 * It exists because `responses.is_correct` once contradicted
 * `questions.correct_answer` for a majority of MCQ responses - marking was
 * statistically independent of the answer given, so difficulty and
 * discrimination counted marks rather than right answers, and an admin reading
 * "% correct" as "% who got it right" would retire good items and keep bad ones.
 *
 * MEASURED CLEAR ON 2026-11-22: 0 disagreements across 17,604 MCQ responses, so
 * `marking_reliable` is true for all 1,750 items and this sentence is currently
 * silent. The number is deliberately NOT restated as a constant anywhere: the
 * caveat is computed from `marking_reliable`, which means a regression re-enables
 * it automatically while a hardcoded figure would have to be noticed first.
 */
export function markingCaveat(rows: { marking_reliable: boolean }[]): string | null {
  if (rows.length === 0) return null
  if (rows.every((r) => r.marking_reliable)) return null

  return (
    'Marking is not trustworthy yet: responses.is_correct disagrees with the authored ' +
    'answer key for a large share of responses, so "% correct" counts marks rather than ' +
    'right answers. Difficulty and discrimination figures below are computed correctly ' +
    'from that column but should not drive retire-or-rewrite decisions until the marking ' +
    'source is fixed. A15 reports this as marking_key_disagreement.'
  )
}

/**
 * The caveat for skip rate, which is a capture gap rather than a marking gap.
 *
 * The adaptive runner answers roughly 10 of the ~48 items in a test and writes no
 * row at all for an item it never serves. A missing row therefore cannot be told
 * apart from a skip, and the specified formula returns 0.0% for every item -
 * which reads as "nobody ever skips". Returning null when skips ARE captured
 * keeps this honest in both directions.
 */
export function skipRateCaveat(rows: { skip_rate_reliable: boolean }[]): string | null {
  if (rows.length === 0) return null
  if (rows.every((r) => r.skip_rate_reliable)) return null

  return (
    'Skip rate reads 0.0% because skipped items are not recorded. The runner writes no ' +
    'response row for an item it never serves, so a skip and an unserved item are ' +
    'indistinguishable. Treat this column as unavailable, not as zero.'
  )
}

/**
 * `p_value` is a proportion, and §5 is explicit that the name invites confusion
 * with a hypothesis-test p-value. This is the single place it becomes a display
 * string, so no screen can render the raw number under a "% correct" heading.
 */
export function formatPValue(pValue: number | null): string {
  if (pValue === null || !Number.isFinite(pValue)) return 'Not enough responses'
  return `${(pValue * 100).toFixed(1)}% correct`
}

/** Difficulty band wording, matching the configured 0.20-0.90 flag band. */
export function difficultyLabel(row: ItemStatisticsRow): string {
  if (!row.enough_evidence || row.p_value === null) return 'Insufficient evidence'
  if (row.defect_reasons.includes('TOO_HARD')) return 'Too hard'
  if (row.defect_reasons.includes('TOO_EASY')) return 'Too easy'
  return 'In range'
}

/**
 * Human wording for a defect flag.
 *
 * Each label names the OBSERVATION, not a verdict to retire the item: §4.6 says
 * A1's decision is "retire, rewrite or recalibrate", and that judgement belongs to
 * a person who can read the stem. "Key beaten" states what happened; "delete this
 * item" would overstep.
 */
export function defectReasonLabel(reason: ItemDefectReason): string {
  switch (reason) {
    case 'TOO_HARD':
      return 'Fewer than 20% got it right'
    case 'TOO_EASY':
      return 'More than 90% got it right'
    case 'NO_DISCRIMINATION':
      return 'Does not separate stronger from weaker students'
    case 'DEAD_DISTRACTOR':
      return 'An option nobody ever chose'
    case 'KEY_BEATEN':
      return 'A wrong option was chosen more often than the key'
    case 'SLOW':
      return 'Takes longer than expected'
    case 'HIGH_SKIP':
      return 'Skipped unusually often'
    default:
      return reason
  }
}

/**
 * The option chosen most often that is NOT the key, plus its share.
 *
 * §12 asks the T4 table for "top distractor and its share", and the diverging bar
 * in A1 needs the same pair. Derived from the breakdown rather than returned as a
 * separate column so there is one source of truth for option ordering.
 */
export function topDistractor(
  row: Pick<ItemStatisticsRow, 'distractors'>
): { option: string; share_pct: number | null; n: number } | null {
  const candidates = row.distractors.filter((d) => !d.is_key)
  if (candidates.length === 0) return null

  // Already ordered by n DESC, option ASC in SQL; re-sorting here keeps this
  // correct even if a caller hands over an unordered array.
  const sorted = [...candidates].sort((a, b) => b.n - a.n || a.option.localeCompare(b.option))
  return sorted[0]
}

/**
 * One-sentence summary for the A1/T4 header.
 *
 * Counts items short of evidence separately from flagged ones, because "12 items
 * need review" and "12 items have too little data to review" lead to completely
 * different actions.
 */
export function itemStatisticsHeadline(rows: ItemStatisticsRow[]): string {
  if (rows.length === 0) return 'No item responses to analyse yet.'

  const thin = rows.filter((r) => !r.enough_evidence).length
  const flagged = rows.filter((r) => r.is_defective).length
  const parts = [`${rows.length} item${rows.length === 1 ? '' : 's'} analysed`]

  if (flagged > 0) parts.push(`${flagged} flagged for review`)
  else parts.push('none flagged')

  if (thin > 0) parts.push(`${thin} below the minimum response count`)

  return `${parts.join(', ')}.`
}

/**
 * Flat CSV projection of an item-statistics row.
 *
 * `csvField` stringifies anything it does not recognise, so a nested
 * `distractors` array would land in the export as `[object Object]` and a
 * `defect_reasons` array as a comma-joined string that then breaks the column
 * count. Both are flattened here, in ONE place, because A1 and T4 export the same
 * metric and two routes hand-rolling their own projection is how the admin export
 * and the tutor export end up with different columns for the same numbers.
 *
 * The distractor breakdown is reduced to the top non-key option and its share,
 * which is what §12 asks the table for. The full per-option breakdown stays in the
 * JSON payload - a CSV cell is the wrong shape for it.
 */
export interface ItemStatisticsCsvRow {
  test_id: string
  item_id: string
  subject: string | null
  topic: string | null
  responses: number
  students: number
  enough_evidence: boolean
  difficulty_pct_correct: number | null
  point_biserial: number | null
  median_time_seconds: number | null
  skip_rate_pct: number | null
  key_option: string | null
  top_distractor: string | null
  top_distractor_share_pct: number | null
  dead_distractors: string
  item_flag_rate_pct: number | null
  defect_reasons: string
  marking_reliable: boolean
  skip_rate_reliable: boolean
  period_label: string
}

export function itemStatisticsCsvRows(rows: ItemStatisticsRow[]): ItemStatisticsCsvRow[] {
  return rows.map((r) => {
    const top = topDistractor(r)
    return {
      test_id: r.test_id,
      item_id: r.item_id,
      subject: r.subject,
      topic: r.topic,
      responses: r.responses,
      students: r.students,
      enough_evidence: r.enough_evidence,
      // Exported as a percentage under an unambiguous heading. The raw column is
      // called p_value, which §5 warns reads as a hypothesis-test p-value; a
      // spreadsheet column labelled "difficulty_pct_correct" cannot.
      difficulty_pct_correct:
        r.p_value === null ? null : Math.round(r.p_value * 1000) / 10,
      point_biserial: r.point_biserial,
      median_time_seconds: r.median_time_seconds,
      skip_rate_pct: r.skip_rate_pct,
      key_option: r.key_option,
      top_distractor: top?.option ?? null,
      top_distractor_share_pct: top?.share_pct ?? null,
      dead_distractors: r.dead_distractors.join('|'),
      item_flag_rate_pct: r.item_flag_rate_pct,
      defect_reasons: r.defect_reasons.join('|'),
      marking_reliable: r.marking_reliable,
      skip_rate_reliable: r.skip_rate_reliable,
      period_label: r.period_label,
    }
  })
}

/** Column order for the A1/T4 export. Kept next to the projection it matches. */
export const ITEM_STATISTICS_CSV_COLUMNS: (keyof ItemStatisticsCsvRow)[] = [
  'test_id',
  'item_id',
  'subject',
  'topic',
  'responses',
  'students',
  'enough_evidence',
  'difficulty_pct_correct',
  'point_biserial',
  'median_time_seconds',
  'skip_rate_pct',
  'key_option',
  'top_distractor',
  'top_distractor_share_pct',
  'dead_distractors',
  'item_flag_rate_pct',
  'defect_reasons',
  'marking_reliable',
  'skip_rate_reliable',
  'period_label',
]

// ---------------------------------------------------------------------------
// P2 - Percentile & Cohort Context wording
//
// The suppression and band RULES live in SQL (mv_percentile_cohort); these
// helpers only turn the wrapper's output into plain English. They deliberately
// contain no threshold numbers: the floors are config (percentile_thresholds)
// and a TS copy of "20" would silently disagree the day an operator tunes it.
// ---------------------------------------------------------------------------

/** Minimal shape percentileSentence needs; PercentileRow satisfies it. */
export interface PercentileSentenceInput {
  suppressed: boolean
  percentile_rank: number | null
  percentile_band: number | null
  year_level: number
  family_group_label: string
}

/** Minimal shape cohortContextSentence needs; PercentileRow satisfies it. */
export interface CohortContextInput {
  cohort_size: number
  year_level: number
  cohort_window_months: number
  window_start: string
  window_end: string
}

/**
 * Quartile wording. Returns null outside 1..4 so a malformed band can never
 * render as a confident label - the caller falls back to the suppressed line.
 */
export function percentileBandLabel(band: number): string | null {
  switch (band) {
    case 1: return 'bottom quarter'
    case 2: return 'second quarter'
    case 3: return 'third quarter'
    case 4: return 'top quarter'
    default: return null
  }
}

/**
 * The ONE headline sentence for P2.
 *
 * Suppressed: no figure of any kind, and the reason is stated. A greyed-out
 * number would still be read as a number.
 * Band (20-49 students): quartile wording, never a percentage - the cohort is
 * too small for a point to be honest (X-4).
 * Point (>=50): "higher than N%", the mid-rank figure rounded in SQL.
 */
export function percentileSentence(row: PercentileSentenceInput): string {
  const cohort = `Year ${row.year_level} ${row.family_group_label} students on this platform`
  if (row.suppressed) {
    return 'Not enough students have completed this type of test yet to show a fair ranking.'
  }
  if (row.percentile_rank !== null) {
    return `Scored higher than ${row.percentile_rank}% of ${cohort}.`
  }
  const band = row.percentile_band !== null ? percentileBandLabel(row.percentile_band) : null
  if (band) {
    return `In the ${band} of ${cohort}.`
  }
  // No figure and no band: same honest fallback as suppression, never a guess.
  return 'Not enough students have completed this type of test yet to show a fair ranking.'
}

/**
 * Mandatory cohort context (11-...md §4.4 PA4): size, window with explicit
 * dates, and the platform-cohort disclaimer. Rendered beside EVERY percentile
 * figure, including the suppressed state - cohort_size is always displayed.
 */
export function cohortContextSentence(row: CohortContextInput): string {
  const fmt = (iso: string) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-AU')
  }
  return (
    `Platform cohort of ${row.cohort_size} Year ${row.year_level} students, ` +
    `${fmt(row.window_start)} to ${fmt(row.window_end)} (${row.cohort_window_months} months). ` +
    'This is not a state or national ranking.'
  )
}

/**
 * B1 pairing: the percentile never renders alone. P4's personal_progress_delta
 * is shown beside it, and its ABSENCE is stated too - "no progress figure yet"
 * is information, not a blank.
 */
export function progressPairingSentence(delta: number | null): string {
  if (delta === null) {
    return 'No earlier completed test in this family yet, so there is no progress figure to compare.'
  }
  const rounded = Math.round(delta)
  const signed = rounded > 0 ? `+${rounded}` : `${rounded}`
  return `Personal progress since the previous test: ${signed} points.`
}



