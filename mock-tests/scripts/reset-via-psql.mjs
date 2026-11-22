/**
 * Reset a database from the versioned captures, using nothing but psql.
 *
 * WHAT THIS REPLACES
 *   `supabase db reset` = fresh database + apply SQL in order + seed. The CLI
 *   adds Docker orchestration and migration-history bookkeeping; the actual
 *   work is ordered file application, which psql does directly. See
 *   supabase/reset/README.md for the ordering rationale (including the
 *   public <-> reporting dependency CYCLE and how the two-pass apply breaks it).
 *
 * HARD SAFETY RULE
 *   The production project ref is refused as a target, unconditionally, with
 *   no override flag. This script DESTROYS and rebuilds schemas; pointing it
 *   at production is not a use case, it is an incident.
 *
 * USAGE
 *   node scripts/reset-via-psql.mjs --target "postgresql://user:pass@host:5432/postgres"
 *       [--local-stubs]        create Supabase role/auth stubs (bare Postgres only)
 *       [--with-sample-data]   also apply seeds/001_sample_dataset.sql
 *       [--skip-cron]          skip the cron step even where pg_cron exists
 *
 * Ends with parity checks (object counts vs the live-captured baseline) and
 * exits non-zero on any failed step or failed check.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROD_REF = 'ekdjrvjgrhpqolthbznr'; // MockExams Project - NEVER a target

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const targetIdx = args.indexOf('--target');
const target = targetIdx >= 0 ? args[targetIdx + 1] : null;

if (!target || !/^postgresql:\/\//.test(target)) {
  console.error('Usage: node scripts/reset-via-psql.mjs --target "postgresql://..." [--fresh] [--checks-only] [--local-stubs] [--with-sample-data] [--skip-cron]');
  process.exit(2);
}
if (target.includes(PROD_REF)) {
  console.error('REFUSED: --target points at the production project. With --fresh this script drops and rebuilds schemas.');
  console.error('There is deliberately no override. Use a scratch project or branch.');
  process.exit(2);
}

// The reporting baseline was captured with search_path = reporting, public
// (the export functions pin it), so view definitions inside 03_views.sql omit
// the `reporting.` qualifier. Every psql invocation must run with the same
// search_path or those definitions cannot resolve. A schema in search_path
// that does not exist yet is skipped silently, so this is safe from the first
// statement (before the prelude creates `reporting`).
const PSQL_ENV = { ...process.env, PGOPTIONS: '--search_path=reporting,public,extensions' };

function psqlSql(sql) {
  return spawnSync('psql', [target, '-q', '-At', '-c', sql], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], env: PSQL_ENV,
  });
}

function psqlFile(path, { stop = true } = {}) {
  const argv = [target];
  if (stop) argv.push('-v', 'ON_ERROR_STOP=1');
  return spawnSync('psql', [...argv, '-q', '-f', path], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], env: PSQL_ENV,
  });
}

/**
 * Apply a generated functions file whose statements are in CAPTURE order
 * (pg_proc OID order), not dependency order. SQL-language functions are
 * validated at CREATE, so a function calling one declared LATER in the same
 * file fails on the first pass. Rather than hand-editing generated captures
 * (which would drift on the next rebaseline), apply tolerantly, then re-apply
 * only the still-missing functions until none are missing. Converges because
 * the dependency graph is acyclic and shallow; bounded at 5 heal rounds.
 */
function applyFunctionsIteratively(path, label, { maxRounds = 5, allowIncomplete = false } = {}) {
  const src = readFileSync(path, 'utf8');
  const stmts = [...src.matchAll(/CREATE OR REPLACE FUNCTION ([\w.]+)\([\s\S]*?\)\s*RETURNS[\s\S]*?\$function\$[\s\S]*?\$function\$\s*;/g)];
  const wantCount = new Map(); // proname -> declared overload count
  for (const m of stmts) {
    const name = m[1].split('.').pop();
    wantCount.set(name, (wantCount.get(name) ?? 0) + 1);
  }
  if (wantCount.size === 0) {
    console.log(`FAIL  ${label}: parsed no functions from ${path}`);
    return false;
  }

  psqlFile(path, { stop: false }); // first pass, tolerant by design

  for (let round = 1; round <= maxRounds + 1; round++) {
    const names = [...wantCount.keys()].map((n) => `'${n}'`).join(',');
    const r = psqlSql(
      `SELECT p.proname || '=' || count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','reporting') AND p.proname IN (${names}) GROUP BY p.proname`
    );
    if (r.status !== 0) { console.log(`FAIL  ${label}: existence probe failed`); return false; }

    const have = new Map(
      (r.stdout ?? '').split(/\r?\n/).filter(Boolean).map((line) => {
        const i = line.lastIndexOf('=');
        return [line.slice(0, i), Number(line.slice(i + 1))];
      })
    );
    const short = [...wantCount.entries()].filter(([name, want]) => (have.get(name) ?? 0) < want);
    if (short.length === 0) {
      console.log(`ok    ${label} (${stmts.length} functions; ${round - 1} heal round(s))`);
      return true;
    }
    if (round > maxRounds) {
      const missingNames = short.map(([n]) => n).join(', ');
      if (allowIncomplete) {
        // Pass 1 of a file whose functions reference views/MVs created by a
        // LATER file (funnel_by_stage -> mv_funnel_stage). Deferred, not lost:
        // the strict heal pass re-runs this file after the views exist.
        console.log(`ok    ${label} (deferred to heal pass: ${missingNames})`);
        return true;
      }
      console.log(`FAIL  ${label}: still missing after ${maxRounds} rounds: ${missingNames}`);
      return false;
    }
    const shortNames = new Set(short.map(([n]) => n));
    const heal = stmts
      .filter((m) => shortNames.has(m[1].split('.').pop()))
      .map((m) => m[0])
      .join('\n\n');
    const tmp = join(ROOT, 'scripts', `_heal_round${round}.sql`);
    writeFileSync(tmp, heal);
    psqlFile(tmp, { stop: false });
    unlinkSync(tmp);
  }
  return false;
}

/**
 * Apply a generated views/MV file for the same reason as functions: capture
 * order is OID order, and a plain VIEW is validated at CREATE against MVs that
 * may appear later in the file (v_student_today reads mv_student_countdown).
 * Strategy: tolerant full-file passes until every declared view/matview
 * relation exists. Re-running the file is safe - already-created relations
 * fail with "already exists" (tolerated), missing ones get created.
 */
function applyViewsIteratively(path, label, maxRounds = 6) {
  const src = readFileSync(path, 'utf8');
  const declared = [...src.matchAll(/CREATE (?:OR REPLACE )?(?:MATERIALIZED )?VIEW ([\w.]+)/g)].map((m) => m[1]);
  if (declared.length === 0) {
    console.log(`FAIL  ${label}: parsed no views from ${path}`);
    return false;
  }
  for (let round = 1; round <= maxRounds; round++) {
    psqlFile(path, { stop: false });
    const probe = declared
      .map((n) => `(SELECT to_regclass('${n}') IS NOT NULL)::int`)
      .join(' + ');
    const r = psqlSql(`SELECT ${probe}`);
    const have = Number((r.stdout ?? '').trim());
    if (r.status === 0 && have === declared.length) {
      console.log(`ok    ${label} (${declared.length} relations; ${round} pass(es))`);
      return true;
    }
    if (round === maxRounds) {
      const missing = declared.filter((n) => {
        const one = psqlSql(`SELECT to_regclass('${n}') IS NULL`);
        return (one.stdout ?? '').trim() === 't';
      });
      console.log(`FAIL  ${label}: still missing after ${maxRounds} passes: ${missing.join(', ')}`);
      return false;
    }
  }
  return false;
}

/**
 * Apply the generated reporting function ACL lock-down, tolerating ONLY the
 * absence of a function name.
 *
 * The file now revokes from every reporting function that exists on the machine
 * the capture ran on (119). A scratch target may legitimately lack one - the
 * capture tooling is created by migration files that a baseline-only restore
 * does not include - and that must not abort a restore that is otherwise
 * faithful. Every other error class still fails the step, and the outcome is
 * verified independently afterwards by privilege_parity_checks(), so tolerance
 * here cannot mask an unapplied lock-down: a REVOKE that silently did nothing
 * would leave a default ACL, which is precisely what that check measures.
 */
function applyAclLockdown(path, label) {
  const res = psqlFile(path, { stop: false });
  const errors = (res.stderr ?? '').split(/\r?\n/).filter((l) => l.includes('ERROR:'));
  const unexpected = errors.filter(
    (l) => !/function .* does not exist/.test(l) && !/operator does not exist: text/.test(l)
  );
  if (unexpected.length > 0) {
    console.log(`FAIL  ${label}: ${unexpected.length} unexpected error(s)`);
    for (const l of unexpected.slice(0, 5)) console.log(`        ${l.trim()}`);
    return false;
  }
  console.log(`ok    ${label} (${errors.length} absent-on-target revoked anyway)`);
  return true;
}

/**
 * Apply a file tolerating ONLY "already exists" errors.
 *
 * 04_indexes.sql was captured from pg_indexes, which also lists the indexes
 * BACKING primary-key/unique constraints - those already exist after
 * 01_tables.sql created the constraints. Every other error class (a missing
 * relation, a bad definition) still fails the step.
 */
function applyToleratingExisting(path, label) {
  const res = psqlFile(path, { stop: false });
  const errors = (res.stderr ?? '').split(/\r?\n/).filter((l) => l.includes('ERROR:'));
  const unexpected = errors.filter((l) => !l.includes('already exists'));
  if (unexpected.length > 0) {
    console.log(`FAIL  ${label}: ${unexpected.length} unexpected error(s)`);
    for (const l of unexpected.slice(0, 5)) console.log(`        ${l.trim()}`);
    return false;
  }
  console.log(`ok    ${label} (${errors.length} constraint-index duplicates skipped)`);
  return true;
}

/**
 * Tolerant-pass support for the public dump: the names baseline/08 recreates.
 * A pass-A error is permitted ONLY when it mentions `reporting`, one of these
 * wrapper names, or one of two known platform noises. Anything else is a real
 * failure and stops the reset.
 */
const wrapperNames = new Set(
  [...readFileSync(join(ROOT, 'supabase/migrations/baseline/08_public_wrappers.sql'), 'utf8')
    .matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)]
    .map((m) => m[1])
);

function auditTolerantErrors(stderr) {
  const errors = (stderr ?? '').split(/\r?\n/).filter((l) => l.includes('ERROR:'));
  const allowed = [];
  const unexpected = [];
  for (const line of errors) {
    const mentionsReporting = /reporting[."']/.test(line);
    const mentionsWrapper = [...wrapperNames].some((n) => line.includes(n));
    // Platform noises expected on a Supabase target, NOT lost objects:
    //  - the dump emits `CREATE SCHEMA public`, which already exists on reset;
    //  - `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` cannot be run by
    //    postgres - fresh Supabase projects carry those defaults natively.
    const platformNoise =
      line.includes('schema "public" already exists') ||
      line.includes('permission denied to change default privileges');
    (mentionsReporting || mentionsWrapper || platformNoise ? allowed : unexpected).push(line.trim());
  }
  return { allowed, unexpected };
}

// THE CYCLE, AND HOW THIS ORDER BREAKS IT
//   baseline/02_functions.sql contains SQL-language functions referencing
//   public.experiment_exposures (validated at CREATE), while the public dump
//   contains SQL-language wrappers referencing reporting MVs. Neither layer
//   can be applied first with strict error-stop. Resolution: apply the public
//   dump FIRST in tolerant mode (its only permitted failures are objects that
//   reference `reporting` or are wrappers baseline/08 will recreate), then the
//   reporting baseline, then baseline/08_public_wrappers.sql re-creates every
//   wrapper via CREATE OR REPLACE and 09 restores their ACLs. The final parity
//   checks are the real guarantee that pass A lost nothing it should not have.
const STEPS = [
  // Every other step is additive (IF NOT EXISTS / CREATE OR REPLACE / guarded
  // unschedule), so a target that already holds app objects cannot be rebuilt
  // by them. This is the only step that removes anything, and it runs solely
  // when --fresh is passed explicitly.
  { file: 'supabase/reset/00_fresh_schemas.sql', label: 'fresh: drop public/reporting/sample_data (--fresh only)', onlyIf: () => flag('fresh') },
  { file: 'supabase/reset/00_prelude.sql', label: 'prelude: schemas, reporting_ro, pg_cron, citext' },
  { file: 'supabase/reset/local_stubs.sql', label: 'local Supabase stubs (roles + auth)', onlyIf: () => flag('local-stubs') },
  { file: 'supabase/migrations/app_baseline/public_schema.sql', label: 'public schema, PASS A (tolerant)', tolerant: true },
  { file: 'supabase/migrations/app_baseline/auth_triggers.sql', label: 'custom auth.users triggers' },
  { file: 'supabase/migrations/baseline/01_tables.sql', label: 'reporting tables' },
  // Functions run TWICE: pass 1 (tolerant) creates everything that does not
  // depend on views/MVs; 03 needs those (e.g. percentile_from_scores for
  // mv_percentile_cohort). The heal pass after 03 completes the rest
  // (funnel_by_stage -> mv_funnel_stage, recommendations_scored -> mv_skill_gap).
  { file: 'supabase/migrations/baseline/02_functions.sql', label: 'reporting functions PASS 1 (iterative, deferrals allowed)', functions: true, allowIncomplete: true },
  { file: 'supabase/migrations/baseline/03_views.sql', label: 'reporting views + MVs (iterative)', views: true },
  { file: 'supabase/migrations/baseline/02_functions.sql', label: 'reporting functions HEAL (strict convergence)', functions: true },
  { file: 'supabase/migrations/baseline/04_indexes.sql', label: 'reporting indexes (constraint-index duplicates tolerated)', tolerateExisting: true },
  { file: 'supabase/migrations/baseline/05_rls.sql', label: 'reporting RLS (PR-07)' },
  { file: 'supabase/migrations/baseline/06_grants.sql', label: 'reporting grants' },
  { file: 'supabase/migrations/baseline/07_config.sql', label: 'reporting config rows' },
  { file: 'supabase/migrations/016_reporting_role_non_inherited.sql', label: 'non-inherited reporting_ro membership' },
  { file: 'supabase/reset/08_dim_date_seed.sql', label: 'dim_date rows (2024-2030)' },
  // PASS B: recreate every wrapper the tolerant pass could not validate.
  { file: 'supabase/migrations/baseline/08_public_wrappers.sql', label: 'public wrappers PASS B (iterative heal)', functions: true },
  { file: 'supabase/migrations/baseline/09_public_grants.sql', label: 'public grant revocations + wrapper ACLs' },
  // pg_get_functiondef does NOT capture ACLs, so every reporting function would
  // be PUBLIC-executable after a restore - a privilege-escalation gap found by
  // the scratch reset proof. This file replicates the live lock-down.
  { file: 'supabase/reset/10_reporting_function_acls.sql', label: 'reporting function ACLs (close PUBLIC EXECUTE gap)', acls: true },
  // 120 must run on the target, not only on live. Two reasons, both about what
  // captures cannot carry: it holds the REVOKE for the public wrapper that
  // 08_public_wrappers.sql recreates bare (pg_get_functiondef omits ACLs, which
  // is the entire reason 117 exists), and it defines the eight-invariant set the
  // parity stage grades with. app_baseline/public_schema.sql does contain such
  // revokes, but it is regenerated by hand through a live-only function and is
  // not refreshed every migration - and the new check would have stayed silent
  // about that only because the revoke happened to be graded where it exists.
  { file: 'supabase/migrations/120_generated_function_name_expectations.sql', label: 'hosted 120: name-set instrument, wrapper ACLs, 8 invariants' },
  { file: 'supabase/migrations/baseline/10_cron.sql', label: 'pg_cron schedules', needsCron: true, skipIf: () => flag('skip-cron') },
  { file: 'supabase/reset/09_dim_test_family.sql', label: 'dim_test_family rows (needs public.exam_type)' },
  // Content BEFORE expansion_catalog (its bundle derives from tests) and
  // BEFORE the sample dataset (attempts reference tests). The prereq users
  // are FK anchors for tests.created_by / approved_by.
  { file: 'supabase/reset/12_content_prereq_users.sql', label: 'content FK anchor identities (placeholders)' },
  { file: 'supabase/reset/13_content_data.sql', label: 'content data: tests, sections, questions, links (pg_dump --data-only)' },
  { file: 'supabase/seed/funnel_offers.sql', label: 'offers catalogue' },
  { file: 'supabase/seed/expansion_catalog.sql', label: 'product bundle + offer fulfilment mapping' },
  { file: 'supabase/seeds/001_sample_dataset.sql', label: 'sample dataset (deterministic)', onlyIf: () => flag('with-sample-data') },
  { file: 'supabase/seeds/002_tutor_fixtures.sql', label: 'tutor fixtures for the assurance suite', onlyIf: () => flag('with-sample-data') },
  // 003-005 fill the tables the reporting backlog was blocked on (served items,
  // writing marks, purchases/entitlements). They run AFTER 001 because they
  // reference its students and attempts, and after the content step because 004
  // sits writing attempts on the real published writing papers.
  { file: 'supabase/seeds/003_sample_served_items.sql', label: 'sample served items (A1/A4 input)', onlyIf: () => flag('with-sample-data') },
  { file: 'supabase/seeds/004_sample_writing.sql', label: 'sample writing attempts + marks', onlyIf: () => flag('with-sample-data') },
  { file: 'supabase/seeds/005_sample_revenue.sql', label: 'sample purchases + entitlements', onlyIf: () => flag('with-sample-data') },
  // Build-time refresh: on a fresh database no cron has run yet, and the
  // assurance suite derives fixtures from the MVs. Plain REFRESH (not
  // safe_refresh): this is construction, not live maintenance, so the
  // blackout must not apply.
  { file: 'supabase/reset/11_refresh_all_mvs.sql', label: 'refresh all reporting MVs (build-time)' },
];

console.log(`\nReset target: ${target.replace(/:[^:@/]+@/, ':***@')}\n`);

const cronProbe = psqlSql("SELECT count(*) FROM pg_extension WHERE extname='pg_cron'");
const hasCron = cronProbe.status === 0 && (cronProbe.stdout ?? '').trim() !== '0';

// Fail here with the real cause rather than 300 lines later with a misleading
// one. Without this guard, a non-empty target aborts inside the tolerant
// public-schema step, where auditTolerantErrors classifies every
// `... already exists` as unexpected (such lines mention neither `reporting`,
// nor a wrapper, nor a platform noise) and the reader is left with a dump that
// looks like broken captures. It is a precondition failure about the TARGET, so
// it is checked against the TARGET, before anything is written.
if (!flag('fresh') && !flag('checks-only')) {
  const dirtyProbe = psqlSql(
    "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')"
  );
  const existing = Number((dirtyProbe.stdout ?? '').trim());
  if (dirtyProbe.status === 0 && Number.isFinite(existing) && existing > 0) {
    console.log(`FAIL  target is not empty: ${existing} table/view/matview/foreign-table object(s) already in public.`);
    console.log('      This pipeline builds from nothing and never drops, so it cannot converge onto a');
    console.log('      database that has been built before (the 2026-11-19 proof left this project populated).');
    console.log('      Re-run with --fresh to drop the app schemas first, or point --target at an empty project.');
    process.exit(1);
  }
}

let failures = 0;
// --checks-only grades a database that has already been built. It exists so a
// negative test can run cheaply: remove one object, re-check, and confirm the
// instrument NAMES it. A check that has never been observed failing is only a
// guess about whether it is capable of failing.
for (const step of flag('checks-only') ? [] : STEPS) {
  if (step.onlyIf && !step.onlyIf()) { console.log(`SKIP  ${step.label} (flag off)`); continue; }
  if (step.skipIf && step.skipIf()) { console.log(`SKIP  ${step.label} (flag off)`); continue; }
  if (step.needsCron && !hasCron) { console.log(`SKIP  ${step.label} (pg_cron absent)`); continue; }
  const path = join(ROOT, step.file);
  if (!existsSync(path)) { console.log(`FAIL  ${step.label}: missing ${step.file}`); failures++; break; }

  if (step.tolerant) {
    const res = psqlFile(path, { stop: false });
    const { allowed, unexpected } = auditTolerantErrors(res.stderr);
    if (unexpected.length > 0) {
      console.log(`FAIL  ${step.label}: ${unexpected.length} unexpected error(s)`);
      for (const l of unexpected.slice(0, 10)) console.log(`        ${l}`);
      failures++;
      break;
    }
    console.log(`ok    ${step.label} (${allowed.length} expected reporting-dependency errors, healed by pass B)`);
    continue;
  }

  if (step.functions) {
    if (!applyFunctionsIteratively(path, step.label, { allowIncomplete: Boolean(step.allowIncomplete) })) { failures++; break; }
    continue;
  }

  if (step.views) {
    if (!applyViewsIteratively(path, step.label)) { failures++; break; }
    continue;
  }

  if (step.tolerateExisting) {
    if (!applyToleratingExisting(path, step.label)) { failures++; break; }
    continue;
  }

  if (step.acls) {
    if (!applyAclLockdown(path, step.label)) { failures++; break; }
    continue;
  }

  const res = psqlFile(path, { stop: true });
  if (res.status !== 0) {
    console.log(`FAIL  ${step.label} (exit ${res.status})`);
    console.log((res.stderr ?? '').split(/\r?\n/).filter((l) => l.includes('ERROR:')).slice(0, 5).map((l) => '        ' + l.trim()).join('\n'));
    failures++;
    break;
  }
  console.log(`ok    ${step.label}`);
}

if (failures === 0) {
  // Schema-object expectations come from baseline/parity.json, regenerated from
  // live by the same command that regenerates the baseline. They used to be
  // literals in this file and had aged badly (57 public functions against a live
  // 69), which turns a drift detector into drift noise and teaches whoever reads
  // it to ignore the failing line - including on the one occasion it matters.
  const PARITY_FILE = join(ROOT, 'supabase', 'migrations', 'baseline', 'parity.json');
  let parity = null;
  if (!existsSync(PARITY_FILE)) {
    console.log('\nFAIL  parity: baseline/parity.json missing. Run `npm run schema:rebaseline`.');
    failures++;
  } else {
    try {
      parity = JSON.parse(readFileSync(PARITY_FILE, 'utf8'));
    } catch (e) {
      console.log(`\nFAIL  parity: baseline/parity.json is not readable JSON: ${e.message}`);
      failures++;
    }
  }

  if (parity) {
    console.log('\n=== parity checks (expected values generated from live) ===');

    // Queries keyed by label. A manifest label with no query here would be
    // skipped silently, so the two lists are compared rather than trusted.
    const QUERIES = {
      'public tables': "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'",
      'public policies': "SELECT count(*) FROM pg_policies WHERE schemaname='public'",
      'auth triggers': "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid='auth.users'::regclass",
      'reporting tables': "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='reporting' AND c.relkind='r'",
      'reporting matviews': "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='reporting' AND c.relkind='m'",
      'reporting views': "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='reporting' AND c.relkind='v'",
      'reporting indexes': "SELECT count(*) FROM pg_indexes WHERE schemaname='reporting'",
      'dim_date rows': 'SELECT count(*) FROM reporting.dim_date',
      'rpt cron jobs': "SELECT count(*) FROM cron.job WHERE jobname LIKE 'rpt-%'",
    };

    const unqueryable = Object.keys(parity.metrics).filter((k) => !QUERIES[k]);
    if (unqueryable.length > 0) {
      console.log(`FAIL  parity: manifest labels with no query (would pass silently): ${unqueryable.join(', ')}`);
      failures++;
    }

    for (const [label, want] of Object.entries(parity.metrics)) {
      if (!QUERIES[label]) continue;
      if (label === 'rpt cron jobs' && (!hasCron || flag('skip-cron'))) {
        console.log(`SKIP  ${label}: ${want} (pg_cron absent or skipped)`);
        continue;
      }
      const r = psqlSql(QUERIES[label]);
      const raw = (r.stdout ?? '').trim();
      const pass = r.status === 0 && Number(raw) === Number(want);
      console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}: ${raw || '?'} (expected ${want})`);
      if (!pass) failures++;
    }
    // Function IDENTITY, by name, per schema. This exists because a count
    // cannot see one object traded for another - and because migration 118's
    // manifest went further and subtracted a name PREFIX
    // (`NOT LIKE 'export_baseline%'`), grading 29 reporting functions while live
    // held 33. A full scratch rebuild then reported "all parity checks pass"
    // while the target genuinely lacked reporting.export_baseline, the capture
    // dispatcher. The comment inside that metric claimed three capture entry
    // points were "live-only... a faithful restore therefore does not have them
    // either"; measured against the capture files, two of the three are in fact
    // captured and exactly one reporting function is live-only - export_baseline,
    // whose own body ends `AND p.proname <> 'export_baseline'` because it declines
    // to capture itself. The expected set now comes from parity.json, which
    // rebaseline derives by grepping the capture files, so the exclusion list is
    // a measurement of what was written down instead of a claim about it.
    console.log('\n=== function name sets (identity, not counts) ===');
    for (const sch of ['public', 'reporting']) {
      const want = parity.function_names && parity.function_names[sch];
      if (!Array.isArray(want) || want.length === 0) {
        // A missing or empty list would make every comparison below vacuously true.
        console.log(`FAIL  function names (${sch}): manifest carries no name list - refusing a vacuous check`);
        failures++;
        continue;
      }
      const r = psqlSql(
        `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='${sch}' AND p.prokind='f'`
      );
      if (r.status !== 0) {
        console.log(`FAIL  function names (${sch}): probe failed`);
        failures++;
        continue;
      }
      const have = (r.stdout ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const haveSet = new Set(have);
      const wantSet = new Set(want);
      // Live functions that no capture file contains: legitimately absent here,
      // and named rather than hidden inside a subtracted count.
      const declared = new Set(
        (parity.capture_exclusions ?? [])
          .filter((e) => e.startsWith(`${sch}.`))
          .map((e) => e.slice(sch.length + 1))
      );
      const missing = want.filter((n) => !haveSet.has(n));
      const unexpected = have.filter((n) => !wantSet.has(n) && !declared.has(n));
      if (missing.length > 0 || unexpected.length > 0) {
        console.log(`FAIL  function names (${sch}): ${missing.length} missing, ${unexpected.length} unexpected`);
        for (const m of missing) console.log(`        missing:     ${sch}.${m}`);
        for (const u of unexpected) console.log(`        unexpected:  ${sch}.${u}`);
        failures++;
      } else {
        console.log(
          `PASS  function names (${sch}): all ${want.length} present, nothing unexpected` +
          (declared.size > 0 ? ` (${declared.size} declared live-only: ${[...declared].join(', ')})` : '')
        );
      }
    }

    // Privilege invariants are asked of THIS database and compared against the
    // set live was verified to satisfy when the manifest was generated. Object
    // counts prove the same things exist; these prove they are reachable the same
    // way, which is the half where 117's defect lived and the half no count can
    // see. The count is compared too, so a target that lost one of the check
    // functions cannot report a smaller, all-green list.
    console.log('\n=== privilege invariants ===');
    const invRes = psqlSql('SELECT name FROM public.privilege_parity_checks() WHERE NOT holds ORDER BY name');
    if (invRes.status !== 0) {
      console.log('FAIL  privilege invariants could not be evaluated on this target');
      for (const l of (invRes.stderr ?? '').split(/\r?\n/).filter((x) => x.includes('ERROR:')).slice(0, 3)) {
        console.log(`        ${l.trim()}`);
      }
      failures++;
    } else {
      const violated = (invRes.stdout ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (violated.length > 0) {
        console.log(`FAIL  ${violated.length} invariant(s) violated on this target:`);
        for (const v of violated) console.log(`        ${v}`);
        failures++;
      } else {
        console.log(`PASS  all ${parity.privilege_invariants.length} privilege invariants hold`);
      }

      const present = psqlSql('SELECT count(*) FROM public.privilege_parity_checks()');
      const n = Number((present.stdout ?? '').trim());
      if (present.status !== 0 || n !== parity.privilege_invariants.length) {
        console.log(`FAIL  invariant set changed: ${Number.isFinite(n) ? n : '?'} on target, expected ${parity.privilege_invariants.length}`);
        failures++;
      }
    }
  }

  // Seed content is a property of the seed files, not of live, so these stay
  // explicit. Deriving them from live would grade a content-losing restore
  // against a live database that had also lost the content, which is a check that
  // can only ever agree with whatever happened.
  console.log('\n=== seed content (properties of the seed files, not of live) ===');
  const seedChecks = [
    ['dim_test_family rows', 'SELECT count(*) FROM reporting.dim_test_family', 17],
    ['offers seeded', 'SELECT count(*) FROM public.offers', 3],
    ['content: tests', 'SELECT count(*) FROM public.tests', 54],
    ['content: questions', 'SELECT count(*) FROM public.questions', 1900],
  ];
  if (flag('with-sample-data')) {
    seedChecks.push(
      ['sample: students', 'SELECT count(*) FROM public.student_profiles', 200],
      ['sample: attempts', "SELECT count(*) > 1000 FROM public.attempts", true],
      ['sample: responses loaded', "SELECT count(*) > 10000 FROM reporting.fact_item_response", true]
    );
  }
  for (const [label, sql, want] of seedChecks) {
    const r = psqlSql(sql);
    const raw = (r.stdout ?? '').trim();
    const pass =
      r.status === 0 &&
      (want === true ? raw === 't' : Number(raw) === want);
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}: ${raw || '?'} (expected ${want})`);
    if (!pass) failures++;
  }
}

console.log(`\n${failures === 0 ? 'RESET COMPLETE - all steps applied, all parity checks pass.' : `RESET FAILED - ${failures} problem(s).`}\n`);
process.exit(failures === 0 ? 0 : 1);