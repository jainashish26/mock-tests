-- ============================================================================
-- seeds/003_sample_served_items.sql
--
-- WHAT THIS FILLS, AND WHY IT WAS EMPTY
--   `public.attempt_items_served` (migration 122) records which items were
--   DISPLAYED. Nothing wrote to it before it existed, so every sample attempt looks
--   like it answered everything it was ever shown: A1's skip rate is a constant
--   0.0% and A4's KR-20 has no matrix to compute from. This seed backfills the
--   history 122 could not have.
--
-- THE RULE: served = (every item answered) UNION (the form's first four items)
--
--   Two requirements pull in opposite directions and this is where they settle.
--
--   1. served MUST be a superset of answered. A child cannot answer an item they
--      were never shown, and a fixture that permits it makes every exposure figure
--      nonsense.
--   2. attempts of a form must share SOME served items, or KR-20 is still
--      uncomputable no matter how good the capture is. Reliability is a property of
--      a matrix; if no two children were shown the same item, there is no matrix.
--
--   A shared four-item opening prefix satisfies (2) cheaply, and (1) is satisfied by
--   construction. Measured on this dataset: 20,286 served rows over all 1,279
--   attempts, an answered share of **86.6%** (a 13.4% skip rate - realistic, and
--   just above the 10% default flag), and **46 items served to every submitted
--   attempt of their form**.
--
-- WHAT THIS DOES *NOT* MAKE COMPUTABLE, AND WHY THAT IS NOT A DATA GAP
--   A4's KR-20 still returns NO_COMPLETE_ATTEMPTS after this seed, and the reason is
--   upstream of serving: **no item in the 001 dataset is ANSWERED by every attempt
--   of its form.** Attempts here answer ~14 scattered items out of up to 90, and the
--   001 generator never gave them a common core. A reliability coefficient needs a
--   rectangle - every examinee scored on every item in the matrix - and a shared
--   SERVED prefix cannot manufacture answers that were never given. Verified after
--   seeding: 4 common served items, 0 complete matrices.
--
--   Making KR-20 demonstrable would mean either regenerating 001's responses so a
--   fixed core is always answered (which changes every attempt score, since 001
--   derives scores from its responses) or adding a dedicated small cohort that
--   answers the same items on purpose. Neither belongs in this file, and inventing
--   answers here would quietly corrupt the score-reconciliation guarantee DA-03
--   relies on. Recorded as a known limitation instead.
--
-- WHY NOT "SERVE UP TO THE FURTHEST POSITION REACHED"
--   That was the first draft, and the data rejected it: the 001 seed placed
--   responses across the form rather than sequentially (average furthest answered
--   position 39.5 against 13.7 answers, and only 207 of 1,279 attempts are
--   contiguous from item 1). A prefix to position 40 therefore served 40 items to a
--   child who answered 14 — an answered share of 33.7%, and a skip rate so high
--   that A1 would flag EVERY item for skipping. Seeded data that trips every
--   threshold is worse than no data: it teaches an operator to ignore the flag.
--
-- KNOWN ARTEFACT, STATED SO NOBODY CHASES IT
--   Because the underlying answers are scattered, the skip share here is still
--   higher than a real cohort's (four served items a child did not answer, against
--   ~14 they did). A1's `skip_rate_pct` will read materially above the 10% default
--   flag for most items. That is a property of this fixture, not of the product -
--   `skip_rate_reliable` becomes true because the denominator is now real, and the
--   magnitude should be read as "populated", not as a finding.
--
-- REBUILD, NOT APPEND
--   The sample slice is cleared first. An append-only seed cannot be corrected once
--   its rule changes (this one changed twice), and rebuilding makes a re-run
--   deterministic rather than additive. The deletes are restricted to sample
--   attempts by prefix.
--
-- Deterministic (md5 of the attempt id, matching 001). Teardown: these rows CASCADE
-- from `attempts`, which 999 already removes.
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
-- 2. The shared opening prefix - four items every child was shown
-- ----------------------------------------------------------------------------
-- Four is chosen, not arbitrary: it is the smallest prefix that gives KR-20 a
-- matrix worth computing (k must be >= 2, and two items carry almost no
-- reliability signal) while adding little enough to the served set that the
-- answered share stays realistic.
INSERT INTO public.attempt_items_served (attempt_id, question_id, first_served_at)
SELECT a.id, tq.question_id, COALESCE(a.started_at, a.created_at, now())
FROM public.attempts a
JOIN public.test_questions tq ON tq.test_id = a.test_id
WHERE a.id::text LIKE '5d000000-%'
  AND tq.question_order <= 4
ON CONFLICT (attempt_id, question_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. The jumpers: a deterministic minority who leapt ahead
-- ----------------------------------------------------------------------------
-- Two items immediately after the furthest position they answered, which is what a
-- child using the question grid does. Deterministic on md5(attempt_id) and limited
-- to a seventh of attempts: enough to exercise a served set that is NOT a prefix,
-- which is exactly the case a high-water mark would get wrong.
WITH sample_attempts AS (
  SELECT
    a.id AS attempt_id,
    a.test_id,
    COALESCE(a.started_at, a.created_at, now()) AS served_at,
    COALESCE((
      SELECT MAX(tq.question_order)
      FROM public.responses r
      JOIN public.test_questions tq
        ON tq.test_id = a.test_id AND tq.question_id = r.question_id
      WHERE r.attempt_id = a.id
    ), 0) AS furthest,
    ('x' || substr(md5(a.id::text), 1, 8))::bit(32)::int AS h
  FROM public.attempts a
  WHERE a.id::text LIKE '5d000000-%'
),
jumpers AS (
  SELECT attempt_id, test_id, served_at, furthest
  FROM sample_attempts
  WHERE furthest > 0 AND abs(h % 7) = 0
)
INSERT INTO public.attempt_items_served (attempt_id, question_id, first_served_at)
SELECT j.attempt_id, tq.question_id, j.served_at
FROM jumpers j
JOIN public.test_questions tq ON tq.test_id = j.test_id
WHERE tq.question_order > j.furthest
  AND tq.question_order <= j.furthest + 2
ON CONFLICT (attempt_id, question_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 4. Load the fact table
-- ----------------------------------------------------------------------------
-- The hourly cron would do this within the hour, but a developer who has just
-- seeded should not wait for a scheduler. Idempotent.
SELECT reporting.load_served_facts();

-- ----------------------------------------------------------------------------
-- 5. Print the shape, because "0.0% for every item" is the symptom this fixes
-- ----------------------------------------------------------------------------
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
  (SELECT COUNT(*) FROM (
     SELECT a.test_id, s.question_id
     FROM public.attempt_items_served s
     JOIN public.attempts a ON a.id = s.attempt_id
     WHERE a.id::text LIKE '5d000000-%'
     GROUP BY 1,2
    HAVING COUNT(DISTINCT s.attempt_id) = (
      SELECT COUNT(*) FROM public.attempts a2
      WHERE a2.test_id = a.test_id AND a2.id::text LIKE '5d000000-%'
        AND a2.submitted_at IS NOT NULL)
   ) common)                                                            AS common_served_items;
