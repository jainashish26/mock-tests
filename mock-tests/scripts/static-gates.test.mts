/**
 * Static assurance gates.
 *
 * WHY THESE EXIST
 *   Three privilege-escalation defects have already passed a green build in this
 *   project: inherited `reporting_ro` membership, column grants that cannot
 *   separate parent from student, and reporting RPCs left executable by `anon`.
 *   None produced a type error, a lint error or a failing test. The build being
 *   green said nothing about whether the access model held.
 *
 *   These gates encode the *design rules* that those defects violated, as
 *   assertions that run on every commit without needing a database. They are
 *   deliberately cheap: no fixtures, no network, no Postgres. The database-backed
 *   half of the assurance plan (pgtap: DA/AC/PR/PF) is separate and complements
 *   this - a static gate cannot prove RLS works, but it can prove nobody wired a
 *   reporting read straight to a table.
 *
 * Run with:
 *   npm run test:gates
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n          ' + detail : '')); }
};

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

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
 * Strip comments so a gate inspects executable code, not prose.
 *
 * The reporting modules explain their own design at length and legitimately
 * mention `fact_test_attempt` and `score` while doing so. Without this, every
 * gate would fire on its own documentation.
 *
 * Known limitation: a `//` inside a string literal (e.g. a URL) is treated as a
 * comment start, which can only HIDE code from a gate, never invent a violation.
 * That is the safe direction for a gate, and the patterns below do not appear in
 * URLs in this codebase.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const REPORTING_LIB = join(ROOT, 'src', 'lib', 'reporting');
const REPORTING_API = join(ROOT, 'src', 'app', 'api', 'reporting');
const reportingFiles = [
  ...walk(REPORTING_LIB, ['.ts']),
  ...walk(REPORTING_API, ['.ts']),
];
const rel = (f: string) => relative(ROOT, f).replace(/\\/g, '/');

console.log('\n=== PF-02 / capability reduction: reporting reads go through RPC only ===');
{
  // The documented design (connection.ts) is that every reporting read passes
  // through a SECURITY DEFINER function whose RETURNS clause is the entire
  // visible surface. A `.from()` call bypasses that: it exposes whatever columns
  // the caller names, and can be widened later by accident.
  const offenders = reportingFiles.filter((f) => /\.from\s*\(/.test(stripComments(readFileSync(f, 'utf8'))));
  ok(
    'no .from() anywhere in the reporting layer',
    offenders.length === 0,
    offenders.map(rel).join(', ')
  );

  // PF-02 proper: no dashboard query touches a fact table. Fact tables are the
  // large, unaggregated ones; reading them from a request path is how a
  // dashboard starts slowing down live tests.
  const factOffenders = reportingFiles.filter((f) => /\bfact_[a-z_]+/.test(stripComments(readFileSync(f, 'utf8'))));
  ok(
    'no fact_* table referenced in reporting code',
    factOffenders.length === 0,
    factOffenders.map(rel).join(', ')
  );

  // The admin/service client makes auth.uid() NULL, which would defeat every
  // authorisation check inside these functions - or silently pass one written
  // as `auth.uid() IS NULL OR ...`.
  const adminOffenders = reportingFiles.filter((f) =>
    /createAdminClient|SUPABASE_SERVICE_ROLE|service_role/.test(stripComments(readFileSync(f, 'utf8')))
  );
  ok(
    'no service-role client in the reporting layer',
    adminOffenders.length === 0,
    adminOffenders.map(rel).join(', ')
  );
}

console.log('\n=== PR-01 (static half): no PII in reporting DTOs ===');
{
  // §15.4 PR-01 is a CI grep over information_schema for PII columns in any
  // reporting object. That needs a database. This is the application-side half:
  // the DTOs are what actually reaches a browser, so a PII field here would leak
  // even if the database column were named innocuously.
  const PII = /\b(email|phone|full_name|fullName|first_name|firstName|last_name|lastName|dob|date_of_birth|dateOfBirth)\b/;
  const typesFile = join(REPORTING_LIB, 'types.ts');
  const dtoFiles = [typesFile, ...walk(REPORTING_API, ['.ts'])];

  const offenders = dtoFiles.filter((f) => PII.test(stripComments(readFileSync(f, 'utf8'))));
  ok(
    'no PII field name in reporting types or API routes',
    offenders.length === 0,
    offenders.map(rel).join(', ')
  );

  // The student surface is the strictest: it must carry no result of any kind.
  // Checked as a named list rather than a generic "score" search so the intent
  // is legible and a new result field has to be consciously added here.
  const studentRoute = join(REPORTING_API, 'student', 'completion', 'route.ts');
  if (existsSync(studentRoute)) {
    const code = stripComments(readFileSync(studentRoute, 'utf8'));
    ok(
      'student completion route carries no score/band/percentile',
      !/\b(score|band|percentile|accuracy|readiness)\b/i.test(code),
      rel(studentRoute)
    );
  }
}

console.log('\n=== analytics boundary: no results in funnel event props ===');
{
  // The catalogue states this rule for ITEM_ANSWERED, and runner/submit honours
  // it for TEST_SUBMITTED ("No score in props"). A result written into an
  // analytics payload is a result written into a table student sessions cause
  // writes to - the boundary migration 015 exists to hold.
  //
  // This gate exists because the rule WAS breached: `score` was threaded through
  // recordAttemptForFunnel into DIAGNOSTIC_COMPLETED props and nothing caught it.
  const funnelDir = join(ROOT, 'src', 'lib', 'funnel');
  const RESULT_KEY = /\b(score|isCorrect|is_correct|accuracy|percentile|readinessScore|band)\s*:/;

  const offenders = walk(funnelDir, ['.ts']).filter((f) =>
    RESULT_KEY.test(stripComments(readFileSync(f, 'utf8')))
  );
  ok(
    'no result-bearing key in the funnel layer',
    offenders.length === 0,
    offenders.map(rel).join(', ')
  );
}

console.log('\n=== reporting RPC surface is explicit ===');
{
  // Every RPC name used by the reporting layer must be one this project defined
  // as a self-authorising wrapper. A typo'd or foreign function name would fail
  // at runtime with a confusing PostgREST error rather than at review time, and
  // an unlisted name is a signal that someone reached past the wrapper layer.
  const ALLOWED = new Set([
    'student_today',
    'child_attempt_history',
    'parent_progress_summary',
    'parent_study_behaviour',
    'parent_recommendations',
    'parent_readiness_projection',
    'parent_plan_get',
    'parent_plan_set',
    'parent_mastery',
    'parent_percentile',
    'admin_platform_health',
    'admin_data_quality',
    'admin_coverage_gaps',
    'creator_coverage_queue',
    'reporting_refresh_lag',
    'admin_funnel_by_stage',
    'admin_funnel_outcomes',
    'admin_experiment_results',
    'tutor_student_overview',
    'tutor_skill_gaps',
    'tutor_at_risk',
    'tutor_assignments',
    'tutor_recommendations',
    'tutor_item_analysis',
    'admin_item_statistics',
    'admin_item_thresholds',
    'tutor_assignable_tests',
    'tutor_assign_test',
    'tutor_remind',
    'parent_tutor_consents',
    'parent_grant_tutor_consent',
    'parent_grant_tutor_consent_by_email',
    'parent_revoke_tutor_consent',
  ]);

  const called = new Set<string>();
  for (const f of reportingFiles) {
    const code = stripComments(readFileSync(f, 'utf8'));
    for (const m of code.matchAll(/callReporting(?:Function|Write)<[^>]*>\(\s*'([a-z_]+)'/g)) {
      called.add(m[1]);
    }
  }

  const unknown = [...called].filter((n) => !ALLOWED.has(n));
  ok('every reporting RPC called is a known wrapper', unknown.length === 0, unknown.join(', '));
  ok('the RPC surface is non-trivial', called.size >= 10, `found ${called.size}`);
}

console.log(`\n${'-'.repeat(58)}`);
console.log(`PASSED: ${pass}   FAILED: ${fail}`);
console.log(`${'-'.repeat(58)}\n`);
if (fail > 0) process.exit(1);

