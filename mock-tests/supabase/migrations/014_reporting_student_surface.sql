-- ============================================================================
-- 014_reporting_student_surface.sql
-- Reports S1 (exam countdown) and S2 (daily practice target), plus
-- v_student_today - the ONLY reporting object a student may read - and the
-- refresh schedule.
--
-- Depends on: 013_reporting_foundation, 011 (funnel_events, student_exam_targets),
--             004 (is_student_self / is_parent_of / has_role).
--
-- ---------------------------------------------------------------------------
-- CORRECTION FOUND WHILE IMPLEMENTING. This changes the design document.
-- ---------------------------------------------------------------------------
-- PostgreSQL does NOT support row-level security on MATERIALIZED VIEWS:
--   ERROR: ALTER action ENABLE ROW SECURITY cannot be performed on relation
--          "mv_student_countdown"
--   DETAIL: This operation is not supported for materialized views.
-- and CREATE POLICY requires a table, so a policy cannot be attached to a plain
-- view either. 12-bi-reporting-data-model.md §9.3/§9.5 assumed both were possible.
--
-- The access model that actually works, implemented below:
--   1. MVs are protected by GRANT alone. SELECT goes to reporting_ro and is
--      revoked from PUBLIC, anon and authenticated.
--   2. Row filtering lives in the VIEW's WHERE clause using auth.uid()-based
--      predicates (is_student_self / is_parent_of / has_role). auth.uid() reads
--      the request.jwt.claims GUC, so it evaluates against the CALLER even though
--      the view is owned by postgres.
--   3. A browser cannot escalate into reporting_ro: browser clients reach Postgres
--      through PostgREST, which exposes relations over REST and cannot execute
--      SET ROLE or arbitrary SQL. Only server code holding a direct connection
--      string can SET LOCAL ROLE reporting_ro.
--
-- See also 016_reporting_role_non_inherited.sql, which closes a second hole found
-- immediately after this migration: a plain `GRANT reporting_ro TO authenticated`
-- is INHERITED, which handed every signed-in user reporting_ro's SELECT rights.
--
-- THE STUDENT RULE THIS ENFORCES
--   v_student_today's columns are: student_id, exam_label, exam_date,
--   days_to_exam, exam_passed, daily_target_units, unit_kind.
--   No score, percentage, percentile, rank, band, correctness or mastery field.
--   mv_student_daily_target DOES compute `required_daily` and `plan_overload_flag`,
--   but the view does not select them - so even a predicate bug cannot show a child
--   their own overload figure (conflict X-5, rule B7).
--
-- Idempotent: safe to re-run.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- S1: exam countdown. Contains NO score column of any kind.
CREATE MATERIALIZED VIEW IF NOT EXISTS reporting.mv_student_countdown AS
SELECT ds.student_key, ds.student_id, ds.pseudonym,
       dp.target_exam AS exam_label, dp.exam_date,
       GREATEST(0, dp.exam_date - (now() AT TIME ZONE 'Australia/Melbourne')::date) AS days_to_exam,
       (dp.exam_date < (now() AT TIME ZONE 'Australia/Melbourne')::date)            AS exam_passed
FROM reporting.dim_practice_plan dp
JOIN reporting.dim_student ds ON ds.student_key = dp.student_key AND ds.is_current
WHERE dp.is_current AND dp.exam_date IS NOT NULL;

-- REQUIRED for REFRESH ... CONCURRENTLY (test DA-17). Without it the statement
-- errors and someone quietly drops CONCURRENTLY, reintroducing blocking locks.
CREATE UNIQUE INDEX IF NOT EXISTS ux_mv_student_countdown
  ON reporting.mv_student_countdown (student_key);

-- ----------------------------------------------------------------------------
-- S2: daily practice target.
--   remaining_units / remaining_days, after excluding planned rest days, then
--   capped by year level. THE CAP ALWAYS WINS. Overload goes to the parent, never
--   to the child.
-- ----------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS reporting.mv_student_daily_target AS
WITH done AS (
  SELECT ds.student_key, COUNT(*) AS units_completed
  FROM public.funnel_events fe
  JOIN reporting.dim_student ds ON ds.student_id = fe.student_id AND ds.is_current
  WHERE fe.event IN ('TEST_SUBMITTED','DIAGNOSTIC_COMPLETED','SECOND_SESSION_COMPLETED')
  GROUP BY ds.student_key
),
rest AS (
  SELECT ds.student_key, COUNT(*) AS rest_days_remaining
  FROM public.practice_rest_days r
  JOIN reporting.dim_student ds ON ds.student_id = r.student_id AND ds.is_current
  WHERE r.rest_date > (now() AT TIME ZONE 'Australia/Melbourne')::date
  GROUP BY ds.student_key
),
calc AS (
  SELECT dp.plan_key, dp.student_key, dp.unit_kind, dp.weekly_sessions_goal,
         GREATEST(0, dp.total_planned_units - COALESCE(d.units_completed,0)) AS remaining_units,
         GREATEST(0, (dp.exam_date - (now() AT TIME ZONE 'Australia/Melbourne')::date)
                     - COALESCE(r.rest_days_remaining,0))                   AS remaining_days
  FROM reporting.dim_practice_plan dp
  LEFT JOIN done d ON d.student_key = dp.student_key
  LEFT JOIN rest r ON r.student_key = dp.student_key
  WHERE dp.is_current AND dp.exam_date IS NOT NULL
)
SELECT c.plan_key, c.student_key, c.unit_kind, c.remaining_units, c.remaining_days,
  CASE WHEN c.remaining_days <= 0 THEN 0
       ELSE CEIL(c.remaining_units::numeric / c.remaining_days) END AS required_daily,
  -- A NULL cap (question Q-4 unanswered) falls back to weekly_sessions_goal/7
  -- rather than leaving the target uncapped. Assumption A-11.
  LEAST(
    CASE WHEN c.remaining_days <= 0 THEN 0
         ELSE CEIL(c.remaining_units::numeric / c.remaining_days) END,
    COALESCE(CASE WHEN c.unit_kind = 'tests'     THEN cap.max_tests_per_day
                  WHEN c.unit_kind = 'questions' THEN cap.max_questions_per_day END,
             CEIL(c.weekly_sessions_goal::numeric / 7))
  )::int AS daily_target_units,
  -- PARENT-FACING ONLY. Never selected by v_student_today.
  (c.remaining_days > 0
   AND CEIL(c.remaining_units::numeric / c.remaining_days) >
       COALESCE(CASE WHEN c.unit_kind='tests' THEN cap.max_tests_per_day
                     ELSE cap.max_questions_per_day END, 2147483647)
  ) AS plan_overload_flag
FROM calc c
JOIN reporting.dim_student ds ON ds.student_key = c.student_key AND ds.is_current
LEFT JOIN reporting.dim_year_level_cap cap ON cap.year_level = ds.year_level;

CREATE UNIQUE INDEX IF NOT EXISTS ux_mv_student_daily_target
  ON reporting.mv_student_daily_target (student_key);

-- ----------------------------------------------------------------------------
-- THE ONLY reporting object a student may read. Row filtering is in the WHERE
-- clause because policies cannot be attached to a view. required_daily and
-- plan_overload_flag are deliberately NOT selected.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW reporting.v_student_today AS
SELECT ds.student_id,
       c.exam_label, c.exam_date, c.days_to_exam, c.exam_passed,
       t.daily_target_units, t.unit_kind
FROM reporting.dim_student ds
LEFT JOIN reporting.mv_student_countdown    c ON c.student_key = ds.student_key
LEFT JOIN reporting.mv_student_daily_target t ON t.student_key = ds.student_key
WHERE ds.is_current
  AND (public.is_student_self(ds.student_id)
    OR public.is_parent_of(ds.student_id)
    OR public.has_role('ADMIN'));

-- Grants: reporting_ro ONLY. Revoked from PUBLIC/anon/authenticated so a browser
-- (PostgREST) cannot select an MV directly and bypass the view's filtering.
REVOKE ALL ON ALL TABLES IN SCHEMA reporting FROM PUBLIC, anon, authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO reporting_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA reporting REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA reporting GRANT SELECT ON TABLES TO reporting_ro;

-- RLS on the base TABLES in reporting (the dimensions). MVs cannot have RLS;
-- tables can, and FORCE stops the owner bypassing its own policies.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'reporting' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE reporting.%I ENABLE ROW LEVEL SECURITY', r.relname);
    EXECUTE format('ALTER TABLE reporting.%I FORCE ROW LEVEL SECURITY', r.relname);
  END LOOP;
END $$;

-- cron.schedule takes UTC; Melbourne is UTC+10 (AEST) or +11 (AEDT), so local time
-- drifts with daylight saving. The blackout guard makes that safe: a schedule that
-- drifts into a peak window is skipped and logged, not run.
SELECT cron.schedule('rpt-load-student-dims', '45 17 * * *',
  $$SELECT reporting.load_student_dims()$$);
SELECT cron.schedule('rpt-student-daily', '0 18 * * *',
  $$SELECT reporting.safe_refresh('reporting.mv_student_countdown', true),
           reporting.safe_refresh('reporting.mv_student_daily_target', true)$$);

COMMENT ON VIEW reporting.v_student_today IS
  'The ONLY reporting object readable by the STUDENT role. Its column list contains no score, percentage, percentile, rank, band, correctness or mastery field, and it omits required_daily and plan_overload_flag so the overload figure can never reach a child. Row filtering is in the WHERE clause because PostgreSQL supports neither policies on views nor RLS on materialized views.';
COMMENT ON MATERIALIZED VIEW reporting.mv_student_daily_target IS
  'S2. Contains required_daily and plan_overload_flag, which are PARENT-FACING ONLY and are never selected by v_student_today. SELECT is granted to reporting_ro and revoked from authenticated/anon, so a browser cannot read it directly.';
