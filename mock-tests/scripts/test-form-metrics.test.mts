/**
 * A4 test-form metric wording tests.
 *
 * WHY THESE ASSERTIONS
 *   A4 publishes a completion rate, an abandonment point and a reliability
 *   coefficient, and every one of them has a way of being wrong that renders
 *   perfectly: a `0` where the truth is "not measured", a coefficient beside a
 *   state that says it was never computed, or the word "reliable" next to a
 *   figure the database refused to produce. None of those are type errors.
 *
 *   The state vocabulary is asserted against the MIGRATION ITSELF rather than
 *   against a second hand-written list, because a copy of a vocabulary with
 *   nothing keeping it honest drifts - and it drifts in the direction where the
 *   database emits a state the UI has never heard of and renders as a blank cell.
 *   Same pattern as the year-level cap bounds test.
 *
 * Run with:
 *   npm run test:test-forms
 *
 * Dependency-free, matching scripts/expansion.test.mts.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  abandonmentSentence,
  attentionFlags,
  distributionSummary,
  formatCoefficient,
  formatPct,
  reliabilityCaveat,
  reliabilityLabel,
  testFormCsvRows,
  TEST_FORM_CSV_COLUMNS,
  RELIABILITY_STATES,
  type TestFormMetricLike,
} from '@/lib/reporting/test-form-format';

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n          ' + detail : '')); }
};
const eq = (label: string, actual: unknown, expected: unknown) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + '\n          actual   ' + a + '\n          expected ' + e); }
};

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(HERE, '..', 'supabase', 'migrations', '121_test_form_metrics.sql');

/** A healthy, reportable row; each test overrides exactly what it is about. */
const row = (
  o: Partial<TestFormMetricLike & { exam_type?: string | null; family_group?: string | null }> = {}
): TestFormMetricLike & { exam_type?: string | null; family_group?: string | null } => ({
  test_title: 'Language Conventions - NAPLAN - Year 7',
  attempts_started: 240,
  attempts_submitted: 227,
  abandoned_attempts: 13,
  completion_rate_pct: 94.6,
  completion_reportable: true,
  abandonment_point: 43,
  abandonment_share_pct: 5.4,
  abandonment_flagged: false,
  items_in_form: 90,
  items_answered_by_all: 0,
  reliability_coefficient: null,
  reliability_state: 'NO_COMPLETE_ATTEMPTS',
  reliability_meets_floor: false,
  mean_score: 53.2,
  median_score: 53.3,
  score_n: 227,
  ...o,
});

console.log('\n=== the state vocabulary matches the migration ===');
{
  const sql = readFileSync(MIGRATION, 'utf8');
  // Every state literal the SQL can emit: the THEN branches plus the ELSE 'OK'.
  const emitted = new Set(
    [...sql.matchAll(/'((?:OK|TOO_[A-Z_]+|NO_[A-Z_]+))'/g)].map((m) => m[1])
  );

  eq(
    'the UI knows exactly the states the database emits',
    [...RELIABILITY_STATES].sort(),
    [...emitted].sort()
  );
  ok(
    'the migration file was found and read',
    sql.includes('reliability_state') && emitted.size > 0
  );
}

console.log('\n=== a state never renders as a blank or a reassurance ===');
{
  for (const state of RELIABILITY_STATES) {
    const label = reliabilityLabel(state);
    ok(`'${state}' has a label`, label.length > 0 && label !== 'Unknown state', label);
  }
  ok(
    'an unseen state reads as unknown, not as "Computed"',
    reliabilityLabel('SOMETHING_NEW') === 'Unknown state'
  );
}

console.log('\n=== null never renders as a number ===');
{
  eq('a null percentage is an em dash', formatPct(null), '—');
  eq('an undefined percentage is an em dash', formatPct(undefined), '—');
  eq('zero is still zero', formatPct(0), '0%');
  eq('a numeric string is coerced', formatPct('94.6'), '94.6%');
  eq('a null coefficient is an em dash', formatCoefficient(null), '—');
  eq('a coefficient keeps three decimals', formatCoefficient(0.8333), '0.833');
  eq('a negative coefficient is shown, not clamped', formatCoefficient(-0.667), '-0.667');
}

console.log('\n=== the caveat is data-driven ===');
{
  eq('no forms -> no caveat', reliabilityCaveat([]), null);
  ok(
    'no coefficient anywhere -> caveat present',
    (reliabilityCaveat([row(), row({ reliability_state: 'TOO_FEW_ITEMS' })]) ?? '').includes(
      'No form has a reliability coefficient yet'
    )
  );
  ok(
    'the caveat names the cause rather than the symptom',
    (reliabilityCaveat([row()]) ?? '').includes('records no row for an item it does not serve')
  );
  eq(
    'one computable form clears the caveat for the whole report',
    reliabilityCaveat([row(), row({ reliability_coefficient: 0.812, reliability_state: 'OK' })]),
    null
  );
}

console.log('\n=== abandonment always carries its denominator ===');
{
  const withPoint = abandonmentSentence(row());
  ok('names the item position', withPoint.includes('item 43 of 90'));
  ok('names the share and the denominator', withPoint.includes('13 of 240 attempts (5.4%)'));

  const withoutPoint = abandonmentSentence(row({ abandonment_point: null, abandoned_attempts: 0 }));
  ok('a null point says so instead of printing 0', withoutPoint.includes('no abandonment point'));
}

console.log('\n=== attention flags never invent a benchmark ===');
{
  eq('a healthy form has no flags', attentionFlags(row()), []);
  eq(
    'a small sample is flagged',
    attentionFlags(row({ completion_reportable: false })),
    ['Small sample']
  );
  eq(
    'high abandonment is flagged from the SQL threshold',
    attentionFlags(row({ abandonment_flagged: true })),
    ['High abandonment']
  );
  eq(
    'a coefficient below the floor is flagged',
    attentionFlags(row({ reliability_coefficient: 0.42, reliability_state: 'OK' })),
    ['Below reliability floor']
  );
  eq(
    'an ABSENT coefficient is not flagged as below the floor',
    attentionFlags(row({ reliability_coefficient: null })),
    []
  );
}

console.log('\n=== the histogram summary counts what it drew ===');
{
  const buckets = [
    { bucket: 1, score_from: 0, score_to: 10, attempts: 0 },
    { bucket: 2, score_from: 10, score_to: 20, attempts: 10 },
    { bucket: 7, score_from: 60, score_to: 70, attempts: 42 },
    { bucket: 10, score_from: 90, score_to: 100, attempts: 5 },
  ];
  eq('totals add up', distributionSummary(buckets).total, 57);
  eq('the peak is the tallest non-empty bucket', distributionSummary(buckets).peak?.bucket, 7);
  eq(
    'an all-zero histogram has no peak',
    distributionSummary([{ bucket: 1, score_from: 0, score_to: 10, attempts: 0 }]).peak,
    null
  );
}

console.log('\n=== CSV keeps the state token, not the prose ===');
{
  ok('the export has columns', TEST_FORM_CSV_COLUMNS.length >= 10);
  const [csv] = testFormCsvRows([row({ exam_type: 'NAPLAN_STYLE_LANGUAGE_CONVENTION' })]);
  eq('the raw state token survives', csv.reliability_state, 'NO_COMPLETE_ATTEMPTS');
  eq('a null coefficient stays null', csv.reliability_coefficient, null);
  eq('the exam type is carried', csv.exam_type, 'NAPLAN_STYLE_LANGUAGE_CONVENTION');
}

console.log(`\n${'-'.repeat(58)}`);
console.log(`PASSED: ${pass}   FAILED: ${fail}`);
console.log(`${'-'.repeat(58)}\n`);
if (fail > 0) process.exit(1);
