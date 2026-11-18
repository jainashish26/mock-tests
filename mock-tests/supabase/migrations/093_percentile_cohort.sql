-- ============================================================================
-- 093 - P2 Percentile & Cohort Context (11-...md §4.4, 12-...md §10, B1/X-4)
--
-- WHY NOW: the sample dataset put real cohorts at 14-33 students against the
-- n>=20 floor, so P2 is finally computable (16-delivery-backlog.md, remaining
-- item 1). Two live cohorts (OLYMPIAD y6 = 19, SELECTIVE y6 = 14) sit BELOW the
-- floor and exercise suppression for real rather than in theory.
--
-- DESIGN DECISIONS, EACH TRACEABLE TO A RULE:
--
-- 1. MID-RANK, ONE DEFINITION. percentile_from_scores() owns the 0.5-for-ties
--    convention (12-...md §5: "state it or two implementations will differ").
--    The MV calls it; DA-06 hand-checks it directly. Extracted for the same
--    reason experiment_decision() was: every branch testable without seeding
--    hundreds of rows.
--
-- 2. GRAIN: student x family_group x year_level. The spec says "test family x
--    year level x test form", but the live dim_test has NO form dimension and
--    inventing one would assert a comparability nobody has decided. A-21
--    (14-...md §20.5) already resolved the family half: dim_test_family.
--    family_group collapses NAPLAN_STYLE_* and *_OLYMPIAD so a cohort is not
--    fragmented below the floor. The form half is a DOCUMENTED DEVIATION:
--    cohorts pool all forms of a family. If a form dimension ever lands, the
--    MV grain changes here and nowhere else.
--
-- 3. DISTINCT ON per student: one score per student per cohort (their most
--    recent COMPLETE attempt inside the window). A diligent child with nine
--    attempts occupies ONE cohort position (DA-08). cohort_size counts
--    students, never attempts.
--
-- 4. SUPPRESSION AND BANDS LIVE IN THE MV, NOT THE UI (B1/X-4):
--      n < 20        -> suppressed, percentile_rank AND percentile_band NULL
--      20 <= n < 50  -> quartile BAND only, never a point
--      n >= 50       -> integer point percentile
--    The raw percentage never leaves the MV: the wrapper's RETURNS clause
--    cannot express it, so no code path can render a bare percentile.
--
-- 5. B1 IS ENFORCED IN SQL. parent_percentile() raises 42501 (-> HTTP 403)
--    unless the student has a completed, scored attempt - the exact condition
--    under which P1 readiness resolves (readiness.ts returns null without
--    one). The gate reads public.attempts LIVE, not the nightly MV: P1
--    resolves from live tables, so gating on a stale MV would 403 a child
--    whose readiness report already renders. Authorisation is checked FIRST
--    so an unlinked caller always gets 0 rows and cannot probe which students
--    have attempts by the error shape.
--
-- 6. personal_progress_delta IS BORROWED FROM P4 (mv_attempt_history), never
--    recomputed (11-...md §4.4 MECE; parent-history.ts owns the metric). The
--    wrapper embeds it on every row so a percentile can never render alone.
--
-- 7. Thresholds are CONFIG (percentile_thresholds singleton), so the floors
--    are tunable without a migration and the baseline config export discovers
--    them automatically via the *_thresholds convention (086).
--
-- 8. Refresh is CHAINED onto rpt-load-attempt-facts, after the fact load and
--    mv_attempt_history, because the MV reads the fact table directly. A
--    separate schedule could run before the load and publish yesterday's
--    cohort as today's.
-- ============================================================================

-- Config singleton -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS reporting.percentile_thresholds (
  id                   integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  min_cohort_students  integer NOT NULL DEFAULT 20,
  min_cohort_for_point integer NOT NULL DEFAULT 50,
  cohort_window_months integer NOT NULL DEFAULT 12,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
INSERT INTO reporting.percentile_thresholds (id) VALUES (1) ON CONFLICT DO NOTHING;

ALTER TABLE reporting.percentile_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.percentile_thresholds FORCE ROW LEVEL SECURITY;
REVOKE ALL ON reporting.percentile_thresholds FROM PUBLIC, anon, authenticated;
GRANT SELECT ON reporting.percentile_thresholds TO reporting_ro;

-- The mid-rank convention, owned here and nowhere else ------------------------
--   100 * (count below + 0.5 * count tied) / n
-- Hand-checks (DA-06): scores 1..21, score 11 -> 50. Sixteen below + five tied
-- at 60, score 60 -> 88.0952. All 21 tied -> 50. Empty cohort -> NULL.
CREATE OR REPLACE FUNCTION reporting.percentile_from_scores(
  p_score numeric, p_scores numeric[]
) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path TO 'pg_catalog'
AS $function$
  SELECT CASE
    WHEN p_score IS NULL OR p_scores IS NULL OR cardinality(p_scores) = 0 THEN NULL
    ELSE 100.0 * (COUNT(*) FILTER (WHERE s < p_score)
                + 0.5 * COUNT(*) FILTER (WHERE s = p_score))
         / cardinality(p_scores)
  END
  FROM unnest(p_scores) AS s;
$function$;
REVOKE ALL ON FUNCTION reporting.percentile_from_scores(numeric, numeric[])
  FROM PUBLIC, anon, authenticated;

-- The cohort MV ---------------------------------------------------------------
CREATE MATERIALIZED VIEW reporting.mv_percentile_cohort AS
WITH latest AS (
  -- ONE score per student per cohort: their most recent COMPLETE attempt
  -- inside the rolling window. Window anchored to Australia/Melbourne dates,
  -- matching every other reporting window (and the blackout evaluator).
  SELECT DISTINCT ON (f.student_id, tf.family_group, ds.year_level)
         f.student_id, tf.family_group, tf.family_group_label, ds.year_level,
         f.score AS latest_score, f.attempt_id AS latest_attempt_id,
         f.submitted_at AS latest_submitted_at
  FROM reporting.fact_test_attempt f
  JOIN reporting.dim_test t         ON t.test_id = f.test_id AND t.is_current
  JOIN reporting.dim_test_family tf ON tf.exam_type = t.exam_type
  JOIN reporting.dim_student ds     ON ds.student_id = f.student_id AND ds.is_current
  CROSS JOIN reporting.percentile_thresholds th
  WHERE th.id = 1
    AND f.status = 'COMPLETE' AND f.score IS NOT NULL
    AND f.submitted_at >= (((now() AT TIME ZONE 'Australia/Melbourne')::date
                          - make_interval(months => th.cohort_window_months))
                          AT TIME ZONE 'Australia/Melbourne')
  ORDER BY f.student_id, tf.family_group, ds.year_level, f.submitted_at DESC
),
cohorts AS (
  SELECT family_group, year_level,
         COUNT(*)          AS cohort_size,   -- DISTINCT students by construction
         array_agg(score)  AS scores
  FROM (SELECT family_group, year_level, latest_score AS score FROM latest) z
  GROUP BY family_group, year_level
),
joined AS (
  SELECT l.*, c.cohort_size,
         reporting.percentile_from_scores(l.latest_score, c.scores) AS pct
  FROM latest l
  JOIN cohorts c ON c.family_group = l.family_group AND c.year_level = l.year_level
)
SELECT
  j.student_id, j.family_group, j.family_group_label, j.year_level,
  j.latest_score, j.latest_attempt_id, j.latest_submitted_at,
  j.cohort_size,
  -- Point only at n >= 50. width_bucket is capped at 4 because the overflow
  -- bucket (5) would otherwise appear if pct ever hit exactly 100 - it cannot
  -- today (the student is inside their own cohort, so pct < 100), but a guard
  -- that costs nothing beats a comment that promises it.
  CASE WHEN j.cohort_size >= th.min_cohort_for_point
       THEN ROUND(j.pct)::int END                              AS percentile_rank,
  CASE WHEN j.cohort_size >= th.min_cohort_students
        AND j.cohort_size <  th.min_cohort_for_point
       THEN LEAST(4, width_bucket(j.pct, 0, 100, 4)) END       AS percentile_band,
  (j.cohort_size < th.min_cohort_students)                     AS suppressed,
  th.cohort_window_months,
  'platform cohort'::text                                      AS cohort_definition,
  ((now() AT TIME ZONE 'Australia/Melbourne')::date
    - make_interval(months => th.cohort_window_months))::date  AS window_start,
  (now() AT TIME ZONE 'Australia/Melbourne')::date             AS window_end,
  now()                                                        AS as_at
FROM joined j
CROSS JOIN reporting.percentile_thresholds th
WHERE th.id = 1;

CREATE UNIQUE INDEX ux_mv_percentile_cohort
  ON reporting.mv_percentile_cohort (student_id, family_group, year_level);

REVOKE ALL ON reporting.mv_percentile_cohort FROM PUBLIC, anon, authenticated;
GRANT SELECT ON reporting.mv_percentile_cohort TO reporting_ro;

-- Parent-facing wrapper. The RETURNS clause is the entire visible surface:
-- no raw percentage, no peer identifiers, no student_key.
CREATE OR REPLACE FUNCTION public.parent_percentile(p_student_id uuid)
RETURNS TABLE(
  family_group text, family_group_label text, year_level smallint,
  latest_score numeric, percentile_rank integer, percentile_band integer,
  suppressed boolean, cohort_size bigint, cohort_window_months integer,
  cohort_definition text, window_start date, window_end date,
  personal_progress_delta numeric, attempts_completed bigint,
  as_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
BEGIN
  -- Authorisation FIRST: an unlinked caller gets 0 rows for every student,
  -- with or without attempts, so the B1 error below cannot be used to probe
  -- which students exist or have practised.
  IF NOT (public.may_read_results()
          AND (public.is_parent_of(p_student_id) OR public.has_role('ADMIN'))) THEN
    RETURN;
  END IF;

  -- B1 (11-...md §4.4): P2 may never render without P1. P1 readiness resolves
  -- exactly when a completed, scored attempt exists (readiness.ts returns
  -- null otherwise). Checked against LIVE attempts, not the nightly MV, so
  -- the gate agrees with the readiness report the parent can already see.
  IF NOT EXISTS (
    SELECT 1 FROM public.attempts a
    WHERE a.student_id = p_student_id
      AND a.status IN ('SUBMITTED','COMPLETE')
      AND a.score_out_of100 IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'percentile requires a completed test first (P1 readiness does not resolve)'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH hist AS (
    -- P4 owns personal_progress_delta. Borrowed, never recomputed: two
    -- definitions of progress is a MECE breach (parent-history.ts header).
    SELECT h.family_group AS fg,
           COUNT(*) AS n,
           (array_agg(h.personal_progress_delta ORDER BY h.started_at DESC))[1] AS delta
    FROM reporting.mv_attempt_history h
    WHERE h.student_id = p_student_id AND h.score IS NOT NULL
    GROUP BY h.family_group
  )
  SELECT pc.family_group, pc.family_group_label, pc.year_level,
         pc.latest_score, pc.percentile_rank, pc.percentile_band,
         pc.suppressed, pc.cohort_size, pc.cohort_window_months,
         pc.cohort_definition, pc.window_start, pc.window_end,
         hist.delta, hist.n, pc.as_at
  FROM reporting.mv_percentile_cohort pc
  LEFT JOIN hist ON hist.fg = pc.family_group
  WHERE pc.student_id = p_student_id
  ORDER BY hist.n DESC NULLS LAST, pc.family_group;
END;
$function$;

REVOKE ALL ON FUNCTION public.parent_percentile(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.parent_percentile(uuid) TO authenticated, service_role;

-- Refresh: chained AFTER the attempt-fact load so the cohort can never be
-- rebuilt from pre-load facts. Same jobname updates the existing schedule.
SELECT cron.schedule('rpt-load-attempt-facts', '20 16 * * *',
  'SELECT reporting.load_attempt_facts(false),
          reporting.safe_refresh(''reporting.mv_attempt_history'', true),
          reporting.safe_refresh(''reporting.mv_percentile_cohort'', true)');

-- Initial population. safe_refresh respects the A14 blackout, so a migration
-- run inside peak would silently leave the MV empty. Suspend the blackout for
-- this one refresh and restore it in an exception handler (the operational
-- note in 16-delivery-backlog.md), rather than bypassing safe_refresh and
-- leaving refresh_log - and therefore the lag badge - stale.
DO $do$
BEGIN
  CREATE TEMP TABLE _p2_suspended ON COMMIT DROP AS
    SELECT blackout_id FROM reporting.refresh_blackout WHERE is_active;
  UPDATE reporting.refresh_blackout SET is_active = false
   WHERE blackout_id IN (SELECT blackout_id FROM _p2_suspended);

  -- Non-concurrent: the MV has never been populated, and REFRESH CONCURRENTLY
  -- requires an already-populated view.
  PERFORM reporting.safe_refresh('reporting.mv_percentile_cohort'::regclass, false);

  UPDATE reporting.refresh_blackout SET is_active = true
   WHERE blackout_id IN (SELECT blackout_id FROM _p2_suspended);
EXCEPTION WHEN OTHERS THEN
  IF to_regclass('pg_temp._p2_suspended') IS NOT NULL THEN
    UPDATE reporting.refresh_blackout SET is_active = true
     WHERE blackout_id IN (SELECT blackout_id FROM _p2_suspended);
  END IF;
  RAISE;
END $do$;