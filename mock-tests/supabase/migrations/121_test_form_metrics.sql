-- ============================================================================
-- 121 - A4 Test-Form Metrics (backlog item 19, the A4 half)
--
-- WHAT THIS IS FOR
--   A4 answers one question: "is this test form fit to stay live?" - publish,
--   revise or withdraw. Section 5 assigns it four metrics and A4 OWNS all four:
--   `test_completion_rate`, `abandonment_point`, `score_distribution` and
--   `reliability_coefficient`. Nothing here recomputes anything A1 or T4 own.
--
-- WHY THIS IS A FUNCTION AND NOT A MATERIALISED VIEW
--   The spec's refresh column says "nightly 01:30". That column exists to bound
--   staleness for reports whose input is large. A4 reads two fact tables that
--   already exist (fact_test_attempt: 1,300 rows; fact_item_response: 17,643)
--   and aggregates them per form - measured at single-digit milliseconds. A
--   nightly MV would therefore buy nothing and cost the usual price: a number
--   that is up to a day stale exactly when someone is asking "can I unpublish
--   this form this morning". The T4 precedent (a live function over the same
--   facts) is the closer match than A1's nightly MV, and T4 is live for the
--   same reason.
--
--   This is a RECORDED DEVIATION from the spec, with the trigger for changing
--   it stated: if fact_item_response ever reaches a scale where this call
--   exceeds ~1s, materialise per calendar month and keep this signature. The
--   caller does not need to know which implementation answered.
--
-- THE HARD PART, AND WHY IT IS HONEST RATHER THAN CLEVER
--   KR-20 needs a COMPLETE item x person matrix: every examinee scored on every
--   item. This runner does not produce one. It serves a subset of the form's
--   pool to each child (attempts here answered between 12 and 21 of up to 90
--   items), and - the root cause - it writes NO ROW for an item it never
--   served, so "unanswered" and "not administered" are indistinguishable. The
--   same capture gap is what forces A1 to carry a skip-rate caveat.
--
--   Verified against live before writing this: ZERO items are answered by every
--   submitted attempt, on every one of the 16 forms with attempts. So there is
--   no complete matrix to compute from, on any form, today.
--
--   The tempting shortcuts are all wrong and each produces a plausible number:
--     * treat unserved items as incorrect - invents a zero for every skipped
--       item and drives the coefficient toward 1 (apparent perfect reliability
--       from a fabrication);
--     * compute over the pairwise-present subset - silently changes k per
--       examinee, which is not what KR-20 measures;
--     * drop to Cronbach's alpha on a partial matrix - same problem, dressed
--       differently.
--   So the coefficient is computed ONLY over attempts that answered the form's
--   full item set, and when there are none it returns NULL with a state that
--   names why. A null coefficient with a reason is a finding; a coefficient
--   from an incomplete matrix is a lie that will be used to keep a bad form
--   live. The `reliability_state` column is that reason, and the UI renders it
--   instead of an empty cell.
--
--   `items_answered_by_all` is returned BESIDE the coefficient on purpose: it
--   is the measurement that decides whether the coefficient is computable at
--   all, so an operator can watch the capture gap shrink as the runner starts
--   recording what it served.
--
-- ABANDONMENT POINT USES THE FORM'S OWN ORDER
--   The spec's formula is `PERCENTILE_CONT(0.5) ... (last_answered_position)`.
--   Neither `fact_item_response` nor `public.responses` has a position column
--   in this schema, so the position is taken from the only place that defines
--   one: `public.test_questions.question_order`. Joining to the form's own
--   definition means the figure is "how far through the form the child got"
--   rather than "how many rows they happened to write", which are different
--   questions and only the first one is A4's.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Thresholds, as data
-- ----------------------------------------------------------------------------
-- Same shape as item_thresholds / enquiry_thresholds: a singleton row so a
-- limit can be re-tuned without a migration, and so the UI can quote the floor
-- it is judging against instead of hardcoding 0.70 in a component.
CREATE TABLE IF NOT EXISTS reporting.test_form_thresholds (
  id                           smallint PRIMARY KEY DEFAULT 1,
  -- Below this many started attempts a completion rate is shown but marked
  -- not-reportable; it is never silently hidden (13.4 "shown greyed with n").
  min_attempts_for_completion   integer  NOT NULL DEFAULT 10,
  -- Below this many COMPLETE attempts KR-20 is null. 30 is the conventional
  -- floor for a stable reliability estimate and matches the spec's "never a
  -- coefficient computed from 5 attempts".
  min_attempts_for_reliability  integer  NOT NULL DEFAULT 30,
  -- Section 5 flags a coefficient below 0.70. Stored as a number, not a boolean.
  reliability_floor             numeric(4,3) NOT NULL DEFAULT 0.700,
  -- Share of started attempts abandoned before this is worth investigating.
  abandonment_alert_pct         numeric(5,2) NOT NULL DEFAULT 40.00,
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT test_form_thresholds_singleton CHECK (id = 1),
  CONSTRAINT test_form_thresholds_counts CHECK (
    min_attempts_for_completion > 0
    AND min_attempts_for_reliability >= min_attempts_for_completion
  ),
  CONSTRAINT test_form_thresholds_reliability CHECK (
    reliability_floor > 0 AND reliability_floor <= 1
  ),
  CONSTRAINT test_form_thresholds_abandonment CHECK (
    abandonment_alert_pct >= 0 AND abandonment_alert_pct <= 100
  )
);

COMMENT ON TABLE reporting.test_form_thresholds IS
  'A4 floors and flags as data: attempt floors, the 0.70 reliability floor from section 5, and the abandonment share worth investigating. Singleton row (id=1).';

-- Every reporting base table forces RLS (PR-07), and a config table read
-- through a definer wrapper is not an exception.
ALTER TABLE reporting.test_form_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.test_form_thresholds FORCE ROW LEVEL SECURITY;

GRANT SELECT ON reporting.test_form_thresholds TO reporting_ro;

INSERT INTO reporting.test_form_thresholds (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. KR-20, as one pure function
-- ----------------------------------------------------------------------------
-- Extracted for the same reason experiment_decision() and
-- recommendations_scored() were: a formula written twice is a formula that will
-- disagree with itself, and one written inline in a 200-line aggregate is a
-- formula nothing can test without seeding a database. This signature takes the
-- three inputs the coefficient actually needs (k, the summed p*q, and the
-- variance of total scores), so every branch - including the ones that must
-- return NULL - is provable with hand-computed numbers.
--
--   KR-20 = (k / (k - 1)) * (1 - SUM(p_j * q_j) / VAR_SAMP(total))
--
-- A NEGATIVE RESULT IS RETURNED, NOT CLAMPED. A negative coefficient means item
-- responses are negatively correlated with the total, which is a real (and
-- alarming) property of a bad form. Clamping it to 0 would hide the finding
-- behind the same number a broken form and a merely terrible one would get.
CREATE OR REPLACE FUNCTION reporting.kr20(
  p_items integer,
  p_sum_pq numeric,
  p_total_variance numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $fn$
  SELECT CASE
    -- k < 2 makes k/(k-1) undefined (or negative). One item carries no
    -- internal consistency to measure.
    WHEN p_items IS NULL OR p_items < 2 THEN NULL
    WHEN p_sum_pq IS NULL OR p_total_variance IS NULL THEN NULL
    -- Everyone scored identically: the denominator is zero, and a coefficient
    -- computed from it is undefined rather than perfect.
    WHEN p_total_variance <= 0 THEN NULL
    ELSE ROUND(
      (p_items::numeric / (p_items - 1)) * (1 - (p_sum_pq / p_total_variance)),
      3
    )
  END;
$fn$;

COMMENT ON FUNCTION reporting.kr20(integer, numeric, numeric) IS
  'KR-20 from its three inputs (item count, summed p*q, variance of total scores). Returns NULL where the coefficient is undefined rather than a number that looks like a measurement. Never clamps a negative coefficient: a negative value is a finding.';

REVOKE ALL ON FUNCTION reporting.kr20(integer, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reporting.kr20(integer, numeric, numeric) TO postgres, service_role;

-- ----------------------------------------------------------------------------
-- 3. The report: one row per test form
-- ----------------------------------------------------------------------------
-- Date filtering is on fact_test_attempt.date_key, i.e. the day the attempt
-- STARTED. That is the only consistent choice for a report that counts
-- completion: an attempt that started in the window and finished after it is
-- still an attempt started in the window, and filtering on submitted_at would
-- silently drop the slow finishers - precisely the population A4 looks for.
CREATE OR REPLACE FUNCTION reporting.test_form_metrics(
  p_from_date integer DEFAULT 20240101,
  p_to_date   integer DEFAULT 99991231
)
RETURNS TABLE(
  test_id uuid,
  test_title text,
  exam_type text,
  family_label text,
  family_group text,
  year_level_min smallint,
  year_level_max smallint,
  content_status text,
  attempts_started bigint,
  attempts_submitted bigint,
  abandoned_attempts bigint,
  completion_rate_pct numeric,
  completion_reportable boolean,
  abandonment_point numeric,
  abandonment_share_pct numeric,
  abandonment_flagged boolean,
  items_in_form bigint,
  items_answered_by_all bigint,
  reliability_coefficient numeric,
  reliability_state text,
  reliability_meets_floor boolean,
  mean_score numeric,
  median_score numeric,
  score_n bigint,
  as_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $fn$
WITH cfg AS (
  SELECT * FROM reporting.test_form_thresholds WHERE id = 1
),
scoped AS (
  SELECT a.attempt_id, a.test_id, a.score, a.submitted_at
  FROM reporting.fact_test_attempt a
  WHERE a.date_key BETWEEN p_from_date AND p_to_date
),
form AS (
  SELECT tq.test_id, COUNT(*)::bigint AS items_in_form
  FROM public.test_questions tq
  GROUP BY tq.test_id
),
counts AS (
  SELECT s.test_id,
         COUNT(*)::bigint                                          AS started,
         COUNT(*) FILTER (WHERE s.submitted_at IS NOT NULL)::bigint AS submitted
  FROM scoped s
  GROUP BY s.test_id
),
-- How far through the FORM the child got. LATERAL because the position lives on
-- the form definition (test_questions.question_order), not on the response.
reached AS (
  SELECT s.test_id, s.attempt_id, p.last_position
  FROM scoped s
  LEFT JOIN LATERAL (
    SELECT MAX(tq.question_order) AS last_position
    FROM reporting.fact_item_response r
    JOIN public.test_questions tq
      ON tq.test_id = r.test_id AND tq.question_id = r.item_id
    WHERE r.attempt_id = s.attempt_id
  ) p ON true
),
abandoned AS (
  SELECT r.test_id,
         COUNT(*)::bigint AS abandoned,
         (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY r.last_position))::numeric
           AS abandonment_point
  FROM reached r
  WHERE r.last_position IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM scoped s
      WHERE s.attempt_id = r.attempt_id AND s.submitted_at IS NOT NULL
    )
  GROUP BY r.test_id
),
-- Which items did EVERY submitted attempt answer? This is the gate on KR-20:
-- with 0 such items there is no complete matrix and no coefficient.
answered AS (
  SELECT r.test_id, r.attempt_id, COUNT(DISTINCT r.item_id)::bigint AS answered_items
  FROM reporting.fact_item_response r
  JOIN scoped s ON s.attempt_id = r.attempt_id
  GROUP BY r.test_id, r.attempt_id
),
coverage AS (
  SELECT a.test_id,
         COUNT(*) FILTER (WHERE a.answered_items = c.submitted)::bigint
           AS items_answered_by_all
  FROM answered a
  JOIN counts c ON c.test_id = a.test_id
  GROUP BY a.test_id
),
complete_attempts AS (
  SELECT a.test_id, a.attempt_id
  FROM answered a
  JOIN form f    ON f.test_id = a.test_id
  JOIN scoped s  ON s.attempt_id = a.attempt_id
  WHERE s.submitted_at IS NOT NULL
    AND a.answered_items = f.items_in_form
),
matrix AS (
  SELECT r.test_id, r.attempt_id, r.item_id, r.is_correct
  FROM reporting.fact_item_response r
  JOIN complete_attempts c
    ON c.attempt_id = r.attempt_id AND c.test_id = r.test_id
),
item_p AS (
  SELECT m.test_id, m.item_id,
         COUNT(*) FILTER (WHERE m.is_correct)::numeric / NULLIF(COUNT(*), 0) AS p
  FROM matrix m
  GROUP BY m.test_id, m.item_id
),
pq AS (
  SELECT i.test_id,
         SUM(i.p * (1 - i.p)) AS sum_pq,
         COUNT(*)::bigint     AS scored_items
  FROM item_p i
  GROUP BY i.test_id
),
totals AS (
  SELECT m.test_id, m.attempt_id, SUM(m.is_correct::int)::numeric AS total
  FROM matrix m
  GROUP BY m.test_id, m.attempt_id
),
variance AS (
  SELECT t.test_id,
         VAR_SAMP(t.total)::numeric AS total_variance,
         COUNT(*)::bigint           AS complete_attempts
  FROM totals t
  GROUP BY t.test_id
),
scores AS (
  SELECT s.test_id,
         ROUND(AVG(s.score), 1)    AS mean_score,
         ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.score))::numeric, 1)
                                   AS median_score,
         COUNT(*)::bigint          AS score_n
  FROM scoped s
  WHERE s.score IS NOT NULL
  GROUP BY s.test_id
)
SELECT
  c.test_id,
  dt.title                                              AS test_title,
  dt.exam_type,
  fam.family_label,
  fam.family_group,
  dt.year_level_min,
  dt.year_level_max,
  dt.content_status,
  c.started                                             AS attempts_started,
  c.submitted                                           AS attempts_submitted,
  COALESCE(ab.abandoned, 0)                             AS abandoned_attempts,
  ROUND(c.submitted::numeric / NULLIF(c.started, 0) * 100, 1)
                                                        AS completion_rate_pct,
  (c.started >= cfg.min_attempts_for_completion)        AS completion_reportable,
  ROUND(ab.abandonment_point, 1)                        AS abandonment_point,
  ROUND(COALESCE(ab.abandoned, 0)::numeric / NULLIF(c.started, 0) * 100, 1)
                                                        AS abandonment_share_pct,
  (
    c.started >= cfg.min_attempts_for_completion
    AND COALESCE(ab.abandoned, 0)::numeric / NULLIF(c.started, 0) * 100
        > cfg.abandonment_alert_pct
  )                                                     AS abandonment_flagged,
  COALESCE(f.items_in_form, 0)                          AS items_in_form,
  COALESCE(cov.items_answered_by_all, 0)                AS items_answered_by_all,
  -- ONE definition of the coefficient, in a LATERAL below, used by both columns.
  -- The first draft called kr20() twice with no attempt-floor gate, and the
  -- apply-time self-test caught the consequence immediately: a form with five
  -- complete attempts produced a number while its state said TOO_FEW_ATTEMPTS -
  -- exactly the "coefficient computed from 5 attempts" section 5 forbids. The
  -- gate now lives with the formula, so the two columns cannot disagree.
  rel.coefficient                                       AS reliability_coefficient,
  CASE
    WHEN COALESCE(f.items_in_form, 0) < 2               THEN 'TOO_FEW_ITEMS'
    WHEN COALESCE(cov.items_answered_by_all, 0) = 0     THEN 'NO_COMPLETE_ATTEMPTS'
    WHEN COALESCE(v.complete_attempts, 0) < cfg.min_attempts_for_reliability
                                                        THEN 'TOO_FEW_ATTEMPTS'
    WHEN v.total_variance IS NULL OR v.total_variance <= 0
                                                        THEN 'NO_VARIANCE'
    ELSE 'OK'
  END                                                   AS reliability_state,
  (rel.coefficient IS NOT NULL
    AND rel.coefficient >= cfg.reliability_floor)       AS reliability_meets_floor,
  sc.mean_score,
  sc.median_score,
  COALESCE(sc.score_n, 0)                               AS score_n,
  (
    SELECT MAX(a.etl_loaded_at)
    FROM reporting.fact_test_attempt a
    WHERE a.date_key BETWEEN p_from_date AND p_to_date
  )                                                     AS as_at
FROM counts c
LEFT JOIN form f                       ON f.test_id = c.test_id
LEFT JOIN abandoned ab                 ON ab.test_id = c.test_id
LEFT JOIN coverage cov                 ON cov.test_id = c.test_id
LEFT JOIN variance v                   ON v.test_id = c.test_id
LEFT JOIN pq                           ON pq.test_id = c.test_id
LEFT JOIN scores sc                    ON sc.test_id = c.test_id
-- LEFT, not CROSS: the singleton row is guaranteed by the CHECK and the INSERT
-- above, but a database where someone deleted it should render "not reportable"
-- rather than an empty report that reads as "no test forms".
LEFT JOIN cfg                          ON true
-- The single gated definition of the coefficient. Every condition that section
-- 5 requires before a number may be published is in this one place:
--   * the form has at least two items (k/(k-1) is undefined below that);
--   * at least one item was answered by every submitted attempt (otherwise
--     there is no complete matrix and any figure would be fabricated);
--   * at least min_attempts_for_reliability complete attempts exist.
-- k passed to kr20() is the number of ITEMS in the matrix, not the number of
-- attempts - the single easiest way to make a plausible, meaningless number.
CROSS JOIN LATERAL (
  SELECT CASE
           WHEN COALESCE(f.items_in_form, 0) >= 2
            AND COALESCE(cov.items_answered_by_all, 0) > 0
            AND COALESCE(v.complete_attempts, 0) >= cfg.min_attempts_for_reliability
           THEN reporting.kr20(
                  COALESCE(pq.scored_items, 0)::integer,
                  pq.sum_pq,
                  v.total_variance
                )
         END AS coefficient
) rel
LEFT JOIN reporting.dim_test dt        ON dt.test_id = c.test_id AND dt.is_current
LEFT JOIN reporting.dim_test_family fam ON fam.exam_type = dt.exam_type
ORDER BY c.started DESC, dt.title NULLS LAST;
$fn$;

COMMENT ON FUNCTION reporting.test_form_metrics(integer, integer) IS
  'A4: per test form, completion rate, abandonment point (form position), score mean/median and KR-20 reliability with the state that explains a null coefficient. Date window filters on the attempt start day.';

REVOKE ALL ON FUNCTION reporting.test_form_metrics(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reporting.test_form_metrics(integer, integer) TO postgres, service_role;

-- ----------------------------------------------------------------------------
-- 4. The histogram (§5: width_bucket(score, 0, 100, 10))
-- ----------------------------------------------------------------------------
-- A separate function rather than a jsonb column on the row above, because it is
-- a second question with its own shape: §13.4 asks for "a histogram of score
-- distribution + a start->submit funnel per form". Ten rows per form is what a
-- histogram needs; folding it into the metrics row would make every caller
-- unpack something it mostly does not draw.
--
-- Every bucket is returned even when empty. A chart that silently omits an empty
-- bucket draws a different distribution from the one that exists, and a gap in
-- the tail is exactly the shape A4 exists to detect.
CREATE OR REPLACE FUNCTION reporting.test_form_score_distribution(
  p_test_id   uuid,
  p_from_date integer DEFAULT 20240101,
  p_to_date   integer DEFAULT 99991231
)
RETURNS TABLE(
  bucket smallint,
  score_from numeric,
  score_to numeric,
  attempts bigint,
  as_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $fn$
WITH scoped AS (
  SELECT a.score
  FROM reporting.fact_test_attempt a
  WHERE a.test_id = p_test_id
    AND a.date_key BETWEEN p_from_date AND p_to_date
    AND a.score IS NOT NULL
),
buckets AS (
  SELECT g.bucket::smallint AS bucket
  FROM generate_series(1, 10) AS g(bucket)
),
counted AS (
  SELECT
    -- Clamped: width_bucket returns 0 below the range and 11 above it, and a
    -- score outside 0..100 would otherwise produce a bucket no chart has a slot
    -- for and silently vanish from the total.
    LEAST(10, GREATEST(1, width_bucket(s.score, 0, 100, 10)))::smallint AS bucket,
    COUNT(*)::bigint AS attempts
  FROM scoped s
  GROUP BY 1
)
SELECT
  b.bucket,
  ((b.bucket - 1) * 10)::numeric                       AS score_from,
  (b.bucket * 10)::numeric                             AS score_to,
  COALESCE(c.attempts, 0)                              AS attempts,
  (
    SELECT MAX(a.etl_loaded_at)
    FROM reporting.fact_test_attempt a
    WHERE a.test_id = p_test_id
      AND a.date_key BETWEEN p_from_date AND p_to_date
  )                                                    AS as_at
FROM buckets b
LEFT JOIN counted c ON c.bucket = b.bucket
ORDER BY b.bucket;
$fn$;

COMMENT ON FUNCTION reporting.test_form_score_distribution(uuid, integer, integer) IS
  'A4 histogram: 10 fixed 0-100 score buckets, empty buckets included so the shape of the distribution is not misdrawn.';

REVOKE ALL ON FUNCTION reporting.test_form_score_distribution(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reporting.test_form_score_distribution(uuid, integer, integer) TO postgres, service_role;

-- ----------------------------------------------------------------------------
-- 5. Public wrappers - the only surface PostgREST exposes
-- ----------------------------------------------------------------------------
-- Same shape as admin_item_statistics / admin_item_thresholds: a SQL wrapper
-- whose WHERE clause is the authorisation check. That gate returns ZERO ROWS
-- rather than raising, so an unauthorised caller learns nothing - not even
-- whether the function exists.
--
-- The ACL below is not decoration. A new function in `public` inherits the
-- Supabase default, which grants EXECUTE to PUBLIC (and therefore anon); 120
-- found exactly that hole on a function written during that migration. These
-- wrappers therefore revoke first and grant back only the roles the siblings
-- actually carry - read from pg_proc.proacl on live, not assumed.

CREATE OR REPLACE FUNCTION public.admin_test_form_metrics(
  p_from_date integer,
  p_to_date integer
)
RETURNS TABLE(
  test_id uuid, test_title text, exam_type text, family_label text,
  family_group text, year_level_min smallint, year_level_max smallint,
  content_status text, attempts_started bigint, attempts_submitted bigint,
  abandoned_attempts bigint, completion_rate_pct numeric,
  completion_reportable boolean, abandonment_point numeric,
  abandonment_share_pct numeric, abandonment_flagged boolean,
  items_in_form bigint, items_answered_by_all bigint,
  reliability_coefficient numeric, reliability_state text,
  reliability_meets_floor boolean, mean_score numeric, median_score numeric,
  score_n bigint, as_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $fn$
  SELECT m.*
  FROM reporting.test_form_metrics(p_from_date, p_to_date) m
  WHERE public.has_role('ADMIN')
  ORDER BY m.attempts_started DESC, m.test_title NULLS LAST;
$fn$;

REVOKE ALL ON FUNCTION public.admin_test_form_metrics(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_test_form_metrics(integer, integer)
  TO postgres, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_test_form_score_distribution(
  p_test_id uuid,
  p_from_date integer,
  p_to_date integer
)
RETURNS TABLE(
  bucket smallint, score_from numeric, score_to numeric, attempts bigint,
  as_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $fn$
  SELECT d.*
  FROM reporting.test_form_score_distribution(p_test_id, p_from_date, p_to_date) d
  WHERE public.has_role('ADMIN')
  ORDER BY d.bucket;
$fn$;

REVOKE ALL ON FUNCTION public.admin_test_form_score_distribution(uuid, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_test_form_score_distribution(uuid, integer, integer)
  TO postgres, authenticated, service_role;

-- The floors A4 judges against, exposed so the panel quotes the database rather
-- than restating 0.70 in a component (the A1/admin_item_thresholds precedent).
CREATE OR REPLACE FUNCTION public.admin_test_form_thresholds()
RETURNS TABLE(
  min_attempts_for_completion integer,
  min_attempts_for_reliability integer,
  reliability_floor numeric,
  abandonment_alert_pct numeric,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $fn$
  SELECT t.min_attempts_for_completion,
         t.min_attempts_for_reliability,
         t.reliability_floor,
         t.abandonment_alert_pct,
         t.updated_at
  FROM reporting.test_form_thresholds t
  WHERE t.id = 1
    AND public.has_role('ADMIN');
$fn$;

REVOKE ALL ON FUNCTION public.admin_test_form_thresholds() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_test_form_thresholds()
  TO postgres, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. Self-tests, at apply time
-- ----------------------------------------------------------------------------
-- Two kinds, for two different reasons.
--
-- (a) KR-20 against HAND-COMPUTED numbers. Four dichotomous items, four
--     examinees:
--        A 1 1 1 1   B 1 1 0 0   C 0 0 1 1   D 0 0 0 0
--     p_j = 0.5 for all four, so SUM(p*q) = 4 * 0.25 = 1.0; total scores are
--     4, 2, 2, 0, so VAR_SAMP = 8/3 = 2.6667 and the coefficient is
--     (4/3) * (1 - 1/2.6667) = 0.8333. That expectation was worked out by hand,
--     not read off the function - a fixture whose expected value came from the
--     same formula proves stability, not correctness.
--
-- (b) INVARIANTS over whatever this database contains. These are the properties
--     a future edit could break without breaking the build, and each is written
--     as a thing that must be impossible rather than a number that must match,
--     so they hold on an empty database and on a full one.
DO $do$
DECLARE
  v numeric;
  v_rows int;
  v_bad text;
BEGIN
  ------------------------------------------------------------------ (a) KR-20
  v := reporting.kr20(4, 1.0, 2.6666666666666667);
  IF v IS DISTINCT FROM 0.833 THEN
    RAISE EXCEPTION '121 self-test: kr20 textbook case returned %, expected 0.833', v;
  END IF;

  -- One item: no internal consistency to measure.
  IF reporting.kr20(1, 0.25, 1.0) IS NOT NULL THEN
    RAISE EXCEPTION '121 self-test: kr20 with k=1 must be NULL';
  END IF;

  -- No variance: undefined, not perfect.
  IF reporting.kr20(4, 1.0, 0) IS NOT NULL THEN
    RAISE EXCEPTION '121 self-test: kr20 with zero variance must be NULL, not a number';
  END IF;

  IF reporting.kr20(4, 1.0, NULL) IS NOT NULL
     OR reporting.kr20(4, NULL, 2.0) IS NOT NULL THEN
    RAISE EXCEPTION '121 self-test: kr20 with a NULL input must be NULL';
  END IF;

  -- A negative coefficient is returned, never clamped to zero: a form whose
  -- items work against each other is a finding, and 0 would hide it behind the
  -- same value a merely uninformative form gets.
  v := reporting.kr20(4, 4.0, 2.6666666666666667);
  IF v IS NULL OR v >= 0 THEN
    RAISE EXCEPTION '121 self-test: kr20 must return the negative coefficient (got %)', v;
  END IF;

  ------------------------------------------------------------- (b) invariants
  SELECT count(*) INTO v_rows FROM reporting.test_form_thresholds WHERE id = 1;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION '121 self-test: expected exactly one thresholds row, found %', v_rows;
  END IF;

  -- The identity the report is built on: every attempt either finished or did
  -- not. If this fails, the abandoned count has been derived from something
  -- other than the same set of attempts.
  SELECT string_agg(coalesce(test_title, test_id::text), ', ') INTO v_bad
  FROM reporting.test_form_metrics()
  WHERE attempts_started <> attempts_submitted + abandoned_attempts;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '121 self-test: started <> submitted + abandoned for %', v_bad;
  END IF;

  -- The lie this migration exists to prevent: a state that says "OK" while the
  -- coefficient is absent, or a coefficient present while the state says it was
  -- not computable.
  SELECT string_agg(coalesce(test_title, test_id::text), ', ') INTO v_bad
  FROM reporting.test_form_metrics()
  WHERE (reliability_state = 'OK') <> (reliability_coefficient IS NOT NULL);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '121 self-test: reliability_state and coefficient disagree for %', v_bad;
  END IF;

  SELECT string_agg(coalesce(test_title, test_id::text), ', ') INTO v_bad
  FROM reporting.test_form_metrics()
  WHERE items_answered_by_all > items_in_form;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '121 self-test: items_answered_by_all exceeds items_in_form for %', v_bad;
  END IF;

  -- An unseen state string would render as a blank cell in the panel, which is
  -- the failure a state column exists to remove.
  SELECT string_agg(DISTINCT reliability_state, ', ') INTO v_bad
  FROM reporting.test_form_metrics()
  WHERE reliability_state NOT IN
    ('OK', 'TOO_FEW_ITEMS', 'NO_COMPLETE_ATTEMPTS', 'TOO_FEW_ATTEMPTS', 'NO_VARIANCE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '121 self-test: unknown reliability_state(s): %', v_bad;
  END IF;

  -- The histogram must account for every scored attempt, per form. Written with
  -- an explicit LATERAL: a scalar subquery whose FROM calls a function with an
  -- outer column as an argument is not a correlated reference PostgreSQL
  -- accepts, and the version without it fails at apply time rather than at
  -- review time.
  SELECT string_agg(x.test_id::text, ', ') INTO v_bad
  FROM (
    SELECT m.test_id, m.score_n, d.total
    FROM reporting.test_form_metrics() m
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(dd.attempts), 0) AS total
      FROM reporting.test_form_score_distribution(m.test_id, 20240101, 99991231) dd
    ) d
    WHERE m.score_n <> d.total
  ) x;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '121 self-test: histogram does not total score_n for test(s) %', v_bad;
  END IF;

  -- Ten buckets always, so a chart never has to invent a slot.
  SELECT count(*) INTO v_rows
  FROM reporting.test_form_score_distribution(
    (SELECT dt.test_id FROM reporting.dim_test dt WHERE dt.is_current LIMIT 1),
    20240101, 99991231
  );
  IF v_rows <> 10 THEN
    RAISE EXCEPTION '121 self-test: histogram must always return 10 buckets, got %', v_rows;
  END IF;

  -- ACL. This is the exact defect class 120 found while writing its own
  -- migration: a fresh SECURITY DEFINER function in `public` lands on the
  -- Supabase default ACL, which EXECUTEs for PUBLIC. Asserted for the wrappers
  -- AND the reporting functions, because both have been got wrong here.
  IF has_function_privilege('anon', 'public.admin_test_form_metrics(integer,integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_test_form_thresholds()', 'EXECUTE')
     OR has_function_privilege('anon',
          'public.admin_test_form_score_distribution(uuid,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '121 self-test: a public A4 wrapper is executable by anon';
  END IF;

  IF has_function_privilege('anon', 'reporting.test_form_metrics(integer,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'reporting.test_form_metrics(integer,integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'reporting.kr20(integer,numeric,numeric)', 'EXECUTE') THEN
    RAISE EXCEPTION '121 self-test: a reporting A4 function is reachable by an app role';
  END IF;

  RAISE NOTICE '121 self-test ok: kr20 textbook case 0.833, invariants hold, ACLs closed';
END;
$do$;
