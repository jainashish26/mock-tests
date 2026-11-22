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
    // Decision 4-A (migration 107). Both read and write the per-year-level daily
    // practice limits through wrappers, never the table: `dim_year_level_cap` has
    // no SELECT grant for `authenticated` at all, so a `.from()` here would not
    // merely bypass the role check, it would fail. Listing them is the deliberate
    // act the gate exists to require.
    'admin_year_level_caps',
    'admin_set_year_level_cap',
    // A13 (migrations 111/112). Both read reporting.fact_enquiry / mv_enquiry_daily
    // through SECURITY DEFINER wrappers. Neither table is readable by
    // `authenticated`: reporting.* is RLS-enabled and FORCED with no policy, so a
    // direct .from() would return zero rows silently rather than erroring. The
    // summary computes verdicts from the fact table and the series from the
    // materialised view, which is exactly the pairing the 112 apply-time check
    // holds against each other - listing them here is the acknowledgement that
    // two code paths now answer "how many" and must not be allowed to drift.
    'admin_enquiry_summary',
    'admin_enquiry_series',
    // A4 (migration 121). The same pattern again: three wrappers, none of the
    // reporting tables or the thresholds row readable by `authenticated`
    // directly (reporting.* is RLS-forced with no policy), so a `.from()` here
    // would return zero rows and look like "no test forms" rather than an error.
    'admin_test_form_metrics',
    'admin_test_form_score_distribution',
    'admin_test_form_thresholds',
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

/* -------------------------------------------------------------------- *
 * Year-level cap bounds: client mirror vs database guarantee
 *
 * WHY COMPARE THEM AT ALL
 *   `CAP_BOUNDS` in `src/lib/reporting/year-caps.ts` duplicates the ranges the
 *   migration's CHECK constraints enforce. That duplication is deliberate — it is
 *   what lets the form refuse a value with a sentence instead of a constraint
 *   name — but a copy with nothing keeping it honest drifts, and it drifts in the
 *   bad direction: the form starts accepting something the database then rejects,
 *   so the operator's own tool tells them the save worked.
 *
 *   Reading the migration text rather than the live database keeps this gate
 *   runnable with no connection. That is weaker than querying `pg_constraint` — a
 *   later migration could change the live constraint without editing 107 — and the
 *   limitation is stated rather than glossed, because a gate that quietly stops
 *   tracking reality is how `checkout_abandon_minutes` ended up configured,
 *   documented, and read by nothing.
 * -------------------------------------------------------------------- */
console.log('\n=== Year-level cap bounds parity (decision 4-A) ===');
{
  const migrationPath = join(ROOT, 'supabase', 'migrations', '107_year_level_caps.sql');
  ok('the caps migration is present', existsSync(migrationPath));

  const sql = stripComments(readFileSync(migrationPath, 'utf8'));
  const boundsSource = stripComments(
    readFileSync(join(ROOT, 'src', 'lib', 'reporting', 'year-caps.ts'), 'utf8')
  );

  /** Pull `BETWEEN <a> AND <b>` out of a named CHECK constraint. */
  const checkRange = (constraint: string): [number, number] | null => {
    const m = new RegExp(
      constraint + '\\s*\\n?\\s*CHECK \\((\\w+) BETWEEN (\\d+) AND (\\d+)\\)',
      'm'
    ).exec(sql);
    return m ? [Number(m[2]), Number(m[3])] : null;
  };

  /** Pull a field out of the CAP_BOUNDS object literal. */
  const boundNumber = (key: string): number | null => {
    const m = new RegExp(key + ':\\s*(\\d+)').exec(boundsSource);
    return m ? Number(m[1]) : null;
  };

  const ceilingRange = checkRange('dim_year_level_cap_tests_range');
  ok('the test-ceiling CHECK is legible to this gate', ceilingRange !== null);
  if (ceilingRange) {
    ok(
      'client test-ceiling bounds match the database',
      boundNumber('testsMin') === ceilingRange[0] && boundNumber('testsMax') === ceilingRange[1],
      `client ${boundNumber('testsMin')}..${boundNumber('testsMax')} vs sql ${ceilingRange[0]}..${ceilingRange[1]}`
    );
  }

  const questionRange = checkRange('dim_year_level_cap_questions_range');
  ok('the question-ceiling CHECK is legible to this gate', questionRange !== null);
  if (questionRange) {
    ok(
      'client question-ceiling bounds match the database',
      boundNumber('questionsMin') === questionRange[0] &&
        boundNumber('questionsMax') === questionRange[1],
      `client ${boundNumber('questionsMin')}..${boundNumber('questionsMax')} vs sql ${questionRange[0]}..${questionRange[1]}`
    );
  }

  // Decision 4-A said the recommended target must be "at least 2". That is a
  // business rule with no other automated guardian: the SQL coherence CHECK says
  // `BETWEEN 2 AND max_*`, so the lower bound lives there and in the client only.
  const coherence = /dim_year_level_cap_tests_target_coherence\s*\n?\s*CHECK \(recommended_tests_per_day BETWEEN (\d+) AND/.exec(
    sql
  );
  ok(
    'recommended-minimum parity: client and the coherence CHECK both say 2',
    coherence !== null && Number(coherence[1]) === boundNumber('recommendedMin') && boundNumber('recommendedMin') === 2,
    `sql ${coherence ? coherence[1] : 'unreadable'} / client ${boundNumber('recommendedMin')}`
  );

  // Migration 101 extended the product to Year 9. A client range still ending at 8
  // would refuse Year 9 in the form while the database happily stored it, which is
  // an interface that disagrees with its own storage.
  ok(
    'client year-level range covers 2 through 9',
    boundNumber('yearLevelMin') === 2 && boundNumber('yearLevelMax') === 9,
    `${boundNumber('yearLevelMin')}..${boundNumber('yearLevelMax')}`
  );

  // Every seeded year level must be editable, and the seed must be the full set.
  const seedBlock = /WITH seed[\s\S]*?\n\)/.exec(sql);
  // Every number in the VALUES list may carry a `::smallint` cast — only the first
  // row needs it, so a parser that tolerates it on the year and not on the values
  // reads the seed as missing Year 2. Seen live: the gate reported
  // "3,4,5,6,7,8,9" while the table held all eight rows, i.e. it would have passed
  // a genuinely absent Year 2 as well. Both positions are now cast-aware.
  const seedYears = seedBlock
    ? [
        ...seedBlock[0].matchAll(
          /\(\s*(\d+)\s*(?:::smallint)?\s*,\s*\d+\s*(?:::smallint)?\s*,\s*\d+/g
        ),
      ].map((m) => Number(m[1]))
    : [];
  ok('the seed block is legible to this gate', seedBlock !== null);
  ok(
    'seeded year levels are exactly 2 through 9',
    seedYears.join(',') === '2,3,4,5,6,7,8,9',
    seedYears.join(',')
  );

  // The read path must go through the RPC. A direct `dim_year_level_cap` read in
  // the settings surface would fail for `authenticated` — migration 107 withholds
  // SELECT entirely — and on this page a failed read is indistinguishable from an
  // empty one, so it would say "no limits configured" about a fully configured
  // database.
  const uiFiles = [
    join(ROOT, 'src', 'app', 'admin', 'settings', 'page.tsx'),
    join(ROOT, 'src', 'app', 'admin', 'settings', 'actions.ts'),
    join(ROOT, 'src', 'app', 'admin', 'settings', 'YearCapsTable.tsx'),
  ].filter((f) => existsSync(f));
  ok('the caps editor files all exist', uiFiles.length === 3, `${uiFiles.length} found`);
  const directTableReads = uiFiles.filter((f) =>
    /dim_year_level_cap/.test(stripComments(readFileSync(f, 'utf8')))
  );
  ok(
    'the settings surface never touches dim_year_level_cap directly',
    directTableReads.length === 0,
    directTableReads.map(rel).join(', ')
  );

  // And the enforcement gap must be stated where the number is entered, not only
  // in a migration comment: the recommended column is stored but clamps nothing.
  const tableSrc = uiFiles.length === 3 ? readFileSync(uiFiles[2], 'utf8') : '';
  ok(
    'the caps editor renders the recommended-is-not-enforced note',
    /CAP_ENFORCEMENT_NOTE/.test(tableSrc)
  );
  const noteSrc = readFileSync(join(ROOT, 'src', 'lib', 'reporting', 'year-caps.ts'), 'utf8');
  ok(
    'the note names the clamp control and states that the alert ignores it',
    /Clamp control/.test(noteSrc) &&
      /overload notice is always/.test(noteSrc) &&
      /measured against the ceiling/.test(noteSrc)
  );
  ok(
    'the stale claim is gone',
    !/nothing clamps/.test(noteSrc),
    'the note still says the recommended target enforces nothing'
  );

  // THE MOST IMPORTANT GATE IN THIS FILE.
  //   Migration 105 had `checkout_abandon_minutes` sitting configured, documented
  //   and read by nothing: a setting that looks like a control and does nothing.
  //   `daily_target_basis` is the same shape of object, so the check is not that
  //   the column exists — it obviously does — but that the materialised view's own
  //   SQL names it. The baseline capture is the source, because that is what a
  //   restore replays.
  const viewsCapture = join(ROOT, 'supabase', 'migrations', 'baseline', '03_views.sql');
  const mvText = existsSync(viewsCapture)
    ? stripComments(readFileSync(viewsCapture, 'utf8'))
    : '';
  ok('the views capture is present', mvText.length > 0);

  /**
   * Isolate the MV's own statement.
   *
   * Without this, a name appearing anywhere in the 27 KB capture — in another
   * view, in a comment the stripper missed, in the *renamed* copy of itself —
   * satisfies the check. The first version of this gate did exactly that:
   * replacing every `daily_target_basis` with `daily_target_basis_UNUSED` left it
   * green, because the substring was still present. A gate that cannot fail is not
   * a weak gate, it is an absent one, and this file exists to catch settings that
   * are configured, documented and read by nothing.
   */
  const mvStmtMatch =
    /CREATE MATERIALIZED VIEW reporting\.mv_student_daily_target AS([\s\S]*?)(?=\nCREATE |\nGRANT |\nCOMMENT |$)/
      .exec(mvText);
  const mvStmt = mvStmtMatch ? mvStmtMatch[1] : '';
  ok('the MV statement is isolable from the capture', mvStmt.length > 200, `${mvStmt.length} chars`);

  const countOf = (re: RegExp): number => (mvStmt.match(re) ?? []).length;

  ok(
    'the MV actually branches on the clamp policy (both unit kinds)',
    countOf(/cap\.daily_target_basis\s*=\s*'ceiling'/g) === 2,
    `found ${countOf(/cap\.daily_target_basis\s*=\s*'ceiling'/g)} branches, expected 2`
  );
  ok(
    'the MV uses the recommended columns, not just mentions the policy',
    mvStmt.includes('cap.recommended_tests_per_day') &&
      mvStmt.includes('cap.recommended_questions_per_day')
  );
  ok(
    'the MV still uses the ceiling columns as the backstop',
    mvStmt.includes('cap.max_tests_per_day') && mvStmt.includes('cap.max_questions_per_day')
  );
  ok(
    'the clamp is applied with LEAST, so a target can never exceed it',
    /LEAST\s*\(\s*required_daily,\s*effective_cap/.test(mvStmt)
  );
  ok(
    'the overload flag is measured against overload_ceiling, not the clamp',
    /required_daily\s*>\s*overload_ceiling/.test(mvStmt) &&
      !/required_daily\s*>\s*effective_cap/.test(mvStmt)
  );
  ok(
    'daily_target_basis does not leak to the student view',
    (() => {
      const m = /CREATE (?:OR REPLACE )?VIEW reporting\.v_student_today AS([\s\S]*?);/.exec(mvText);
      return m ? !m[1].includes('basis') : false;
    })()
  );
  ok(
    'the student view still omits every parent-facing target figure',
    (() => {
      const m = /CREATE (?:OR REPLACE )?VIEW reporting\.v_student_today AS([\s\S]*?);/.exec(mvText);
      if (!m) return false;
      const cols = ['required_daily', 'effective_cap', 'overload_ceiling', 'target_basis', 'plan_overload_flag'];
      return cols.every((c) => !m[1].includes(c));
    })(),
    'v_student_today must never select the parent-facing columns'
  );

  // The clamp modes the client offers must be exactly the ones the column allows.
  // Read from the source text rather than imported, keeping this suite a static
  // analysis that needs no module graph.
  //
  // Both cap migrations are scanned. The clamp policy arrived in 108, so reading
  // only 107 — where the table was created — would find no basis CHECK and report
  // a mismatch forever, which is the same class of blind spot as the seed parser
  // that could not read a `::smallint` cast.
  const mig108 = join(ROOT, 'supabase', 'migrations', '108_daily_target_clamp_policy.sql');
  ok('the clamp-policy migration is present', existsSync(mig108));
  const capsSql = existsSync(mig108)
    ? `${sql}\n${stripComments(readFileSync(mig108, 'utf8'))}`
    : sql;
  // Whitespace flattened first: the CHECK is written across three lines in 108,
  // and a regex that expects one line silently matches nothing.
  const basisCheck = /CHECK \(?\s*daily_target_basis IN \(([^)]*)\)/.exec(capsSql.replace(/\s+/g, ' '));
  const sqlBases = basisCheck
    ? [...basisCheck[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
    : [];
  ok('the basis CHECK is legible to this gate', basisCheck !== null);
  // Anchored on `Object.freeze([` deliberately: a pattern that starts at
  // DAILY_TARGET_BASES and looks for the first `[` lands on the empty brackets of
  // the type annotation (`readonly DailyTargetBasis[]`) and silently extracts
  // nothing — which this gate then would have reported as a mismatch forever, with
  // no hint that it was reading the wrong token.
  const clientBasesBlock =
    /DAILY_TARGET_BASES[\s\S]{0,200}?Object\.freeze\(\[([\s\S]*?)\]/.exec(noteSrc);
  const clientBases = clientBasesBlock
    ? [...clientBasesBlock[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
    : [];
  ok(
    'client clamp modes are legible to this gate',
    clientBases.length === 2,
    clientBases.join(',')
  );
  ok(
    'client clamp modes match the database CHECK exactly',
    sqlBases.length === 2 && sqlBases.join(',') === clientBases.join(','),
    `sql [${sqlBases}] vs client [${clientBases}]`
  );

  // The client's mandated set must be exactly what the migration seeds. If the
  // seed grows a Year 10 and this list does not, `missingYearLevels` is asserting
  // a completeness guarantee that no longer matches reality.
  const expectedSrc = /EXPECTED_YEAR_LEVELS = Object\.freeze\(\[([\d,\s]+)\]\)/.exec(
    readFileSync(join(ROOT, 'src', 'lib', 'reporting', 'year-caps.ts'), 'utf8')
  );
  const expectedYears = expectedSrc
    ? expectedSrc[1].split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n))
    : [];
  ok(
    'the mandated year-level set matches the seeded set exactly',
    expectedYears.join(',') === seedYears.join(','),
    `expected ${expectedYears.join(',')} vs seeded ${seedYears.join(',')}`
  );

  // `loadYearLevelCaps` must keep treating an empty read as a refusal, not as
  // "nothing configured". That distinction is the whole defence against the
  // service-role 200-with-[] response rendering as an empty settings table, and
  // it is one `catch`-free line to accidentally delete.
  const ioSrc = readFileSync(join(ROOT, 'src', 'lib', 'reporting', 'admin-year-caps.ts'), 'utf8');
  ok(
    'an empty caps read is still reported as an error, not as emptiness',
    /rows\.length === 0/.test(ioSrc) && /error:\s*true/.test(ioSrc) &&
      /empty-refused/.test(ioSrc)
  );

  // And the page must not reintroduce a bare "no limits" empty state on top of it.
  const pageSrc = readFileSync(join(ROOT, 'src', 'app', 'admin', 'settings', 'page.tsx'), 'utf8');
  ok(
    'the settings page has no path that renders an empty read as unconfigured',
    !/capsResult\.caps\.length === 0/.test(pageSrc)
  );
}

/* -------------------------------------------------------------------- *
 * SEO origin + indexability integrity


 *
 * WHY THESE ARE HERE RATHER THAN ONLY IN validate-seo.mjs
 *   Two defects shipped silently in this area, and neither was exotic:
 *
 *   (1) `SITE_URL` read `NEXT_PUBLIC_SITE_URL`, a variable no environment ever
 *       set, and ended its fallback chain with a hardcoded
 *       `https://mocktestspro.com.au` — a placeholder domain from the original
 *       brief that was never purchased. So production published canonicals, OG
 *       URLs, JSON-LD entity URLs and a robots.txt `Host:` for a domain that does
 *       not resolve. `scripts/validate-seo.mjs` asserted that literal in five
 *       places, which means the one check positioned to notice was positioned to
 *       prevent noticing.
 *
 *   (2) Six surfaces declared page-level `robots: { index: true, ... }`. Because
 *       Next resolves `metadata.robots` per page and a page declaration beats the
 *       layout's, a noindex added only to the root layout left every blog article
 *       and category hub — the whole organic surface — still asking to be indexed.
 *       A grep for the single-line form `robots: { index: true` missed the ones
 *       written across several lines, so even a search-based check was unreliable.
 *
 *   Both are the shape of bug this suite exists for: green typecheck, green lint,
 *   green build, wrong behaviour. validate-seo.mjs now tests the rendered output;
 *   these gates keep the *source* from re-acquiring the shape, and run without a
 *   build so they fire on the commit that introduces it.
 * -------------------------------------------------------------------- */
console.log('\n=== SEO origin and indexability integrity ===');
{
  const SEO_WATCH_DIRS = [join(ROOT, 'src'), join(ROOT, 'scripts')];
  // `.mts` is included deliberately. These are the *test* scripts, and the defect
  // being guarded against was not enforced by application code — it was enforced
  // by `validate-seo.mjs`, a script that asserted the placeholder so strongly a
  // fix would have failed the build. Excluding test files from this gate would
  // leave precisely that enforcement path unguarded.
  //
  // This file is exempted from gate (1) only, and by name: it must spell the
  // domain to detect it. The exemption is therefore stated rather than hidden in
  // a regex, and it is the narrowest one available — no other file may name the
  // domain, and every other gate below still inspects this one.
  const SELF = 'static-gates.test.mts';
  const seoFiles = SEO_WATCH_DIRS
    .flatMap((d) => walk(d, ['.ts', '.tsx', '.mjs', '.mts']))
    .filter((f) => !f.endsWith(SELF));


  // (1) The placeholder domain must never reappear in executable code. Prose is
  //     stripped first, so this suite's own explanation of the defect — and every
  //     comment recording why a change was made — cannot trip the gate it documents.
  const domainOffenders = seoFiles.filter((f) =>
    /mocktestspro/i.test(stripComments(readFileSync(f, 'utf8')))
  );
  ok(
    'no fictional domain literal in any source or script',
    domainOffenders.length === 0,
    domainOffenders.map(rel).join(', ')
  );

  // (2) The origin chain must actually read a variable the environments set. This
  //     is the precise defect: a chain ending in one name while every deploy sets
  //     another.
  const siteConfig = readFileSync(join(ROOT, 'src', 'lib', 'seo', 'site-config.ts'), 'utf8');
  // Normalised because this checkout is CRLF: a `\n\n` boundary never appears in
  // `\r\n\r\n`, so a blank-line-terminated match silently finds nothing and the
  // gate reports the assignment is missing rather than admitting it cannot read
  // the file. A gate that fails because it is blind is not much better than one
  // that passes because it is, so the blindness is removed rather than tolerated.
  const siteConfigCode = stripComments(siteConfig).replace(/\r\n/g, '\n');

  ok(
    'SITE_URL resolution consults NEXT_PUBLIC_APP_URL',
    /NEXT_PUBLIC_APP_URL/.test(siteConfigCode)
  );
  ok(
    'SITE_URL resolution consults NEXT_PUBLIC_SITE_URL',
    /NEXT_PUBLIC_SITE_URL/.test(siteConfigCode)
  );

  // (3) An origin the app cannot name must not be invented. The last resort is
  //     loopback, which is visibly wrong in a production build rather than
  //     plausibly wrong forever. Scoped to the assignment itself — from its
  //     `export const` to the first blank line — so the gate reads the fallback
  //     chain and nothing else.
  const siteUrlDecl = /export const SITE_URL[\s\S]*?\n\n/.exec(siteConfigCode)?.[0] ?? '';
  const originLiterals = [...siteUrlDecl.matchAll(/https?:\/\/[A-Za-z0-9._:/-]+/g)].map((m) => m[0]);
  ok(
    'SITE_URL assignment exists to inspect',
    siteUrlDecl.length > 0
  );
  ok(
    'every origin literal in the chain is loopback',
    originLiterals.length > 0 &&
      originLiterals.every((u) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(u)),
    originLiterals.join(', ')
  );

  // (4) Contact addresses come from configuration only. A quoted email anywhere in
  //     this module is by definition a default, and defaults are how the dead
  //     mailboxes reached the privacy policy.
  ok(
    'CONTACT addresses are read from the environment',
    /process\.env\.SUPPORT_EMAIL/.test(siteConfigCode) &&
      /process\.env\.PRIVACY_EMAIL/.test(siteConfigCode)
  );
  ok(
    'no email address is hardcoded in site-config',
    !/['"][^'"\s]+@[^'"\s]+\.[^'"\s]+['"]/.test(siteConfigCode)
  );

  // (5) Indexing may be granted from exactly one expression. Pages may still refuse
  //     it — `{ index: false }` on a personalised surface is correct and must stay
  //     possible — but no page may *allow* it, because a page-level `robots` beats
  //     the layout's and that is how the noindex would have been defeated on every
  //     article while looking applied everywhere else.
  const appFiles = walk(join(ROOT, 'src', 'app'), ['.ts', '.tsx']);
  const indexers = appFiles.filter((f) => /\bindex:\s*true/.test(stripComments(readFileSync(f, 'utf8'))));
  ok(
    'no page grants indexing; only INDEXABLE_ROBOTS may',
    indexers.length === 0,
    indexers.map(rel).join(', ')
  );
  ok(
    'pages route indexability through INDEXABLE_ROBOTS',
    appFiles.filter((f) => /INDEXABLE_ROBOTS/.test(stripComments(readFileSync(f, 'utf8')))).length >= 6,
    'found ' + appFiles.filter((f) => /INDEXABLE_ROBOTS/.test(stripComments(readFileSync(f, 'utf8')))).length + ' app files'
  );

  // (6) robots.txt and sitemap.xml must obey the same flag rather than assuming the
  //     site always wants crawlers. A populated sitemap next to a noindex is a
  //     contradiction Google settles by crawling.
  const robotsSrc = stripComments(readFileSync(join(ROOT, 'src', 'app', 'robots.ts'), 'utf8'));
  const sitemapSrc = stripComments(readFileSync(join(ROOT, 'src', 'app', 'sitemap.ts'), 'utf8'));
  ok('robots.txt branches on INDEXABLE', /INDEXABLE/.test(robotsSrc));
  ok('sitemap.xml branches on INDEXABLE', /INDEXABLE/.test(sitemapSrc));
}

console.log(`\n${'-'.repeat(58)}`);

console.log(`PASSED: ${pass}   FAILED: ${fail}`);
console.log(`${'-'.repeat(58)}\n`);
if (fail > 0) process.exit(1);

