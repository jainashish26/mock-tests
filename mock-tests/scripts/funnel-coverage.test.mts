/**
 * Funnel catalogue coverage test.
 *
 * WHY THIS TEST EXISTS
 *   `EVENT_STEP` in src/lib/funnel/events.ts is a closed vocabulary of ~80 event
 *   names. Declaring a name costs nothing; emitting it requires someone to find
 *   the right line in the right route. When those diverge the failure is
 *   completely silent: the build passes, the funnel query runs, and the stage
 *   simply reports zero forever. That is how this codebase ended up with
 *   `diagnostic_started_at` read by the lifecycle worker but written by nothing,
 *   and with two event pairs (STUDY_PLAN_SESSION_* and DAILY_TARGET_*) declared
 *   for the same measurement because neither had ever been emitted and so
 *   nobody had been forced to choose.
 *
 *   This test makes the gap visible. It scans the real source tree for each
 *   declared name and asserts that the set of names found nowhere matches an
 *   explicit allowlist, where every entry states WHY it is not wired.
 *
 * WHAT THE ALLOWLIST IS FOR
 *   Not every unwired name is a bug. Some belong to phases not yet built
 *   (writing marks, subscriptions, enquiries), and some are emitted from SQL
 *   rather than TypeScript - the daily target job lives in a migration, not in
 *   src/. The allowlist is the place those facts are recorded, and the test
 *   fails in BOTH directions: a newly unwired event fails until it is wired or
 *   explicitly justified, and an allowlist entry that has since been wired also
 *   fails, so the list cannot rot into fiction.
 *
 * Run with:
 *   npm run test:funnel
 *
 * Dependency-free apart from node:fs / node:path, matching the other suites.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVENT_STEP, FUNNEL_STEPS } from '@/lib/funnel/events';

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean) => {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label); }
};
const eq = (label: string, actual: unknown, expected: unknown) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + '\n          actual   ' + a + '\n          expected ' + e); }
};

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/** Recursively collect files whose name ends with one of `exts`. */
function walk(dir: string, exts: string[], out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => full.endsWith(e))) out.push(full);
  }
  return out;
}
/**
 * Strip comments before scanning, so that MENTIONING an event is not mistaken
 * for WIRING it.
 *
 * This is not a hypothetical. A doc comment reading "'ALL_TIME' until the
 * ITEM_FLAGGED event exists" made the scanner report ITEM_FLAGGED as wired, which
 * failed the staleness check in direction 2 - so documenting a known gap made the
 * suite claim the gap was closed. The only ways to satisfy a gate like that are to
 * delete the explanation or to phrase it so vaguely that it stops being useful, and
 * both make the codebase worse.
 *
 * `isSql` selects `--` line comments; TypeScript files use `//`. The `(^|[^:])`
 * guard on the TS branch keeps `https://` inside a string literal from being
 * treated as the start of a comment, which would otherwise swallow the rest of the
 * line and could hide a genuine emission.
 *
 * Deliberately not a full lexer: it does not understand nested template literals or
 * comment markers inside strings. For a scanner whose only job is "does this
 * identifier appear in code rather than prose", that trade is worth making, and
 * getting it wrong fails LOUDLY (an event flips to unwired and must be justified)
 * rather than silently.
 */
function stripComments(src: string, isSql: boolean): string {
  const withoutBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  return isSql
    ? withoutBlock.replace(/--.*$/gm, '')
    : withoutBlock.replace(/(^|[^:])\/\/.*$/gm, '$1');
}



/** The catalogue itself is excluded: it declares every name by definition, so
 *  including it would make every event look wired and the test worthless. */
const CATALOGUE = join(ROOT, 'src', 'lib', 'funnel', 'events.ts');

// SQL migrations are scanned too, because some events are emitted from database
// functions rather than application code (the daily target job, migration 036).
// Migrations applied only through the management API are not on disk, so those
// events appear in the allowlist with their migration number cited instead.
const corpus = [
  ...walk(join(ROOT, 'src'), ['.ts', '.tsx']).filter((f) => f !== CATALOGUE),
  ...walk(join(ROOT, 'supabase', 'migrations'), ['.sql']),
]
  .map((f) => stripComments(readFileSync(f, 'utf8'), f.endsWith('.sql')))
  .join('\n');

const declared = Object.keys(EVENT_STEP);
const unwired = declared.filter((name) => !corpus.includes(name));

/**
 * Every declared event that is NOT emitted from the scanned corpus, with the
 * reason. The test fails if this list and reality diverge in either direction.
 *
 * `sql:` entries are emitted from a database function in a migration applied
 * through the management API, so their source is not on disk to be scanned.
 */
const EXPECTED_UNWIRED: Record<string, string> = {
  // DAILY_TARGET_MET / DAILY_TARGET_MISSED used to be listed here as "sql:" -
  // emitted from reporting.evaluate_daily_targets() (migrations 036/039) whose
  // source was not on disk to scan. The schema baseline
  // (supabase/migrations/baseline/02_functions.sql) now carries that function
  // definition, so the scanner finds them and they are genuinely wired.
  //
  // This is the allowlist's direction-2 check doing its job: it failed the moment
  // the entries became stale, rather than letting the list rot into fiction.

  // No surface exists to trigger these. Inventing a control purely to fire an
  // event would be adding UI nobody designed.
  PAYWALL_DISMISSED: 'no dismissible paywall surface; LockedInsightCard is a button, not a banner',
  SUBSCRIPTION_RESUMED: 'no pause/resume subscription UI exists yet',
  ITEM_FLAGGED: 'admin/review UI exists but does not yet emit; deferred with the creator tranche',

  // Phase 2 per 14-bi-reporting-assurance-roadmap.md and 15-conversion-and-ux-resolution.md.
  CONSENT_GRANTED: 'Phase 2: tutor consent foundation (P10)',
  CONSENT_REVOKED: 'Phase 2: tutor consent foundation (P10)',
  // SIBLING_ADDED, SIBLING_OFFER_VIEWED and CROSSSELL_VIEWED were listed here
  // until the N-5/N-8 tranche wired them (child route, SiblingOfferCard).
  // Removed per the direction-2 check: an allowlist entry that has been wired
  // is fiction, and the suite fails on it.
  WRITING_MARK_COMPLETED: 'Phase 2: writing mark extension (11-...md 11.1)',
  WRITING_MARK_FLAGGED: 'Phase 2: writing mark extension (11-...md 11.1)',

  // Phase 3: needs an ingestion layer that does not exist.
  // ENQUIRY_CREATED left this list when POST /api/enquiries shipped (migration
  // 103 + the web form on /contact) - the direction-2 check below fails on an
  // entry that has since been wired, which is how the list stays truthful.
  // The other two still have no caller: they fire from the admin triage surface,
  // and until it exists first_response_at and resolved_at have no writer, which
  // would leave A13 measuring an SLA against a clock nobody starts.
  ENQUIRY_FIRST_RESPONDED: 'Phase 3: A13 enquiry ingest integration',
  ENQUIRY_RESOLVED: 'Phase 3: A13 enquiry ingest integration',
  EMAIL_OPENED: 'needs email-provider open tracking webhook; not integrated',
  EMAIL_CLICKED: 'needs email-provider click tracking webhook; not integrated',

  // Superseded or covered by a neighbouring event that IS wired.
  READINESS_REPORT_GENERATED: 'report is built on demand; READINESS_REPORT_EMAILED covers generate+send',
  SECOND_SESSION_STARTED: 'no distinct start; SECOND_SESSION_COMPLETED fires on the 2nd attempt',
  SECOND_SESSION_EXPIRED: 'window expiry is computed by windowStatus(), not persisted as an event',
  TEST_ABANDONED: 'the expiry finaliser completes stale attempts rather than marking them abandoned',
  RENEWAL_REMINDER_SENT: 'no renewal email sequence built yet',
  YEAR_IN_REVIEW_SENT: 'no year-in-review email built yet',
  REFERRAL_REWARDED: 'reward crediting not implemented; only markReferralActivated exists',
};

console.log('\n=== funnel catalogue integrity ===');

eq(
  'every declared event maps to a known funnel step',
  declared.every((n) => (FUNNEL_STEPS as readonly string[]).includes(EVENT_STEP[n])),
  true
);

ok('the catalogue is non-trivial (>50 events)', declared.length > 50);

console.log('\n=== wiring coverage ===');
console.log(`  declared ${declared.length} · wired ${declared.length - unwired.length} · unwired ${unwired.length}`);

// Direction 1: an event went unwired without being justified. This is the
// silent-death case - a stage that reports zero forever while the build stays
// green.
const unexplained = unwired.filter((n) => !(n in EXPECTED_UNWIRED));
eq('every unwired event has a documented reason', unexplained, []);

// Direction 2: an allowlist entry is now actually wired. Without this the list
// rots into fiction and stops meaning anything.
const stale = Object.keys(EXPECTED_UNWIRED).filter((n) => !unwired.includes(n));
eq('no allowlist entry has since been wired', stale, []);

// Direction 3: an allowlist entry was deleted from the catalogue entirely (as
// STUDY_PLAN_SESSION_* was by migration 039). A reason for an event that no
// longer exists is noise.
const orphaned = Object.keys(EXPECTED_UNWIRED).filter((n) => !declared.includes(n));
eq('no allowlist entry refers to a removed event', orphaned, []);

console.log('\n=== unwired inventory (each must stay justified) ===');
for (const name of unwired) {
  console.log(`  - ${name}: ${EXPECTED_UNWIRED[name] ?? 'UNDOCUMENTED'}`);
}

console.log(`\n${'-'.repeat(58)}`);
console.log(`PASSED: ${pass}   FAILED: ${fail}`);
console.log(`${'-'.repeat(58)}\n`);
if (fail > 0) process.exit(1);

