-- ============================================================================
-- 123_item_skip_rate_from_served.sql
--
-- A1/T4's skip_rate finally measures something.
--
-- THE BUG THIS FIXES IS NOT ARITHMETIC, IT IS THE DENOMINATOR
--   The specified formula is "skips / presentations". Until migration 122 there was
--   no record of presentations at all, so the implementation divided
--   `COUNT(*) FILTER (WHERE is_skipped)` by `COUNT(*)` over `fact_item_response` -
--   a table that, by construction, holds a row ONLY for items that were answered.
--   The numerator could never be non-zero, so every item reported 0.0% and the
--   column had to be disclaimed as unavailable.
--
--   Now that `reporting.fact_item_served` exists, the denominator is real:
--
--       skip_rate_pct = (served - answered) / served * 100
--
--   counted over the SAME scoped population for both terms (all attempts in scope,
--   not just the scored ones), because mixing a served count over every attempt with
--   an answered count over scored attempts only would inflate the rate.
--
-- WHAT `skip_rate_reliable` MEANS NOW
--   It used to be a single global flag ("does ANY row anywhere have is_skipped"),
--   which is the wrong shape for a capture that arrived part-way through the
--   history. It is now PER ITEM: true when that item has served rows, false when it
--   does not. Items whose history predates the capture report
--   `skip_rate_pct = NULL` and `skip_rate_reliable = false`, so the UI renders n/a
--   for them instead of a confident 0.0%.
--
--   That distinction is the whole point. An item measured at 0% skip and an item
--   never measured must not render the same number, and before this migration they
--   did - which is exactly the failure the caveat text existed to paper over.
--
-- `HIGH_SKIP` IS NOW GATED ON THE SAME PER-ITEM FLAG
--   Previously gated on the global flag; an item with no served rows could never be
--   flagged, but for the wrong reason (the numerator was always 0). It is now
--   explicitly "measured AND above the configured ceiling".
--
-- THE MATERIALISED VIEW IS REFRESHED HERE, NOT LEFT TO THE CRON
--   A1's admin path reads `reporting.mv_item_statistics`, not the function. Leaving
--   the refresh to the nightly job would mean the migration looks applied while the
--   report still shows the old numbers - the most confusing possible outcome for
--   whoever verifies this.
-- ============================================================================

CREATE OR REPLACE FUNCTION reporting.item_statistics(
  p_test_id     uuid   DEFAULT NULL,
  p_student_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(
  period_label        text,
  test_id             uuid,
  item_id             uuid,
  subject             text,
  topic               text,
  responses           bigint,
  students            bigint,
  enough_evidence     boolean,
  p_value             numeric,
  point_biserial      numeric,
  median_time_seconds numeric,
  skip_rate_pct       numeric,
  skip_rate_reliable  boolean,
  marking_reliable    boolean,
  item_flag_rate_pct  numeric,
  key_option          text,
  distractors         jsonb,
  dead_distractors    text[],
  defect_reasons      text[],
  is_defective        boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = reporting, public, pg_catalog
AS $function$
WITH cfg AS (
  SELECT * FROM reporting.item_thresholds WHERE id = 1
),
scoped AS (
  SELECT f.attempt_id, f.student_id, f.test_id, f.item_id,
         f.is_correct, f.is_skipped, f.time_spent_seconds,
         NULLIF(btrim(f.answer_option, '"'), '') AS answer_option
  FROM reporting.fact_item_response f
  WHERE (p_test_id IS NULL OR f.test_id = p_test_id)
    AND (p_student_ids IS NULL OR f.student_id = ANY (p_student_ids))
),
-- 123: the denominator skip rate never had. Scoped exactly like `scoped` so the
-- two terms of the ratio describe the same set of children.
served AS (
  SELECT f.test_id, f.item_id, COUNT(*)::bigint AS served_rows
  FROM reporting.fact_item_served f
  WHERE (p_test_id IS NULL OR f.test_id = p_test_id)
    AND (p_student_ids IS NULL OR f.student_id = ANY (p_student_ids))
  GROUP BY f.test_id, f.item_id
),
-- Answered by the SAME population that `served` describes: attempts with served
-- capture. This is not cosmetic. Counting every response here would put pre-122
-- answers in the numerator against a denominator that excludes their attempts -
-- so an item answered only by pre-capture attempts would show a skip rate of 0%
-- (clamped by GREATEST after going negative) rather than n/a, and every other item
-- would understate by however many pre-capture answers it carries.
--
-- The one real attempt on the live database is exactly that case: 68 answers, no
-- served rows. It is why this filter exists rather than being assumed.
answered_all AS (
  SELECT s.test_id, s.item_id, COUNT(*)::bigint AS answered_rows
  FROM scoped s
  WHERE EXISTS (
    SELECT 1 FROM reporting.fact_item_served c
    WHERE c.attempt_id = s.attempt_id
  )
  GROUP BY s.test_id, s.item_id
),
attempt_totals AS (
  SELECT s.attempt_id, SUM(s.is_correct::int) AS total_correct
  FROM scoped s
  GROUP BY s.attempt_id
),
-- Point-biserial with the item EXCLUDED from its own rest score, per §5:
-- "the most commonly botched item statistic".
usable AS (
  SELECT s.attempt_id, s.student_id, s.test_id, s.item_id,
         s.is_correct, s.is_skipped, s.time_spent_seconds, s.answer_option,
         (att.total_correct - s.is_correct::int) AS rest_score
  FROM scoped s
  JOIN attempt_totals att ON att.attempt_id = s.attempt_id
  JOIN reporting.fact_test_attempt a ON a.attempt_id = s.attempt_id
  WHERE a.score IS NOT NULL
),
per_item AS (
  SELECT u.test_id, u.item_id,
         COUNT(*)::bigint                     AS responses,
         COUNT(DISTINCT u.student_id)::bigint AS students,
         COUNT(*) FILTER (WHERE u.is_correct)::numeric
           / NULLIF(COUNT(*), 0)              AS p_value,
         CORR(u.is_correct::int::numeric, u.rest_score::numeric) AS point_biserial,
         (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY u.time_spent_seconds))::numeric
                                              AS median_time_seconds
  FROM usable u
  GROUP BY u.test_id, u.item_id
),
keyed AS (
  SELECT q.id AS item_id, NULLIF(btrim(q.correct_answer), '') AS key_option
  FROM public.questions q
),
opt AS (
  SELECT u.test_id, u.item_id, u.answer_option AS option, COUNT(*)::bigint AS n
  FROM usable u
  WHERE u.answer_option IS NOT NULL
  GROUP BY u.test_id, u.item_id, u.answer_option
),
opt_k AS (
  SELECT o.test_id, o.item_id, o.option, o.n,
         (o.option = k.key_option) AS is_key,
         k.key_option
  FROM opt o
  LEFT JOIN keyed k ON k.item_id = o.item_id
),
opt_sh AS (
  SELECT o.*,
         SUM(o.n) OVER w                            AS tot,
         MAX(o.n) FILTER (WHERE o.is_key)     OVER w AS key_n,
         MAX(o.n) FILTER (WHERE NOT o.is_key) OVER w AS top_distractor_n
  FROM opt_k o
  WINDOW w AS (PARTITION BY o.test_id, o.item_id)
),
opt_agg AS (
  SELECT s.test_id, s.item_id,
         jsonb_agg(jsonb_build_object(
                     'option',    s.option,
                     'n',         s.n,
                     'share_pct', ROUND(s.n::numeric / NULLIF(s.tot, 0) * 100, 1),
                     'is_key',    s.is_key)
                   ORDER BY s.n DESC, s.option) AS distractors,
         MAX(s.key_option)        AS key_option,
         MAX(s.key_n)             AS key_n,
         MAX(s.top_distractor_n)  AS top_distractor_n
  FROM opt_sh s
  GROUP BY s.test_id, s.item_id
),
authored AS (
  SELECT q.id AS item_id, x.option
  FROM public.questions q
  CROSS JOIN LATERAL (
    VALUES ('A', q.answer_a), ('B', q.answer_b), ('C', q.answer_c),
           ('D', q.answer_d), ('E', q.answer_e)
  ) AS x(option, txt)
  WHERE NULLIF(btrim(x.txt), '') IS NOT NULL
),
dead AS (
  SELECT p.test_id, p.item_id,
         array_agg(a.option ORDER BY a.option) AS dead_options
  FROM per_item p
  JOIN authored a ON a.item_id = p.item_id
  LEFT JOIN keyed k ON k.item_id = p.item_id
  WHERE a.option IS DISTINCT FROM k.key_option
    AND NOT EXISTS (
      SELECT 1 FROM opt o
      WHERE o.item_id = a.item_id AND o.test_id = p.test_id AND o.option = a.option
    )
  GROUP BY p.test_id, p.item_id
),
-- 088: one shared rule, so A1/T4 and the A15 check cannot disagree.
marking_capable AS (
  SELECT (SELECT disagreeing FROM reporting.marking_disagreement()) = 0 AS reliable
),
enriched AS (
  SELECT
    'ALL_TIME'::text                                   AS period_label,
    p.test_id, p.item_id,
    d.subject, d.topic,
    p.responses, p.students,
    (p.responses >= c.min_responses_per_item)          AS enough_evidence,
    CASE WHEN p.responses >= c.min_responses_per_item
         THEN ROUND(p.p_value, 3) END                  AS p_value,
    CASE WHEN p.responses >= c.min_responses_per_item
         THEN ROUND(p.point_biserial::numeric, 3) END  AS point_biserial,
    ROUND(p.median_time_seconds, 0)                    AS median_time_seconds,
    -- 123: served - answered over the same scoped population. NULL rather than
    -- 0.0 when the item has no served history, so "never measured" cannot render
    -- as "measured at zero".
    CASE WHEN COALESCE(sv.served_rows, 0) = 0 THEN NULL
         ELSE ROUND(
                GREATEST(sv.served_rows - COALESCE(aa.answered_rows, 0), 0)::numeric
                  / sv.served_rows * 100, 1)
    END                                                AS skip_rate_pct,
    (COALESCE(sv.served_rows, 0) > 0)                  AS skip_rate_reliable,
    mk.reliable                                        AS marking_reliable,
    ROUND(COALESCE(q.flag_count, 0)::numeric
            / NULLIF(p.responses, 0) * 100, 2)         AS item_flag_rate_pct,
    oa.key_option,
    COALESCE(oa.distractors, '[]'::jsonb)              AS distractors,
    -- 090: same floor as the statistics. Below it, "nobody chose this option" is
    -- an artefact of a small sample, not a finding about the item.
    CASE WHEN p.responses >= c.min_responses_per_item
         THEN COALESCE(dd.dead_options, '{}'::text[])
         ELSE '{}'::text[] END                         AS dead_distractors,
    CASE WHEN p.responses < c.min_responses_per_item THEN '{}'::text[]
         ELSE array_remove(ARRAY[
           CASE WHEN p.p_value < c.p_value_floor   THEN 'TOO_HARD' END,
           CASE WHEN p.p_value > c.p_value_ceiling THEN 'TOO_EASY' END,
           CASE WHEN p.point_biserial IS NOT NULL
                 AND p.point_biserial::numeric < c.point_biserial_min
                THEN 'NO_DISCRIMINATION' END,
           CASE WHEN COALESCE(dd.dead_options, '{}'::text[]) <> '{}'::text[]
                THEN 'DEAD_DISTRACTOR' END,
           CASE WHEN oa.top_distractor_n IS NOT NULL AND oa.key_n IS NOT NULL
                 AND oa.top_distractor_n > oa.key_n
                THEN 'KEY_BEATEN' END,
           CASE WHEN p.median_time_seconds > c.median_time_max_seconds
                THEN 'SLOW' END,
           -- 123: gated on THIS item's capture and on the rate actually exceeding
           -- the configured ceiling, not on a numerator that could never be
           -- non-zero.
           CASE WHEN COALESCE(sv.served_rows, 0) > 0
                 AND GREATEST(sv.served_rows - COALESCE(aa.answered_rows, 0), 0)::numeric
                       / sv.served_rows * 100 > c.skip_rate_max_pct
                THEN 'HIGH_SKIP' END
         ], NULL)
    END                                                AS defect_reasons
  FROM per_item p
  CROSS JOIN cfg c
  CROSS JOIN marking_capable mk
  LEFT JOIN served       sv ON sv.test_id = p.test_id AND sv.item_id = p.item_id
  LEFT JOIN answered_all aa ON aa.test_id = p.test_id AND aa.item_id = p.item_id
  LEFT JOIN reporting.dim_item d ON d.item_id = p.item_id
  LEFT JOIN public.questions  q ON q.id      = p.item_id
  LEFT JOIN opt_agg oa ON oa.test_id = p.test_id AND oa.item_id = p.item_id
  LEFT JOIN dead    dd ON dd.test_id = p.test_id AND dd.item_id = p.item_id
)
SELECT e.period_label, e.test_id, e.item_id, e.subject, e.topic,
       e.responses, e.students, e.enough_evidence,
       e.p_value, e.point_biserial, e.median_time_seconds,
       e.skip_rate_pct, e.skip_rate_reliable, e.marking_reliable,
       e.item_flag_rate_pct,
       e.key_option, e.distractors, e.dead_distractors, e.defect_reasons,
       cardinality(e.defect_reasons) > 0 AS is_defective
FROM enriched e;
$function$;

COMMENT ON FUNCTION reporting.item_statistics(uuid, uuid[]) IS
'A1/T4 item statistics. 123: skip_rate_pct is (served - answered) / served, both terms scoped identically, read from reporting.fact_item_served; skip_rate_reliable is now PER ITEM - true where served history exists, false with a NULL rate where the item predates the capture. Difficulty, discrimination, timing and distractor analysis are unchanged and still computed over scored attempts only.';

-- ----------------------------------------------------------------------------
-- The materialisation A1 actually reads. Refreshed here, not left to the cron:
-- otherwise the migration applies cleanly and the report still shows the old
-- numbers, which is the most confusing possible way to ship this.
-- ----------------------------------------------------------------------------
REFRESH MATERIALIZED VIEW reporting.mv_item_statistics;

-- ----------------------------------------------------------------------------
-- Self-test: the invariants that would make this migration silently wrong
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_reliable   bigint;
  v_inconsistent bigint;
  v_bad_flag   bigint;
  v_negative   bigint;
  v_mv         bigint;
  v_items      bigint;
  v_served     bigint;
BEGIN
  CREATE TEMP TABLE _it123 ON COMMIT DROP AS
  SELECT * FROM reporting.item_statistics();

  SELECT COUNT(*) INTO v_items FROM _it123;
  IF v_items = 0 THEN
    -- Nothing to assert against, and that is a state, not a failure: a fresh
    -- database has no items until content is loaded. Failing here would make the
    -- migration unusable on exactly the environment that needs it most.
    RAISE NOTICE '123 self-test: no item rows yet - structural checks skipped';
    RETURN;
  END IF;

  -- 1. Where capture exists, at least one item must come back measured. Guarded on
  --    the capture itself rather than assumed: PRODUCTION HAS NO SERVED ROWS until
  --    the first child sits a test after 122 ships, so an unconditional "at least
  --    one measured item" would abort this migration on the very deploy that
  --    installs it. The metric reporting n/a until traffic arrives is the designed
  --    behaviour (per-item `skip_rate_reliable`), not a defect to fail on.
  SELECT COUNT(*) INTO v_served FROM reporting.fact_item_served;
  SELECT COUNT(*) INTO v_reliable FROM _it123 WHERE skip_rate_reliable;
  IF v_served > 0 AND v_reliable = 0 THEN
    RAISE EXCEPTION '123 self-test: % served rows exist but no item reports a measured skip rate', v_served;
  END IF;
  IF v_served = 0 THEN
    RAISE NOTICE '123 self-test: no served rows yet - skip rate reports n/a until runner traffic arrives, and clears itself';
  END IF;

  -- 2. The flag and the value cannot disagree. A NULL rate means "not measured";
  --    a rate with reliable = false would be a number nobody should trust.
  SELECT COUNT(*) INTO v_inconsistent FROM _it123
  WHERE (skip_rate_reliable AND skip_rate_pct IS NULL)
     OR (NOT skip_rate_reliable AND skip_rate_pct IS NOT NULL);
  IF v_inconsistent > 0 THEN
    RAISE EXCEPTION '123 self-test: % rows disagree between skip_rate_pct and skip_rate_reliable', v_inconsistent;
  END IF;

  -- 3. HIGH_SKIP only ever fires on a measured item.
  SELECT COUNT(*) INTO v_bad_flag FROM _it123
  WHERE 'HIGH_SKIP' = ANY (defect_reasons) AND NOT skip_rate_reliable;
  IF v_bad_flag > 0 THEN
    RAISE EXCEPTION '123 self-test: % rows flagged HIGH_SKIP without served capture', v_bad_flag;
  END IF;

  -- 4. For any attempt that HAS served capture, every answered item must have a
  --    served row. This is the invariant skip rate rests on: if an answer exists
  --    without a served row, the denominator is short and the rate understates.
  --
  --    Scoped to attempts with capture on purpose. Attempts that predate 122 have
  --    answers and no served rows at all, and counting them here would fail the
  --    migration for historical absence rather than for a broken capture - the
  --    distinction is the whole reason skip_rate_reliable is per item.
  SELECT COUNT(*) INTO v_negative
  FROM reporting.fact_item_response r
  WHERE EXISTS (
          SELECT 1 FROM reporting.fact_item_served c
          WHERE c.attempt_id = r.attempt_id)
    AND NOT EXISTS (
          SELECT 1 FROM reporting.fact_item_served s
          WHERE s.attempt_id = r.attempt_id AND s.item_id = r.item_id);
  IF v_negative > 0 THEN
    RAISE EXCEPTION '123 self-test: % answered rows belong to a captured attempt but have no served row - skip rate would understate', v_negative;
  END IF;

  -- 5. The MV the admin screen reads carries the same verdict, not the old one.
  SELECT COUNT(*) INTO v_mv FROM reporting.mv_item_statistics WHERE skip_rate_reliable;
  IF v_mv <> v_reliable THEN
    RAISE EXCEPTION '123 self-test: mv_item_statistics has % measured items but the function has % - the refresh did not take', v_mv, v_reliable;
  END IF;

  RAISE NOTICE '123 self-test ok: % items, % with measured skip rate', v_items, v_reliable;
END
$$;
