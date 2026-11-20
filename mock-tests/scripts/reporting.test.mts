/**
 * Regression tests for the Phase 1 reporting layer.
 *
 * WHY THESE PARTICULAR ASSERTIONS
 *   Every test here pins a rule that fails SILENTLY if it breaks - the kind of
 *   defect that ships, looks plausible, and is only caught when a parent acts
 *   on a wrong number:
 *
 *     - B12 (max three recommendations) is enforced by SQL `LIMIT 3`, but the
 *       TypeScript cap is the defence if that LIMIT is ever dropped.
 *     - Guardrail 3 (bands, never decimals) is the difference between "Between
 *       Developing and Exceeding" and a forecast percentage nobody can honour.
 *     - `paceLabel` refusing to run without accuracy is what stops a screen
 *       telling a careful child they are "too slow".
 *     - A15 treating NOT_IMPLEMENTED as not-a-failure is what stops the data
 *       quality screen being permanently red - and therefore ignored.
 *     - The lag badge claiming "unknown" rather than "just now" when it cannot
 *       verify freshness. A confident wrong lag is worse than no lag.
 *     - CSV formula escaping: these exports carry free text an operator did not
 *       author, opened in Excel by the person with the most platform access.
 *
 *   All of these live in pure modules (`envelope.ts`, `csv.ts`, `format.ts`,
 *   `route-params.ts`) precisely so they can be tested without a database or a
 *   Next.js request context. The loaders cannot be imported here: they reach
 *   `next/headers`, which does not exist in Node.
 *
 * Run with:
 *   npm run test:reporting
 *
 * Dependency-free, matching scripts/consent.test.mts.
 */
import {
  adherencePct,
  behaviourSentence,
  capRecommendations,
  coverageCaveat,
  coverageStatusLabel,
  ciCrossesZero,
  draftAgeNote,
  experimentDecisionLabel,
  experimentHeadline,
  forestDomain,
  forestPosition,
  funnelHeadline,
  masteryCounts,
  masteryHeadline,
  MIN_ITEMS_FOR_SIGNAL,
  noProjectionSentence,
  overloadSentence,
  paceLabel,
  projectionBandSentence,
  qualityVerdict,
  rateLabel,
  splitBySignal,
  stageLabel,
  trendSentence,
  weakTopics,
  weakestStage,
  formatLag,
  cohortContextSentence,
  percentileBandLabel,
  percentileSentence,
  progressPairingSentence,
} from '@/lib/reporting/format';
import { csvField, csvRow } from '@/lib/reporting/csv';
import { envelope, lagMinutes, UNKNOWN_LAG } from '@/lib/reporting/envelope';
import { intParam, requireStudentId } from '@/lib/reporting/route-params';
import { MAX_WEEKLY_SESSIONS, MIN_WEEKLY_SESSIONS } from '@/lib/reporting/plan-types';
import type {
  CoverageGapRow,
  DataQualityRow,
  ExperimentResultRow,
  FunnelStageRow,
  MasteryRow,
  ProductionQueueRow,
  ProgressSummaryRow,
  ReadinessProjection,
  RecommendationRow,
  StudyBehaviourRow,
} from '@/lib/reporting/types';
import { bandForScore, CONFIDENCE_LABEL, severityForAccuracy } from '@/lib/report/readiness';
import { classifyDevice, isDeviceClass } from '@/lib/funnel/device';
import {
  interestLine,
  isLockedInsight,
  LOCKED_INSIGHT_TITLES,
  prioritiseIncludes,
} from '@/lib/pricing/offer-personalisation';
import {
  CAP_BOUNDS,
  CLAMP_MODE_COPY,
  DAILY_TARGET_BASES,
  EXPECTED_YEAR_LEVELS,
  describeCap,
  isCapDraftValid,
  missingYearLevels,
  validateYearLevelCap,
  type DailyTargetBasis,
  type YearLevelCap,
  type YearLevelCapDraft,
} from '@/lib/reporting/year-caps';
import type { PracticePlan } from '@/lib/reporting/plan-types';

let pass = 0;
let fail = 0;
const eq = (label: string, actual: unknown, expected: unknown) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + '\n          actual   ' + a + '\n          expected ' + e); }
};
const ok = (label: string, cond: boolean) => eq(label, cond, true);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const rec = (rank: number, topic: string): RecommendationRow => ({
  recommendation_rank: rank,
  subject: 'Maths',
  topic,
  items_answered: 20,
  accuracy_pct: 40,
  expected_impact_score: 100 - rank,
  reason: 'reason',
});

const projection = (over: Partial<ReadinessProjection>): ReadinessProjection => ({
  eligible: true,
  attempts_completed: 4,
  exam_date: '2027-05-01',
  weeks_to_exam: 20,
  point_projection: 70,
  range_low: 60,
  range_high: 80,
  projected_band_low: 'Developing',
  projected_band_high: 'Exceeding',
  confidence: 'medium',
  reason: null,
  ...over,
});

const summary = (over: Partial<ProgressSummaryRow>): ProgressSummaryRow => ({
  family_group: 'NAPLAN',
  family_group_label: 'NAPLAN',
  attempts_completed: 3,
  first_score: 50,
  latest_score: 62,
  overall_delta: 12,
  mean_delta: 6,
  sd_delta: 4,
  latest_attempt_id: 'a',
  latest_started_at: '2026-10-01T00:00:00Z',
  trend: 'IMPROVING',
  ...over,
});

const check = (over: Partial<DataQualityRow>): DataQualityRow => ({
  check_date: '2026-10-25',
  check_name: 'untagged_items',
  object_name: 'public.questions',
  metric_value: 0,
  threshold: 0,
  status: 'OK',
  detail: 'detail',
  as_at: '2026-10-25T00:00:00Z',
  ...over,
});

const plan = (over: Partial<PracticePlan>): PracticePlan => ({
  student_id: 's',
  target_exam: 'NAPLAN',
  target_exam_type: null,
  exam_date: '2027-05-01',
  days_to_exam: 200,
  weekly_sessions_goal: 3,
  unit_kind: 'questions',
  daily_target_units: 10,
  required_daily: 10,
  effective_cap: 20,
  plan_overload_flag: false,
  updated_at: '2026-10-25T00:00:00Z',
  ...over,
});

// ---------------------------------------------------------------------------
console.log('\n=== P8 / rule B12: at most three recommendations ===');
// ---------------------------------------------------------------------------

{
  const many = [rec(3, 'C'), rec(1, 'A'), rec(5, 'E'), rec(2, 'B'), rec(4, 'D')];
  const capped = capRecommendations(many, 3);

  eq('caps at three even given five', capped.length, 3);
  eq('keeps the three highest-ranked', capped.map((r) => r.recommendation_rank), [1, 2, 3]);
  eq(
    'sorts by rank BEFORE capping (an unsorted cap would drop arbitrary rows)',
    capped.map((r) => r.topic),
    ['A', 'B', 'C']
  );
  ok('does not mutate the input array', many[0].recommendation_rank === 3);
}

// ---------------------------------------------------------------------------
console.log('\n=== P1 / guardrail 3: bands, never decimals ===');
// ---------------------------------------------------------------------------

{
  eq(
    'straddling bands read as a range of names',
    projectionBandSentence(projection({})),
    'Between Developing and Exceeding'
  );
  eq(
    'same band both ends reads as one name',
    projectionBandSentence(
      projection({ projected_band_low: 'Developing', projected_band_high: 'Developing' })
    ),
    'Developing'
  );

  // Guardrail 1: an ineligible projection shows NO numbers at all.
  eq('ineligible projection renders no band', projectionBandSentence(projection({ eligible: false })), null);
  eq(
    'ineligible projection explains why, using the SQL reason',
    noProjectionSentence(projection({ eligible: false, reason: 'Not enough practice yet to project - 2 of 3 tests completed.' })),
    'Not enough practice yet to project - 2 of 3 tests completed.'
  );
  eq('null projection still explains itself', noProjectionSentence(null), 'Not enough practice yet to project.');

  // The band vocabulary must match readiness.ts, or P1 and the emailed report
  // will describe the same child with different words.
  const BANDS = ['Needs support', 'Developing', 'Exceeding', 'Strongly exceeding'];
  ok(
    'bandForScore only emits the four shared band names',
    [0, 25, 49, 50, 74, 75, 89, 90, 100].every((s) => BANDS.includes(bandForScore(s)))
  );
  eq('band boundaries match readiness.ts (<50 Needs support)', bandForScore(49), 'Needs support');
  eq('band boundaries match readiness.ts (50 Developing)', bandForScore(50), 'Developing');
  eq('band boundaries match readiness.ts (75 Exceeding)', bandForScore(75), 'Exceeding');
  eq('band boundaries match readiness.ts (90 Strongly exceeding)', bandForScore(90), 'Strongly exceeding');
  ok('confidence labels exist for all three levels', Object.keys(CONFIDENCE_LABEL).length === 3);
}

// ---------------------------------------------------------------------------
console.log('\n=== P7: pace is never characterised without accuracy ===');
// ---------------------------------------------------------------------------

{
  eq('pace with no accuracy returns null', paceLabel(1.5, null), null);
  eq('pace with no accuracy (undefined) returns null', paceLabel(1.5, undefined), null);
  eq('no pace value returns null', paceLabel(null, 80), null);

  // Fast + wrong is guessing; slow + right is labouring. Neither may be
  // described without the other half of the picture.
  ok('fast + inaccurate warns about accuracy', (paceLabel(0.5, 40) ?? '').includes('slowing down'));
  ok('slow + accurate is framed positively', (paceLabel(1.5, 85) ?? '').includes('getting it right'));
  ok('slow + inaccurate names it as the priority', (paceLabel(1.5, 40) ?? '').includes('work on'));
  ok('typical pace is described as typical', (paceLabel(1.0, 75) ?? '').includes('typical'));
}

// ---------------------------------------------------------------------------
console.log('\n=== P7: no plan must never fabricate adherence ===');
// ---------------------------------------------------------------------------

{
  // Regression for migration 035. Postgres LEAST() ignores NULL operands, so
  // `LEAST(sessions / NULLIF(goal,0), 1.0)` returned 1.00 for a child with NO
  // plan - rendering a full progress bar labelled "100% of the weekly practice
  // goal" against a goal that was never set. Verified on live data before the
  // fix: sessions=1, weekly_sessions_goal=NULL, target_adherence=1.00.
  const week = (over: Partial<StudyBehaviourRow>): StudyBehaviourRow => ({
    week_start: '2026-09-14',
    week_end: '2026-09-20',
    year_level: 5,
    sessions: 1,
    weekly_sessions_goal: null,
    target_adherence: null,
    items_answered: 68,
    time_on_task_seconds: 470,
    median_seconds_per_item: 5,
    peer_median_seconds: 5,
    pace_vs_expected: 1.0,
    skip_rate: 0,
    guess_rate: 2.9,
    as_at: '2026-09-20T00:00:00Z',
    ...over,
  });

  const noPlan = week({});
  eq('no plan yields no adherence percentage', adherencePct(noPlan), null);
  ok(
    'no plan does not claim a goal percentage in the summary',
    !behaviourSentence(noPlan).includes('% of the')
  );
  ok(
    'no plan still reports what WAS done',
    behaviourSentence(noPlan).includes('1 session') && behaviourSentence(noPlan).includes('68 questions')
  );

  const withPlan = week({ weekly_sessions_goal: 3, target_adherence: 0.33 });
  eq('a real goal yields a real percentage', adherencePct(withPlan), 33);
  ok('a real goal is described against the goal', behaviourSentence(withPlan).includes('33% of the 3-session goal'));

  const metGoal = week({ weekly_sessions_goal: 2, target_adherence: 1.0 });
  eq('meeting the goal reads as 100%', adherencePct(metGoal), 100);

  eq('no week at all says so', behaviourSentence(null), 'No practice recorded yet.');
}


// ---------------------------------------------------------------------------
console.log('\n=== A15: NOT_IMPLEMENTED is not a failure ===');
// ---------------------------------------------------------------------------

{
  const allOk = [check({}), check({ check_name: 'orphan_attempts' })];
  eq('all passing reads as all passing', qualityVerdict(allOk), 'All checks passing.');

  const withUnbuilt = [
    ...allOk,
    check({
      check_name: 'stripe_reconciliation',
      status: 'NOT_IMPLEMENTED',
      metric_value: null,
    }),
  ];
  const unbuiltVerdict = qualityVerdict(withUnbuilt);
  ok('unbuilt checks do NOT make the verdict a failure', !unbuiltVerdict.includes('failing'));
  ok('unbuilt checks are still reported', unbuiltVerdict.includes('1 check not yet implemented'));
  ok('implemented checks are acknowledged as passing', unbuiltVerdict.includes('All implemented checks passing'));

  const withWarn = [...allOk, check({ check_name: 'failed_events', status: 'WARN', metric_value: 12 })];
  ok('a WARN is reported but is not blocking', qualityVerdict(withWarn).includes('Nothing is blocking'));

  const withFail = [...withWarn, check({ check_name: 'orphan_responses', status: 'FAIL', metric_value: 99 })];
  ok('a FAIL outranks a WARN in the verdict', qualityVerdict(withFail).includes('repair before reporting'));

  eq('no checks at all says so', qualityVerdict([]), 'No data-quality checks have run yet.');
}

// ---------------------------------------------------------------------------
console.log('\n=== CSV export: injection and numeric integrity ===');
// ---------------------------------------------------------------------------

{
  // A field beginning with = + - @ is executed as a formula by Excel and Sheets.
  // These exports carry free text an operator did not author.
  eq('formula trigger "=" is neutralised', csvField('=1+1'), '\t=1+1');
  eq('formula trigger "+" is neutralised', csvField('+cmd'), '\t+cmd');
  eq('formula trigger "@" is neutralised', csvField('@SUM(A1)'), '\t@SUM(A1)');
  eq('formula trigger "-" is neutralised for TEXT', csvField('-HYPERLINK(1)'), '\t-HYPERLINK(1)');
  eq('plain text is untouched', csvField('Numeracy'), 'Numeracy');

  // A negative NUMBER must stay a number. Tab-prefixing it would turn every
  // negative metric in the export into text, breaking sums and sorts silently.
  eq('negative numbers stay numeric (not tab-prefixed)', csvField(-5), '-5');
  eq('zero stays numeric', csvField(0), '0');
  eq('non-finite numbers do not emit NaN', csvField(Number.NaN), '');
  eq('booleans render as true/false', csvField(true), 'true');
  eq('null and undefined render as empty', csvField(null) + csvField(undefined), '');

  eq('commas are quoted', csvField('a,b'), '"a,b"');
  eq('embedded quotes are doubled', csvField('say "hi"'), '"say ""hi"""');
  eq('newlines are quoted', csvField('a\nb'), '"a\nb"');

  eq(
    'a row keeps column order and escapes per field',
    csvRow(['a', 'b', 'c'], { c: '=x', a: 'plain', b: -3 }),
    'plain,-3,\t=x'
  );
}

// ---------------------------------------------------------------------------
console.log('\n=== Envelope: state inference and the lag badge ===');
// ---------------------------------------------------------------------------

{
  const emptyArr = envelope<{ rows: unknown[] }>({
    reportId: 'P4',
    data: { rows: [] },
    asAt: new Date().toISOString(),
  });
  eq('a non-null object is NOT inferred as empty', emptyArr.meta.state, 'ok');

  const emptyList = envelope<unknown[]>({
    reportId: 'P4',
    data: [],
    asAt: new Date().toISOString(),
  });
  eq('an empty array IS inferred as empty', emptyList.meta.state, 'empty');

  const err = envelope<{ a: number }>({
    reportId: 'P4',
    data: { a: 1 },
    asAt: new Date().toISOString(),
    state: 'error',
  });
  eq('an error state NULLS the data even if present', err.data, null);

  const lowData = envelope<{ a: number }>({
    reportId: 'P4',
    data: { a: 1 },
    asAt: new Date().toISOString(),
    state: 'low_data',
  });
  eq('low_data KEEPS its data (it is shown with a caveat)', lowData.data, { a: 1 });

  // The lag badge must never claim freshness it cannot verify.
  eq('a null asAt yields a sentinel lag, never 0', lagMinutes(null), Number.MAX_SAFE_INTEGER);
  eq('an unparseable asAt yields a sentinel lag', lagMinutes('not-a-date'), Number.MAX_SAFE_INTEGER);
  eq(
    'a future asAt clamps to 0 rather than going negative',
    lagMinutes(new Date(Date.now() + 600000).toISOString()),
    0
  );
  ok('a fresh asAt reports a small lag', lagMinutes(new Date(Date.now() - 120000).toISOString()) === 2);

  eq('formatLag admits when freshness is unknown', formatLag(null), 'Data freshness unknown');
  eq(
    'formatLag admits when freshness is unknown (sentinel)',
    formatLag(Number.MAX_SAFE_INTEGER),
    'Data freshness unknown'
  );
  // The round trip that was actually broken: lagMinutes(null) produces a FINITE
  // sentinel, which used to sail past an isFinite guard and render as
  // "Updated 6254999482459 days ago". This is the regression test for it.
  eq(
    'lagMinutes(null) -> formatLag round trip says unknown, not a colossal duration',
    formatLag(lagMinutes(null)),
    'Data freshness unknown'
  );
  eq(
    'lagMinutes(garbage) -> formatLag round trip says unknown',
    formatLag(lagMinutes('not-a-date')),
    'Data freshness unknown'
  );
  ok('the sentinel is finite, so isFinite cannot detect it', Number.isFinite(UNKNOWN_LAG));
  eq('formatLag reports minutes under an hour', formatLag(45), 'Updated 45 min ago');

  eq('formatLag reports hours under a day', formatLag(120), 'Updated 2 hrs ago');
  eq('formatLag reports days beyond a day', formatLag(2880), 'Updated 2 days ago');
}

// ---------------------------------------------------------------------------
console.log('\n=== Route params: bounded filters (§12.1 / §12.2) ===');
// ---------------------------------------------------------------------------

{
  const weeks = { fallback: 12, min: 1, max: 26 };

  eq('a missing optional filter falls back', intParam('P7', 'https://x.test/', 'weeks', weeks), {
    ok: true,
    value: 12,
  });
  eq('a valid filter passes through', intParam('P7', 'https://x.test/?weeks=8', 'weeks', weeks), {
    ok: true,
    value: 8,
  });
  ok(
    'an over-wide window is REJECTED, not silently clamped',
    intParam('P7', 'https://x.test/?weeks=500', 'weeks', weeks).ok === false
  );
  ok(
    'a non-numeric filter is rejected',
    intParam('P7', 'https://x.test/?weeks=abc', 'weeks', weeks).ok === false
  );

  ok('a missing studentId is rejected', requireStudentId('P4', 'https://x.test/').ok === false);
  ok(
    'a malformed studentId is rejected',
    requireStudentId('P4', 'https://x.test/?studentId=123').ok === false
  );
  eq(
    'a well-formed studentId passes',
    requireStudentId('P4', 'https://x.test/?studentId=00000000-0000-4000-8000-000000000000'),
    { ok: true, value: '00000000-0000-4000-8000-000000000000' }
  );
}

// ---------------------------------------------------------------------------
console.log('\n=== P9 bounds mirror the database CHECK constraint ===');
// ---------------------------------------------------------------------------

{
  // public.student_exam_targets has CHECK (weekly_sessions_goal BETWEEN 1 AND 14).
  // If these drift, the client validates a range the database will reject.
  eq('minimum matches the DB constraint', MIN_WEEKLY_SESSIONS, 1);
  eq('maximum matches the DB constraint', MAX_WEEKLY_SESSIONS, 14);

  eq('a plan within the cap produces no notice', overloadSentence(plan({})), null);

  const overloaded =
    overloadSentence(
      plan({ plan_overload_flag: true, required_daily: 30, effective_cap: 20, unit_kind: 'questions' })
    ) ?? '';
  ok('an overloaded plan states both figures', overloaded.includes('30') && overloaded.includes('20'));
  ok('an overloaded plan names a fix', overloaded.includes('Moving the exam date out'));
  ok(
    'an overloaded plan with no figures still warns',
    (overloadSentence(plan({ plan_overload_flag: true, required_daily: null, effective_cap: null })) ?? '')
      .length > 0
  );
}

// ---------------------------------------------------------------------------
console.log('\n=== P4: trend wording stays honest and non-alarmist ===');
// ---------------------------------------------------------------------------

{
  eq('no summary at all says so plainly', trendSentence(null), 'No completed tests yet.');

  const one = trendSentence(
    summary({ attempts_completed: 1, trend: 'NOT_ENOUGH_DATA', overall_delta: null })
  );
  ok('a single attempt does NOT claim a trend', one.includes('sit another to see a trend'));
  ok('a single attempt does not invent a direction', !one.includes('Up') && !one.includes('Down'));

  ok('improving leads with the gain', trendSentence(summary({})).startsWith('Up 12 points'));

  const declining = trendSentence(summary({ trend: 'DECLINING', overall_delta: -8 }));
  ok('declining is framed as something to review', declining.includes('worth reviewing'));
  ok(
    'declining never uses loss language about the child',
    !declining.includes('behind') && !declining.includes('failing')
  );
  ok(
    'steady says steady',
    trendSentence(summary({ trend: 'STEADY', overall_delta: 0 })).includes('Holding steady')
  );
}

// ---------------------------------------------------------------------------
console.log('\n=== P3: mastery vocabulary matches readiness.ts ===');
// ---------------------------------------------------------------------------

{
  const topic = (over: Partial<MasteryRow>): MasteryRow => ({
    subject: 'Maths',
    topic: 'Fractions',
    items_answered: 20,
    items_correct: 10,
    accuracy_pct: 50,
    mastery_level: 'watch',
    mastery_label: 'Watch this',
    has_signal: true,
    last_practised_date_key: 20260918,
    as_at: '2026-09-18T00:00:00Z',
    ...over,
  });

  // Migration 040's CASE mirrors severityForAccuracy(). If either side moves,
  // the mastery map and the emailed readiness report start describing the same
  // topic differently - the exact failure the single-vocabulary rule prevents.
  eq('severity boundary: 49 is critical', severityForAccuracy(49), 'critical');
  eq('severity boundary: 50 is watch', severityForAccuracy(50), 'watch');
  eq('severity boundary: 74 is watch', severityForAccuracy(74), 'watch');
  eq('severity boundary: 75 is secure', severityForAccuracy(75), 'secure');

  // The TS layer's notion of "weak" must be exactly "not secure", otherwise a
  // level could be counted as fine here while readiness.ts flags it as a gap.
  eq(
    'weakTopics treats precisely the non-secure levels as weak',
    ['critical', 'watch', 'secure'].filter(
      (lv) => severityForAccuracy(lv === 'secure' ? 80 : lv === 'watch' ? 60 : 30) !== 'secure'
    ),
    ['critical', 'watch']
  );

  const mixed = [
    topic({ topic: 'A', accuracy_pct: 30, mastery_level: 'critical', items_answered: 20 }),
    topic({ topic: 'B', accuracy_pct: 60, mastery_level: 'watch', items_answered: 12 }),
    topic({ topic: 'C', accuracy_pct: 95, mastery_level: 'secure', items_answered: 40 }),
    topic({ topic: 'D', accuracy_pct: 0, mastery_level: 'critical', has_signal: false, items_answered: 2 }),
  ];

  const { judged, insufficient } = splitBySignal(mixed);
  eq('splitBySignal keeps only signalled topics as judged', judged.map((t) => t.topic), ['A', 'B', 'C']);
  eq('splitBySignal quarantines the unsignalled topic', insufficient.map((t) => t.topic), ['D']);

  // The critical guardrail: a topic with two responses must never surface as a
  // weakness, however bad those two responses were.
  eq('weakTopics excludes unsignalled topics', weakTopics(mixed).map((t) => t.topic), ['A', 'B']);
  eq('masteryCounts ignores unsignalled topics', masteryCounts(mixed), {
    critical: 1,
    watch: 1,
    secure: 1,
  });

  ok(
    'headline names the weakest topic WITH signal, not the unsignalled zero',
    masteryHeadline(mixed).includes('A is the weakest at 30%')
  );
  ok(
    'an all-secure map does not lead with a failure',
    masteryHeadline([mixed[2]]).startsWith('Solid across all 1')
  );
  ok(
    'a map with no signal admits it rather than guessing',
    masteryHeadline([mixed[3]]).includes('Not enough practice yet')
  );
  eq('the signal floor matches the P8 five-response floor', MIN_ITEMS_FOR_SIGNAL, 5);
}

// ---------------------------------------------------------------------------
console.log('\n=== A3 / TC1: an unconfigured threshold never reads as "adequate" ===');
// ---------------------------------------------------------------------------

{
  const gap = (over: Partial<CoverageGapRow>): CoverageGapRow => ({
    subject: 'English',
    topic: 'Grammar',
    sub_topic: 'Articles',
    exam_type: 'NAPLAN_STYLE_LANGUAGE_CONVENTION',
    item_count: 1,
    published_count: 1,
    draft_count: 0,
    min_items_required: null,
    threshold_configured: false,
    coverage_status: 'ADEQUATE',
    avg_authored_difficulty: 2,
    avg_observed_difficulty: null,
    ...over,
  });

  // The live database is in exactly this state: all 85 sub-topics report
  // ADEQUATE, some with a single published item. Rendering that as "Adequate"
  // would tell a commissioning editor that no content is needed.
  eq('unconfigured ADEQUATE is labelled Unclassified', coverageStatusLabel(gap({})), 'Unclassified');
  ok('the label never claims adequacy while unconfigured', coverageStatusLabel(gap({})) !== 'Adequate');
  ok('a caveat is produced while unconfigured', (coverageCaveat([gap({})]) ?? '').length > 0);
  ok(
    'the caveat names the config that must be set',
    (coverageCaveat([gap({})]) ?? '').includes('min_items_per_subtopic')
  );

  // Nothing published is a hard fact independent of any threshold, so it stays
  // a verdict even when classification is impossible.
  eq(
    'NONE_PUBLISHED stays a verdict while unconfigured',
    coverageStatusLabel(gap({ coverage_status: 'NONE_PUBLISHED', published_count: 0 })),
    'Nothing published'
  );

  const configured = gap({ threshold_configured: true, min_items_required: 5 });
  eq('configured ADEQUATE may be called adequate', coverageStatusLabel(configured), 'Adequate');
  eq(
    'configured TOO_FEW is labelled as too few',
    coverageStatusLabel(
      gap({ threshold_configured: true, min_items_required: 5, coverage_status: 'TOO_FEW' })
    ),
    'Too few items'
  );
  eq('no caveat once the threshold is configured', coverageCaveat([configured]), null);
  eq('no caveat for an empty result set', coverageCaveat([]), null);

  // TC1 draft age: stalled work and never-started work are different problems,
  // and conflating them means chasing authors for items that do not exist.
  const queue = (over: Partial<ProductionQueueRow>): ProductionQueueRow => ({
    production_priority: 1,
    subject: 'English',
    topic: 'Grammar',
    sub_topic: 'Articles',
    exam_type: 'BENCHMARK',
    published_count: 1,
    draft_count: 0,
    min_items_required: null,
    threshold_configured: false,
    deficit: null,
    oldest_draft_age_days: null,
    coverage_status: 'ADEQUATE',
    ...over,
  });

  eq('no drafts at all produces no draft note', draftAgeNote(queue({})), null);
  eq(
    'a recent draft produces no stall warning',
    draftAgeNote(queue({ draft_count: 2, oldest_draft_age_days: 10 })),
    null
  );
  ok(
    'a stalled draft is called out with its age',
    (draftAgeNote(queue({ draft_count: 1, oldest_draft_age_days: 120 })) ?? '').includes('120 days')
  );
  ok(
    'drafts with no recorded date are reported, not silently ignored',
    (draftAgeNote(queue({ draft_count: 3, oldest_draft_age_days: null })) ?? '').includes(
      'no recorded creation date'
    )
  );
}

// ---------------------------------------------------------------------------
console.log('\n=== A11: rates are never shown without their denominators ===');
// ---------------------------------------------------------------------------

{
  const stage = (over: Partial<FunnelStageRow>): FunnelStageRow => ({
    stage: 'PAYWALL_READY',
    stage_rank: 7,
    channel: '(all)',
    campaign: '(all)',
    device_class: 'unknown',
    visitors: 12,
    events: 12,
    prev_stage: 'REPORT_SENT',
    prev_stage_visitors: 18,
    stage_conversion_rate: 66.67,
    stage_dropoff_count: 6,
    suppressed: false,
    ...over,
  });

  // Three states must not collapse into one. Rendering a suppressed 62% beside a
  // genuine 62% is how a team spends a sprint chasing noise.
  eq('a real rate is rendered as a percentage', rateLabel(62.5, false), '62.5%');
  eq('a suppressed rate refuses to print a number', rateLabel(62.5, true), 'too small');
  eq('a missing rate is a dash, not zero', rateLabel(null, false), '—');

  // Ranks by ABSOLUTE drop-off, not by rate: losing 17 of 58 people is a bigger
  // problem than losing 1 of 3, even though 1-of-3 is the worse percentage.
  const funnel = [
    stage({ stage: 'SIGNED_UP', stage_rank: 1, prev_stage: null, prev_stage_visitors: null,
            stage_conversion_rate: null, stage_dropoff_count: 0, visitors: 58 }),
    stage({ stage: 'STUDENT_ADDED', stage_rank: 2, prev_stage: 'SIGNED_UP',
            prev_stage_visitors: 58, visitors: 41, stage_conversion_rate: 70.69,
            stage_dropoff_count: 17 }),
    stage({ stage: 'DIAGNOSTIC_STARTED', stage_rank: 3, prev_stage: 'STUDENT_ADDED',
            prev_stage_visitors: 41, visitors: 28, stage_conversion_rate: 68.29,
            stage_dropoff_count: 13 }),
  ];
  eq('weakest stage is the biggest absolute leak', weakestStage(funnel)?.stage, 'STUDENT_ADDED');

  // The entry stage has no predecessor, so it cannot leak and must never be
  // named as the weakest point.
  eq(
    'the entry stage is never the weakest',
    weakestStage([funnel[0]])?.stage ?? null,
    null
  );

  // A suppressed stage is noise: naming it would send the team after a phantom.
  eq(
    'suppressed stages are excluded from the weakest calculation',
    weakestStage([
      stage({ stage: 'CUSTOMER', stage_dropoff_count: 99, suppressed: true }),
      funnel[1],
    ])?.stage,
    'STUDENT_ADDED'
  );

  ok(
    'headline names the leak and both denominators',
    funnelHeadline(funnel).includes('17 people lost') &&
      funnelHeadline(funnel).includes('Signed up')
  );
  ok(
    'an all-suppressed funnel says so instead of inventing a headline',
    funnelHeadline([stage({ suppressed: true })]).includes('below the 20-visitor reporting floor')
  );
  eq('an empty funnel is stated plainly', funnelHeadline([]), 'No funnel activity in this period.');

  // Unknown stage names fall through rather than rendering "undefined".
  eq('known stages get human labels', stageLabel('CUSTOMER'), 'Purchased');
  eq('unknown stages fall back to the raw name', stageLabel('SOMETHING_NEW'), 'SOMETHING_NEW');
}

// ---------------------------------------------------------------------------
console.log('\n=== C9: device is derived server-side, never trusted from the client ===');
// ---------------------------------------------------------------------------

{
  const req = (headers: Record<string, string>) =>
    new Request('https://example.test/api/events', { headers });

  // Client hints are structured and preferred; the UA is the fallback because
  // hint coverage is partial, particularly on iOS.
  eq('hint ?1 is mobile', classifyDevice(req({ 'sec-ch-ua-mobile': '?1' })), 'mobile');
  eq('hint ?0 is desktop', classifyDevice(req({ 'sec-ch-ua-mobile': '?0' })), 'desktop');
  eq(
    'iPad UA is tablet',
    classifyDevice(req({ 'user-agent': 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' })),
    'tablet'
  );
  eq(
    'iPhone UA is mobile',
    classifyDevice(req({ 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' })),
    'mobile'
  );
  eq(
    'desktop UA is desktop',
    classifyDevice(req({ 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })),
    'desktop'
  );
  // No headers at all is genuinely unobservable, and must not be guessed into a
  // segment - a fabricated 'desktop' would inflate that cohort silently.
  eq('no headers is unknown, not a guess', classifyDevice(req({})), 'unknown');

  // The hint wins over a contradictory UA. This is the anti-spoofing property:
  // the class comes from headers the server reads, not from a body field a
  // client could set to manufacture a 100%-converting mobile cohort.
  eq(
    'client hint overrides a contradictory UA',
    classifyDevice(req({ 'sec-ch-ua-mobile': '?0', 'user-agent': 'iPhone' })),
    'desktop'
  );

  // Only the four known classes may be stored. Anything else - including a
  // plausible-looking value a client might inject - is rejected.
  ok('accepts the four known classes', ['mobile', 'tablet', 'desktop', 'unknown'].every(isDeviceClass));
  ok('rejects an injected segment', !isDeviceClass('bot'));
  ok('rejects a near-miss casing', !isDeviceClass('Mobile'));
  ok('rejects null and undefined', !isDeviceClass(null) && !isDeviceClass(undefined));
}

// ---------------------------------------------------------------------------
console.log('\n=== N-7: offer personalisation moves a benefit, never invents one ===');
// ---------------------------------------------------------------------------

{
  // The real default benefit list from the offer route.
  const INCLUDES = [
    '6 full-length exam papers across NAPLAN, Selective, Scholarship and Olympiad',
    'Unlimited AI writing marks with criterion-level feedback',
    'Time-per-question diagnostics and full question-level review',
    'Progress trend across every attempt',
    'An adaptive weekly study plan that re-targets the weakest topic',
    'A 30-day money-back guarantee',
  ];

  eq(
    'clicking Progress trend promotes the trend benefit',
    prioritiseIncludes(INCLUDES, 'Progress trend')[0],
    'Progress trend across every attempt'
  );
  eq(
    'clicking Adaptive study plan promotes the plan benefit',
    prioritiseIncludes(INCLUDES, 'Adaptive study plan')[0],
    'An adaptive weekly study plan that re-targets the weakest topic'
  );
  eq(
    'clicking Further AI writing marks promotes the writing benefit',
    prioritiseIncludes(INCLUDES, 'Further AI writing marks')[0],
    'Unlimited AI writing marks with criterion-level feedback'
  );

  // Reordering must be lossless: a personalisation that dropped the guarantee
  // would be a compliance problem, not a conversion win.
  const moved = prioritiseIncludes(INCLUDES, 'Progress trend');
  eq('no benefit is lost', moved.length, INCLUDES.length);
  eq('no benefit is duplicated', new Set(moved).size, INCLUDES.length);
  eq(
    'every original benefit is still present',
    INCLUDES.every((line) => moved.includes(line)),
    true
  );
  eq(
    'the remaining order is preserved',
    moved.slice(1),
    INCLUDES.filter((l) => l !== 'Progress trend across every attempt')
  );

  // No signal, or an unrecognised one, must leave the list exactly as it was.
  eq('null insight leaves the order untouched', prioritiseIncludes(INCLUDES, null), INCLUDES);
  eq('unknown insight leaves the order untouched', prioritiseIncludes(INCLUDES, 'Something else'), INCLUDES);
  eq(
    'an already-first benefit is not reshuffled',
    prioritiseIncludes(INCLUDES, 'Further AI writing marks')[0],
    INCLUDES[1]
  );

  // COMPLETENESS: every locked insight the paywall can emit must map to a real
  // benefit. Without this, adding a sixth insight would silently personalise
  // nothing - the event would be captured and the offer unchanged, which is the
  // exact write-only failure N-7 exists to fix.
  const unmapped = LOCKED_INSIGHT_TITLES.filter(
    (title) => prioritiseIncludes(INCLUDES, title) === INCLUDES
  );
  eq('every locked insight maps to a benefit in the default list', unmapped, []);

  ok('known titles are recognised', LOCKED_INSIGHT_TITLES.every(isLockedInsight));
  ok('an injected title is rejected', !isLockedInsight('Free money'));

  eq('no signal produces no acknowledgement line', interestLine(null), null);
  eq('an unknown title produces no line', interestLine('Free money'), null);
  ok(
    'a known title produces a line naming it',
    (interestLine('Progress trend') ?? '').includes('progress trend')
  );
}

// ---------------------------------------------------------------------------
console.log('\n=== A12: the forest plot must not manufacture confidence ===');
// ---------------------------------------------------------------------------

{
  const arm = (over: Partial<ExperimentResultRow>): ExperimentResultRow => ({
    experiment_key: 'n7',
    experiment_name: 'N-7',
    status: 'RUNNING',
    variant: 'personalised',
    is_control: false,
    sample_size: 4,
    conversions: 2,
    variant_conversion_rate: 50,
    control_sample_size: 4,
    control_rate: 75,
    diff_pp: -25,
    ci_lower_pp: -65.53,
    ci_upper_pp: 31.96,
    p_value_experiment: 0.465209,
    recommended_decision: 'INSUFFICIENT_DATA',
    decision_reason: 'Only 4 exposed...',
    ...over,
  });

  // The seeded N-7 result: -25pp looks like a decisive loss, but the interval
  // spans zero. This is precisely the misreading a two-bar chart would cause.
  ok('an interval spanning zero crosses zero', ciCrossesZero(arm({})));
  ok('an entirely positive interval does not', !ciCrossesZero(arm({ ci_lower_pp: 1.3, ci_upper_pp: 8.6 })));
  ok('an entirely negative interval does not', !ciCrossesZero(arm({ ci_lower_pp: -8.3, ci_upper_pp: -1.7 })));
  ok('a missing interval is treated as crossing zero', ciCrossesZero(arm({ ci_lower_pp: null, ci_upper_pp: null })));

  // Every arm shares ONE axis, or the intervals are not comparable.
  const rows = [arm({}), arm({ variant: 'b', diff_pp: 5, ci_lower_pp: 1, ci_upper_pp: 9 })]
  const domain = forestDomain(rows)
  ok('the domain always includes zero', domain.min <= 0 && domain.max >= 0)
  ok('the domain covers the widest interval', domain.min <= -65.53 && domain.max >= 65.53)
  ok('the domain is symmetric so zero sits centre', domain.min === -domain.max)
  eq('zero maps to the middle of the axis', forestPosition(0, domain), 50)
  eq('the domain minimum maps to 0%', forestPosition(domain.min, domain), 0)
  eq('the domain maximum maps to 100%', forestPosition(domain.max, domain), 100)
  ok(
    'a value beyond the domain is clamped, not drawn off-canvas',
    forestPosition(domain.max * 10, domain) === 100 && forestPosition(domain.min * 10, domain) === 0
  )
  ok(
    'ordering is preserved on the axis',
    forestPosition(-25, domain) < forestPosition(5, domain)
  )

  // An empty experiment still gets a usable axis rather than a divide-by-zero.
  const empty = forestDomain([])
  ok('an empty plot still has a valid domain', empty.min < 0 && empty.max > 0)
  eq('zero is still centre on an empty plot', forestPosition(0, empty), 50)

  // THE HARD RULE: below the minimum, the verdict must never read as equivalence.
  const label = experimentDecisionLabel('INSUFFICIENT_DATA')
  ok('INSUFFICIENT_DATA is not labelled "no difference"', !/no difference/i.test(label))
  ok('INSUFFICIENT_DATA says data is lacking', /not enough data/i.test(label))
  eq('SHIP is actionable wording', experimentDecisionLabel('SHIP'), 'Ship it')
  eq('REVERT is actionable wording', experimentDecisionLabel('REVERT'), 'Revert')

  eq('no arms is stated plainly', experimentHeadline([]), 'No experiments are collecting exposures yet.')
  ok(
    'an all-insufficient headline denies equivalence explicitly',
    experimentHeadline([arm({})]).includes('not evidence that the changes do nothing')
  )
  ok(
    'an actionable arm is counted',
    experimentHeadline([arm({ recommended_decision: 'SHIP' })]).includes('1 arm')
  )
}

// ---------------------------------------------------------------------------
// P2 - percentile wording. The RULES (suppression, bands, mid-rank) are tested
// in pgtap against the SQL that owns them; these pin the wording guarantees a
// parent actually reads: no figure when suppressed, no point below the point
// floor, cohort context and progress pairing always present (B1).
{
  const pRow = (o: Record<string, unknown> = {}) => ({
    suppressed: false,
    percentile_rank: null as number | null,
    percentile_band: 3 as number | null,
    year_level: 5,
    family_group_label: 'NAPLAN-style',
    cohort_size: 27,
    cohort_window_months: 12,
    window_start: '2025-11-18',
    window_end: '2026-11-18',
    ...o,
  })

  const suppressedLine = percentileSentence(pRow({ suppressed: true, percentile_band: null }))
  ok('suppressed percentile renders no % figure', !/%/.test(suppressedLine))
  ok('suppression states its reason', /not enough students/i.test(suppressedLine))
  ok(
    'suppression wins even if a figure somehow arrives',
    !percentileSentence(pRow({ suppressed: true, percentile_rank: 72 })).includes('72')
  )

  eq('band 4 is the top quarter', percentileBandLabel(4), 'top quarter')
  ok('band labels refuse out-of-range values', percentileBandLabel(5) === null && percentileBandLabel(0) === null)
  ok('a band sentence carries no point figure', !/\d+%/.test(percentileSentence(pRow({ percentile_band: 2 }))))
  ok('a band sentence names its quartile', percentileSentence(pRow({ percentile_band: 2 })).includes('second quarter'))
  ok(
    'a point sentence states the figure',
    percentileSentence(pRow({ percentile_rank: 72, percentile_band: null, cohort_size: 60 })).includes('72%')
  )
  eq(
    'no rank and no band falls back to the honest line, never a guess',
    percentileSentence(pRow({ percentile_band: null })),
    suppressedLine
  )

  const ctx = cohortContextSentence(pRow())
  ok('cohort context always shows the size', ctx.includes('27'))
  ok('cohort context shows the window', ctx.includes('12 months'))
  ok('cohort context disclaims state/national', /not a state or national ranking/i.test(ctx))

  ok('progress pairing is present even with no delta', /no progress figure/i.test(progressPairingSentence(null)))
  ok('positive progress is signed', progressPairingSentence(4.2).includes('+4'))
  ok('negative progress is signed', progressPairingSentence(-3.2).includes('-3'))
}

// ---------------------------------------------------------------------------
// Year-level practice caps (decision 4-A)
//
// These tests are about three things that all fail silently:
//
//  1. The coherence rule. A recommended target above the ceiling is not a
//     formatting problem, it is an incoherent policy — the ceiling is defined as
//     the most the system will ever ask, so advice above it means the operator
//     believes the ceiling is something else. If that reaches Postgres it is
//     rejected by a CHECK, but a rejected save with an unreadable message is how
//     operators stop trusting a screen.
//
//  2. The "at least 2" floor. This is the only automated guard on a number that
//     came from a business decision rather than from arithmetic. Nothing in the
//     schema says a recommended target may not be 0; the CHECK does, and this
//     pins that the client agrees with it.
//
//  3. That `field` names match what the editor renders. The table looks failures
//     up by field key. A validator returning `target_tests` while the form
//     expects `recommended_tests` produces a save that is refused and displays
//     nothing at all — a silent no-op, and the easiest of the three to introduce.
// ---------------------------------------------------------------------------

console.log('\n=== Year-level practice caps (decision 4-A) ===');
{
  const base: YearLevelCapDraft = {
    year_level: 2,
    max_tests: 10,
    max_questions: 250,
    recommended_tests: 2,
    recommended_questions: 50,
    daily_target_basis: 'recommended',
  };
  const draft = (over: Partial<YearLevelCapDraft>): YearLevelCapDraft => ({ ...base, ...over });

  ok('the seeded Year 2 row validates', validateYearLevelCap(base).length === 0);
  ok(
    'every seeded year level validates',
    [
      draft({ year_level: 3, max_tests: 15, max_questions: 375 }),
      draft({ year_level: 5, max_tests: 15, max_questions: 375 }),
      draft({ year_level: 6, max_tests: 20, max_questions: 500, recommended_tests: 3, recommended_questions: 75 }),
      draft({ year_level: 9, max_tests: 25, max_questions: 625, recommended_tests: 3, recommended_questions: 75 }),
    ].every((d) => isCapDraftValid(d))
  );

  ok(
    'a target above the ceiling is refused',
    validateYearLevelCap(draft({ recommended_tests: 30 })).some(
      (f) => f.field === 'recommended_tests' && f.code === 'TARGET_TESTS_EXCEEDS_CEILING'
    )
  );
  ok(
    'a question target above the question ceiling is refused',
    validateYearLevelCap(draft({ recommended_questions: 300 })).some(
      (f) => f.field === 'recommended_questions' && f.code === 'TARGET_QUESTIONS_EXCEEDS_CEILING'
    )
  );

  // Decision 4-A: "target must be recommended only and around at least 2".
  ok('the floor is 2, not 1 or 0', CAP_BOUNDS.recommendedMin === 2);
  ok(
    'a recommended target below the floor is refused',
    validateYearLevelCap(draft({ recommended_tests: 1 })).some((f) => f.code === 'TARGET_TESTS_TOO_LOW')
  );
  ok(
    'a zero target is refused rather than read as "no limit"',
    validateYearLevelCap(draft({ recommended_tests: 0 })).length > 0
  );

  ok(
    'a ceiling beyond the guard range is refused',
    validateYearLevelCap(draft({ max_tests: 41 })).some((f) => f.code === 'CEILING_TESTS_OUT_OF_RANGE')
  );
  ok(
    'a ceiling of zero is refused — it would stop every child practising',
    validateYearLevelCap(draft({ max_tests: 0 })).some((f) => f.code === 'CEILING_TESTS_OUT_OF_RANGE')
  );
  ok(
    'a question ceiling beyond the guard range is refused',
    validateYearLevelCap(draft({ max_questions: 5000 })).some((f) => f.code === 'CEILING_QUESTIONS_OUT_OF_RANGE')
  );

  ok(
    'Year 1 and Year 10 are both out of range',
    validateYearLevelCap(draft({ year_level: 1 })).some((f) => f.code === 'YEAR_LEVEL_OUT_OF_RANGE') &&
      validateYearLevelCap(draft({ year_level: 10 })).some((f) => f.code === 'YEAR_LEVEL_OUT_OF_RANGE')
  );

  // Blank and fractional fields arrive as NaN from the number inputs.
  const blank = draft({ max_tests: Number.NaN });
  ok('a blank ceiling is refused, not treated as unlimited', validateYearLevelCap(blank).length > 0);
  ok(
    'a fractional ceiling is refused',
    validateYearLevelCap(draft({ max_tests: 7.5 })).some((f) => f.code === 'CEILING_TESTS_OUT_OF_RANGE')
  );
  ok(
    'a blank target does not invent a spurious exceeds-ceiling error',
    validateYearLevelCap(draft({ recommended_tests: Number.NaN })).every(
      (f) => f.code !== 'TARGET_TESTS_EXCEEDS_CEILING'
    )
  );
  ok('validation never throws on hostile input', (() => {
    try {
      validateYearLevelCap(draft({ max_tests: Infinity, recommended_questions: -Infinity }));
      return true;
    } catch {
      return false;
    }
  })());

  ok(
    'several bad fields are reported together, not one per keystroke',
    validateYearLevelCap(draft({ year_level: 12, max_tests: 99, recommended_tests: 0 })).length >= 3
  );

  // Every message names the year level: on an eight-row table an error without a
  // row reference is an error about the wrong row.
  //
  // Note the draft: the ceiling stays legal (10) and only the target is wrong.
  // The first version of this test set `max_tests: 99` as well, which pushed the
  // ceiling out of range and meant 99 > 99 — so the coherence rule never fired and
  // the assertion was checking a message that had not been produced. A test that
  // passes because the interesting branch was skipped is the quiet kind of useless.
  const messages = validateYearLevelCap(draft({ recommended_tests: 30 }));
  ok('every refusal names its year level', messages.length > 0 && messages.every((f) => f.message.includes('Year 2')));
  ok(
    'a coherence refusal quotes the ceiling it exceeded',
    messages.some((f) => f.code === 'TARGET_TESTS_EXCEEDS_CEILING' && f.message.includes('(10)'))
  );
  ok(
    'a refusal that is out of range says so instead of pretending to be coherent',
    validateYearLevelCap(draft({ max_tests: 99, recommended_tests: 99 })).some(
      (f) => f.code === 'CEILING_TESTS_OUT_OF_RANGE'
    )
  );

  // The field keys must be exactly the ones YearCapsTable renders against.
  const renderable = new Set([
    'year_level',
    'max_tests',
    'max_questions',
    'recommended_tests',
    'recommended_questions',
  ]);
  ok(
    'every failure field is one the editor can display',
    validateYearLevelCap(
      draft({ year_level: 1, max_tests: 0, max_questions: 0, recommended_tests: 1, recommended_questions: 1 })
    ).every((f) => renderable.has(f.field))
  );

  ok('isCapDraftValid agrees with the failure list', isCapDraftValid(base) && !isCapDraftValid(blank));

  // The mandated year-level set. `loadYearLevelCaps()` reports an *empty* read as
  // a failure rather than as "nothing configured", because HTTP 200 with [] is
  // what a refused read looks like — verified live against a fully seeded table.
  // That reasoning only holds while this set matches what the migration seeds, so
  // it is pinned here and cross-checked against the migration by test:gates.
  ok('the mandated set is Years 2 through 9', EXPECTED_YEAR_LEVELS.join(',') === '2,3,4,5,6,7,8,9');
  ok('a complete read reports nothing missing', missingYearLevels([2, 3, 4, 5, 6, 7, 8, 9]).length === 0);
  ok(
    'a missing level is named, not swallowed',
    missingYearLevels([2, 3, 4, 5, 7, 8, 9]).join(',') === '6'
  );
  ok('an empty read reports every level missing', missingYearLevels([]).length === 8);
  ok(
    'unexpected extra levels are not treated as missing',
    missingYearLevels([2, 3, 4, 5, 6, 7, 8, 9, 10]).length === 0
  );
  ok('the mandated set cannot be mutated by a caller', (() => {
    try {
      (EXPECTED_YEAR_LEVELS as number[]).push(10);
      return false;
    } catch {
      return EXPECTED_YEAR_LEVELS.length === 8;
    }
  })());


  // The clamp policy. An unknown mode is the one input that does not fail a range
  // check, so it is easy to imagine this being let through to the database's CHECK
  // and the operator seeing a constraint name for a dropdown choice.
  ok('both documented modes are accepted',
    validateYearLevelCap(draft({ daily_target_basis: 'ceiling' })).length === 0 &&
    validateYearLevelCap(draft({ daily_target_basis: 'recommended' })).length === 0);
  ok('the exported modes are exactly the two the database allows',
    DAILY_TARGET_BASES.join(',') === 'ceiling,recommended' ||
    DAILY_TARGET_BASES.join(',') === 'recommended,ceiling');
  ok('an unknown mode is refused by name, not defaulted',
    validateYearLevelCap(draft({ daily_target_basis: 'Recommend' as DailyTargetBasis })).some(
      (f) => f.code === 'BASIS_UNKNOWN' && f.field === 'daily_target_basis'
    ));
  ok('a missing mode is refused too',
    validateYearLevelCap(draft({ daily_target_basis: undefined as unknown as DailyTargetBasis }))
      .some((f) => f.code === 'BASIS_UNKNOWN'));
  ok('every clamp mode has display copy',
    DAILY_TARGET_BASES.every((b) => typeof CLAMP_MODE_COPY[b] === 'string' && CLAMP_MODE_COPY[b].length > 20));

  // The audit line carries all four numbers, or a changed ceiling hides behind an
  // unchanged target in the toast an operator reads after saving.
  //
  // Annotated rather than inferred: naming the type here means a rename of any
  // field on YearLevelCap fails the compile instead of quietly leaving this test
  // asserting against an object the interface no longer describes.
  const describedRow: YearLevelCap = {
    year_level: 7,
    max_tests_per_day: 20,
    max_questions_per_day: 500,
    recommended_tests_per_day: 3,
    recommended_questions_per_day: 75,
    daily_target_basis: 'ceiling',
    updated_at: null,
  };
  const described = describeCap(describedRow);
  ok(
    'the audit summary carries every configured number and the policy',
    ['Year 7', '20 tests', '500 questions', '3 tests', '75 questions', 'ceiling'].every((t) => described.includes(t))
  );
}

// ---------------------------------------------------------------------------
console.log(`\n${'-'.repeat(58)}`);


console.log(`PASSED: ${pass}   FAILED: ${fail}`);
console.log(`${'-'.repeat(58)}\n`);
if (fail > 0) process.exit(1);



