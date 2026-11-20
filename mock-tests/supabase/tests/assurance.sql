-- ============================================================================
-- Assurance suite (pgtap) - the database half of §15 of 14-...md.
--
-- Run with:
--   npm run test:db            (reads SUPABASE_DB_URL from env or .env.local;
--                               fails on any "not ok" line, not just psql exit)
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/assurance.sql
-- or paste into the Supabase SQL editor. The whole script is wrapped in
-- BEGIN/ROLLBACK, so it leaves no trace and is safe to run against production -
-- it creates only TEMP tables.
--
-- DESIGN: two kinds of assertion, deliberately
--   1. CATALOG assertions (grants, policies, RETURNS clauses, indexes, column
--      names). Data-independent, so they hold on an empty database and a full
--      one. Most of the access model is a property of configuration rather than
--      data, and testing configuration is what catches the defect classes this
--      project has actually suffered: an inherited role grant, a column grant
--      that cannot separate two app roles, an RPC left executable by anon.
--   2. LIVE ROLE SIMULATION for rules that only manifest at query time - above
--      all "a student cannot read a score" and "a student can still sit a test".
--      AC-40 is the half that gets skipped and the half that would take the
--      product down, so it is here.
--
--   Identities are looked up at runtime, never hardcoded, so the suite does not
--   depend on particular seeded rows.
-- ============================================================================

BEGIN;

-- pgtap lives in extensions, NEVER public: its has_role(name) returns text and
-- would shadow public.has_role(user_role), breaking every RLS policy. See migration 050.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

-- pgtap needs `extensions` visible for its own internal helpers, but `public`
-- MUST come first. App helpers are schema-qualified in this script, and RLS
-- policies store an explicit `::user_role` cast, so neither can be shadowed by
-- pgtap's has_role(name). Verified before relying on it. See migration 050.
SET LOCAL search_path = public, extensions;

-- 148 = the 100 this suite planned before migration 109, plus 12 assertions for
-- the business-day SLA clock (AC-41..AC-52), 11 for conversion references
-- (AC-53..AC-63, migration 110), 6 for the A13 warehouse (AC-64..AC-69,
-- migrations 111/112), 7 for inbound capture shipped dark
-- (AC-70..AC-74, migration 114), 13 for contact privacy, audit and the
-- append-only finding (AC-35..AC-40, PR-02, migration 115) and 3 for keeping the
-- read-only reporting role read-only (AC-75..AC-76, migration 116) and 3 for the ACL
-- capture describing the live schema (AC-77..AC-79, migration 117).
SELECT extensions.plan(155);

CREATE TEMP TABLE _ids AS
SELECT
  (SELECT sp.auth_user_id FROM public.student_profiles sp
    WHERE sp.auth_user_id IS NOT NULL LIMIT 1)                        AS student_uid,
  (SELECT r.user_id FROM public.app_user_roles r WHERE r.role='PARENT' LIMIT 1) AS parent_uid,
  (SELECT sp.id FROM public.student_profiles sp LIMIT 1)              AS any_student_id;

-- ===========================================================================
-- AC-01..05 - a student cannot read results
-- ===========================================================================

-- Simulate a student JWT. set_config(..., true) is transaction-local; the role
-- switch is what makes RLS evaluate as the browser would.
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT student_uid FROM _ids), 'role', 'authenticated')::text, true);

SET LOCAL ROLE authenticated;
CREATE TEMP TABLE _as_student_attempts AS SELECT id, score_out_of100 FROM public.attempts;
CREATE TEMP TABLE _as_student_responses AS SELECT id, is_correct FROM public.responses;
RESET ROLE;

SELECT extensions.is((SELECT COUNT(*) FROM _as_student_attempts), 0::bigint,
  'AC-01 student JWT reads zero attempt rows (no score leak)');
SELECT extensions.is((SELECT COUNT(*) FROM _as_student_responses), 0::bigint,
  'AC-02 student JWT reads zero response rows (no correctness leak)');

-- The column privilege alone is NOT the control: parents and students both
-- connect as `authenticated`, so §9.6's "column grants are decisive" is wrong
-- (roadmap §20.4). RLS is the control, and this asserts the real mechanism.
SELECT extensions.is(
  (SELECT COUNT(*) FROM pg_policies
    WHERE schemaname='public' AND tablename='attempts' AND cmd='SELECT'
      AND qual LIKE '%is_student_self%'),
  0::bigint,
  'AC-03 no SELECT policy on attempts grants a student self-read');

SELECT extensions.is(
  (SELECT COUNT(*) FROM pg_policies
    WHERE schemaname='public' AND tablename='responses' AND cmd='SELECT'
      AND qual LIKE '%is_attempt_owner%'),
  0::bigint,
  'AC-04 no SELECT policy on responses grants an owner self-read');

SELECT extensions.is(
  (SELECT COUNT(*) FROM pg_policies
    WHERE schemaname='public' AND tablename IN ('attempts','responses')
      AND cmd='SELECT' AND qual NOT LIKE '%may_read_results%'),
  0::bigint,
  'AC-05 every results SELECT policy is gated on may_read_results()');

-- ===========================================================================
-- AC-40 - the positive half: a student can still sit a test
-- ===========================================================================
-- Revoking student SELECT is the easy half. Confirming a child can still INSERT
-- and UPDATE their own attempt is the half that gets skipped, and the half that
-- would take the product down if it broke.
SELECT extensions.ok(
  (SELECT COUNT(*) FROM pg_policies
    WHERE schemaname='public' AND tablename='attempts' AND cmd='INSERT') > 0,
  'AC-40a student retains an INSERT policy on attempts');
SELECT extensions.ok(
  (SELECT COUNT(*) FROM pg_policies
    WHERE schemaname='public' AND tablename='attempts' AND cmd='UPDATE'
      AND qual LIKE '%is_student_self%') > 0,
  'AC-40b student retains an UPDATE policy on own attempts');
SELECT extensions.ok(
  (SELECT COUNT(*) FROM pg_policies
    WHERE schemaname='public' AND tablename='responses' AND cmd='INSERT') > 0,
  'AC-40c student retains an INSERT policy on responses');

-- ===========================================================================
-- AC-09/12 - the student surface carries no result and no overload figure
-- ===========================================================================
-- Introspected with pg_get_function_result(), NOT pg_attribute: a function has
-- no pg_attribute rows, so an attrelid join would return 0 and the assertion
-- would pass vacuously - a test that proves nothing. Verified before writing.
SELECT extensions.ok(
  (SELECT pg_get_function_result(p.oid)
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='student_today')
    !~ '\m(score|score_out_of100|band|percentile|accuracy|required_daily|plan_overload_flag)\M',
  'AC-09/12 student_today RETURNS no result and no overload column');

-- ===========================================================================
-- AC-17/18 - a parent reads only linked children
-- ===========================================================================
SELECT extensions.is(
  (SELECT COUNT(*) FROM public.parent_mastery((SELECT any_student_id FROM _ids))),
  0::bigint,
  'AC-17 unauthorised caller gets zero mastery rows for a real student');

SELECT extensions.ok(
  (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='parent_mastery'),
  'AC-18a parent_mastery is SECURITY DEFINER');

SELECT extensions.ok(
  (SELECT p.proconfig::text LIKE '%search_path%'
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='parent_mastery'),
  'AC-18b parent_mastery pins search_path (no shadowing-object substitution)');

-- ===========================================================================
-- AC-27..31 - creator and admin surfaces
-- ===========================================================================
SELECT extensions.ok(
  (SELECT pg_get_function_result(p.oid)
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='creator_coverage_queue')
    !~ '\m(student_id|student_key|user_id|auth_user_id)\M',
  'AC-27 creator_coverage_queue RETURNS no student identifier');

-- 4-arg form: (query, errcode, expected_message, description). The 3-arg form
-- treats its third argument as the expected MESSAGE, not a label - passing a
-- label there compares it against the real message and fails spuriously.
SELECT extensions.throws_ok(
  $$SELECT * FROM public.creator_coverage_queue(5)$$, '42501',
  'creator or admin role required',
  'AC-28 creator_coverage_queue rejects a caller without creator/admin role');

SELECT extensions.throws_ok(
  $$SELECT * FROM public.admin_data_quality(20260101, 20260131)$$, '42501',
  'admin role required',
  'AC-30 admin_data_quality rejects a non-admin');

SELECT extensions.is(
  (SELECT COUNT(*) FROM public.admin_coverage_gaps(NULL)), 0::bigint,
  'AC-31 admin_coverage_gaps returns zero rows for a non-admin');

-- ===========================================================================
-- Grant hygiene - the three escalation classes this project has suffered
-- ===========================================================================
CREATE TEMP TABLE _wrappers(fn text) ON COMMIT DROP;
INSERT INTO _wrappers VALUES
  ('student_today'), ('child_attempt_history'), ('parent_progress_summary'),
  ('parent_study_behaviour'), ('parent_recommendations'), ('parent_readiness_projection'),
  ('parent_plan_get'), ('parent_plan_set'), ('parent_mastery'), ('parent_percentile'),
  ('admin_platform_health'), ('admin_data_quality'), ('admin_coverage_gaps'),
  ('creator_coverage_queue'), ('reporting_refresh_lag'),
  ('admin_funnel_by_stage'), ('admin_funnel_outcomes');

-- Class 1: an RPC reachable with no credentials. PostgREST exposes every
-- EXECUTE-granted function directly, so a route-level role check is not a control.
SELECT extensions.is(
  (SELECT COUNT(*) FROM pg_proc p
     JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN (SELECT fn FROM _wrappers)
      AND has_function_privilege('anon', p.oid, 'EXECUTE')),
  0::bigint,
  'GRANT-01 no reporting wrapper is executable by anon');

-- Class 2: inherited role membership silently conferring every privilege.
SELECT extensions.ok(
  (SELECT COUNT(*) FROM pg_auth_members m
     JOIN pg_roles r ON r.oid = m.roleid
    WHERE r.rolname='reporting_ro' AND m.inherit_option = false) > 0,
  'GRANT-02 reporting_ro membership is non-inherited (migration 016)');

SELECT extensions.is(
  (SELECT COUNT(*) FROM pg_class c
     JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='reporting' AND c.relkind='m'
      AND has_table_privilege('authenticated', c.oid, 'SELECT')),
  0::bigint,
  'GRANT-03 authenticated cannot SELECT any reporting materialised view directly');

-- Class 3: confidentiality resting on the absence of policies.
SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'public.funnel_events'::regclass, 'SELECT'),
  'GRANT-04 funnel_events SELECT revoked from authenticated (migration 047)');
SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'public.email_log'::regclass, 'SELECT'),
  'GRANT-05 email_log SELECT revoked from authenticated (migration 048)');

-- Every wrapper must be SECURITY DEFINER with a pinned search_path: without the
-- pin, a shadowing object in a caller-writable schema can substitute itself.
SELECT extensions.is(
  (SELECT COUNT(*) FROM pg_proc p
     JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN (SELECT fn FROM _wrappers)
      AND (NOT p.prosecdef OR p.proconfig IS NULL
           OR p.proconfig::text NOT LIKE '%search_path%')),
  0::bigint,
  'GRANT-06 every reporting wrapper is SECURITY DEFINER with pinned search_path');

-- ===========================================================================
-- PR - privacy
-- ===========================================================================
SELECT extensions.is(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema='reporting'
      AND column_name IN ('email','phone','full_name','first_name','last_name','dob')),
  0::bigint,
  'PR-01 no PII column anywhere in the reporting schema');

SELECT extensions.is(
  (SELECT COUNT(*) FROM pg_class c
     JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='reporting' AND c.relkind='r'
      AND NOT (c.relrowsecurity AND c.relforcerowsecurity)),
  0::bigint,
  'PR-07 every reporting base table has RLS enabled AND forced');

-- The property migration 049 depends on. If this ever changes, forcing RLS with
-- no policies would stop the ETL dead - so it is asserted, not assumed.
SELECT extensions.ok(
  (SELECT rolbypassrls FROM pg_roles WHERE rolname='postgres'),
  'PR-07b ETL role postgres has BYPASSRLS (forced RLS does not break loads)');

-- ===========================================================================
-- DA / PF - grain and configuration
-- ===========================================================================
SELECT extensions.ok(
  (SELECT COUNT(*) FROM pg_indexes
    WHERE schemaname='reporting' AND tablename='fact_item_response'
      AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%attempt_id%'
      AND indexdef LIKE '%item_id%') > 0,
  'DA-01 fact_item_response enforces one row per (attempt, item)');

SELECT extensions.ok(
  (SELECT min_items_per_subtopic FROM reporting.coverage_thresholds WHERE id=1) IS NOT NULL,
  'DA-11 coverage threshold is configured (TOO_FEW detection is live)');

-- ===========================================================================
-- A12 - experiment integrity
-- ===========================================================================
-- A client that could choose its own arm could manufacture a winning variant,
-- so assignment and exposure are service-role only, and the raw tables are not
-- readable by browsers at all.
SELECT extensions.is(
  (SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('experiment_assign','experiment_expose')
      AND (has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0::bigint,
  'A12-01 experiment assign/expose are not callable by anon or authenticated');

SELECT extensions.is(
  (SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public'
      AND c.relname IN ('experiment_assignments','experiment_exposures')
      AND (has_table_privilege('authenticated', c.oid, 'SELECT')
        OR has_table_privilege('anon', c.oid, 'SELECT'))),
  0::bigint,
  'A12-02 experiment assignment/exposure tables are not browser-readable');

-- The hard rule from 5.4: below the minimum sample the verdict must be
-- INSUFFICIENT_DATA, never a verdict that reads as equivalence.
SELECT extensions.is(
  (SELECT decision FROM reporting.experiment_decision(4, 2, 4, 3, 200, 0.05, 2.0)),
  'INSUFFICIENT_DATA',
  'A12-03 a 4-user arm yields INSUFFICIENT_DATA, not a difference verdict');

-- ===========================================================================
-- AC-21..26 - tutor access requires a CURRENT consent (decision D-B)
-- ===========================================================================
-- Uses the sample tutor 57000000-...-01, who is linked to sample students
-- 0001/0002/0003 with live consent. Everything here rolls back with the suite.

SELECT set_config('request.jwt.claims',
  '{"sub":"57000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- AC-21/25: only consented students are visible; an unlinked one is not.
SELECT extensions.is(
  (SELECT COUNT(*) FROM public.tutor_student_overview(30)), 3::bigint,
  'AC-21 tutor sees exactly their three consented students');

SELECT extensions.ok(
  NOT public.is_tutor_of('5a000000-0000-4000-8000-000000000010'::uuid),
  'AC-25 tutor has no access to an unlinked student');

-- AC-22: revocation removes access immediately, with no job and no cache.
UPDATE public.consent_records SET revoked_at = now(),
       revoked_by = (SELECT parent_user_id FROM public.parent_student_links
                     WHERE student_id='5a000000-0000-4000-8000-000000000001' LIMIT 1)
WHERE student_id='5a000000-0000-4000-8000-000000000001'
  AND tutor_user_id='57000000-0000-4000-8000-000000000001';

SELECT extensions.is(
  (SELECT COUNT(*) FROM public.tutor_student_overview(30)), 2::bigint,
  'AC-22 revoking consent immediately removes the student from the tutor report');

-- AC-23: expiry removes access too, evaluated at query time.
UPDATE public.consent_records
SET granted_at = now() - interval '13 months', expires_at = now() - interval '1 day'
WHERE student_id='5a000000-0000-4000-8000-000000000002'
  AND tutor_user_id='57000000-0000-4000-8000-000000000001';

SELECT extensions.is(
  (SELECT COUNT(*) FROM public.tutor_student_overview(30)), 1::bigint,
  'AC-23 an expired consent grants no access');

-- AC-24: the remaining live consent still works, and T2/T3 agree with T1.
SELECT extensions.ok(
  public.is_tutor_of('5a000000-0000-4000-8000-000000000003'::uuid),
  'AC-24 a current consent still grants access');

SELECT extensions.is(
  (SELECT COUNT(DISTINCT student_id) FROM public.tutor_skill_gaps()), 1::bigint,
  'AC-24b T2 is scoped to the same consented set as T1');

-- AC-26: no billing policy admits a tutor. Tutors connect as `authenticated`, so
-- the control is the absence of any tutor-aware policy on the billing tables.
SELECT extensions.is(
  (SELECT COUNT(*) FROM pg_policies
    WHERE schemaname='public'
      AND tablename IN ('purchases','subscriptions','entitlements')
      AND (qual ILIKE '%tutor%' OR with_check ILIKE '%tutor%')),
  0::bigint,
  'AC-26 no billing policy grants tutor access');

-- ===========================================================================
-- T5 Assignment Tracker / T7 Recommendations (migrations 073, 074)
--
-- Runs AFTER the AC-21..26 block on purpose, so student 0001's consent is
-- revoked and 0002's has expired. That gives a real consent gate to assert
-- against: fixtures exist for all three students and only 0003's may surface.
--
-- `public.assignments` and `public.tests` are empty in the sample dataset, so
-- fixtures are built here and roll back with the suite. REFRESH is
-- non-concurrent because CONCURRENTLY cannot run inside a transaction block.
-- ===========================================================================

CREATE TEMP TABLE _t5ids ON COMMIT DROP AS
SELECT
  (SELECT tutor_user_id FROM public.tutor_student_links
    WHERE student_id = '5a000000-0000-4000-8000-000000000003' LIMIT 1)  AS tutor_uid,
  (SELECT l2.tutor_user_id FROM public.tutor_student_links l2
    WHERE l2.tutor_user_id <> (SELECT tutor_user_id FROM public.tutor_student_links
                                WHERE student_id = '5a000000-0000-4000-8000-000000000003' LIMIT 1)
    LIMIT 1)                                                           AS other_tutor_uid,
  (SELECT parent_user_id FROM public.parent_student_links
    WHERE student_id = '5a000000-0000-4000-8000-000000000003' LIMIT 1)  AS parent_uid;

INSERT INTO public.tests (id, title, exam_type, year_level_min, year_level_max,
                          time_limit_mins, is_free, status, created_by)
SELECT ('59000000-0000-4000-8000-0000000000' || s)::uuid,
       'T5 fixture ' || s, 'SELECTIVE', 4, 6, 45, false, 'DRAFT',
       (SELECT tutor_uid FROM _t5ids)
FROM unnest(ARRAY['aa','ab','ac','ad','ae','af']) AS s;

-- Rows for the consented student 0003, one per status branch, each on its own
-- test so a completion cannot leak between branches. Ids are ordered so the
-- aggregate assertion below is deterministic.
INSERT INTO public.assignments (id, student_id, test_id, assigned_by, assigned_at, due_at) VALUES
  ('59000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000003',
   '59000000-0000-4000-8000-0000000000aa', (SELECT tutor_uid FROM _t5ids),
   now() - interval '10 days', now() + interval '7 days'),
  ('59000000-0000-4000-8000-000000000002', '5a000000-0000-4000-8000-000000000003',
   '59000000-0000-4000-8000-0000000000ab', (SELECT tutor_uid FROM _t5ids),
   now() - interval '10 days', now() + interval '7 days'),
  ('59000000-0000-4000-8000-000000000003', '5a000000-0000-4000-8000-000000000003',
   '59000000-0000-4000-8000-0000000000ac', (SELECT tutor_uid FROM _t5ids),
   now() - interval '10 days', now() - interval '1 day'),
  ('59000000-0000-4000-8000-000000000004', '5a000000-0000-4000-8000-000000000003',
   '59000000-0000-4000-8000-0000000000ad', (SELECT tutor_uid FROM _t5ids),
   now() - interval '10 days', now() - interval '1 day'),
  -- due_at NULL: can never be overdue, and must not read as ON_TIME either.
  ('59000000-0000-4000-8000-000000000005', '5a000000-0000-4000-8000-000000000003',
   '59000000-0000-4000-8000-0000000000ae', (SELECT tutor_uid FROM _t5ids),
   now() - interval '10 days', NULL),
  -- Migration-075 regression pair: the SAME test assigned twice. The attempt at
  -- now()-4d must belong to 0021 (assigned now()-5d) and not to 0020, or one
  -- completion marks both done.
  ('59000000-0000-4000-8000-000000000020', '5a000000-0000-4000-8000-000000000003',
   '59000000-0000-4000-8000-0000000000af', (SELECT tutor_uid FROM _t5ids),
   now() - interval '10 days', now() + interval '7 days'),
  ('59000000-0000-4000-8000-000000000021', '5a000000-0000-4000-8000-000000000003',
   '59000000-0000-4000-8000-0000000000af', (SELECT tutor_uid FROM _t5ids),
   now() - interval '5 days', now() + interval '7 days'),
  -- Consent-gate probes: same tutor, students whose consent is revoked/expired.
  ('59000000-0000-4000-8000-000000000011', '5a000000-0000-4000-8000-000000000001',
   '59000000-0000-4000-8000-0000000000aa', (SELECT tutor_uid FROM _t5ids),
   now() - interval '10 days', now() + interval '7 days'),
  ('59000000-0000-4000-8000-000000000012', '5a000000-0000-4000-8000-000000000002',
   '59000000-0000-4000-8000-0000000000aa', (SELECT tutor_uid FROM _t5ids),
   now() - interval '10 days', now() + interval '7 days'),
  -- Another tutor's assignment to the SAME consented student.
  ('59000000-0000-4000-8000-000000000019', '5a000000-0000-4000-8000-000000000003',
   '59000000-0000-4000-8000-0000000000aa', (SELECT other_tutor_uid FROM _t5ids),
   now() - interval '10 days', now() + interval '7 days');

-- Attempts that drive STARTED and COMPLETED. created_at is after assigned_at,
-- which is the condition mv_assignment_progress requires. The attempt on test
-- 'af' is the migration-075 regression case: two assignments share that test and
-- only the later one may claim it.
INSERT INTO public.attempts (student_id, test_id, status, created_at, started_at, submitted_at)
VALUES
  ('5a000000-0000-4000-8000-000000000003', '59000000-0000-4000-8000-0000000000ab',
   'IN_PROGRESS', now() - interval '5 days', now() - interval '5 days', NULL),
  ('5a000000-0000-4000-8000-000000000003', '59000000-0000-4000-8000-0000000000ac',
   'COMPLETE', now() - interval '4 days', now() - interval '4 days', now() - interval '4 days'),
  ('5a000000-0000-4000-8000-000000000003', '59000000-0000-4000-8000-0000000000af',
   'COMPLETE', now() - interval '4 days', now() - interval '4 days', now() - interval '4 days');

REFRESH MATERIALIZED VIEW reporting.mv_assignment_progress;

SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT tutor_uid FROM _t5ids), 'role', 'authenticated')::text, true);

-- T5 is consent-gated even though 11-...md 4.5 lists the gate only for T2/T3/T7:
-- a revoked or expired consent must hide the child's activity, not just scores.
SELECT extensions.is(
  (SELECT COUNT(DISTINCT student_id) FROM public.tutor_assignments(NULL)), 1::bigint,
  'T5 shows assignments only for students with a current consent');

CREATE TEMP TABLE _t5out ON COMMIT DROP AS
SELECT assignment_id, student_id, assignment_status, due_state, is_overdue
FROM public.tutor_assignments(NULL);

SELECT extensions.is(
  (SELECT string_agg(assignment_status || '/' || due_state, ',' ORDER BY assignment_id)
     FROM _t5out WHERE student_id = '5a000000-0000-4000-8000-000000000003'),
  'ASSIGNED/ON_TIME,STARTED/ON_TIME,COMPLETED/MET,OVERDUE/OVERDUE,ASSIGNED/NO_DUE_DATE,'
  || 'ASSIGNED/ON_TIME,COMPLETED/MET',
  'T5 derives every status and separates no-due-date from on-time');

-- Regression for migration 075. Assignments 0020 and 0021 are the SAME test for
-- the SAME student; only one attempt exists. Before 075 the join on
-- (student_id, test_id) matched it to both, so a single completion marked every
-- assignment of that test done - the tutor's chase list claimed work had been
-- handed in which was never started.
SELECT extensions.is(
  (SELECT string_agg(assignment_status, ',' ORDER BY assignment_id)
     FROM _t5out WHERE assignment_id IN ('59000000-0000-4000-8000-000000000020',
                                         '59000000-0000-4000-8000-000000000021')),
  'ASSIGNED,COMPLETED',
  'T5 attributes an attempt to one assignment, not to every assignment of that test');

-- A handed-in assignment is never "overdue", whatever the due date says.
SELECT extensions.is(
  (SELECT COUNT(*) FROM _t5out WHERE assignment_status = 'COMPLETED' AND is_overdue), 0::bigint,
  'T5 never marks a completed assignment overdue');

-- THE DESIGN POINT OF MIGRATION 073: due_at moves into the past AFTER the last
-- refresh. If status were baked into the MV this would still read ASSIGNED/ON_TIME.
UPDATE public.assignments
   SET due_at = now() - interval '1 minute'
 WHERE id = '59000000-0000-4000-8000-000000000001';

SELECT extensions.is(
  (SELECT assignment_status FROM public.tutor_assignments(NULL)
    WHERE assignment_id = '59000000-0000-4000-8000-000000000001'),
  'OVERDUE',
  'T5 recomputes overdue at read time, not at the last hourly refresh');

-- Refresh so the other tutor's row is genuinely in the MV: this proves it is
-- filtered by assigned_by, not merely absent because the MV is stale.
REFRESH MATERIALIZED VIEW reporting.mv_assignment_progress;

SELECT extensions.is(
  (SELECT COUNT(*) FROM public.tutor_assignments(NULL)
    WHERE assignment_id = '59000000-0000-4000-8000-000000000019'), 0::bigint,
  'T5 shows only work this tutor set, not another tutor''s');

-- ------------------------------- T7 ----------------------------------------

SELECT extensions.ok(
  (SELECT COALESCE(max(n), 0) FROM
     (SELECT COUNT(*) AS n FROM public.tutor_recommendations(NULL) GROUP BY student_id) z) <= 3,
  'T7 caps recommendations at three per student (B12)');

-- Parity with P8. This is the whole reason the metric was extracted into
-- reporting.recommendations_scored() instead of copied: if the two ever diverge,
-- a parent and their tutor get different advice for the same child, and nothing
-- else in the system would notice.
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT parent_uid FROM _t5ids), 'role', 'authenticated')::text, true);
CREATE TEMP TABLE _p7 ON COMMIT DROP AS
  SELECT * FROM public.parent_recommendations('5a000000-0000-4000-8000-000000000003');

SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT tutor_uid FROM _t5ids), 'role', 'authenticated')::text, true);
CREATE TEMP TABLE _t7 ON COMMIT DROP AS
  SELECT recommendation_rank, subject, topic, items_answered, accuracy_pct,
         expected_impact_score, reason
  FROM public.tutor_recommendations('5a000000-0000-4000-8000-000000000003');

SELECT extensions.is(
  (SELECT COUNT(*) FROM (SELECT * FROM _p7 EXCEPT SELECT * FROM _t7) x)
  + (SELECT COUNT(*) FROM (SELECT * FROM _t7 EXCEPT SELECT * FROM _p7) y), 0::bigint,
  'T7 and P8 return identical recommendations - one definition, no drift');

-- Without this the assertion above could pass on two empty sets.
SELECT extensions.ok((SELECT COUNT(*) FROM _p7) > 0,
  'P8/T7 parity actually compared rows');

SELECT extensions.is(
  (SELECT COUNT(DISTINCT student_id) FROM public.tutor_recommendations(NULL)), 1::bigint,
  'T7 is scoped to the same consented set as T1');

-- Catalog: the shared metric must not be reachable from a browser role, or the
-- authorisation both wrappers perform could be bypassed entirely.
SELECT extensions.is(
  has_function_privilege('authenticated', 'reporting.recommendations_scored(uuid)', 'EXECUTE'),
  false, 'the shared recommendation metric is not directly callable by a browser role');

SELECT extensions.is(
  has_function_privilege('anon', 'public.tutor_assignments(text)', 'EXECUTE'),
  false, 'T5 is not anon-executable');

SELECT extensions.is(
  has_function_privilege('anon', 'public.tutor_recommendations(uuid)', 'EXECUTE'),
  false, 'T7 is not anon-executable');

SELECT extensions.is(
  has_table_privilege('authenticated', 'reporting.mv_assignment_progress', 'SELECT'),
  false, 'the T5 materialised view is not browser-readable');

-- ------------------------------- A1 / T4 ------------------------------------
--
-- X-6 makes A1 the OWNER of p_value, point_biserial and distractor_analysis, and
-- T4 "the same metric restricted to tests the tutor assigned and to that tutor's
-- consented students". One definition, two scopes - so the first thing to prove is
-- that the scoped call and the materialised one agree exactly when given the same
-- population. Migration 078's parity check found a real bug this way: jsonb_agg
-- ordered by count alone, so tied options reordered between calls and 19 of 75
-- items differed on byte-identical data.

-- WHICH TEST IS DERIVED, NOT NAMED. A hardcoded test id tied these assertions to
-- whichever tests the sample generator happened to give this student, and that
-- moves whenever the catalogue or the generator changes - re-seeding against 53
-- published tests instead of 11 reshuffles every student's attempts. Picking the
-- test from the data keeps the assertions about the METRIC rather than about one
-- run of the seed. It must be a test the consented student actually answered AND
-- that at least one other student also sat, or the "strict subset" check below
-- would compare a set against itself and pass vacuously.
CREATE TEMP TABLE _a1test ON COMMIT DROP AS
SELECT f.test_id
FROM reporting.fact_item_response f
WHERE f.student_id = '5a000000-0000-4000-8000-000000000003'
  AND (SELECT COUNT(DISTINCT g.student_id)
         FROM reporting.fact_item_response g
        WHERE g.test_id = f.test_id) > 1
GROUP BY f.test_id
ORDER BY COUNT(*) DESC
LIMIT 1;

CREATE TEMP TABLE _a1pop ON COMMIT DROP AS
SELECT array_agg(DISTINCT student_id) AS ids
FROM reporting.fact_item_response
WHERE test_id = (SELECT test_id FROM _a1test);

CREATE TEMP TABLE _a1live ON COMMIT DROP AS
SELECT item_id, responses, p_value, point_biserial, median_time_seconds, skip_rate_pct,
       key_option, distractors, dead_distractors, defect_reasons
FROM reporting.item_statistics((SELECT test_id FROM _a1test),
                               (SELECT ids FROM _a1pop));

CREATE TEMP TABLE _a1mv ON COMMIT DROP AS
SELECT item_id, responses, p_value, point_biserial, median_time_seconds, skip_rate_pct,
       key_option, distractors, dead_distractors, defect_reasons
FROM reporting.mv_item_statistics
WHERE test_id = (SELECT test_id FROM _a1test);

SELECT extensions.is(
  (SELECT COUNT(*) FROM (SELECT * FROM _a1live EXCEPT SELECT * FROM _a1mv) x)
+ (SELECT COUNT(*) FROM (SELECT * FROM _a1mv EXCEPT SELECT * FROM _a1live) y), 0::bigint,
  'A1 and T4 share ONE item-statistics definition - no drift between scopes');

-- Without this the assertion above passes on two empty sets.
SELECT extensions.ok((SELECT COUNT(*) FROM _a1mv) > 0,
  'A1/T4 parity actually compared rows');

-- T4 scope: an assignment by THIS tutor on the derived test.
INSERT INTO public.assignments (id, student_id, test_id, assigned_by, assigned_at, due_at)
VALUES ('59000000-0000-4000-8000-000000000030', '5a000000-0000-4000-8000-000000000003',
        (SELECT test_id FROM _a1test), (SELECT tutor_uid FROM _t5ids),
        now() - interval '10 days', now() + interval '7 days');

CREATE TEMP TABLE _t4 ON COMMIT DROP AS
SELECT * FROM public.tutor_item_analysis((SELECT test_id FROM _a1test));

SELECT extensions.ok((SELECT COUNT(*) FROM _t4) > 0,
  'T4 returns item rows for a test this tutor assigned');

SELECT extensions.is((SELECT MAX(students) FROM _t4), 1::bigint,
  'T4 counts only this tutor''s consented students, never the whole cohort');

-- The population narrows; the metric does not change. If T4 had its own formula
-- this would still pass, which is why the parity check above is the real guard -
-- but a scoped view that somehow saw MORE than the platform-wide one would mean
-- the consent gate had failed open.
SELECT extensions.ok(
  (SELECT COALESCE(SUM(responses), 0) FROM _t4)
    < (SELECT COALESCE(SUM(responses), 0) FROM _a1mv),
  'T4 sees a strict subset of A1 - the consent gate narrows, never widens');

-- Derived for the same reason as _a1test: a hardcoded "unassigned" test id stops
-- being unassigned the moment any earlier fixture assigns it, and then this
-- assertion would silently start testing the success path.
CREATE TEMP TABLE _a1other ON COMMIT DROP AS
SELECT t.id AS test_id
FROM public.tests t
WHERE t.status::text = 'PUBLISHED'
  AND t.id <> (SELECT test_id FROM _a1test)
  AND NOT EXISTS (
        SELECT 1 FROM public.assignments a
        WHERE a.test_id = t.id
          AND a.assigned_by = (SELECT tutor_uid FROM _t5ids))
LIMIT 1;

SELECT extensions.throws_ok(
  format('SELECT * FROM public.tutor_item_analysis(%L)', (SELECT test_id FROM _a1other)),
  '42501',
  'item analysis requires a test this tutor assigned',
  'T4 refuses a test this tutor never assigned (403, not an empty list)');

SELECT extensions.is((SELECT COUNT(*) FROM public.admin_item_statistics(NULL)), 0::bigint,
  'A1 returns nothing at all to a non-admin');

-- The shared definition must not be reachable from a browser role, or both
-- wrappers' authorisation could be skipped entirely.
SELECT extensions.is(
  has_function_privilege('authenticated', 'reporting.item_statistics(uuid,uuid[])', 'EXECUTE'),
  false, 'the shared item metric is not directly callable by a browser role');

SELECT extensions.is(
  has_table_privilege('authenticated', 'reporting.mv_item_statistics', 'SELECT'),
  false, 'the A1 materialised view is not browser-readable');

SELECT extensions.is(
  has_table_privilege('authenticated', 'reporting.item_thresholds', 'SELECT'),
  false, 'the item calibration thresholds are not browser-readable');

SELECT extensions.is(
  has_function_privilege('anon', 'public.admin_item_statistics(uuid)', 'EXECUTE'),
  false, 'A1 is not anon-executable');

SELECT extensions.is(
  has_function_privilege('anon', 'public.tutor_item_analysis(uuid)', 'EXECUTE'),
  false, 'T4 is not anon-executable');

-- Regression guard for the bug §5 calls "the most commonly botched item
-- statistic". Correlating an item with a total that CONTAINS it inflates the
-- coefficient - measured at 0.330 naive against 0.194 corrected on this dataset,
-- higher for 323 of 328 items. If someone "simplifies" the rest score back to the
-- attempt total, almost every discrimination failure disappears from view and this
-- assertion fails.
SELECT extensions.ok(
  (WITH j AS (
     SELECT f.attempt_id, f.item_id, f.is_correct::int::numeric AS y
     FROM reporting.fact_item_response f
     JOIN reporting.fact_test_attempt t
       ON t.attempt_id = f.attempt_id AND t.score IS NOT NULL),
   att AS (SELECT attempt_id, SUM(y) AS tot FROM j GROUP BY attempt_id),
   pb AS (
     SELECT j.item_id, CORR(j.y, att.tot) AS naive, CORR(j.y, att.tot - j.y) AS rest
     FROM j JOIN att ON att.attempt_id = j.attempt_id
     GROUP BY j.item_id HAVING COUNT(*) >= 20)
   SELECT AVG(naive) > AVG(rest) FROM pb),
  'point-biserial excludes the item from its own rest score');

-- --------------------- T7 Assign / T5 Remind (write path) --------------------
--
-- Both actions were withheld in 073/074 because public.tests was empty: there was
-- nothing to assign, and a button that cannot work is worse than a stated
-- limitation. The content layer now holds published tests, so these assert the real
-- write path - including every way it must refuse.

-- A published test inside student 0003's year band (the T5 fixture tests are all
-- DRAFT, which is exactly what the first refusal below needs).
INSERT INTO public.tests (id, title, exam_type, year_level_min, year_level_max,
                          time_limit_mins, is_free, status, created_by)
VALUES ('59000000-0000-4000-8000-0000000000bb', 'A1/T4 fixture published', 'SELECTIVE',
        4, 6, 45, false, 'PUBLISHED', (SELECT tutor_uid FROM _t5ids))
ON CONFLICT (id) DO UPDATE SET status = 'PUBLISHED';

SELECT extensions.throws_ok(
  'SELECT public.tutor_assign_test(''5a000000-0000-4000-8000-000000000003'',
                                   ''59000000-0000-4000-8000-0000000000aa'', NULL)',
  '22023',
  'only a published test can be assigned',
  'Assign refuses a draft test - unfinished content is never handed to a student');

SELECT extensions.throws_ok(
  'SELECT public.tutor_assign_test(''5a000000-0000-4000-8000-000000000001'',
                                   ''59000000-0000-4000-8000-0000000000bb'', NULL)',
  '42501',
  'no current consent for this student',
  'Assign refuses a student whose consent is not current');

SELECT extensions.throws_ok(
  'SELECT public.tutor_assign_test(''5a000000-0000-4000-8000-000000000003'',
                                   ''59000000-0000-4000-8000-0000000000bb'',
                                   now() - interval ''1 day'')',
  '22023',
  'due date must be in the future',
  'Assign refuses a due date already in the past, which would create an instantly-overdue row');

CREATE TEMP TABLE _assign ON COMMIT DROP AS
SELECT public.tutor_assign_test('5a000000-0000-4000-8000-000000000003',
                                '59000000-0000-4000-8000-0000000000bb',
                                now() + interval '7 days') AS aid;

SELECT extensions.ok((SELECT aid FROM _assign) IS NOT NULL,
  'Assign creates the assignment for a consented student on a published test');

CREATE TEMP TABLE _r1 ON COMMIT DROP AS
SELECT * FROM public.tutor_remind((SELECT aid FROM _assign));
CREATE TEMP TABLE _r2 ON COMMIT DROP AS
SELECT * FROM public.tutor_remind((SELECT aid FROM _assign));

SELECT extensions.ok((SELECT queued FROM _r1) > 0,
  'Remind queues for the student AND the linked parent, not the child alone');

-- The rate limit is structural (email_log's unique index on
-- user_id/template/dedupe_key), not a disabled button. An overdue assignment is
-- exactly where a frustrated tutor clicks repeatedly, and the family must not
-- receive six emails because of it.
SELECT extensions.is((SELECT queued FROM _r2), 0,
  'Remind will not email the same family twice about one assignment in a day');

SELECT extensions.ok((SELECT already_sent FROM _r2) > 0,
  'a suppressed reminder is reported back, so the control never looks broken');

SELECT extensions.throws_ok(
  'SELECT * FROM public.tutor_remind(''59000000-0000-4000-8000-000000000019'')',
  '42501',
  'this assignment belongs to another tutor',
  'Remind refuses an assignment another tutor set');

SELECT extensions.is(
  has_function_privilege('anon', 'public.tutor_assign_test(uuid,uuid,timestamp with time zone)', 'EXECUTE'),
  false, 'Assign is not anon-executable');

SELECT extensions.is(
  has_function_privilege('anon', 'public.tutor_remind(uuid)', 'EXECUTE'),
  false, 'Remind is not anon-executable');

-- ===========================================================================
-- P2 / DA-06..08 / AC-19..20 - percentile (migration 093)
--
-- DA-06 is HAND-COMPUTED, not derived from the same SQL it tests:
--   scores 1..21, score 11: 10 below + 1 tied -> 100*10.5/21 = 50.
--   16 below + 5 tied at 60, score 60: 100*18.5/21 = 88.09523809... -> 88.0952.
--   21 all tied at 60: 100*10.5/21 = 50.
--
-- DA-07/08 and AC-19/20 use a FIXTURE cohort: SELECTIVE x Year 2, a cell no
-- real data occupies (sample students are Years 3-8), so the assertions are
-- isolated. Everything rolls back with the suite, including the MV refreshes
-- (non-concurrent: CONCURRENTLY cannot run inside a transaction block).
-- ===========================================================================

SELECT extensions.is(
  reporting.percentile_from_scores(11, (SELECT array_agg(g)::numeric[] FROM generate_series(1,21) g)),
  50::numeric, 'DA-06 mid-rank hand-check: 10 below + 1 tied of 21 = 50');

SELECT extensions.is(
  ROUND(reporting.percentile_from_scores(60,
    (SELECT array_agg(g)::numeric[] FROM
       (SELECT g FROM generate_series(1,16) g UNION ALL SELECT 60 FROM generate_series(1,5)) z)), 4),
  88.0952::numeric, 'DA-06 ties hand-check: 16 below + 5 tied of 21 = 88.0952');

SELECT extensions.is(
  reporting.percentile_from_scores(60, array_fill(60::numeric, ARRAY[21])),
  50::numeric, 'DA-06 all-tied cohort gives 50, not 0 or 100');

SELECT extensions.ok(
  reporting.percentile_from_scores(50, ARRAY[]::numeric[]) IS NULL,
  'DA-06 an empty cohort yields NULL, never a divide-by-zero or a 0');

CREATE TEMP TABLE _p2ids ON COMMIT DROP AS
SELECT (SELECT parent_user_id FROM public.parent_student_links LIMIT 1) AS parent_uid;

INSERT INTO public.tests (id, title, exam_type, year_level_min, year_level_max,
                          time_limit_mins, is_free, status, created_by)
VALUES ('6d000000-0000-4000-8000-0000000000aa', 'P2 fixture test', 'SELECTIVE',
        2, 2, 45, false, 'DRAFT', (SELECT parent_uid FROM _p2ids));

INSERT INTO reporting.dim_test (test_id, title, exam_type, year_level_min, year_level_max,
                                time_limit_mins, is_free, content_status, valid_from, is_current)
VALUES ('6d000000-0000-4000-8000-0000000000aa', 'P2 fixture test', 'SELECTIVE',
        2, 2, 45, false, 'DRAFT', now(), true);

-- 19 students, scores 5,10,...,95. Student 10 (score 50) is the subject:
-- 9 below + 1 tied of 19 -> mid-rank 50, but SUPPRESSED at n=19.
INSERT INTO reporting.dim_student (student_id, pseudonym, year_level, valid_from, is_current)
SELECT ('6a000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
       'p2 fixture ' || n, 2, current_date, true
FROM generate_series(1,19) n;

INSERT INTO reporting.fact_test_attempt
  (attempt_id, date_key, student_id, test_id, status, score, started_at, submitted_at, etl_loaded_at)
SELECT ('6c000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
       to_char(current_date, 'YYYYMMDD')::int,
       ('6a000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
       '6d000000-0000-4000-8000-0000000000aa', 'COMPLETE', 5*n,
       now() - interval '2 days', now() - interval '2 days', now()
FROM generate_series(1,19) n;

-- B1 needs a LIVE completed attempt for the subject (the gate reads
-- public.attempts, not the nightly MV). attempts.student_id AND
-- parent_student_links.student_id both FK to student_profiles, so the
-- subject AND the AC-19 student need public identities - the other fixture
-- students live only in the reporting dimension. Student 11 gets a link
-- but NO attempt: that is the AC-19 case.
INSERT INTO auth.users
  (id, instance_id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at,
   raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous)
SELECT ('6a000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
       '00000000-0000-0000-0000-000000000000',
       'authenticated', 'authenticated',
       'p2.fixture.' || lpad(n::text, 4, '0') || '@sample.invalid', '',
       NULL, now(), now(),
       '{"provider":"sample","providers":["sample"]}'::jsonb,
       '{"sample":true,"purpose":"assurance fixture"}'::jsonb, false, false
FROM unnest(ARRAY[10, 11]) n;

INSERT INTO public.student_profiles (id, auth_user_id, year_level, username)
SELECT ('6a000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
       ('6a000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
       2, 'p2fixture' || lpad(n::text, 4, '0')
FROM unnest(ARRAY[10, 11]) n
ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, year_level = 2;

INSERT INTO public.attempts (id, student_id, test_id, status, score_out_of100, started_at, submitted_at)
VALUES ('6c000000-0000-4000-8000-00000000000a',
        '6a000000-0000-4000-8000-00000000000a',
        '6d000000-0000-4000-8000-0000000000aa', 'COMPLETE', 50,
        now() - interval '2 days', now() - interval '2 days');

INSERT INTO public.parent_student_links (id, parent_user_id, student_id) VALUES
  ('6c000000-0000-4000-8000-0000000000f1', (SELECT parent_uid FROM _p2ids),
   '6a000000-0000-4000-8000-00000000000a'),
  ('6c000000-0000-4000-8000-0000000000f2', (SELECT parent_uid FROM _p2ids),
   '6a000000-0000-4000-8000-00000000000b');

REFRESH MATERIALIZED VIEW reporting.mv_percentile_cohort;

SELECT extensions.is(
  (SELECT cohort_size FROM reporting.mv_percentile_cohort
    WHERE student_id='6a000000-0000-4000-8000-00000000000a'
      AND family_group='SELECTIVE' AND year_level=2),
  19::bigint, 'DA-07 fixture cohort counts 19 distinct students');

SELECT extensions.ok(
  (SELECT suppressed FROM reporting.mv_percentile_cohort
    WHERE student_id='6a000000-0000-4000-8000-00000000000a'
      AND family_group='SELECTIVE' AND year_level=2),
  'DA-07 a 19-student cohort is suppressed IN THE MV, not the UI');

SELECT extensions.ok(
  (SELECT percentile_rank IS NULL AND percentile_band IS NULL
     FROM reporting.mv_percentile_cohort
    WHERE student_id='6a000000-0000-4000-8000-00000000000a'
      AND family_group='SELECTIVE' AND year_level=2),
  'DA-07 suppression nulls BOTH the point and the band');

SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT parent_uid FROM _p2ids), 'role', 'authenticated')::text, true);

SELECT extensions.is(
  (SELECT COUNT(*) FROM public.parent_percentile('6a000000-0000-4000-8000-00000000000a')
    WHERE suppressed),
  1::bigint, 'AC-20 the wrapper transports suppression for a below-floor cohort');

SELECT extensions.is(
  (SELECT cohort_size FROM public.parent_percentile('6a000000-0000-4000-8000-00000000000a') LIMIT 1),
  19::bigint, 'AC-20 the cohort size is still returned while suppressed');

SELECT extensions.throws_ok(
  $$SELECT * FROM public.parent_percentile('6a000000-0000-4000-8000-00000000000b')$$,
  '42501', 'percentile requires a completed test first (P1 readiness does not resolve)',
  'AC-19 linked parent, no completed attempt: B1 refuses server-side (403)');

SELECT extensions.is(
  (SELECT COUNT(*) FROM public.parent_percentile('6a000000-0000-4000-8000-00000000000c')),
  0::bigint,
  'AC-19b an UNLINKED caller gets 0 rows even for a no-attempt student (auth before B1, no existence probe)');

-- Grow the cohort to 21: suppression lifts, but 21 < 50 so the figure must be
-- a BAND. Student 10 (score 50) now has 9 below + 1 tied of 21 -> mid-rank
-- 100*9.5/21 = 45.2381 -> width_bucket(45.2381,0,100,4) = 2. (At n=19 it was
-- exactly 50; the two new HIGH scorers move the denominator, which is the
-- point of recomputing by hand rather than trusting the earlier figure.)
INSERT INTO reporting.dim_student (student_id, pseudonym, year_level, valid_from, is_current)
SELECT ('6a000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
       'p2 fixture ' || n, 2, current_date, true
FROM generate_series(20,21) n;

INSERT INTO reporting.fact_test_attempt
  (attempt_id, date_key, student_id, test_id, status, score, started_at, submitted_at, etl_loaded_at)
SELECT ('6c000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
       to_char(current_date, 'YYYYMMDD')::int,
       ('6a000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
       '6d000000-0000-4000-8000-0000000000aa', 'COMPLETE', 76 + n,
       now() - interval '2 days', now() - interval '2 days', now()
FROM generate_series(20,21) n;

REFRESH MATERIALIZED VIEW reporting.mv_percentile_cohort;

SELECT extensions.is(
  (SELECT percentile_band FROM reporting.mv_percentile_cohort
    WHERE student_id='6a000000-0000-4000-8000-00000000000a'
      AND family_group='SELECTIVE' AND year_level=2),
  2, 'P2 at n=21 the mid-rank 45.2381 becomes band 2, hand-computed');

SELECT extensions.ok(
  (SELECT NOT suppressed AND percentile_rank IS NULL
     FROM reporting.mv_percentile_cohort
    WHERE student_id='6a000000-0000-4000-8000-00000000000a'
      AND family_group='SELECTIVE' AND year_level=2),
  'P2 at n=21 (below the point floor) there is a band but NO point');

SELECT extensions.is(
  (SELECT cohort_size FROM reporting.mv_percentile_cohort
    WHERE student_id='6a000000-0000-4000-8000-00000000000a'
      AND family_group='SELECTIVE' AND year_level=2),
  21::bigint, 'P2 cohort grew to 21 distinct students');

-- DA-08: one student, nine attempts. The cohort must stay 21, and the score
-- used is their MOST RECENT (5), not their first or best.
INSERT INTO reporting.fact_test_attempt
  (attempt_id, date_key, student_id, test_id, status, score, started_at, submitted_at, etl_loaded_at)
SELECT ('6c000000-0000-4000-8000-' || lpad(to_hex(256+k), 12, '0'))::uuid,
       to_char(current_date, 'YYYYMMDD')::int,
       '6a000000-0000-4000-8000-000000000001',
       '6d000000-0000-4000-8000-0000000000aa', 'COMPLETE', 5,
       now() - interval '1 day', now() - interval '1 day', now()
FROM generate_series(1,8) k;

REFRESH MATERIALIZED VIEW reporting.mv_percentile_cohort;

SELECT extensions.is(
  (SELECT cohort_size FROM reporting.mv_percentile_cohort
    WHERE student_id='6a000000-0000-4000-8000-00000000000a'
      AND family_group='SELECTIVE' AND year_level=2),
  21::bigint, 'DA-08 one student with 9 attempts does not inflate a 21-student cohort');

SELECT extensions.is(
  (SELECT latest_score FROM reporting.mv_percentile_cohort
    WHERE student_id='6a000000-0000-4000-8000-000000000001'
      AND family_group='SELECTIVE' AND year_level=2),
  5::numeric, 'DA-08b the cohort score is the MOST RECENT attempt, not the first or best');

SELECT extensions.is(
  has_table_privilege('authenticated', 'reporting.mv_percentile_cohort', 'SELECT'),
  false, 'P2 the cohort MV is not browser-readable');

SELECT extensions.is(
  has_function_privilege('authenticated', 'reporting.percentile_from_scores(numeric,numeric[])', 'EXECUTE'),
  false, 'P2 the mid-rank metric is not directly callable by a browser role');

SELECT extensions.ok(
  (SELECT pg_get_function_result(p.oid)
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='parent_percentile')
    !~ '\m(pct|percentile_pct|student_key)\M',
  'P2 the wrapper RETURNS no raw percentage and no surrogate key');

-- ===========================================================================
-- T3 LOW_ENGAGEMENT (migration 094) - the rule is proven to FIRE under
-- controlled conditions, and proven to honour its spec condition (an active
-- exam target), rather than left untested because the sample happens not to
-- trigger it. Runs after the AC-21..26 block: for tutor 5700...01 only
-- student 0003's consent is still live, and every assertion here is scoped
-- to a named student, so it also holds when run against a fresh database.
-- ===========================================================================

SELECT set_config('request.jwt.claims',
  '{"sub":"57000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- An active exam target, and every attempt stale by 20 days (> the 14-day
-- threshold). Both conditions of the spec rule now hold for student 0003.
INSERT INTO public.student_exam_targets (student_id, target_exam, exam_date, weekly_sessions_goal, updated_at)
VALUES ('5a000000-0000-4000-8000-000000000003', 'T3 fixture exam', current_date + 60, 3, now());

UPDATE reporting.fact_test_attempt
   SET started_at = now() - interval '20 days',
       submitted_at = CASE WHEN status IN ('SUBMITTED','COMPLETE')
                           THEN now() - interval '20 days' ELSE NULL END
 WHERE student_id = '5a000000-0000-4000-8000-000000000003';

SELECT extensions.ok(
  EXISTS(SELECT 1 FROM public.tutor_at_risk()
          WHERE student_id='5a000000-0000-4000-8000-000000000003'
            AND at_risk_rule='LOW_ENGAGEMENT'),
  'T3-01 LOW_ENGAGEMENT fires: stale sessions + an active exam target');

SELECT extensions.ok(
  EXISTS(SELECT 1 FROM public.tutor_at_risk()
          WHERE student_id='5a000000-0000-4000-8000-000000000003'
            AND at_risk_rule='LOW_ENGAGEMENT' AND rule_detail LIKE '%exam target%'),
  'T3-02 the detail names the exam-target condition, so a tutor can dispute it');

DELETE FROM public.student_exam_targets
 WHERE student_id='5a000000-0000-4000-8000-000000000003';

SELECT extensions.is(
  (SELECT COUNT(*) FROM public.tutor_at_risk()
    WHERE student_id='5a000000-0000-4000-8000-000000000003'
      AND at_risk_rule='LOW_ENGAGEMENT'),
  0::bigint, 'T3-03 without an active exam target the rule does NOT fire (AL-17)');

-- A consented student with ZERO attempts: the case the old scores-driven
-- query could never show. Auth user + profile + link + live consent + target.
INSERT INTO auth.users
  (id, instance_id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at,
   raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous)
VALUES
  ('6a000000-0000-4000-8000-0000000000f1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 't3.fixture.zero@sample.invalid', '',
   NULL, now(), now(),
   '{"provider":"sample","providers":["sample"]}'::jsonb,
   '{"sample":true,"purpose":"assurance fixture"}'::jsonb, false, false);

INSERT INTO public.student_profiles (id, auth_user_id, year_level, username)
VALUES ('6a000000-0000-4000-8000-0000000000f1', '6a000000-0000-4000-8000-0000000000f1', 2, 't3fixturezero')
ON CONFLICT (id) DO UPDATE SET username='t3fixturezero', year_level=2;

INSERT INTO public.tutor_student_links (id, tutor_user_id, student_id)
VALUES ('6c000000-0000-4000-8000-0000000000f5',
        '57000000-0000-4000-8000-000000000001', '6a000000-0000-4000-8000-0000000000f1');

INSERT INTO public.consent_records
  (id, student_id, tutor_user_id, purpose, granted_by, granted_at, expires_at)
VALUES ('6c000000-0000-4000-8000-0000000000f6',
        '6a000000-0000-4000-8000-0000000000f1', '57000000-0000-4000-8000-000000000001',
        'TUTOR_REPORTING',
        (SELECT parent_user_id FROM public.parent_student_links
          WHERE student_id='5a000000-0000-4000-8000-000000000003' LIMIT 1),
        now(), now() + interval '12 months');

INSERT INTO public.student_exam_targets (student_id, target_exam, exam_date, weekly_sessions_goal, updated_at)
VALUES ('6a000000-0000-4000-8000-0000000000f1', 'T3 fixture zero', current_date + 90, 3, now());

SELECT extensions.ok(
  EXISTS(SELECT 1 FROM public.tutor_at_risk()
          WHERE student_id='6a000000-0000-4000-8000-0000000000f1'
            AND at_risk_rule='LOW_ENGAGEMENT'),
  'T3-04 a consented student with ZERO attempts is visible to the rule (the structural fix)');

SELECT extensions.ok(
  EXISTS(SELECT 1 FROM public.tutor_at_risk()
          WHERE student_id='6a000000-0000-4000-8000-0000000000f1'
            AND rule_detail LIKE 'No practice session yet%'),
  'T3-05 the zero-attempt detail says "no session yet", not "0 days"');

-- "No session" means no session: a STARTED (unfinished) attempt today is
-- activity, and must clear the flag even though nothing was completed.
INSERT INTO reporting.fact_test_attempt
  (attempt_id, date_key, student_id, test_id, status, score, started_at, submitted_at, etl_loaded_at)
VALUES ('6c000000-0000-4000-8000-0000000000f7',
        to_char(current_date, 'YYYYMMDD')::int,
        '6a000000-0000-4000-8000-0000000000f1',
        '6d000000-0000-4000-8000-0000000000aa', 'IN_PROGRESS', NULL, now(), NULL, now());

SELECT extensions.is(
  (SELECT COUNT(*) FROM public.tutor_at_risk()
    WHERE student_id='6a000000-0000-4000-8000-0000000000f1'
      AND at_risk_rule='LOW_ENGAGEMENT'),
  0::bigint, 'T3-06 a started session today counts as activity (session, not completion)');

SELECT extensions.is(
  (SELECT COUNT(*) FROM public.tutor_at_risk()
    WHERE student_id='6a000000-0000-4000-8000-0000000000f1'
      AND at_risk_rule='DECLINING_TREND'),
  0::bigint, 'T3-07 zero completed attempts never fabricates a declining trend');

-- ============================================================================
-- AC-41 .. AC-52  Business-day SLA clock (migration 109, decision 1-B)
--
-- Why these are worth pinning: the calendar is now load-bearing for a
-- customer-facing promise, and its failure modes are silent. A rule that gets
-- the Christmas/Boxing Day cascade wrong, a year that is only half populated, or
-- a deadline expressed as a fixed UTC hour instead of Melbourne wall-clock time
-- would each produce a plausible number rather than an error. The two refuse
-- tests (AC-49, AC-50) are the important pair: a MISSING year is easy to notice,
-- a PARTIAL one is not, and a partial year makes the clock stricter than the
-- promise while every figure still looks sourced.
-- ============================================================================

SELECT extensions.ok(
  (SELECT COUNT(DISTINCT EXTRACT(YEAR FROM holiday_date)) = 7
     FROM reporting.dim_public_holiday_vic),
  'AC-41 the holiday calendar spans all seven seeded years 2024-2030');

SELECT extensions.ok(
  (SELECT BOOL_AND(reporting.holiday_year_is_complete(y))
     FROM generate_series(2024, 2030) AS y),
  'AC-42 every seeded year is complete against the generator that made it');

-- The case a naive "+1 for Sunday" rule gets wrong: Christmas 2027 is a Saturday,
-- so Monday the 27th belongs to Christmas and Boxing Day slips to Tuesday 28th.
SELECT extensions.is(
  (SELECT COUNT(*) FROM reporting.dim_public_holiday_vic
    WHERE holiday_date IN (DATE '2027-12-27', DATE '2027-12-28')
      AND is_substitute),
  2::bigint,
  'AC-43 the 2027 Christmas/Boxing Day double substitute is both present and flagged');

-- ANZAC is the one fixed-date holiday with NO replacement day, and 2026 put it on
-- a Saturday. If a substitute appeared here the clock would gain a phantom
-- non-business day every April.
SELECT extensions.is(
  (SELECT COUNT(*) FROM reporting.dim_public_holiday_vic
    WHERE name = 'ANZAC Day' AND is_substitute),
  0::bigint,
  'AC-44 ANZAC Day never generates a substitute, in any seeded year');

-- The deadline must be a wall-clock time in Melbourne, not a fixed UTC hour:
-- AEST is +10 and AEDT is +11, so a naive implementation is an hour wrong for
-- half the year and nobody would notice in a queue that only ever shows "late".
SELECT extensions.ok(
  (SELECT BOOL_AND(to_char(x.d AT TIME ZONE 'Australia/Melbourne', 'HH24:MI') = '23:59')
     FROM (VALUES (timestamptz '2027-06-10 10:00:00+10'),   -- winter, AEST +10
                  (timestamptz '2026-12-08 10:00:00+11')    -- summer, AEDT +11
            ) AS m(t)
     CROSS JOIN LATERAL (SELECT reporting.business_day_deadline(m.t) AS d) AS x
    WHERE x.d IS NOT NULL),
  'AC-45 the deadline is close of business in Melbourne across both DST states');

SELECT extensions.is(
  (SELECT to_char(reporting.business_day_deadline(timestamptz '2026-11-02 14:00:00+11')
                    AT TIME ZONE 'Australia/Melbourne', 'YYYY-MM-DD Dy')),
  '2026-11-04 Wed',
  'AC-46 a deadline skips Melbourne Cup Day, not just the weekend');

-- Property test: whatever day you start from, the deadline itself always lands on
-- a business day. One bad rule (say the Cup misfiled as a Saturday) would show up
-- here rather than in a single hand-picked example.
SELECT extensions.ok(
  (SELECT BOOL_AND(
      EXTRACT(ISODOW FROM d AT TIME ZONE 'Australia/Melbourne') <= 5
      AND NOT EXISTS (SELECT 1 FROM reporting.dim_public_holiday_vic h
                       WHERE h.holiday_date = (d AT TIME ZONE 'Australia/Melbourne')::date))
     FROM (SELECT reporting.business_day_deadline(
              ((base)::date + TIME '09:00') AT TIME ZONE 'Australia/Melbourne') AS d
           FROM (SELECT generate_series(DATE '2026-01-01', DATE '2026-12-31', INTERVAL '1 day')::date AS base) b
          ) x WHERE d IS NOT NULL),
  'AC-47 every 2026 deadline lands on a real business day (365-day property test)');

SELECT extensions.ok(
  (SELECT BOOL_AND((d AT TIME ZONE 'Australia/Melbourne')::date > base)
     FROM (SELECT base, reporting.business_day_deadline(
              (base + TIME '09:00') AT TIME ZONE 'Australia/Melbourne') AS d
           FROM (SELECT generate_series(DATE '2026-01-01', DATE '2026-12-31', INTERVAL '1 day')::date AS base) b
          ) x WHERE d IS NOT NULL),
  'AC-48 the day of receipt never counts: the deadline is always a later date');

-- Refuse, do not guess. This is the whole point of the unknown_calendar state.
SELECT extensions.is(
  reporting.business_day_deadline(timestamptz '2031-03-05 10:00:00+11'),
  NULL::timestamptz,
  'AC-49 an unseeded year refuses to produce a deadline');

-- The harder half: delete ONE row from an otherwise seeded year and the clock
-- must still refuse. Without the completeness test this passes silently and every
-- figure for that year is quietly a day out.
DELETE FROM reporting.dim_public_holiday_vic WHERE holiday_date = DATE '2027-11-02';

SELECT extensions.is(
  reporting.holiday_year_is_complete(2027),
  false,
  'AC-50 a year missing a single holiday is detected as incomplete');

SELECT extensions.is(
  reporting.business_day_deadline(timestamptz '2027-11-01 10:00:00+11'),
  NULL::timestamptz,
  'AC-51 a PARTIAL year also refuses to compute, rather than running a day short');

-- Restored by the surrounding ROLLBACK, so the hosted database is untouched.
SELECT extensions.ok(
  (SELECT sla_basis = 'business' AND first_response_sla_business_days >= 1
     FROM reporting.enquiry_thresholds WHERE id = 1),
  'AC-52 the shipped basis is business days and the promise is at least one day');

-- ============================================================================
-- AC-53 .. AC-63  Conversion references (migration 110, decision 2-A)
--
-- The point of these is not that the columns exist. It is that 012's guarantee
-- survived the relaxation: converted_at used to imply a purchases row, and the
-- only reason that was acceptable is that subscription payments never create one.
-- So the tests assert both directions - the subscription conversion now lands,
-- and a timestamp pointing at nothing is STILL refused - plus the three-valued
-- logic regression that the apply-time self-test in 110 caught first time.
-- ============================================================================

-- Authorisation is by auth.uid(), and an earlier block in this suite has already
-- put a non-admin in the claims, so the queue call below would silently return
-- zero rows without this. Local to the transaction, so nothing leaks out.
SELECT set_config('request.jwt.claims',
  json_build_object(
    'sub', (SELECT user_id::text FROM public.app_user_roles WHERE role = 'ADMIN' LIMIT 1),
    'role', 'authenticated')::text, true);

-- received_at AND converted_at are both backdated deliberately: AC-61 has to be
-- able to tell "the original moment was preserved" apart from "it was stamped by
-- this run", which is impossible if the fixture starts at now().
INSERT INTO public.enquiries
  (channel, enquiry_type, status, outcome, received_at, converted_at, converted_ref, converted_ref_kind)
VALUES ('web_form','billing','closed','answered',
        now() - interval '4 days', now() - interval '3 days', 'sub_ac53', 'subscription');

SELECT extensions.is(
  (SELECT converted_ref_kind FROM public.enquiries WHERE converted_ref = 'sub_ac53'),
  'subscription'::text,
  'AC-53 a subscription conversion is stored: the row 012 rejected by CHECK');

SELECT extensions.is(
  (SELECT COUNT(*)::bigint FROM public.admin_enquiry_queue(NULL,NULL,false,200,0)
    WHERE converted AND converted_ref = 'sub_ac53'),
  1::bigint,
  'AC-54 the queue sees the reference path, not only the purchases foreign key');

-- The five refusals are asserted by SQLSTATE *and* constraint name, captured in
-- one probe pass, rather than by pgtap's throws_ok. This pgtap build has
-- throws_ok(text,text,text) whose middle argument is the expected message, not
-- the SQLSTATE, so the obvious call "failed" five times while the constraints
-- were in fact working correctly - a test that lies in the unsafe direction. The
-- probe also distinguishes the constraints from each other: five rows all
-- rejected by *some* check would prove nothing, and enquiries has six CHECKs plus
-- the new three.
CREATE TEMP TABLE _conv_probe (tag text, p_state text, p_cons text);

DO $$
DECLARE
  p_state text;
  p_cons  text;
BEGIN
  -- AC-55: the guarantee 012 provided, which the widening must not have lost.
  BEGIN
    INSERT INTO public.enquiries (channel, enquiry_type, status, outcome, converted_at)
    VALUES ('web_form','other','closed','answered', now());
    INSERT INTO _conv_probe VALUES ('AC-55','no-exception',NULL);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS p_state = RETURNED_SQLSTATE, p_cons = CONSTRAINT_NAME;
    INSERT INTO _conv_probe VALUES ('AC-55', p_state, p_cons);
  END;

  -- AC-56: three-valued-logic regression. `converted_ref_kind IN (...)` is NULL
  -- when the kind is NULL and a CHECK treats NULL as satisfied, so the natural
  -- wording of this rule passed the exact row it was written to stop. 110's own
  -- apply-time self-test caught it; this keeps it caught.
  BEGIN
    INSERT INTO public.enquiries
      (channel, enquiry_type, status, outcome, converted_at, converted_ref, converted_ref_kind)
    VALUES ('web_form','other','closed','answered', now(), 'sub_nokind', NULL);
    INSERT INTO _conv_probe VALUES ('AC-56','no-exception',NULL);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS p_state = RETURNED_SQLSTATE, p_cons = CONSTRAINT_NAME;
    INSERT INTO _conv_probe VALUES ('AC-56', p_state, p_cons);
  END;

  BEGIN
    INSERT INTO public.enquiries
      (channel, enquiry_type, status, outcome, converted_ref, converted_ref_kind)
    VALUES ('web_form','other','closed','answered', 'sub_nowhen','subscription');
    INSERT INTO _conv_probe VALUES ('AC-57','no-exception',NULL);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS p_state = RETURNED_SQLSTATE, p_cons = CONSTRAINT_NAME;
    INSERT INTO _conv_probe VALUES ('AC-57', p_state, p_cons);
  END;

  BEGIN
    INSERT INTO public.enquiries
      (channel, enquiry_type, status, outcome, converted_at, converted_ref, converted_ref_kind)
    VALUES ('web_form','other','closed','answered', now(), '   ','invoice');
    INSERT INTO _conv_probe VALUES ('AC-58','no-exception',NULL);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS p_state = RETURNED_SQLSTATE, p_cons = CONSTRAINT_NAME;
    INSERT INTO _conv_probe VALUES ('AC-58', p_state, p_cons);
  END;

  BEGIN
    INSERT INTO public.enquiries
      (channel, enquiry_type, status, outcome, converted_at, converted_ref, converted_ref_kind)
    VALUES ('web_form','other','closed','answered', now(), 'sub_merch','merch');
    INSERT INTO _conv_probe VALUES ('AC-59','no-exception',NULL);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS p_state = RETURNED_SQLSTATE, p_cons = CONSTRAINT_NAME;
    INSERT INTO _conv_probe VALUES ('AC-59', p_state, p_cons);
  END;
END $$;

SELECT extensions.is(
  (SELECT p_state || '|' || COALESCE(p_cons,'-') FROM _conv_probe WHERE tag = 'AC-55'),
  '23514|enquiries_converted_has_order',
  'AC-55 a timestamp pointing at nothing is refused by the original constraint');

SELECT extensions.is(
  (SELECT p_state || '|' || COALESCE(p_cons,'-') FROM _conv_probe WHERE tag = 'AC-56'),
  '23514|enquiries_conversion_reference_sane',
  'AC-56 a reference with no kind is refused (NULL must not satisfy a CHECK)');

SELECT extensions.is(
  (SELECT p_state || '|' || COALESCE(p_cons,'-') FROM _conv_probe WHERE tag = 'AC-57'),
  '23514|enquiries_conversion_needs_when',
  'AC-57 a reference with no moment is refused');

SELECT extensions.is(
  (SELECT p_state || '|' || COALESCE(p_cons,'-') FROM _conv_probe WHERE tag = 'AC-58'),
  '23514|enquiries_conversion_reference_sane',
  'AC-58 a whitespace reference is refused, because the CHECK trims before measuring');

SELECT extensions.is(
  (SELECT p_state || '|' || COALESCE(p_cons,'-') FROM _conv_probe WHERE tag = 'AC-59'),
  '23514|enquiries_conversion_reference_sane',
  'AC-59 only the four declared reference kinds are accepted');

SELECT extensions.is(
  (SELECT converted_ref_kind FROM public.admin_enquiry_transition(
      (SELECT id FROM public.enquiries WHERE converted_ref = 'sub_ac53'),
      'convert', NULL, NULL, 'sub_ac60', 'invoice')),
  'invoice'::text,
  'AC-60 re-converting corrects what the row points at');

-- The timestamp belongs to the moment the family decided, not to whoever last
-- edited the field, so a correction must not move it forward. The fixture is
-- three days old; a re-stamp would land within the last minute.
SELECT extensions.ok(
  (SELECT converted_at < now() - interval '1 day'
     FROM public.enquiries WHERE converted_ref = 'sub_ac60'),
  'AC-61 a correction preserves the original conversion timestamp');

SELECT extensions.is(
  (SELECT converted_ref FROM public.admin_enquiry_transition(
      (SELECT id FROM public.enquiries WHERE converted_ref = 'sub_ac60'),
      'unconvert')),
  NULL::text,
  'AC-62 withdraw clears the reference, so a wrong entry can be undone');

SELECT extensions.is(
  (SELECT COUNT(*)::bigint FROM public.enquiries WHERE converted_ref_kind IS NOT NULL),
  0::bigint,
  'AC-63 withdraw leaves no orphan reference behind to be counted again');

-- ============================================================================
-- AC-64 .. AC-69  A13 warehouse (migrations 111/112)
--
-- The apply-time self-tests in those migrations already prove the verdict
-- partitions and that the summary and series agree. What is asserted here is the
-- set of properties a one-shot check cannot see: behaviour under update and
-- delete, the timezone the day is keyed on, and whether an unrecorded response
-- can leak into the median.
-- ============================================================================

-- REFRESH CONCURRENTLY is what the hourly cron job calls, and it requires a
-- unique index on the grain. Without one the scheduled job fails at 10 past the
-- hour and the panel silently serves yesterday - the failure DA-15 exists to
-- catch, but not the failure to be able to refresh at all.
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'reporting' AND c.relname = 'mv_enquiry_daily' AND i.indisunique),
  'AC-64 mv_enquiry_daily has the unique index REFRESH CONCURRENTLY requires');

-- Melbourne, not UTC. Received 14:00Z on 20 Nov is 01:00 on 21 Nov in AEDT
-- (UTC+11), so a UTC key would file this enquiry on the wrong day. Every hour
-- from 13:00Z onwards belongs to the following Melbourne day, which is most of a
-- normal working day in Victoria - a silently-shifted daily series, not a
-- rounding error.
INSERT INTO public.enquiries (channel, enquiry_type, status, received_at, ingest_source_ref)
VALUES ('web_form','other','new', timestamptz '2026-11-20 14:00:00+00', 'a13-tz');

-- The loader has to run before the assertion: fact_enquiry is a rebuild, not a
-- trigger-fed mirror, so a row inserted since the last load simply is not there
-- yet. (Omitting this made the first draft of AC-65 fail on an absent row and
-- report it as a timezone bug.)
SELECT reporting.load_enquiry_facts(true);

SELECT extensions.is(
  (SELECT f.date_key FROM reporting.fact_enquiry f
     JOIN public.enquiries e ON e.id = f.enquiry_id
    WHERE e.ingest_source_ref = 'a13-tz'),
  20261121,
  'AC-65 the fact day is keyed on Melbourne, not UTC');

-- The loader is a rebuild, so a triage action taken days later must be reflected.
-- An incremental-on-received_at design would have frozen this row at 'new'.
UPDATE public.enquiries
   SET status = 'resolved', outcome = 'answered', resolved_at = now(),
       first_response_at = now() - interval '1 hour'
 WHERE ingest_source_ref = 'a13-tz';
SELECT reporting.load_enquiry_facts(true);

SELECT extensions.is(
  (SELECT f.status FROM reporting.fact_enquiry f
     JOIN public.enquiries e ON e.id = f.enquiry_id
    WHERE e.ingest_source_ref = 'a13-tz'),
  'resolved'::text,
  'AC-66 a later status change is reflected, not frozen at first load');

-- Privacy: an enquiry deleted upstream must not persist in the warehouse.
DELETE FROM public.enquiries WHERE ingest_source_ref = 'a13-tz';

SELECT extensions.is(
  (SELECT COUNT(*)::bigint FROM reporting.fact_enquiry f
     LEFT JOIN public.enquiries e ON e.id = f.enquiry_id
    WHERE e.id IS NULL),
  0::bigint,
  'AC-67 no warehouse row outlives its enquiry');

-- The honesty property the whole report rests on: an enquiry closed with no
-- recorded response must contribute nothing to the median, because treating the
-- admin's click as the answer time would report invented speed as real speed.
INSERT INTO public.enquiries
  (channel, enquiry_type, status, outcome, received_at, resolved_at, ingest_source_ref)
VALUES ('web_form','billing','resolved','answered',
        now() - interval '20 days', now(), 'a13-silent');
SELECT reporting.load_enquiry_facts(true);

SELECT extensions.is(
  (SELECT first_response_minutes FROM reporting.fact_enquiry f
     JOIN public.enquiries e ON e.id = f.enquiry_id
    WHERE e.ingest_source_ref = 'a13-silent'),
  NULL::integer,
  'AC-68 an unrecorded response stays NULL rather than becoming a fast answer');

SELECT extensions.is(
  (SELECT response_recorded::int FROM reporting.fact_enquiry f
     JOIN public.enquiries e ON e.id = f.enquiry_id
    WHERE e.ingest_source_ref = 'a13-silent'),
  0,
  'AC-69 the unrecorded population is identifiable separately from slow');

-- ============================================================================
-- AC-70 .. AC-74  Inbound email capture, shipped dark (migration 114)
--
-- Decision 3-A's entire claim is "built, and off". Two things can be wrong about
-- that claim and both look like success in a review: the table is readable when
-- it should not be, or the switch defaults to on. These assert both, plus the
-- retry property that stops a provider's redelivery becoming duplicate support
-- history.
-- ============================================================================

SELECT extensions.is(
  (SELECT inbound_email_enabled FROM reporting.enquiry_thresholds WHERE id = 1),
  false,
  'AC-70 inbound capture is OFF by default - the whole content of decision 3-A');

-- Force-enabled and no policies means every app role sees nothing, including the
-- owner of the mailbox. Checked as posture rather than by attempting a read,
-- because the read would be permitted to this superuser session and prove little.
SELECT extensions.is(
  (SELECT c.relrowsecurity::text || '/' || c.relforcerowsecurity::text || '/' ||
          (SELECT count(*)::int FROM pg_policies p
            WHERE p.schemaname = 'public' AND p.tablename = 'inbound_email_messages')
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'inbound_email_messages'),
  'true/true/0',
  'AC-71 captured mail is unreadable to every app role (forced RLS, zero policies)');

-- A provider retry must not become a second enquiry-shaped row.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
UPDATE reporting.enquiry_thresholds SET inbound_email_enabled = true WHERE id = 1;

SELECT extensions.is(
  (SELECT reason FROM public.record_inbound_email('ac72','p@e.invalid','s@e.invalid')),
  'stored'::text,
  'AC-72a the first delivery is stored');

SELECT extensions.is(
  (SELECT count(*)::int FROM public.inbound_email_messages
    WHERE provider_message_id = 'ac72'),
  1,
  'AC-72b and only once');

SELECT extensions.is(
  (SELECT reason FROM public.record_inbound_email(
     'ac72','p@e.invalid','s@e.invalid','Again', now(), '{}'::jsonb)),
  'duplicate'::text,
  'AC-72c a redelivery is reported as a duplicate, not a new message');

-- The CHECK that keeps 'converted' honest: 110's lesson applied to the next
-- table rather than relearned by it.
SELECT extensions.is(
  (SELECT count(*)::int FROM pg_constraint
    WHERE conrelid = 'public.inbound_email_messages'::regclass
      AND conname = 'inbound_email_converted_has_enquiry'),
  1,
  'AC-73 a row cannot claim conversion without pointing at an enquiry');

-- Back to dark, and assert it: this suite rolls back, but the intent is that
-- nothing else run after it finds capture enabled.
UPDATE reporting.enquiry_thresholds SET inbound_email_enabled = false WHERE id = 1;
DELETE FROM public.inbound_email_messages;
SELECT set_config('request.jwt.claims', '{}', true);

SELECT extensions.is(
  (SELECT inbound_email_enabled FROM reporting.enquiry_thresholds WHERE id = 1),
  false,
  'AC-74 the probe left capture disabled again');

-- ============================================================================
-- AC-35 .. AC-39  Contact privacy and audit (Phase D, backlog item 21)
--
-- These were listed as outstanding and were genuinely absent: the suite asserted
-- privileges for other objects but never for the one table that holds a parent's
-- phone number. Two notes on the roadmap while writing them:
--   * AC-37 names `admin_access_audit`. No such table exists. The real one is
--     public.enquiry_contact_access_log, asserted here by its actual name rather
--     than corrected in prose nobody executes.
--   * AC-35/36/38 are asserted through role-level privilege functions rather than
--     by SET ROLE and attempting the statement. Both are valid; the privilege
--     form was chosen because it reports *which* grant is wrong instead of
--     failing on the first denied statement, which is what makes it useful at 3am.
-- ============================================================================

-- The restricted table must not be readable by any app role. If this ever fails,
-- the audited function is no longer the only door and every access becomes
-- unaudited by construction.
SELECT extensions.is(
  has_table_privilege('authenticated', 'public.enquiry_contacts', 'SELECT'),
  false,
  'AC-35a authenticated cannot read enquiry_contacts directly');
SELECT extensions.is(
  has_table_privilege('anon', 'public.enquiry_contacts', 'SELECT'),
  false,
  'AC-35b anon cannot read enquiry_contacts directly');

-- Access must leave evidence. A reveal that is not logged is indistinguishable
-- from a leak, and the log is the only thing that makes the promise reviewable.
INSERT INTO public.enquiries (channel, enquiry_type, status, ingest_source_ref, received_at)
VALUES ('web_form','billing','new','ac36', now() - interval '2 hours');

INSERT INTO public.enquiry_contacts (enquiry_id, full_name, email, phone, message_body)
SELECT id, 'Test Family', 'ac36@example.invalid', '0400000000',
       'Please contact me about the yearly plan.'
FROM public.enquiries WHERE ingest_source_ref = 'ac36';

SELECT set_config('request.jwt.claims',
  json_build_object(
    'sub', (SELECT user_id::text FROM public.app_user_roles WHERE role = 'ADMIN' LIMIT 1),
    'role', 'authenticated')::text, true);

SELECT extensions.is(
  (SELECT email FROM public.read_enquiry_contact(
      (SELECT id FROM public.enquiries WHERE ingest_source_ref = 'ac36'),
      'Answering a billing question about the yearly plan.')),
  'ac36@example.invalid'::text,
  'AC-36a an admin with a stated reason can read the contact');

SELECT extensions.is(
  (SELECT count(*)::int FROM public.enquiry_contact_access_log
    WHERE enquiry_id = (SELECT id FROM public.enquiries WHERE ingest_source_ref = 'ac36')),
  1,
  'AC-36b exactly one audit row per reveal, not zero and not two');

SELECT extensions.is(
  (SELECT task_reason IS NOT NULL AND admin_user_id IS NOT NULL
     FROM public.enquiry_contact_access_log
    WHERE enquiry_id = (SELECT id FROM public.enquiries WHERE ingest_source_ref = 'ac36')),
  true,
  'AC-36c the audit row names who asked and why');

-- Append-only: an audit trail that can be edited is not an audit trail.
SELECT extensions.is(
  (SELECT count(*)::int FROM (
     SELECT unnest(ARRAY['anon','authenticated','service_role','reporting_ro']) AS r
   ) x WHERE has_table_privilege(x.r, 'public.enquiry_contact_access_log', 'UPDATE')
          OR has_table_privilege(x.r, 'public.enquiry_contact_access_log', 'DELETE')),
  0,
  'AC-37 no app role may update or delete the access log');

-- AC-38 extended to everything added by this backlog item.
--
-- The policy is not "nothing is executable by app roles" - admin_enquiry_summary,
-- admin_enquiry_series and readiness_skill_exam_map are granted to authenticated
-- on purpose and self-gate on has_role('ADMIN') inside. So this is stated as two
-- real claims: nothing here is reachable anonymously, and the two that must be
-- service-role-only are exactly that. Written as named offenders rather than a
-- count, because "3 functions leaked" tells you nothing at 3am and
-- "record_inbound_email leaked" tells you which grant to revert.
SELECT extensions.is(
  (SELECT string_agg(f, ', ') FROM (
     SELECT unnest(ARRAY[
       'public.admin_enquiry_summary(integer,text,text)',
       'public.admin_enquiry_series(integer,text,text)',
       'public.admin_enquiry_queue(text,text,boolean,integer,integer)',
       'public.admin_enquiry_counts()',
       'public.admin_enquiry_transition(uuid,text,text,uuid,text,text)',
       'public.readiness_skill_exam_map()',
       'public.record_inbound_email(text,text,text,text,timestamptz,jsonb)'
     ]) AS f
   ) y WHERE has_function_privilege('anon', y.f, 'EXECUTE')),
  NULL::text,
  'AC-38a nothing added by item 21 is executable anonymously');

SELECT extensions.is(
  has_function_privilege('authenticated',
    'public.record_inbound_email(text,text,text,text,timestamptz,jsonb)', 'EXECUTE'),
  false,
  'AC-38b inbound capture is executable by the service role and nobody else');

-- A non-admin asking for a parent's phone number must be refused, not silently
-- answered with an empty record: an empty result and a denial look identical to
-- the caller and mean opposite things.
SELECT set_config('request.jwt.claims',
  json_build_object(
    'sub', (SELECT u.user_id::text FROM public.app_user_roles u
             WHERE u.role <> 'ADMIN' LIMIT 1),
    'role', 'authenticated')::text, true);

-- read_enquiry_contact raises 'not authorised' before touching the log, which is
-- what makes AC-40 true: the refusal path cannot leave a trace that looks like an
-- access. Probed via RETURNED_SQLSTATE rather than pgtap's throws_ok, because this
-- build resolves throws_ok(call, text, text) as (call, sqlstate, MESSAGE) - so the
-- description lands in the slot compared against the error text and a correctly
-- refusing function reports as a failure. Same reason AC-55..AC-59 are probes.
CREATE TEMP TABLE _reveal_probe (p_state text, p_msg text);

DO $$
DECLARE
  p_state text;
  p_msg   text;
BEGIN
  BEGIN
    PERFORM email FROM public.read_enquiry_contact(
      (SELECT id FROM public.enquiries WHERE ingest_source_ref = 'ac36'),
      'Answering a billing question.');
    INSERT INTO _reveal_probe VALUES ('no-exception', NULL);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS p_state = RETURNED_SQLSTATE, p_msg = MESSAGE_TEXT;
    INSERT INTO _reveal_probe VALUES (p_state, p_msg);
  END;
END $$;

SELECT extensions.is(
  (SELECT p_state FROM _reveal_probe),
  'P0001'::text,
  'AC-39a a non-admin reveal attempt is refused outright');

SELECT extensions.is(
  (SELECT p_msg FROM _reveal_probe),
  'not authorised'::text,
  'AC-39b and the refusal says so, rather than returning an empty row');

SELECT extensions.is(
  (SELECT count(*)::int FROM public.enquiry_contact_access_log
    WHERE enquiry_id = (SELECT id FROM public.enquiries WHERE ingest_source_ref = 'ac36')),
  1,
  'AC-40 a refused reveal adds no audit row, so the log count stays truthful');

-- PR-02: no object in the reporting schema may reach the restricted contact
-- table. The warehouse is readable by a reporting role with its own grants; if a
-- view ever joined enquiry_contacts into it, the audited door would become
-- decorative while every privacy claim in 12-...md still read as true.
SELECT extensions.is(
  (SELECT string_agg(p.proname, ', ')
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'reporting'
      -- prokind filter: pg_get_functiondef errors on aggregates ("array_agg is
      -- an aggregate function"), and this suite is not the place to discover a
      -- scan breaks because the schema gained a custom aggregate.
      AND p.prokind = 'f'
      AND pg_get_functiondef(p.oid) ILIKE '%enquiry_contacts%'),
  NULL::text,
  'PR-02a no reporting function reads enquiry_contacts');

SELECT extensions.is(
  (SELECT string_agg(c.relname, ', ')
     FROM pg_depend d
     JOIN pg_rewrite r ON r.oid = d.objid
     JOIN pg_class c ON c.oid = r.ev_class
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'reporting'
      AND d.refclassid = 'pg_class'::regclass
      AND d.refobjid = 'public.enquiry_contacts'::regclass
      AND c.relkind IN ('v','m')),
  NULL::text,
  'PR-02b no reporting view or materialised view depends on enquiry_contacts');

-- ============================================================================
-- AC-75 .. AC-76  The read-only role must stay read-only (migration 116)
--
-- 111 granted EXECUTE on load_enquiry_facts to `reporting_ro`. Because the
-- function is SECURITY DEFINER and postgres-owned, that let a role with no write
-- privilege on any table truncate and rebuild the warehouse - the grant bypassed
-- the very privilege model the role exists to enforce. Measured afterwards: the
-- other five reporting loaders all return false, so this was never the house
-- pattern, it was assumed to be.
--
-- Asserted as a scan over every load_* rather than by naming this function, so
-- the next fact table added with the same well-meaning grant fails here.
-- ============================================================================

SELECT extensions.is(
  (SELECT string_agg(p.proname, ', ' ORDER BY p.proname)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'reporting'
      AND p.prokind = 'f'
      AND p.proname LIKE 'load\_%'
      AND has_function_privilege('reporting_ro', p.oid::regprocedure, 'EXECUTE')),
  NULL::text,
  'AC-75 no reporting loader is executable by the read-only role');

-- Hardening that breaks the pipeline is not hardening. Both the owner and the
-- scheduled job must still be able to do the work.
SELECT extensions.is(
  has_function_privilege('postgres', 'reporting.load_enquiry_facts(boolean)', 'EXECUTE'),
  true,
  'AC-76a the ETL owner can still load enquiry facts');

SELECT extensions.is(
  (SELECT count(*)::int FROM cron.job
    WHERE jobname = 'rpt-enquiry-daily' AND command LIKE '%load_enquiry_facts%'),
  1,
  'AC-76b the hourly job that calls it is unchanged');

-- ============================================================================
-- AC-77  The ACL capture describes the schema that actually exists
--
-- 117 exists because supabase/reset/10_reporting_function_acls.sql was generated
-- once by hand and never regenerated, so every reporting function added since
-- (including 111's loader) was left PUBLIC-executable on a restored database
-- while live looked correctly locked down. Live-state checks cannot see that
-- class of problem at all - the defect only exists on the machine rebuilt from
-- the backup - so the assertion compares the CAPTURE against live rather than
-- trusting that someone remembered to run it.
-- ============================================================================

SELECT extensions.is(
  (SELECT count(*) FROM (
     SELECT unnest(string_to_array(reporting.export_baseline_function_acls(), E'\n')) AS line
   ) x WHERE x.line LIKE 'REVOKE ALL ON FUNCTION%') >= (
     SELECT count(*)::bigint FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'reporting' AND p.prokind = 'f'
        AND p.proname NOT LIKE 'export\_%'
   ),
  true,
  'AC-77 the generated ACL script covers at least as many functions as live has');

SELECT extensions.ok(
  (SELECT position('load_enquiry_facts' IN reporting.export_baseline_function_acls()) > 0),
  'AC-78 the function whose grant drift motivated 117 is present in the capture');

SELECT extensions.ok(
  (SELECT position('reporting.' IN reporting.export_baseline_function_acls()) > 0),
  'AC-79 signatures are schema-qualified, not left to the restore search_path');

SELECT * FROM extensions.finish();

ROLLBACK;


