-- ============================================================================
-- seeds/003_sample_served_items.sql
--
-- WHAT THIS FILLS, AND WHY IT WAS EMPTY
--   `public.attempt_items_served` (migration 122) records which items were
--   DISPLAYED. Nothing wrote to it before it existed, so every sample attempt looked
--   like it answered everything it was ever shown: A1's skip rate was a constant
--   0.0% with `skip_rate_reliable = false`, and there was no denominator anywhere.
--   This seed backfills the history 122 could not have, which is what lets 123 turn
--   the metric on.
--
-- THE RULE: served = (every item answered) UNION (a scattered handful it was not)
--
--   Two requirements, and this is where they settle:
--
--   1. served MUST be a superset of answered. A child cannot answer an item they
--      were never shown; a fixture that permits it makes every exposure figure
--      nonsense, and 123's self-test asserts exactly this.
--   2. The un-answered items must be SCATTERED, not a fixed prefix. The first draft
--      served "the form's first four items" to everyone. It produced 1,497 items at
--      exactly 0.0% skip and a handful at 50-85% - a bimodal artefact of the
--      fixture's own shape, in which `HIGH_SKIP` could never fire and the skip
--      scatter plot had nothing to plot. Scattering by md5(attempt, item) spreads
--      the same number of skipped presentations across the whole item bank, which
--      is what real usage looks like and what the report needs to be developed
--      against.
--
--   The scatter is also what makes the served set NOT a watermark: a child's served
--   items are not "everything up to position N", which is precisely why 122 stores
--   a set per item rather than a single high-water position. A prefix-only fixture
--   would have hidden that, and the grid navigator that lets a child jump to
--   question 40 would have gone unmodelled.
--
--   Volume: one or two un-answered items per attempt, so the answered share lands
--   around 90% and the average skip rate just under the 10% configured ceiling -
--   with a tail above it, because items that few children answer get picked as
--   "shown and skipped" relatively more often. That tail is the signal A1 exists to
--   surface; a fixture where every item sits at the same rate would hide it.
--
-- REBUILD, NOT APPEND
--   The sample slice is cleared first. An append-only seed cannot be corrected once
--   its rule changes, and this one changed three times. The deletes are restricted
--   to sample attempts by prefix, so real rows are untouched.
--
-- Deterministic (md5, matching 001). Teardown: these rows CASCADE from `attempts`,
-- which 999 already removes.
--
-- ORDERING: run this AFTER 004. It rebuilds served rows for every sample attempt,
-- so it has to see the writing attempts 004 creates or they get none.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Rebuild the sample slice
-- ----------------------------------------------------------------------------
-- Fact rows first: they do not cascade from a served-row delete, so leaving them
-- would double-count on the next load.
DELETE FROM reporting.fact_item_served WHERE attempt_id::text LIKE '5d000000-%';
DELETE FROM public.attempt_items_served   WHERE attempt_id::text LIKE '5d000000-%';

-- ----------------------------------------------------------------------------
-- 1. Everything the child actually answered
-- ----------------------------------------------------------------------------
INSERT INTO public.attempt_items_served (attempt_id, question_id, first_served_at)
SELECT r.attempt_id, r.question_id, COALESCE(a.started_at, a.created_at, now())
FROM public.responses r
JOIN public.attempts a ON a.id = r.attempt_id
WHERE a.id::text LIKE '5d000000-%'
ON CONFLICT (attempt_id, question_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. One or two items they were SHOWN and did not answer, scattered
-- ----------------------------------------------------------------------------
-- Chosen by md5(attempt, item), so a different pair of items per child and no
-- positional pattern. `answered > 0` keeps the 20 sample attempts that were
-- abandoned before answering anything from being credited with served items the
-- runner never reached.
WITH per_attempt AS (
  SELECT
    a.id            AS attempt_id,
    a.test_id,
    COALESCE(a.started_at, a.created_at, now()) AS served_at,
    (SELECT COUNT(*) FROM public.responses r WHERE r.attempt_id = a.id) AS answered,
    ('x' || substr(md5(a.id::text), 1, 8))::bit(32)::int AS h
  FROM public.attempts a
  WHERE a.id::text LIKE '5d000000-%'
),
plan AS (
  SELECT attempt_id, test_id, served_at,
         1 + (abs(h) % 2) AS n_extra
  FROM per_attempt
  WHERE answered > 0
)
INSERT INTO public.attempt_items_served (attempt_id, question_id, first_served_at)
SELECT p.attempt_id, x.question_id, p.served_at
FROM plan p
CROSS JOIN LATERAL (
  SELECT tq.question_id
  FROM public.test_questions tq
  WHERE tq.test_id = p.test_id
    AND NOT EXISTS (
      SELECT 1 FROM public.responses r
      WHERE r.attempt_id = p.attempt_id AND r.question_id = tq.question_id)
  ORDER BY md5(p.attempt_id::text || tq.question_id::text)
  LIMIT p.n_extra
) x
ON CONFLICT (attempt_id, question_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. Load the fact table
-- ----------------------------------------------------------------------------
-- The hourly cron would do this within the hour, but a developer who has just
-- seeded should not have to wait for a scheduler. Idempotent.
SELECT reporting.load_served_facts();

-- ----------------------------------------------------------------------------
-- 4. Print the shape, and the two things that would make this fixture useless
-- ----------------------------------------------------------------------------
-- `unanswered_but_served` is the whole point: without it skip rate has no
-- numerator. `answers_without_served` must be zero or the denominator is short and
-- every rate understates - which is what 123's self-test asserts too.
SELECT
  (SELECT COUNT(*) FROM public.attempt_items_served
    WHERE attempt_id::text LIKE '5d000000-%')                          AS sample_served_rows,
  (SELECT COUNT(DISTINCT attempt_id) FROM public.attempt_items_served
    WHERE attempt_id::text LIKE '5d000000-%')                          AS attempts_covered,
  (SELECT COUNT(*) FROM reporting.fact_item_served)                    AS fact_rows,
  (SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE r.id IS NOT NULL)
                / NULLIF(COUNT(*), 0), 1)
     FROM public.attempt_items_served s
     LEFT JOIN public.responses r
       ON r.attempt_id = s.attempt_id AND r.question_id = s.question_id
    WHERE s.attempt_id::text LIKE '5d000000-%')                        AS answered_share_pct,
  (SELECT COUNT(*) FROM public.attempt_items_served s
    WHERE s.attempt_id::text LIKE '5d000000-%'
      AND NOT EXISTS (SELECT 1 FROM public.responses r
                      WHERE r.attempt_id = s.attempt_id
                        AND r.question_id = s.question_id))            AS unanswered_but_served,
  (SELECT COUNT(*) FROM public.responses r
    JOIN public.attempts a ON a.id = r.attempt_id
    WHERE a.id::text LIKE '5d000000-%'
      AND NOT EXISTS (SELECT 1 FROM public.attempt_items_served s
                      WHERE s.attempt_id = r.attempt_id
                        AND s.question_id = r.question_id))            AS answers_without_served;
