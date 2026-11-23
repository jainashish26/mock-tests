/**
 * Tutor view-derivation tests.
 *
 * WHY THESE ASSERTIONS
 *   The tutor dashboard and the tutor drill-down show the same child from the same
 *   rows, and every figure they derive has a way of being wrong that still renders:
 *   "0% complete" for a child who was never assigned anything, "0 pp" for a movement
 *   the database refused to compute, a chase list that opens with on-time work, an
 *   avatar circle with no letter in it. None of those are type errors, and all of
 *   them are the kind of thing a tutor would act on.
 *
 *   The last block is a DRIFT GUARD: it reads both page files and fails if either
 *   grows its own inline copy of a derivation that now lives in tutor-format. That
 *   is how the two pages ended up needing this module in the first place.
 *
 * Run with:
 *   npm run test:tutor
 *
 * Dependency-free, matching scripts/test-form-metrics.test.mts.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  completionLabel,
  completionPct,
  consentWindowLabel,
  daysUntil,
  initialFor,
  movementLabel,
  sortAssignments,
  MOVEMENT_TONE_CLASS,
  type TutorAssignmentLike,
} from '@/lib/reporting/tutor-format';

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
const DAY = 86_400_000;
// Fixed "now" so every date assertion is deterministic regardless of when CI runs.
const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);
const iso = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString();

const assignment = (
  is_overdue: boolean,
  due_at: string | null,
  assignment_status: TutorAssignmentLike['assignment_status'] = 'ASSIGNED'
): TutorAssignmentLike => ({ is_overdue, due_at, assignment_status });

console.log('\n=== consent window: absent is not expired ===');
{
  eq('null expiry -> null label', consentWindowLabel(null, NOW), null);
  eq('undefined expiry -> null label', consentWindowLabel(undefined, NOW), null);
  eq('unparseable date -> null days', daysUntil('not-a-date', NOW), null);
  eq('a year out has no countdown', consentWindowLabel(iso(365), NOW), `until ${new Date(iso(365)).toLocaleDateString()}`);
  const soon = consentWindowLabel(iso(3), NOW) ?? '';
  ok('three days out counts down', soon.includes('3 days left'), soon);
  const one = consentWindowLabel(iso(1), NOW) ?? '';
  ok('singular day is not pluralised', one.includes('1 day left') && !one.includes('1 days'), one);
  const past = consentWindowLabel(iso(-2), NOW) ?? '';
  ok('a lapsed window says expired, not "-2 days"', past.startsWith('expired'), past);
  eq('daysUntil is null-safe', daysUntil(null, NOW), null);
}

console.log('\n=== completion: nothing assigned is not 0% ===');
{
  eq('no assignments -> null', completionPct(0, 0), null);
  eq('no assignments but completions -> null', completionPct(0, 3), null);
  eq('three of four', completionPct(4, 3), 75);
  eq('one of three rounds down', completionPct(3, 1), 33);
  eq('two of three rounds up', completionPct(3, 2), 67);
  eq('more completed than assigned clamps to 100', completionPct(2, 5), 100);
  eq('label omits the percentage when unassigned', completionLabel(0, 0), '0/0');
  eq('label carries both counts and the rate', completionLabel(4, 3), '3/4 · 75%');
}

console.log('\n=== chase order: overdue first, no deadline last ===');
{
  const rows = [
    assignment(false, iso(5)),          // on time, later
    assignment(false, null),            // no deadline
    assignment(true, iso(-3)),          // overdue
    assignment(false, iso(1)),          // on time, sooner
    assignment(true, iso(-9)),          // overdue, older
  ];
  const sorted = sortAssignments(rows);
  eq('overdue items lead', sorted.slice(0, 2).map((r) => r.is_overdue), [true, true]);
  eq('oldest overdue first', sorted[0].due_at, iso(-9));
  eq('then soonest due', sorted[2].due_at, iso(1));
  eq('then later due', sorted[3].due_at, iso(5));
  eq('no-deadline rows come last', sorted[4].due_at, null);
  eq('every row survives the sort', sorted.length, rows.length);
  eq('the input is not mutated', rows.map((r) => r.due_at), [iso(5), null, iso(-3), iso(1), iso(-9)]);
}

console.log('\n=== movement: null is absence, not zero ===');
{
  eq('null reads as words', movementLabel(null), { text: 'not enough attempts', tone: 'neutral' });
  eq('undefined reads as words', movementLabel(undefined), { text: 'not enough attempts', tone: 'neutral' });
  eq('a real zero is still a zero', movementLabel(0), { text: '0 pp', tone: 'neutral' });
  eq('gains are signed and green', movementLabel(5), { text: '+5 pp', tone: 'up' });
  eq('losses keep their sign', movementLabel(-3), { text: '-3 pp', tone: 'down' });
  ok('a fall is coloured destructive', MOVEMENT_TONE_CLASS.down.includes('destructive'));
  ok('a rise is not coloured destructive', !MOVEMENT_TONE_CLASS.up.includes('destructive'));
  ok('all three tones have a class', Object.keys(MOVEMENT_TONE_CLASS).length === 3);
}

console.log('\n=== avatar letter ===');
{
  eq('lowercase is capitalised', initialFor('maya'), 'M');
  eq('leading space is trimmed', initialFor('  ada'), 'A');
  eq('empty string is a visible fallback', initialFor(''), '?');
  eq('null is a visible fallback', initialFor(null), '?');
}

console.log('\n=== drift guard: one definition, not one per page ===');
{
  const read = (...parts: string[]) => readFileSync(join(HERE, '..', ...parts), 'utf8');
  const dashboard = read('src', 'app', 'tutor', 'page.tsx');
  const drilldown = read('src', 'app', 'tutor', 'student', '[id]', 'page.tsx');
  const moduleSrc = read('src', 'lib', 'reporting', 'tutor-format.ts');

  ok('the module stays free of next/headers', !moduleSrc.includes('next/headers'));
  ok('the dashboard imports the shared derivations', dashboard.includes("@/lib/reporting/tutor-format"));
  ok('the drill-down imports the shared derivations', drilldown.includes("@/lib/reporting/tutor-format"));

  // Each of these was an inline copy before the module existed; if one reappears
  // the two pages can disagree about the same child again.
  for (const [name, src] of [['dashboard', dashboard], ['drill-down', drilldown]] as const) {
    ok(`${name} does not hand-roll the avatar letter`, !src.includes('.charAt(0).toUpperCase()'));
    ok(`${name} does not redefine daysUntil`, !/function\s+daysUntil\s*\(/.test(src));
    ok(`${name} does not hand-roll the chase sort`, !src.includes('localeCompare'));
    ok(`${name} does not hand-roll completion maths`, !src.includes('assigned_count > 0'));
  }
}

console.log(`\n${'-'.repeat(58)}`);
console.log(`PASSED: ${pass}   FAILED: ${fail}`);
console.log(`${'-'.repeat(58)}\n`);
if (fail > 0) process.exit(1);
