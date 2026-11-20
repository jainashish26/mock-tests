-- 108_daily_target_clamp_policy.sql
-- Decision 4-A follow-up, answered 2026-11-20: a per-year-level toggle for what
-- clamps a child's daily target, DEFAULTING TO THE RECOMMENDED TARGET.
--
-- WHY THIS MIGRATION EXISTS AT ALL
--   Seeding the ceilings (107) did not just configure a limit - it changed one,
--   because `mv_student_daily_target` clamps `daily_target_units` to the ceiling
--   column. With the caps NULL since migration 013, the fallback
--   `2 * ceil(weekly_sessions_goal / 7)` had been quietly acting as the clamp, at
--   roughly 2 for a normal plan. Populating Year 2 with 10 therefore raised what a
--   behind-plan seven-year-old can be told to do from ~2 to 10 full papers in a
--   day. The recommended target - the number that actually reads as advice - was
--   stored beside it and enforced nothing.
--
-- THE POLICY, AND WHY THE TWO NUMBERS STILL BOTH MATTER
--   `daily_target_basis` selects the clamp:
--     'recommended' (default) - clamp to the recommended target.
--     'ceiling'               - clamp to the ceiling (rule B7 as originally read).
--   `plan_overload_flag` is measured against the CEILING in both cases, never
--   against the clamp. This is the part that matters most: with the clamp set to
--   the recommended target, `required_daily > clamp` would fire for almost every
--   child who is merely a little behind, so the parent's plan-adjustment notice
--   would become background noise and the genuinely infeasible plans - the ones
--   needing more than the system's absolute bound - would be indistinguishable
--   from the ordinary ones. An alert that fires constantly is an alert nobody
--   reads, which is a worse outcome than no alert.
--
-- WHY `overload_ceiling` IS EXPOSED RATHER THAN KEPT INTERNAL
--   Because the clamp and the backstop can now differ, any surface showing
--   "today: 2 tests" needs to be able to say "...and the plan needs 7, which is
--   still inside the ceiling of 10". Without the second number visible, a parent
--   sees a target slipping further behind with no way to tell "recovered by
--   exam day" from "impossible". `effective_cap` stays the clamp so existing
--   consumers (`evaluate_daily_targets`, `parent_plan_get`, `v_student_today`)
--   keep working unchanged.
--
-- WHY THE VIEW AND INDEX ARE RECREATED VERBATIM, FROM THE LIVE DATABASE
--   `mv_student_daily_target` has a dependent: `reporting.v_student_today`, the
--   ONLY reporting object a student role can read, whose safety lies entirely in
--   which columns it omits (no score, no `required_daily`, no `plan_overload_flag`
--   - see 013/014). Redefining the MV means dropping that view, so its definition,
--   its ACL, the MV's unique index (which `REFRESH ... CONCURRENTLY` requires) and
--   both grants are restated here exactly as captured from the running database
--   rather than retyped from the migration files.
--
--   Those files are not a reliable source for this object, and that is worth
--   stating plainly: migration 014 wraps the MV in `CREATE MATERIALIZED VIEW IF
--   NOT EXISTS`, and 013 had already created it - so 014's definition never
--   executed. Both 013 and 014 describe an overload bound of `2147483647` and a
--   fallback of `ceil(weekly/7)`; the live object uses `2 * ceil(weekly/7)` and a
--   shared `effective_cap`, text that appears in NO local migration. It came from
--   hosted migration 025, which exists only in the database. Anyone reading 014
--   to understand S2 is reading something that never ran.

-- ─── 1. The policy column ───────────────────────────────────────────────────
ALTER TABLE reporting.dim_year_level_cap
  ADD COLUMN IF NOT EXISTS daily_target_basis text
    NOT NULL DEFAULT 'recommended'
    CONSTRAINT dim_year_level_cap_basis_known
    CHECK (daily_target_basis IN ('recommended', 'ceiling'));

COMMENT ON COLUMN reporting.dim_year_level_cap.daily_target_basis IS
  'Which limit clamps a student''s daily target for this year level (decision 4-A follow-up, migration 108): ''recommended'' (default - the advisory target) or ''ceiling'' (rule B7 as originally written). plan_overload_flag is measured against the ceiling either way, so switching this to ''recommended'' does not soften the overload alert. Read by reporting.mv_student_daily_target.';

-- ─── 2. Drop the dependent view, then the MV ────────────────────────────────
-- Not CASCADE: an explicit list of what is being removed, so an object nobody
-- thought about cannot be quietly taken down with them. `v_student_today` is the
-- only dependent (verified against pg_depend before writing this), and it is
-- recreated immediately below from its captured live definition.
DROP VIEW IF EXISTS reporting.v_student_today;
DROP MATERIALIZED VIEW IF EXISTS reporting.mv_student_daily_target;

-- ─── 3. The MV, with the clamp policy applied ───────────────────────────────
-- Every relation is schema-qualified deliberately. The definition being replaced
-- referred to `funnel_events` and `practice_rest_days` unqualified and resolved
-- them through whatever search_path was in force at creation time; persisting that
-- in an object that is re-created on restore is a way for a later schema change to
-- silently redirect a student-facing calculation.
CREATE MATERIALIZED VIEW reporting.mv_student_daily_target AS
 WITH done AS (
         SELECT ds.student_key,
            count(*) AS units_completed
           FROM public.funnel_events fe
             JOIN reporting.dim_student ds ON ds.student_id = fe.student_id AND ds.is_current
          WHERE fe.event = ANY (ARRAY['TEST_SUBMITTED'::text, 'DIAGNOSTIC_COMPLETED'::text, 'SECOND_SESSION_COMPLETED'::text])
          GROUP BY ds.student_key
        ), rest AS (
         SELECT ds.student_key,
            count(*) AS rest_days_remaining
           FROM public.practice_rest_days prd
             JOIN reporting.dim_student ds ON ds.student_id = prd.student_id AND ds.is_current
          WHERE prd.rest_date > (now() AT TIME ZONE 'Australia/Melbourne'::text)::date
          GROUP BY ds.student_key
        ), calc AS (
         SELECT dp.plan_key,
            dp.student_key,
            dp.unit_kind,
            dp.weekly_sessions_goal,
            GREATEST(0::bigint, dp.total_planned_units - COALESCE(d.units_completed, 0::bigint)) AS remaining_units,
            GREATEST(0::bigint, dp.exam_date - (now() AT TIME ZONE 'Australia/Melbourne'::text)::date - COALESCE(r.rest_days_remaining, 0::bigint)) AS remaining_days
           FROM reporting.dim_practice_plan dp
             LEFT JOIN done d ON d.student_key = dp.student_key
             LEFT JOIN rest r ON r.student_key = dp.student_key
          WHERE dp.is_current AND dp.exam_date IS NOT NULL
        ), capped AS (
         SELECT c.plan_key,
            c.student_key,
            c.unit_kind,
            c.remaining_units,
            c.remaining_days,
                CASE
                    WHEN c.remaining_days <= 0 THEN 0::numeric
                    ELSE ceil(c.remaining_units::numeric / c.remaining_days::numeric)
                END AS required_daily,
            -- THE CLAMP. Which column it comes from is the operator's per-year
            -- choice; the fallback only applies when no cap row exists for the
            -- year level at all, which 107 made impossible for years 2-9.
            COALESCE(
                CASE
                    WHEN c.unit_kind = 'tests' AND cap.daily_target_basis = 'ceiling'     THEN cap.max_tests_per_day::numeric
                    WHEN c.unit_kind = 'tests'                                            THEN cap.recommended_tests_per_day::numeric
                    WHEN c.unit_kind = 'questions' AND cap.daily_target_basis = 'ceiling' THEN cap.max_questions_per_day::numeric
                    WHEN c.unit_kind = 'questions'                                        THEN cap.recommended_questions_per_day::numeric
                    ELSE NULL::numeric
                END,
                2::numeric * ceil(c.weekly_sessions_goal::numeric / 7::numeric)
            )::integer AS effective_cap,
            -- THE BACKSTOP. Always the ceiling, independent of the clamp above,
            -- so the overload alert keeps meaning "this plan cannot be completed
            -- safely" rather than "this child is a little behind".
            (CASE
                    WHEN c.unit_kind = 'tests'     THEN cap.max_tests_per_day
                    WHEN c.unit_kind = 'questions' THEN cap.max_questions_per_day
                    ELSE NULL::smallint
                END)::integer AS overload_ceiling,
            COALESCE(cap.daily_target_basis, 'recommended'::text) AS target_basis
           FROM calc c
             JOIN reporting.dim_student ds ON ds.student_key = c.student_key AND ds.is_current
             LEFT JOIN reporting.dim_year_level_cap cap ON cap.year_level = ds.year_level
        )
SELECT plan_key,
    student_key,
    unit_kind,
    remaining_units,
    remaining_days,
    required_daily,
    effective_cap,
    overload_ceiling,
    target_basis,
    LEAST(required_daily, effective_cap::numeric) AS daily_target_units,
    -- Measured against the ceiling, and only when a ceiling is known.
    remaining_days > 0 AND overload_ceiling IS NOT NULL AND required_daily > overload_ceiling::numeric AS plan_overload_flag
   FROM capped;

-- The unique index is not a performance choice: REFRESH ... CONCURRENTLY refuses
-- to run without one, and the nightly job refreshes this view during school hours.
CREATE UNIQUE INDEX IF NOT EXISTS ux_mv_student_daily_target
  ON reporting.mv_student_daily_target (student_key);

GRANT ALL ON reporting.mv_student_daily_target TO postgres;
GRANT SELECT ON reporting.mv_student_daily_target TO reporting_ro;

COMMENT ON MATERIALIZED VIEW reporting.mv_student_daily_target IS
  'S2. daily_target_units = LEAST(required_daily, effective_cap) and is the only figure a child sees. effective_cap is the CLAMP chosen by dim_year_level_cap.daily_target_basis: ''recommended'' (default) uses the advisory target, ''ceiling'' uses the absolute bound; it falls back to 2 x CEIL(weekly_sessions_goal/7) only where no cap row exists. overload_ceiling is always the ceiling, and plan_overload_flag is measured against it in both modes, so changing the clamp never softens the parent-facing overload alert. required_daily, effective_cap, overload_ceiling, target_basis and plan_overload_flag are PARENT-FACING ONLY and are not selected by v_student_today.';

-- ─── 4. The student-facing view, restated exactly as captured ───────────────
-- Reproduced from pg_get_viewdef of the live object rather than from migration
-- 013/014, because those files are not a trustworthy source here: 014's
-- `CREATE MATERIALIZED VIEW IF NOT EXISTS` never executed, and the live shape came
-- from hosted-only migration 025. The column list is the security control - it is
-- what keeps `required_daily`, `effective_cap` and `plan_overload_flag` away from
-- a child - so it is unchanged, and the comment below restates why.
CREATE VIEW reporting.v_student_today AS
 SELECT ds.student_id,
    c.exam_label,
    c.exam_date,
    c.days_to_exam,
    c.exam_passed,
    t.daily_target_units,
    t.unit_kind
   FROM reporting.dim_student ds
     LEFT JOIN reporting.mv_student_countdown c ON c.student_key = ds.student_key
     LEFT JOIN reporting.mv_student_daily_target t ON t.student_key = ds.student_key
  WHERE ds.is_current AND is_student_self(ds.student_id);

GRANT ALL ON reporting.v_student_today TO postgres;
GRANT SELECT ON reporting.v_student_today TO reporting_ro;

COMMENT ON VIEW reporting.v_student_today IS
  'The ONLY reporting object readable by the STUDENT role. Its column list contains no score, percentage, percentile, rank, band, correctness or mastery field, and it omits required_daily, effective_cap, overload_ceiling, target_basis and plan_overload_flag so the overload figure can never reach a child.';

-- ─── 5. The admin wrappers learn about the new column ───────────────────────
-- The read wrapper returns daily_target_basis so the settings screen can show
-- which policy is in force per year level. Showing a recommended target as if it
-- were the clamp - which is what an omission here would allow - is the exact
-- confusion this migration was written to end.
--
-- Dropped rather than replaced: Postgres refuses to change a function's return
-- row type through CREATE OR REPLACE ("cannot change return type of existing
-- function ... use DROP FUNCTION first"), and it refuses at parse time, so an
-- IF NOT EXISTS-style slip here stops the whole migration rather than half-applying
-- it. Caught by running this file through psql, not by reading it.
DROP FUNCTION IF EXISTS public.admin_year_level_caps();

CREATE FUNCTION public.admin_year_level_caps()
 RETURNS TABLE(year_level smallint, max_tests_per_day smallint,
               max_questions_per_day smallint, recommended_tests_per_day smallint,
               recommended_questions_per_day smallint, daily_target_basis text,
               updated_at timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
  SELECT c.year_level, c.max_tests_per_day, c.max_questions_per_day,
         c.recommended_tests_per_day, c.recommended_questions_per_day,
         c.daily_target_basis, c.updated_at
  FROM reporting.dim_year_level_cap c
  WHERE public.has_role('ADMIN')
  ORDER BY c.year_level;
$function$;

-- The write wrapper is re-created with the new argument rather than overloaded:
-- two functions of the same name differing only in arity is how PostgREST callers
-- end up resolving to whichever signature the schema cache happened to refresh
-- last, and a settings save that lands on the old signature would silently ignore
-- the basis the operator just picked.
DROP FUNCTION IF EXISTS public.admin_set_year_level_cap(smallint, smallint, smallint, smallint, smallint);

CREATE OR REPLACE FUNCTION public.admin_set_year_level_cap(
  p_year_level smallint,
  p_max_tests smallint,
  p_max_questions smallint,
  p_recommended_tests smallint,
  p_recommended_questions smallint,
  p_daily_target_basis text DEFAULT 'recommended'
) RETURNS TABLE(year_level smallint, max_tests_per_day smallint,
                max_questions_per_day smallint, recommended_tests_per_day smallint,
                recommended_questions_per_day smallint, daily_target_basis text,
                updated_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
BEGIN
  IF NOT public.has_role('ADMIN') THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;

  IF p_year_level IS NULL OR p_year_level NOT BETWEEN 2 AND 9 THEN
    RAISE EXCEPTION 'year_level % is outside the configured range 2-9', p_year_level
      USING ERRCODE = '22023';
  END IF;
  IF p_max_tests IS NULL OR p_max_tests NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'max_tests_per_day must be between 1 and 40 (got %)', p_max_tests
      USING ERRCODE = '22023';
  END IF;
  IF p_max_questions IS NULL OR p_max_questions NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'max_questions_per_day must be between 1 and 2000 (got %)', p_max_questions
      USING ERRCODE = '22023';
  END IF;
  IF p_recommended_tests IS NULL OR p_recommended_tests < 2 THEN
    RAISE EXCEPTION 'recommended_tests_per_day must be at least 2 (got %)', p_recommended_tests
      USING ERRCODE = '22023';
  END IF;
  IF p_recommended_tests > p_max_tests THEN
    RAISE EXCEPTION 'recommended target % exceeds the ceiling % for Year %',
      p_recommended_tests, p_max_tests, p_year_level USING ERRCODE = '22023';
  END IF;
  IF p_recommended_questions IS NULL OR p_recommended_questions < 2 THEN
    RAISE EXCEPTION 'recommended_questions_per_day must be at least 2 (got %)', p_recommended_questions
      USING ERRCODE = '22023';
  END IF;
  IF p_recommended_questions > p_max_questions THEN
    RAISE EXCEPTION 'recommended question target % exceeds the ceiling % for Year %',
      p_recommended_questions, p_max_questions, p_year_level USING ERRCODE = '22023';
  END IF;
  -- Spelled out rather than trusting the table CHECK, because the failure mode of
  -- a typo here ('Recommend', 'recommended ') is a row that silently keeps the
  -- previous policy while the operator believes they changed it.
  IF p_daily_target_basis IS NULL OR p_daily_target_basis NOT IN ('recommended', 'ceiling') THEN
    RAISE EXCEPTION 'daily_target_basis must be ''recommended'' or ''ceiling'' (got %)',
      p_daily_target_basis USING ERRCODE = '22023';
  END IF;

  UPDATE reporting.dim_year_level_cap c
     SET max_tests_per_day             = p_max_tests,
         max_questions_per_day         = p_max_questions,
         recommended_tests_per_day     = p_recommended_tests,
         recommended_questions_per_day = p_recommended_questions,
         daily_target_basis            = p_daily_target_basis,
         updated_at                    = now()
   WHERE c.year_level = p_year_level;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no cap row for year_level %', p_year_level USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY SELECT c.year_level, c.max_tests_per_day, c.max_questions_per_day,
                       c.recommended_tests_per_day, c.recommended_questions_per_day,
                       c.daily_target_basis, c.updated_at
                  FROM reporting.dim_year_level_cap c
                 WHERE c.year_level = p_year_level;
END;
$function$;

COMMENT ON FUNCTION public.admin_year_level_caps() IS
  'Admin read wrapper over reporting.dim_year_level_cap, including daily_target_basis so the screen can state which limit is actually clamping a child. ADMIN only, enforced in-body: a non-admin receives zero rows, the same shape for every caller, so the response cannot be used to probe which year levels are configured.';

COMMENT ON FUNCTION public.admin_set_year_level_cap(smallint, smallint, smallint, smallint, smallint, text) IS
  'Admin write path for the per-year-level daily practice limits and the clamp policy. ADMIN only, checked in-body as well as by grant. Validates range, ceiling/target coherence and the basis enum with actionable messages; the table CHECKs are the actual guarantee, so this function improves the error rather than weakening the control. Takes effect on the next refresh of mv_student_daily_target, not immediately.';

-- Grants for the NEW signature only. The five-argument function was dropped
-- above, so leaving this out would not fail loudly - it would make PostgREST stop
-- advertising the RPC and the settings screen would report a save failure that is
-- really a missing grant.
GRANT EXECUTE ON FUNCTION public.admin_set_year_level_cap(smallint, smallint, smallint, smallint, smallint, text)
  TO authenticated, postgres, service_role;
REVOKE EXECUTE ON FUNCTION public.admin_set_year_level_cap(smallint, smallint, smallint, smallint, smallint, text)
  FROM anon, PUBLIC;

-- ─── 6. Refresh, so the new shape holds data rather than nothing ────────────
-- Plain REFRESH, not CONCURRENTLY: this runs inside the migration transaction and
-- CONCURRENTLY is refused there. There are zero current plans, so the table is
-- empty either way and no reader sees a transient state.
REFRESH MATERIALIZED VIEW reporting.mv_student_daily_target;

-- ─── 7. What this migration deliberately does NOT do ────────────────────────
-- It does not change the ceiling or recommended numbers, and it does not alter
-- `v_student_today`'s column list. The first is configuration and the second is
-- the student access-control boundary; a clamp-policy change has no business
-- touching either, and the assertion that it did not is left to the baseline diff
-- (`schema:validate` plus the capture's own before/after) rather than to this
-- comment's say-so.




