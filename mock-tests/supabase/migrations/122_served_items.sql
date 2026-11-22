-- ============================================================================
-- 122 - Record which items were SERVED, not only which were answered
--
-- WHY THIS EXISTS
--   Every accuracy-and-coverage report on this platform is currently missing half
--   of its input. `public.responses` holds a row when a child ANSWERS an item, and
--   nothing at all when they look at one and move on. So:
--
--     * A1's `skip_rate` is 0.0% for every item, because a skip and "not served"
--       are the same absence. That is why `skip_rate_reliable` exists and is false
--       everywhere - the report says so rather than printing a reassuring zero.
--     * A4's KR-20 cannot be computed at all: a complete item x person matrix
--       needs the served set to know which cells SHOULD have a value. Measured on
--       live before writing this: zero items are answered by every submitted
--       attempt, on all 16 forms with attempts.
--     * A2 (adaptive health) and the pathway work are blocked on the same column.
--
--   This migration adds the missing half. It is a CAPTURE change, exactly as the
--   backlog describes it - the reports are not touched here, because changing a
--   metric and its input in one commit makes it impossible to tell which one moved
--   a number.
--
-- WHAT "SERVED" MEANS, PRECISELY
--   An item is served when it was DISPLAYED to the child. Not "unlocked", not
--   "reachable": with the grid navigator a child can jump from question 2 to
--   question 40, so a high-water mark would claim 38 items were served that they
--   never saw. That is why this is a set of (attempt, item) pairs reported by the
--   runner as the question changes, and why nothing here derives served from
--   position.
--
-- WRITE VOLUME, AND WHY IT IS ACCEPTABLE
--   One INSERT per item viewed, de-duplicated on (attempt_id, question_id), sent
--   as a small delta with the existing save cadence. A 90-item form an ambitious
--   child works through completely costs 90 rows and 90 tiny requests - against
--   90 answer upserts that already happen. The primary key makes every retry,
--   every resumed attempt and every duplicate beacon free.
--
-- WHAT IS DELIBERATELY NOT HERE
--   No UPDATE or DELETE policy: a served row is a fact about what happened and no
--   client should be able to rewrite it. No SELECT policy either - the child's
--   own session does not need to read its history back (the reporting layer does,
--   through the fact table), and an INSERT-only table is the smallest surface that
--   still records the truth.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The capture table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attempt_items_served (
  attempt_id   uuid NOT NULL REFERENCES public.attempts(id) ON DELETE CASCADE,
  question_id  uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  -- First time it was displayed. Later displays do not move this: "served at"
  -- answers "when did the child first meet this item", which is the ordering the
  -- exposure metrics need.
  first_served_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, question_id)
);

COMMENT ON TABLE public.attempt_items_served IS
  'One row per item DISPLAYED to a child in an attempt. The answer-table complement: responses says what they did, this says what they were given. Written by /api/runner/served, read only by the reporting layer.';

CREATE INDEX IF NOT EXISTS ix_attempt_items_served_question
  ON public.attempt_items_served (question_id);

-- RLS on, and forced, so the table owner cannot be the only thing enforcing it
-- (PR-07's rule, applied to a public table this time).
ALTER TABLE public.attempt_items_served ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempt_items_served FORCE ROW LEVEL SECURITY;

-- INSERT only, and only into the caller's own attempt. Mirrors
-- `Student can insert own responses` exactly; is_attempt_owner() already folds in
-- the synthetic-student identity check, so a parent cannot write another family's
-- exposure history.
DROP POLICY IF EXISTS "Student can record own served items" ON public.attempt_items_served;
CREATE POLICY "Student can record own served items"
  ON public.attempt_items_served
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_attempt_owner(attempt_id));

-- No SELECT policy on purpose (see header): default-deny for every browser role.
-- service_role and postgres carry BYPASSRLS, which is how the ETL reads it.
REVOKE ALL ON TABLE public.attempt_items_served FROM anon;
GRANT INSERT ON TABLE public.attempt_items_served TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. The reporting fact
-- ----------------------------------------------------------------------------
-- Shaped like every other fact here: immutable keys, no PII, one row per
-- (attempt, item). It is separate from fact_item_response rather than a nullable
-- column on it, because the two have different multiplicities - a response may
-- exist without a served row (legacy attempts, a retried save) and a served row
-- usually has no response at all. Folding them would make `is_correct` nullable
-- and quietly change every consumer of that table.
CREATE TABLE IF NOT EXISTS reporting.fact_item_served (
  attempt_id    uuid NOT NULL,
  item_id       uuid NOT NULL,
  test_id       uuid NOT NULL,
  student_id    uuid NOT NULL,
  date_key      integer NOT NULL,          -- first-served day, Australia/Melbourne
  served_at     timestamptz NOT NULL,
  etl_loaded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, item_id),
  CHECK (date_key > 0)
);

COMMENT ON TABLE reporting.fact_item_served IS
  'Warehouse copy of public.attempt_items_served, one row per item displayed in an attempt. The denominator A1 skip rate and A4 reliability were missing. No PII: keys only.';

-- A served row removed upstream (privacy request, cascade from the attempt being
-- deleted) must not outlive itself in the warehouse.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'reporting.fact_item_served'::regclass
                   AND conname = 'fact_item_served_attempt_item_fkey') THEN
    ALTER TABLE reporting.fact_item_served
      ADD CONSTRAINT fact_item_served_attempt_item_fkey
      FOREIGN KEY (attempt_id, item_id)
      REFERENCES public.attempt_items_served(attempt_id, question_id)
      ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE reporting.fact_item_served ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.fact_item_served FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS ix_fact_item_served_item
  ON reporting.fact_item_served (item_id, date_key DESC);
CREATE INDEX IF NOT EXISTS ix_fact_item_served_student
  ON reporting.fact_item_served (student_id, date_key DESC);
CREATE INDEX IF NOT EXISTS ix_fact_item_served_test
  ON reporting.fact_item_served (test_id, item_id);

GRANT SELECT ON reporting.fact_item_served TO reporting_ro;

-- ----------------------------------------------------------------------------
-- 3. The loader
-- ----------------------------------------------------------------------------
-- INSERT-missing rather than delete-and-rebuild: served rows are immutable once
-- written, so "anything not yet in the fact" IS the delta. Unlike enquiries
-- (111), a served row never changes status, so there is no reason to re-read the
-- whole table each night.
--
-- Deliberately NOT keyed on a high-water timestamp: a late-arriving beacon can
-- insert a row with an OLDER first_served_at than the newest already loaded, and
-- a watermark would silently drop it. The primary key is the only correct guard.
CREATE OR REPLACE FUNCTION reporting.load_served_facts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $fn$
DECLARE
  v_rows integer;
BEGIN
  INSERT INTO reporting.fact_item_served (
    attempt_id, item_id, test_id, student_id, date_key, served_at, etl_loaded_at)
  SELECT s.attempt_id,
         s.question_id,
         a.test_id,
         a.student_id,
         to_char(s.first_served_at AT TIME ZONE 'Australia/Melbourne', 'YYYYMMDD')::int,
         s.first_served_at,
         now()
  FROM public.attempt_items_served s
  JOIN public.attempts a ON a.id = s.attempt_id
  ON CONFLICT (attempt_id, item_id) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- Recorded so DA-15 (refresh lag) can see this object the way it sees the
  -- materialised views; a fact table nobody refreshes is a silent lie too.
  INSERT INTO reporting.etl_watermark (object_name, high_water)
  VALUES ('fact_item_served', now())
  ON CONFLICT (object_name) DO UPDATE
    SET high_water = EXCLUDED.high_water, updated_at = now();

  RETURN v_rows;
END;
$fn$;

REVOKE ALL ON FUNCTION reporting.load_served_facts() FROM PUBLIC, anon, authenticated, reporting_ro;
-- NOT reporting_ro. Worth spelling out, because granting this to the read-only
-- role is the obvious-looking mistake that AC-75 exists to catch - and it caught
-- this migration, which is the test working. A loader writes; the read-only role
-- must not be able to. service_role and postgres run the cron job.
--
-- The REVOKE above has to name reporting_ro explicitly: grants are additive, and
-- "REVOKE ... FROM PUBLIC" does NOT undo a grant made to a specific role. Leaving
-- it out left the grant in place on a re-apply, which is how this was found.
GRANT EXECUTE ON FUNCTION reporting.load_served_facts() TO postgres, service_role;

-- ----------------------------------------------------------------------------
-- 4. Schedule
-- ----------------------------------------------------------------------------
-- Hourly at :20, which keeps it clear of the */15 platform-health refresh, the
-- */30 event loader and A13's :10. Re-running cron.schedule on an existing name
-- updates it in place, so this stays idempotent.
SELECT cron.schedule(
  'rpt-served-facts',
  '20 * * * *',
  $$SELECT reporting.load_served_facts()$$
);

-- ----------------------------------------------------------------------------
-- 5. Self-tests, at apply time
-- ----------------------------------------------------------------------------
-- STRUCTURAL only. The behaviour that matters - "a second load inserts nothing,
-- a student can record their own attempt and nobody else's, anon cannot write" -
-- lives in supabase/tests/assurance.sql, because proving it requires fixture rows
-- and this file must run against a database where the capture is legitimately
-- empty. A test that needs data and runs at apply time either invents data in
-- production or passes vacuously.
DO $do$
DECLARE
  v int;
  v_bad text;
BEGIN
  -- The grain IS the primary key. Without it a duplicate beacon would inflate
  -- every exposure count rather than being absorbed.
  SELECT count(*) INTO v
  FROM pg_constraint
  WHERE conrelid = 'public.attempt_items_served'::regclass
    AND contype = 'p'
    AND conname = 'attempt_items_served_pkey';
  IF v <> 1 THEN
    RAISE EXCEPTION '122 self-test: attempt_items_served has no primary key';
  END IF;

  SELECT count(*) INTO v
  FROM pg_class c
  WHERE c.oid = 'public.attempt_items_served'::regclass
    AND c.relrowsecurity AND c.relforcerowsecurity;
  IF v <> 1 THEN
    RAISE EXCEPTION '122 self-test: attempt_items_served must have RLS enabled and forced';
  END IF;

  SELECT count(*) INTO v
  FROM pg_class c
  WHERE c.oid = 'reporting.fact_item_served'::regclass
    AND c.relrowsecurity AND c.relforcerowsecurity;
  IF v <> 1 THEN
    RAISE EXCEPTION '122 self-test: fact_item_served must have RLS enabled and forced';
  END IF;

  -- Least privilege, asserted rather than described in a comment: exactly one
  -- INSERT policy and no policy at all that grants a read, an update or a delete
  -- to a browser role.
  SELECT count(*) INTO v
  FROM pg_policy WHERE polrelid = 'public.attempt_items_served'::regclass;
  IF v <> 1 THEN
    RAISE EXCEPTION '122 self-test: expected exactly one policy, found %', v;
  END IF;

  SELECT string_agg(polname, ', ') INTO v_bad
  FROM pg_policy
  WHERE polrelid = 'public.attempt_items_served'::regclass
    AND polcmd <> 'a';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '122 self-test: non-INSERT policy present (%); served rows are insert-only', v_bad;
  END IF;

  IF has_table_privilege('anon', 'public.attempt_items_served', 'INSERT')
     OR has_table_privilege('anon', 'public.attempt_items_served', 'SELECT') THEN
    RAISE EXCEPTION '122 self-test: anon can reach attempt_items_served';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.attempt_items_served', 'INSERT') THEN
    RAISE EXCEPTION '122 self-test: authenticated cannot insert, so the runner would silently record nothing';
  END IF;

  IF has_table_privilege('authenticated', 'reporting.fact_item_served', 'SELECT') THEN
    RAISE EXCEPTION '122 self-test: fact_item_served is reachable by authenticated';
  END IF;

  -- The loader must be a no-op the second time and must never duplicate: on any
  -- database, fact count must equal source count for the attempts it can join.
  PERFORM reporting.load_served_facts();
  SELECT count(*) INTO v FROM reporting.fact_item_served;
  IF v <> (SELECT count(*) FROM public.attempt_items_served s
             JOIN public.attempts a ON a.id = s.attempt_id) THEN
    RAISE EXCEPTION '122 self-test: fact_item_served does not match its source (% vs %)',
      v, (SELECT count(*) FROM public.attempt_items_served);
  END IF;

  IF reporting.load_served_facts() <> 0 THEN
    RAISE EXCEPTION '122 self-test: load_served_facts inserted rows on an already-loaded table';
  END IF;

  RAISE NOTICE '122 self-test ok: insert-only capture, RLS forced, loader idempotent (% rows)', v;
END;
$do$;
