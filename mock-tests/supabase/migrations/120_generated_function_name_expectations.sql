-- 120_generated_function_name_expectations.sql
--
-- WHY (found by RUNNING the reset proof, not by reading it, 2026-11-22):
-- The scratch rebuild finished "RESET COMPLETE - all parity checks pass" while
-- the rebuilt database was missing a function that exists on live:
-- reporting.export_baseline, the capture dispatcher itself. Nothing was wrong
-- with the restore. The instrument was wrong.
--
--   reporting functions: 29 (expected 29)   <- both sides agreed
--   live actually holds 33 prokind='f' functions in reporting
--
-- The metric excluded `proname NOT LIKE 'export\_baseline%'`, so it graded 29 of
-- 33: four captured functions were invisible to the check, and the one function
-- the restore genuinely could not reproduce sat inside that blind spot. A count
-- cannot see WHICH objects exist, so it cannot see one object traded for
-- another - and here a count was also quietly subtracting a category.
--
-- The comment justifying it claimed three names were "live-only capture entry
-- points, omitted from the baseline by design... a faithful restore therefore
-- does not have them either". Checked against the capture files, two of those
-- three ARE in the baseline: export_baseline_function_acls and
-- export_baseline_parity each appear in 02_functions.sql and
-- 08_public_wrappers.sql. This is the identical failure 119 corrected in 117's
-- ACL exclusions - a belief about the capture, stated in a file whose job is to
-- keep the capture honest. The truth is that the capture omits exactly ONE
-- reporting function, because export_baseline's body ends with
--   WHERE n.nspname = 'reporting' AND p.proname <> 'export_baseline'
-- i.e. it declines to capture itself.
--
-- FIX: stop asserting which functions are live-only, and derive it.
--   * export_baseline_function_names() reports the complete, unfiltered name
--     set, so the reference standard cannot hide anything.
--   * export_baseline_parity() loses its two function-count rows: function
--     identity is a set question, not a count question.
--   * rebaseline_schema.py computes the restorable set by grepping the capture
--     files for each live name and writes both the expected lists and the
--     resulting exclusions into parity.json. The exclusion list is a measurement
--     of what the files contain, so it cannot rot into a lie the way a
--     hand-written VALUES list did.
--   * the harness compares target names against those lists and prints any
--     missing/extra name, instead of two numbers that agreed by construction.

CREATE OR REPLACE FUNCTION reporting.export_baseline_function_names()
 RETURNS TABLE(schema_name text, function_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
BEGIN
  -- Deliberately unfiltered. Every prior attempt to be helpful here - skipping
  -- "tooling", skipping a name prefix - is what let a missing function pass.
  RETURN QUERY
  SELECT n.nspname::text, p.proname::text
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'reporting')
    AND p.prokind = 'f'
  ORDER BY 1, 2;
END;
$function$;

-- Without this line the above is a privilege hole, and 118's own invariant
-- caught it during this migration: every sibling export function in reporting
-- reads `postgres=X / service_role=X`, while a freshly created one lands on the
-- Supabase default ACL, which is PUBLIC execute. Repeating the pattern the
-- siblings use, verified against their actual proacl rather than assumed.
REVOKE ALL ON FUNCTION reporting.export_baseline_function_names() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reporting.export_baseline_function_names() TO postgres, service_role;

CREATE OR REPLACE FUNCTION reporting.export_baseline_parity()
 RETURNS TABLE(label text, expected bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
BEGIN
  RETURN QUERY
  SELECT lbl, val FROM (
    SELECT 'public tables'::text AS lbl, count(*)::bigint AS val
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'

    UNION ALL
    -- 'public functions' and 'reporting functions' are GONE from this list,
    -- along with the tooling CTE and the NOT LIKE exclusion that came with
    -- them. Function identity is now checked as a name set via
    -- export_baseline_function_names(); see the header for what the counts hid.
    SELECT 'public policies'::text AS lbl, count(*)::bigint AS val
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
    SELECT 'reporting indexes', count(*)
    FROM pg_indexes WHERE schemaname = 'reporting'

    UNION ALL
    SELECT 'dim_date rows', count(*) FROM reporting.dim_date

    UNION ALL
    SELECT 'rpt cron jobs', count(*) FROM cron.job WHERE jobname LIKE 'rpt-%'
  ) s
  ORDER BY lbl;
END;
$function$;

CREATE OR REPLACE FUNCTION public.export_baseline_function_names()
 RETURNS TABLE(schema_name text, function_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'pg_catalog'
AS $function$
  SELECT * FROM reporting.export_baseline_function_names();
$function$;

-- Self-tests. These exist because the defect being fixed was a check that
-- agreed with itself. The assertions below are about the SHAPE of the
-- instrument, so a future edit that reintroduces filtering fails at apply time
-- instead of silently passing a restore.
DO $do$
DECLARE
  v_rows int;
  v_extra text;
BEGIN
  -- 1. The list must be unfiltered. Asserted as a property of the RESULT, not
  --    as the presence of particular optional objects - because this file runs
  --    against restore targets as well as live, and reporting.export_baseline is
  --    deliberately never captured (its own body ends
  --    `AND p.proname <> 'export_baseline'`). The first version of this test
  --    required both that dispatcher and public.export_schema_baseline to exist,
  --    which holds only on live, and the scratch rebuild correctly failed on it:
  --    an assertion written against one database and run against another.
  --    What the 118 metric actually got wrong was dropping the whole family with
  --    `NOT LIKE 'export_baseline%'`. Four members of that family ARE captured
  --    and present on every target, so requiring those four is portable AND is
  --    exactly the regression guard for that filtering.
  SELECT count(*) INTO v_rows
  FROM reporting.export_baseline_function_names()
  WHERE schema_name = 'reporting'
    AND function_name IN ('export_baseline_config', 'export_baseline_tables',
                          'export_baseline_function_acls', 'export_baseline_parity');
  IF v_rows <> 4 THEN
    RAISE EXCEPTION '120 self-test: name list is filtered - all four captured export-family functions must appear (found %)', v_rows;
  END IF;

  -- 2. The count-only function metrics must be gone, not merely re-tuned.
  SELECT string_agg(label, ', ') INTO v_extra
  FROM reporting.export_baseline_parity()
  WHERE label IN ('public functions', 'reporting functions');
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION '120 self-test: parity still emits count-only function metrics (%)', v_extra;
  END IF;

  -- 3. A silently-empty name list would make every set comparison vacuously
  --    true - the exact failure mode PR-02c exists to catch.
  SELECT count(*) INTO v_rows FROM reporting.export_baseline_function_names();
  IF v_rows < 90 THEN
    RAISE EXCEPTION '120 self-test: name list implausibly small (% rows); refusing to bless a vacuous check', v_rows;
  END IF;

  RAISE NOTICE '120 self-test ok: % names reported unfiltered, count-only function metrics removed', v_rows;
END;
$do$;

-- ----------------------------------------------------------------------------
-- The hole this migration opened, closed in the same file.
--
-- public.export_baseline_function_names() was created above as SECURITY
-- DEFINER, and on Supabase a new function in `public` inherits default
-- privileges that EXECUTE-grant anon and authenticated. Reading pg_proc.proacl
-- after applying showed exactly that: `=X/postgres / anon=X / authenticated=X`,
-- while its sibling export_baseline_parity has only postgres and service_role.
-- So the inventory function was callable by an anonymous API request - a
-- SECURITY DEFINER disclosure of the entire function list, introduced by the
-- very migration whose subject was making privilege checks honest. The
-- definition convention was copied from the siblings; the GRANT convention was
-- not checked, because it lives in app_baseline/public_schema.sql rather than
-- in 09_public_grants.sql.
-- ----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.export_baseline_function_names() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.export_baseline_function_names() TO service_role;

-- Why this is a permanent invariant and not a one-off fix: 119's PUBLIC-ACL
-- invariant is scoped to `reporting`, so nothing in privilege_parity_checks()
-- could see a PUBLIC-executable wrapper in `public`. That is the same class of
-- gap 118/119 were about - a check that cannot see the region where the defect
-- actually occurs.
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

  -- 7. What an unapplied 10_reporting_function_acls.sql looks like: every
  --    restored function sitting on the default PUBLIC execute ACL.
  RETURN QUERY SELECT 'no reporting function carries the default PUBLIC ACL', NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'reporting' AND p.prokind = 'f'
      AND EXISTS (
        SELECT 1 FROM unnest(COALESCE(p.proacl, ARRAY[]::aclitem[])) a
        WHERE split_part(a::text, '=', 1) = ''
      )
  );

  -- 8. A SECURITY DEFINER capture/inventory wrapper in `public` must not be
  --    reachable by anon or by PUBLIC: it runs as the owner and returns
  --    internal structure. The absence of this invariant is what let the hole
  --    described above exist while every check still reported green.
  RETURN QUERY SELECT 'no public capture wrapper is reachable by anon', NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND p.prosecdef AND p.proname LIKE 'export\_%'
      AND (
        has_function_privilege('anon', p.oid::regprocedure, 'EXECUTE')
        OR EXISTS (
          SELECT 1 FROM unnest(COALESCE(p.proacl, ARRAY[]::aclitem[])) a
          WHERE split_part(a::text, '=', 1) = ''
        )
      )
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

DO $do$
DECLARE
  v_count int;
  v_bad text;
BEGIN
  SELECT count(*) INTO v_count FROM reporting.privilege_parity_checks();
  IF v_count <> 8 THEN
    RAISE EXCEPTION '120 self-test: expected 8 privilege invariants, got %', v_count;
  END IF;

  -- This file runs on live and on restore targets, so the message must not
  -- claim a database it has not seen. Same wording discipline as above.
  SELECT string_agg(name, ', ') INTO v_bad
  FROM reporting.privilege_parity_checks() WHERE NOT holds;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '120 self-test: this database violates its own invariants (%)', v_bad;
  END IF;

  RAISE NOTICE '120 self-test ok: 8 invariants, all holding here';
END;
$do$;
