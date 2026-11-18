/**
 * Row shapes returned by the reporting functions.
 *
 * WHY A SEPARATE MODULE
 *   These types are needed on BOTH sides of a boundary that cannot be crossed
 *   at runtime:
 *
 *     - the loaders (`parent-history.ts` etc.) import `./connection`, which
 *       imports `@/lib/supabase/server` and therefore `next/headers` - a
 *       server-only module that cannot appear in a browser bundle;
 *     - the presentation helpers (`format.ts`) and the test suite
 *       (`scripts/reporting.test.mts`) need the same row shapes but must run
 *       in Node and in the browser, where `next/headers` does not exist.
 *
 *   Keeping the shapes here means `format.ts` can be imported by a plain Node
 *   test without dragging a server-only module into it. This module must
 *   therefore stay TYPES ONLY - no imports, no runtime code. Adding a single
 *   value export here would reintroduce the bundling failure that
 *   `plan-types.ts` exists to avoid.
 */

// ---------------------------------------------------------------------------
// P4 - attempt history
// ---------------------------------------------------------------------------

/** One completed attempt, from `reporting.mv_attempt_history`. */
export interface AttemptHistoryRow {
  attempt_id: string
  started_at: string
  status: string
  /** Weighted score out of 100. */
  score: number | null
  /** Per-section scores, e.g. { "Numeracy": 72 }. Drives `section_trend`. */
  section_scores: Record<string, number> | null
  test_id: string
  test_title: string
  exam_type: string
  family_group: string
  family_group_label: string
  year_level: number
  /** 1-based position within the family, oldest first. */
  attempt_ordinal: number
  /** Change from the previous attempt in the same family. Null on the first. */
  personal_progress_delta: number | null
}

/** Direction of travel, first attempt to latest. */
export type TrendDirection = 'IMPROVING' | 'DECLINING' | 'STEADY' | 'NOT_ENOUGH_DATA'

/** Per-family trend, from `public.parent_progress_summary()`. */
export interface ProgressSummaryRow {
  family_group: string
  family_group_label: string
  attempts_completed: number
  first_score: number | null
  latest_score: number | null
  /** Latest minus first. */
  overall_delta: number | null
  mean_delta: number | null
  /** Standard deviation of attempt-to-attempt deltas. */
  sd_delta: number | null
  latest_attempt_id: string | null
  latest_started_at: string | null
  trend: TrendDirection
}

/** One section's movement between the two most recent attempts. */
export interface SectionTrendPoint {
  section: string
  latest: number
  previous: number | null
  delta: number | null
}

// ---------------------------------------------------------------------------
// P7 - study behaviour
// ---------------------------------------------------------------------------

/** One ISO week of study behaviour, from `reporting.mv_study_behaviour`. */
export interface StudyBehaviourRow {
  week_start: string
  week_end: string
  year_level: number
  sessions: number
  weekly_sessions_goal: number | null
  /** Sessions / goal, capped at 1.0. */
  target_adherence: number | null
  items_answered: number
  time_on_task_seconds: number
  median_seconds_per_item: number | null
  /** Same-year-level median for the same week. */
  peer_median_seconds: number | null
  /** >1 slower than peers, <1 faster. */
  pace_vs_expected: number | null
  /** Percentage of items left unanswered. */
  skip_rate: number | null
  /** Percentage of answered items that were rapid and wrong. A proxy. */
  guess_rate: number | null
  as_at: string
}

// ---------------------------------------------------------------------------
// P8 - recommendations
// ---------------------------------------------------------------------------

/** One recommendation, from `public.parent_recommendations()`. */
export interface RecommendationRow {
  /** 1..3. Never more than 3 (rule B12). */
  recommendation_rank: number
  subject: string
  topic: string
  items_answered: number
  accuracy_pct: number | null
  /** Ranking key only - NOT a predicted score gain. */
  expected_impact_score: number | null
  /** Plain-English reason, generated in SQL. */
  reason: string
}

// ---------------------------------------------------------------------------
// P1 - projection
// ---------------------------------------------------------------------------

/**
 * One projection row, from `public.parent_readiness_projection()`.
 *
 * Band names use the `ReadinessBand` vocabulary from `src/lib/report/readiness`
 * ('Needs support' | 'Developing' | 'Exceeding' | 'Strongly exceeding'). Spelled
 * as plain strings rather than imported, so this module keeps its no-imports
 * rule; `scripts/reporting.test.mts` asserts the two vocabularies agree.
 */
export interface ReadinessProjection {
  /** False means: show no projection at all. */
  eligible: boolean
  attempts_completed: number
  exam_date: string | null
  weeks_to_exam: number | null
  /** Null whenever `eligible` is false. */
  point_projection: number | null
  range_low: number | null
  range_high: number | null
  projected_band_low: string | null
  projected_band_high: string | null
  /** 'low' | 'medium' | 'high' - confidenceForSample() thresholds. */
  confidence: 'low' | 'medium' | 'high'
  /** Why there is no projection, when there is none. */
  reason: string | null
}

// ---------------------------------------------------------------------------
// A14 / A15 - operations
// ---------------------------------------------------------------------------

/** One hour of platform health, from `reporting.mv_platform_health`. */
export interface PlatformHealthRow {
  hour_start: string
  /** YYYYMMDD, Australia/Melbourne. */
  date_key: number
  hour_of_day: number
  /** Distinct user_id or anonymous_id - people, not accounts. */
  active_users: number
  /** Attempts genuinely in flight during the hour. */
  peak_concurrency: number
  /** peak_concurrency / cap. */
  concurrency_vs_cap: number | null
  peak_concurrency_cap: number
  /** False means the cap is a brief-stated target, not a measurement (A-13). */
  cap_is_measured: boolean
  tests_started: number
  tests_submitted: number
  errors: number
  /** Errors as a percentage of test activity, not of all events. */
  test_error_rate: number | null
  submit_errors: number
  /** Share of submission attempts that failed. */
  failed_submission_rate: number | null
  as_at: string
}

/** Severity of one data-quality check. */
export type QualityStatus = 'OK' | 'WARN' | 'FAIL' | 'NOT_IMPLEMENTED'

/** One data-quality check, from `reporting.mv_data_quality`. */
export interface DataQualityRow {
  check_date: string
  check_name: string
  /** Schema-qualified object the check is about. */
  object_name: string
  /** Null when the check could not produce a number. */
  metric_value: number | null
  threshold: number
  status: QualityStatus
  /** Plain-English explanation, generated in SQL. */
  detail: string
  as_at: string
}

// ---------------------------------------------------------------------------
// P3 - mastery map (Phase 2)
// ---------------------------------------------------------------------------

/**
 * Mastery vocabulary. Deliberately the SAME three values as `GapSeverity` in
 * src/lib/report/readiness.ts, plus 'unknown' for a topic with no accuracy.
 *
 * Not a new scale: the readiness report, the readiness screen and P3 must
 * describe the same child's same topic in the same words, and inventing a
 * fourth vocabulary is how one report ends up saying "Developing" while another
 * says "Band 3" about the same result.
 */
export type MasteryLevel = 'critical' | 'watch' | 'secure' | 'unknown'

/** One topic's mastery, from `public.parent_mastery()`. */
export interface MasteryRow {
  subject: string
  topic: string
  items_answered: number
  items_correct: number
  accuracy_pct: number | null
  mastery_level: MasteryLevel
  /** Parent-facing wording, generated in SQL to match ReadinessReportView. */
  mastery_label: string
  /** False below five responses: not enough evidence to call it anything. */
  has_signal: boolean
  last_practised_date_key: number | null
  as_at: string
}

// ---------------------------------------------------------------------------
// A3 / TC1 - content coverage (Phase 2)
// ---------------------------------------------------------------------------

/** One coverage row, from `public.admin_coverage_gaps()`. */
export interface CoverageGapRow {
  subject: string
  topic: string
  sub_topic: string
  exam_type: string
  item_count: number
  published_count: number
  draft_count: number
  /** Null while `coverage_thresholds.min_items_per_subtopic` is unset. */
  min_items_required: number | null
  /**
   * False means coverage_status CANNOT return TOO_FEW, so it is not a verdict.
   * Every row must be read with this in mind: an 'ADEQUATE' status arriving
   * alongside `threshold_configured: false` means "unclassified", not "fine".
   */
  threshold_configured: boolean
  coverage_status: string
  avg_authored_difficulty: number | null
  avg_observed_difficulty: number | null
}

/** One ranked authoring task, from `public.creator_coverage_queue()`. */
export interface ProductionQueueRow {
  production_priority: number
  subject: string
  topic: string
  sub_topic: string
  exam_type: string
  published_count: number
  draft_count: number
  min_items_required: number | null
  threshold_configured: boolean
  /** Null while the threshold is unset - never 0, which would read as "none needed". */
  deficit: number | null
  /** Oldest sitting draft in days. Max, not average. */
  oldest_draft_age_days: number | null
  coverage_status: string
}

// ---------------------------------------------------------------------------
// A11 - conversion funnel
// ---------------------------------------------------------------------------

/**
 * One funnel stage, from `public.admin_funnel_by_stage()`.
 *
 * `prev_stage` is not decoration. Stages with no visitors at all are skipped when
 * chaining (migration 056), so a rate may be measured against a stage further up
 * the funnel than the one immediately above. Presenting OFFER_MADE-vs-REPORT_SENT
 * as though it were OFFER_MADE-vs-PAYWALL_READY would be a different measurement
 * wearing the same label.
 */
export interface FunnelStageRow {
  stage: string
  stage_rank: number
  channel: string
  campaign: string
  /**
   * Coarse device class: 'mobile' | 'tablet' | 'desktop' | 'unknown'.
   *
   * Derived server-side from client hints / User-Agent by
   * `classifyDevice()` in src/lib/funnel/device.ts, written to `props.device` by
   * the beacon, and inherited by server-side stage events via `trackEvent`.
   * 'unknown' now means genuinely unobservable, not "never implemented".
   */
  device_class: string
  visitors: number
  events: number
  prev_stage: string | null
  prev_stage_visitors: number | null
  stage_conversion_rate: number | null
  stage_dropoff_count: number
  /** True when either side of the comparison is below min_segment_visitors. */
  suppressed: boolean
}

/** A11 outcome metrics, from `public.admin_funnel_outcomes()`. */
export interface FunnelOutcomes {
  /** Denominator for free_to_paid_rate. PAYWALL_TRIGGERED, per §5.4 - NOT signups. */
  reached_paywall: number
  paying: number
  free_to_paid_rate: number | null
  checkout_started: number
  checkout_completed: number
  checkout_abandoned: number
  checkout_abandonment_rate: number | null
  /** Null when nothing was abandoned, which is a good result, not zero. */
  median_hours_to_abandon: number | null
  signup_cohort: number
  activated: number
  activation_rate: number | null
  median_hours_to_first_value: number | null
  suppressed: boolean
}

/** Which dimension A11 is segmented by. */
export type FunnelSegment = 'none' | 'channel' | 'campaign' | 'device'

// ---------------------------------------------------------------------------
// Tutor surface (T1/T2/T3) and P10 consent
// ---------------------------------------------------------------------------

/** T1 - one consented student's overview. */
export interface TutorStudentRow {
  student_id: string
  student_name: string
  year_level: number
  assigned_count: number
  completed_count: number
  /** Null when nothing has been assigned - not 0%, which would read as failure. */
  completion_rate: number | null
  current_attempts: number
  /** Raw score. Banding is applied by bandForScore(), never redefined here. */
  current_score: number | null
  prior_attempts: number
  prior_score: number | null
  /** Null unless BOTH periods have >=2 attempts (§5.4). */
  movement_pp: number | null
  /** TU9: linkage state must be visible to the tutor. */
  consent_expires_at: string | null
}

/** T2 - one topic for one consented student. Same source view as P3 and P8. */
export interface TutorSkillGapRow {
  student_id: string
  student_name: string
  subject: string
  topic: string
  items_answered: number
  accuracy_pct: number | null
  mastery_level: 'critical' | 'watch' | 'secure' | 'unknown'
  has_signal: boolean
}

/** T3 - one fired at-risk rule. Every flag names its rule (TU1). */
export interface TutorAtRiskRow {
  student_id: string
  student_name: string
  at_risk_rule: 'DECLINING_TREND' | 'LOW_ENGAGEMENT' | 'REPEATED_MISCONCEPTION'
  at_risk_severity: 'high' | 'medium'
  rule_detail: string
  /** Always false today: seeded defaults, not validated cut-points. */
  thresholds_validated: boolean
}

/** P10 - one tutor's access to one child, as the parent sees it. */
export interface TutorConsentRow {
  tutor_user_id: string
  tutor_email: string
  linked_at: string
  consent_id: string | null
  granted_at: string | null
  expires_at: string | null
  revoked_at: string | null
  is_current: boolean
  state: 'ACTIVE' | 'REVOKED' | 'EXPIRED' | 'NO_CONSENT'
}

/**
 * T5 - one assignment the tutor set, for a currently-consented student.
 *
 * `due_at` is nullable in the live schema, so `due_state` is a separate field
 * rather than being folded into `assignment_status`: "no due date" and "on time"
 * are different facts, and rendering the first as the second would tell a tutor
 * that work is on track when no deadline was ever set.
 */
export interface TutorAssignmentRow {
  assignment_id: string
  student_id: string
  student_name: string
  test_id: string
  test_title: string | null
  assigned_at: string | null
  due_at: string | null
  due_state: 'NO_DUE_DATE' | 'MET' | 'OVERDUE' | 'ON_TIME'
  /** Strict partition: COMPLETED > OVERDUE > STARTED > ASSIGNED. */
  assignment_status: 'ASSIGNED' | 'STARTED' | 'COMPLETED' | 'OVERDUE'
  is_overdue: boolean
  attempt_status: 'IN_PROGRESS' | 'SUBMITTED' | 'WRITING_PENDING' | 'COMPLETE' | null
  attempts_n: number
  last_activity_at: string | null
}

/**
 * T7 - one ranked recommendation for one consented student.
 *
 * Identical figures to P8: both reports read reporting.recommendations_scored(),
 * so a parent and their tutor cannot be given different advice for the same
 * child. At most three rows per student (B12).
 */
export interface TutorRecommendationRow {
  student_id: string
  student_name: string
  recommendation_rank: number
  subject: string
  topic: string
  items_answered: number
  accuracy_pct: number | null
  expected_impact_score: number | null
  reason: string
}

// ---------------------------------------------------------------------------
// A1 / T4 - item statistics
// ---------------------------------------------------------------------------

/**
 * Why an item was flagged. Every value maps to a rule in
 * `reporting.item_thresholds`, so a flag can always be argued with by changing
 * configuration rather than code.
 */
export type ItemDefectReason =
  | 'TOO_HARD'
  | 'TOO_EASY'
  | 'NO_DISCRIMINATION'
  | 'DEAD_DISTRACTOR'
  | 'KEY_BEATEN'
  | 'SLOW'
  | 'HIGH_SKIP'

/** One option's share of the responses to an item. */
export interface DistractorBreakdown {
  option: string
  n: number
  share_pct: number | null
  /** True for exactly one option: the authored key, not the most-marked one. */
  is_key: boolean
}

/**
 * A1 (admin) and T4 (tutor) share this shape because they share ONE definition.
 *
 * §5 X-6 makes `p_value` and `distractor_analysis` A1-owned, and T4 "the same
 * metric restricted to tests the tutor assigned and to that tutor's consented
 * students". Both therefore read `reporting.item_statistics()`: A1 through the
 * nightly materialisation over everybody, T4 live over the tutor's consented
 * set. There is no second copy of any formula, and a pgtap assertion fails if
 * the two disagree on the same population.
 *
 * `p_value` is a PROPORTION (0-1), not a percentage - §5 defines it that way and
 * the flag band 0.20-0.90 applies to the proportion. It is also not a
 * statistical-hypothesis p-value; §5 warns the name invites that confusion, so
 * the UI must label it "difficulty (% correct)".
 */
export interface ItemStatisticsRow {
  /** 'ALL_TIME' until the ITEM_FLAGGED event exists (see migration 077). */
  period_label: string
  test_id: string
  item_id: string
  subject: string | null
  topic: string | null
  responses: number
  students: number
  /**
   * False below `min_responses_per_item`. The statistics are then NULL rather
   * than noisy: §5 requires a minimum before they are "reported at all", but the
   * row is kept so thin evidence is visible as thin, not silently absent.
   */
  enough_evidence: boolean
  p_value: number | null
  point_biserial: number | null
  median_time_seconds: number | null
  skip_rate_pct: number | null
  /**
   * False while the runner records no skips. The adaptive runner answers ~10 of
   * ~48 items and writes no row for an item it never serves, so a missing row
   * cannot be told apart from a skip and `skip_rate_pct` reads 0.0% for every
   * item. Derived from the data, so it flips itself when capture is fixed.
   */
  skip_rate_reliable: boolean
  /**
   * False while `responses.is_correct` contradicts `questions.correct_answer`
   * anywhere in the bank. When false, difficulty and discrimination count marks
   * rather than right answers. Derived from the data, so it clears itself.
   */
  marking_reliable: boolean
  /** Lifetime, not per-period: `questions.flag_count` carries no timestamp. */
  item_flag_rate_pct: number | null
  key_option: string | null
  distractors: DistractorBreakdown[]
  /** Authored options nobody ever chose. Excludes the key. */
  dead_distractors: string[]
  defect_reasons: ItemDefectReason[]
  is_defective: boolean
}


// ---------------------------------------------------------------------------
// A12 - experiment results
// ---------------------------------------------------------------------------

/**
 * A12's verdict vocabulary.
 *
 * `INSUFFICIENT_DATA` is deliberately distinct from any "no difference" verdict.
 * §5.4 is emphatic that below the minimum sample the recommendation must never
 * read as equivalence: a null result from four users is absence of evidence, and
 * reporting it as "no difference" is how a working change gets killed.
 */
export type ExperimentDecision =
  | 'CONTROL'
  | 'INSUFFICIENT_DATA'
  | 'EXTEND'
  | 'SHIP'
  | 'REVERT'

/**
 * One experiment arm, from `public.admin_experiment_results()`.
 *
 * Contains NO subject identifiers - only per-arm aggregates. The underlying
 * assignment and exposure tables are not readable by browsers at all.
 */
export interface ExperimentResultRow {
  experiment_key: string
  experiment_name: string
  status: string
  variant: string
  is_control: boolean
  /** DISTINCT subjects EXPOSED, not assigned. Counting assignments biases to null. */
  sample_size: number
  conversions: number
  variant_conversion_rate: number | null
  control_sample_size: number | null
  control_rate: number | null
  /** Percentage-point difference vs control. Null on the control row. */
  diff_pp: number | null
  /** Newcombe (Wilson-based) interval on the difference, in percentage points. */
  ci_lower_pp: number | null
  ci_upper_pp: number | null
  /** Two-proportion z-test. Never `p_value`, which means item difficulty. */
  p_value_experiment: number | null
  recommended_decision: ExperimentDecision
  /** Why, in words, so a human can disagree with the recommendation. */
  decision_reason: string
}

// ---------------------------------------------------------------------------
// P2 - Percentile & Cohort Context
// ---------------------------------------------------------------------------

/**
 * One cohort row from `public.parent_percentile()`.
 *
 * STRUCTURAL GUARANTEES (the wrapper's RETURNS clause cannot express more):
 *   - NO raw mid-rank percentage. Below 50 students the figure is a quartile
 *     BAND; below 20 it is nothing at all. A client cannot render a bare
 *     percentile because the field does not exist here (B1/X-4).
 *   - NO peer identifiers - only the aggregate cohort_size.
 *   - personal_progress_delta is P4's metric, embedded by the wrapper so a
 *     percentile can never be shown without the child's own progress (B1).
 *   - cohort_definition is the literal 'platform cohort'. This is NOT a state
 *     or national ranking and the UI must say so.
 */
export interface PercentileRow {
  family_group: string
  family_group_label: string
  year_level: number
  latest_score: number | null
  /** Integer point percentile. Non-null ONLY when cohort_size >= 50. */
  percentile_rank: number | null
  /** Quartile 1 (bottom) .. 4 (top). Non-null ONLY when 20 <= cohort_size < 50. */
  percentile_band: number | null
  /** True below the 20-student floor: rank AND band are null. */
  suppressed: boolean
  /** DISTINCT students, never attempts. Always displayed, even suppressed. */
  cohort_size: number
  cohort_window_months: number
  cohort_definition: 'platform cohort'
  window_start: string
  window_end: string
  /** P4's metric, borrowed. Null on the first completed test in the family. */
  personal_progress_delta: number | null
  attempts_completed: number | null
  as_at: string
}




