-- ============================================================================
-- 118 - The reset parity expectations are generated, not hand-tuned
--
-- WHAT WAS WRONG
--   scripts/reset-via-psql.mjs ends with a list of object counts meant to prove
--   that a database rebuilt from the backup equals the live one. The list was
--   written by hand and never regenerated: it expects 57 public functions where
--   live now has 69, 24 reporting tables against 28, and 14 rpt-* cron jobs
--   against 15. So the check whose entire purpose is to notice drift had itself
--   drifted - and the drift it accumulated is the drift it exists to catch,
--   including the privilege gap 117 fixed, which this list could never have seen
--   because it counted objects and never inspected grants.
--
--   A stale expectation is worse than no expectation. It trains the next person
--   to read a failing parity line as "that list is out of date" rather than "the
--   restore is wrong", and on the one occasion it matters - after a restore that
--   actually lost something - the failure is indistinguishable from the noise.
--
-- WHAT THIS IS
--   Functions that derive every schema-object expectation, and every privilege
--   invariant, from the database they are asked about. schema:rebaseline calls
--   them against live and writes baseline/parity.json; the reset script reads
--   that file and re-runs the privilege checks against the restored target.
--   Regenerating the baseline and regenerating its expectations become the same
--   act, which is the only arrangement under which they cannot disagree forever.
--
--   Seed contents (54 tests, 1900 questions) are deliberately NOT derived from
--   live: they are a property of the seed files, and measuring a restore against
--   live would make the check tautological - a restore that lost content would be
--   graded against a live database that had also lost it.
--
-- THE EXCLUSIONS, STATED
--   Every legitimate difference between live and a restore is named rather than
--   absorbed into a magic number, so each is a claim a reader can challenge. If a
--   future change makes an excluded object restorable, deleting the exclusion is
--   the fix, and the parity check will say so.
--
-- Idempotent: safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION reporting.export_baseline_parity()
RETURNS TABLE(label text, expected bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $p$
BEGIN
  RETURN QUERY
  WITH tooling(name) AS (
    -- Live-only capture entry points, omitted from the baseline by design: a
    -- faithful restore therefore does not have them either, and counting them
    -- would make every parity run fail for a reason that is not a defect.
    VALUES ('export_schema_baseline'), ('export_baseline_function_acls'),
           ('export_baseline_parity')
  )
  SELECT lbl, val FROM (
    SELECT 'public tables'::text AS lbl, count(*)::bigint AS val
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'

    UNION ALL
    SELECT 'public functions', count(*)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND p.proname NOT IN (SELECT name FROM tooling)

    UNION ALL
    SELECT 'public policies', count(*)
    FROM pg_policies WHERE schemaname = 'public'

    UNION ALL
    SELECT 'auth triggers', count(*)
    FROM pg_trigger
    WHERE NOT tgisinternal AND tgrelid = 'auth.users'::regclass

    UNION ALL
    SELECT 'reporting tables', count(*)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'reporting' AND c.relkind = 'r'

    UNION ALL
    SELECT 'reporting matviews', count(*)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'reporting' AND c.relkind = 'm'

    UNION ALL
    SELECT 'reporting views', count(*)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'reporting' AND c.relkind = 'v'

    UNION ALL
    SELECT 'reporting functions', count(*)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'reporting' AND p.prokind = 'f'
      AND p.proname NOT LIKE 'export\_baseline%'

    UNION ALL
    SELECT 'reporting indexes', count(*)
    FROM pg_indexes WHERE schemaname = 'reporting'

    UNION ALL
    SELECT 'dim_date rows', count(*) FROM reporting.dim_date

    UNION ALL
    SELECT 'rpt cron jobs', count(*) FROM cron.job WHERE jobname LIKE 'rpt-%'
  ) s
  ORDER BY lbl;
END;
$p$;

REVOKE ALL ON FUNCTION reporting.export_baseline_parity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reporting.export_baseline_parity() TO postgres, service_role;

-- Public entry point, for the reason 117 records: PostgREST advertises `public`,
-- so a capture tool reachable only from `reporting` would 404 in the capture step
-- and the expectations would quietly stop being regenerated - the exact failure
-- this migration exists to prevent, reintroduced by its own plumbing.
CREATE OR REPLACE FUNCTION public.export_baseline_parity()
RETURNS TABLE(label text, expected bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'reporting', 'pg_catalog'
AS $$
  SELECT * FROM reporting.export_baseline_parity();
$$;

REVOKE ALL ON FUNCTION public.export_baseline_parity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.export_baseline_parity() TO postgres, service_role;

-- ----------------------------------------------------------------------------
-- Privilege invariants
-- ----------------------------------------------------------------------------
-- Deliberately not counts in a generated file. A count proves the restore made
-- the same objects; these prove it made the same *reachability*, which is the
-- half where 117's defect lived. Written as booleans so the reset script can ask
-- the same question of live and of a restored target: faithful restore, same
-- answers; unfaithful restore, an answer that differs and names itself.
--
-- Each is phrased as the question an operator would actually ask ("can anon run
-- this?") rather than as an ACL regex, because ACL text has several shapes that
-- all mean the same thing and a pattern over them is a source of bugs, not a
-- check for them.
CREATE OR REPLACE FUNCTION reporting.privilege_parity_checks()
RETURNS TABLE(name text, holds boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $v$
BEGIN
  -- 1. The condition 117 was written to keep true after a restore.
  RETURN QUERY SELECT 'no reporting function is reachable by anon', NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'reporting' AND p.prokind = 'f'
      AND has_function_privilege('anon', p.oid::regprocedure, 'EXECUTE')
  );

  -- 2. A read-only role must not be able to run a postgres-owned writer.
  RETURN QUERY SELECT 'no reporting loader is executable by reporting_ro', NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'reporting' AND p.prokind = 'f'
      AND p.proname LIKE 'load\_%'
      AND has_function_privilege('reporting_ro', p.oid::regprocedure, 'EXECUTE')
  );

  -- 3. The contact audit log is append-only for the service credential, too.
  RETURN QUERY SELECT 'service_role cannot edit the contact audit log',
    NOT has_table_privilege('service_role', 'public.enquiry_contact_access_log', 'UPDATE')
    AND NOT has_table_privilege('service_role', 'public.enquiry_contact_access_log', 'DELETE');

  -- 4. Inbound capture stays service-role-only.
  RETURN QUERY SELECT 'inbound capture is not reachable by app roles',
    NOT has_function_privilege('anon',
      'public.record_inbound_email(text,text,text,text,timestamptz,jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated',
      'public.record_inbound_email(text,text,text,text,timestamptz,jsonb)', 'EXECUTE');

  -- 5. Restricted contact details stay unreadable outside the audited function.
  RETURN QUERY SELECT 'enquiry_contacts is unreadable by app roles',
    NOT has_table_privilege('authenticated', 'public.enquiry_contacts', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.enquiry_contacts', 'SELECT');

  -- 6. PR-07 as an invariant rather than a count compared against a manifest.
  RETURN QUERY SELECT 'every reporting table forces RLS', NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'reporting' AND c.relkind = 'r'
      AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
  );
END;
$v$;

REVOKE ALL ON FUNCTION reporting.privilege_parity_checks() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reporting.privilege_parity_checks() TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.privilege_parity_checks()
RETURNS TABLE(name text, holds boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'reporting', 'pg_catalog'
AS $$
  SELECT * FROM reporting.privilege_parity_checks();
$$;

REVOKE ALL ON FUNCTION public.privilege_parity_checks() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.privilege_parity_checks() TO postgres, service_role;

-- ----------------------------------------------------------------------------
-- Self-check: live must pass every invariant it claims a restore will pass
-- ----------------------------------------------------------------------------
-- If any of these were already false on live, the parity check would be a
-- machine that always blames the restore - the same trap as a baseline captured
-- from a schema that is itself wrong. Asserted here, at apply time, so the
-- invariants are known-good before anything relies on them.
DO $$
DECLARE
  r       record;
  v_bad   text;
  v_count integer;
BEGIN
  SELECT string_agg(x.name, ', ') INTO v_bad
  FROM (
    SELECT ppc.name FROM public.privilege_parity_checks() ppc WHERE NOT ppc.holds
  ) x;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      '118 self-test: live itself fails these invariants - % - so parity checking would only ever blame the restore',
      v_bad USING ERRCODE = 'raise_exception';
  END IF;

  SELECT count(*) INTO v_count FROM public.privilege_parity_checks();
  IF v_count < 6 THEN
    RAISE EXCEPTION '118 self-test: expected 6 privilege invariants, got %', v_count
      USING ERRCODE = 'raise_exception';
  END IF;

  -- The counts must be non-empty and internally sane; a zero here would mean the
  -- capture is generating expectations from an empty catalog, which restores as
  -- "everything is missing" and reads like a broken restore rather than a broken
  -- capture.
  IF (SELECT count(*) FROM public.export_baseline_parity()) < 10 THEN
    RAISE EXCEPTION '118 self-test: parity metric list is unexpectedly short'
      USING ERRCODE = 'raise_exception';
  END IF;

  IF EXISTS (SELECT 1 FROM public.export_baseline_parity() WHERE expected <= 0) THEN
    RAISE EXCEPTION '118 self-test: a parity expectation is zero or negative'
      USING ERRCODE = 'raise_exception';
  END IF;
END $$;
