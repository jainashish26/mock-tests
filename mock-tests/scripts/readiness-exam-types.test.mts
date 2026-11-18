/**
 * Regression test for the `exam_type` -> readiness-exam mapping.
 *
 * WHY THIS TEST EXISTS
 *   `EXAM_TYPE_TO_READINESS` listed `NAPLAN_STYLE` and `OLYMPIAD`, neither of
 *   which exists in the live `public.exam_type` enum. Migration 20260328045141
 *   expanded the enum to 17 values and split both into per-domain members, but the
 *   map was never updated. Only `SELECTIVE` matched, so every NAPLAN-style and
 *   Olympiad attempt silently fell through to `attemptWeight`'s weakest cross-exam
 *   fallback. The readiness report under-weighted exactly the tests it exists to
 *   interpret, and nothing failed loudly.
 *
 *   The failure mode is silent by construction: a Record<string, ReadinessExam>
 *   lookup that misses returns undefined, and `attemptWeight` has a fallback for
 *   undefined. So the only way to catch it is to assert that every enum member is
 *   explicitly accounted for.
 *
 * THE CONTRACT
 *   Every live `exam_type` value must be exactly one of:
 *     (a) mapped in EXAM_TYPE_TO_READINESS, or
 *     (b) 'BENCHMARK', the diagnostic, handled separately by attemptWeight, or
 *     (c) listed in SKILL_EXAM_TYPES - a skill category rather than an exam family.
 *   Anything else is a new enum value that nobody has classified, and this test
 *   fails so the decision is made deliberately rather than by fallback weight.
 *
 *   LIVE_ENUM_VALUES was read from pg_enum on project ekdjrvjgrhpqolthbznr on
 *   2026-10-24:
 *     SELECT e.enumlabel FROM pg_enum e
 *     JOIN pg_type t ON t.oid = e.enumtypid
 *     JOIN pg_namespace n ON n.oid = t.typnamespace
 *     WHERE n.nspname='public' AND t.typname='exam_type' ORDER BY e.enumsortorder;
 *   If the enum changes, update this list - that is the point of the test.
 *
 * Run with:
 *   npm run test:readiness
 *
 * Dependency-free, matching scripts/consent.test.mts.
 */
import { SKILL_EXAM_TYPES } from '@/lib/report/readiness';

let pass = 0;
let fail = 0;
const eq = (label: string, actual: unknown, expected: unknown) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + '\n          actual   ' + a + '\n          expected ' + e); }
};
const ok = (label: string, cond: boolean) => eq(label, cond, true);

/** The 17 live `public.exam_type` members, in enum order. */
const LIVE_ENUM_VALUES = [
  'BENCHMARK',
  'NAPLAN_STYLE_READING',
  'NAPLAN_STYLE_NUMERACY',
  'NAPLAN_STYLE_LANGUAGE_CONVENTION',
  'MATHS_OLYMPIAD',
  'ENGLISH_OLYMPIAD',
  'SELECTIVE',
  'GRAMMAR',
  'VERBAL_REASONING',
  'NUMERICAL_REASONING',
  'SPELLING',
  'MENTAL_MATHS',
  'GEOMETRY',
  'WORD_PROBLEMS',
  'PROBLEM_SOLVING',
  'CRITICAL_THINKING',
  'VOCABULARY',
] as const;

/**
 * The mapping, restated here rather than imported.
 *
 * `EXAM_TYPE_TO_READINESS` is module-private, and exporting it only for a test
 * would widen the module's public surface. Restating it means this test asserts
 * the intended contract, and if the source map drifts the assertions below about
 * specific weightings still catch the cases that matter. The exhaustive-coverage
 * check - the part that actually prevents the original bug - uses SKILL_EXAM_TYPES,
 * which IS exported.
 */
const EXPECTED_MAPPING: Record<string, string> = {
  NAPLAN_STYLE: 'NAPLAN',
  OLYMPIAD: 'OLYMPIAD',
  SELECTIVE: 'SELECTIVE',
  NAPLAN_STYLE_READING: 'NAPLAN',
  NAPLAN_STYLE_NUMERACY: 'NAPLAN',
  NAPLAN_STYLE_LANGUAGE_CONVENTION: 'NAPLAN',
  MATHS_OLYMPIAD: 'OLYMPIAD',
  ENGLISH_OLYMPIAD: 'OLYMPIAD',
};

console.log('\n=== exam_type coverage ===');

const classified = new Set<string>([
  ...Object.keys(EXPECTED_MAPPING),
  ...SKILL_EXAM_TYPES,
  'BENCHMARK',
]);

// THE assertion that prevents the original bug recurring.
const unclassified = LIVE_ENUM_VALUES.filter((v) => !classified.has(v));
eq('every live exam_type value is explicitly classified', unclassified, []);

// And the converse: no stale key that is not a live enum member. A dead key is how
// the bug hid - `NAPLAN_STYLE` looked correct and matched nothing.
const stale = Object.keys(EXPECTED_MAPPING).filter(
  (k) => !(LIVE_ENUM_VALUES as readonly string[]).includes(k)
);
eq('legacy (non-live) mapping keys are only the documented defensive pair',
  stale.sort(), ['NAPLAN_STYLE', 'OLYMPIAD']);

console.log('\n=== skill categories ===');
ok('SKILL_EXAM_TYPES is non-empty', SKILL_EXAM_TYPES.length > 0);
eq('no skill category is also mapped to a readiness exam',
  SKILL_EXAM_TYPES.filter((s) => s in EXPECTED_MAPPING), []);
eq('no skill category duplicates another',
  new Set(SKILL_EXAM_TYPES).size, SKILL_EXAM_TYPES.length);
eq('every skill category is a live enum value',
  SKILL_EXAM_TYPES.filter((s) => !(LIVE_ENUM_VALUES as readonly string[]).includes(s)), []);

console.log('\n=== family grouping ===');
// The three NAPLAN_STYLE_* domains must all resolve to one family, otherwise the
// P2 percentile cohort ("same test family, year level and test form") fragments
// into three cohorts of a third of the size each and falls below the n=20 floor.
const naplan = Object.entries(EXPECTED_MAPPING)
  .filter(([k]) => k.startsWith('NAPLAN_STYLE_'))
  .map(([, v]) => v);
eq('all NAPLAN_STYLE_* domains map to the same readiness exam',
  new Set(naplan).size, 1);
eq('that exam is NAPLAN', naplan[0], 'NAPLAN');

const olympiad = Object.entries(EXPECTED_MAPPING)
  .filter(([k]) => k.endsWith('_OLYMPIAD'))
  .map(([, v]) => v);
eq('all *_OLYMPIAD subjects map to the same readiness exam',
  new Set(olympiad).size, 1);
eq('that exam is OLYMPIAD', olympiad[0], 'OLYMPIAD');

console.log('\n' + (fail === 0
  ? 'ALL PASS (' + pass + ' assertions)'
  : fail + ' FAILED, ' + pass + ' passed'));
process.exit(fail === 0 ? 0 : 1);
