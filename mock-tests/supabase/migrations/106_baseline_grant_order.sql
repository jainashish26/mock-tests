-- 106_baseline_grant_order.sql
-- Make the generated schema baseline byte-stable.
--
-- WHY THIS IS AN ASSURANCE FIX AND NOT COSMETICS
--   `reporting.export_baseline('grants')` aggregated with
--
--       ORDER BY r.relname, r.priv
--
--   which leaves the tie unresolved whenever one table grants the same privilege
--   to more than one role - exactly the case that matters here, because every
--   reporting table is readable by both `reporting_ro` and `postgres`. Postgres
--   is free to break that tie either way, and it did: regenerating the baseline
--   after migration 105 rewrote 48 lines of `06_grants.sql` with **no change of
--   content** - every added line had an identical removed line.
--
--   That looks harmless in a diff and is not. The baseline is the artifact that
--   makes a restore reproducible, and `schema:validate` is the test that proves
--   it. A file that reorders itself on every run trains the reader to skim grant
--   churn, which is precisely where a real change would hide: a widened grant to
--   `anon`, or a `reporting_ro` SELECT quietly dropped, arrives as one more line
--   in a 48-line shuffle. Non-determinism in a security-relevant generated file
--   is not noise, it is the removal of the signal.
--
-- WHY ORDER BY THE ROLE NAME, NOT THE OID
--   `grantee` is an oid, and oids are not preserved across a restore - a role
--   recreated gets a new number. Sorting by `pg_get_userbyid(grantee)` is stable
--   across dump-and-restore, which is the only comparison that ever happens here.
--   `PUBLIC` (grantee 0) sorts by its own literal, so it comes first rather than
--   wherever a number happens to land.
--
-- The output is the same set of statements in a fixed order. Nothing about the
-- grants themselves changes, which is why this is safe to apply to a live project.

CREATE OR REPLACE FUNCTION reporting.export_baseline(p_part text)
 RETURNS TABLE(filename text, content text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
BEGIN
  -- Authorise here as well as by grant: PostgREST reaches this directly, so a
  -- grant alone is not a control (the lesson of migration 044).
  IF current_user NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  IF p_part NOT IN ('functions','views','indexes','tables','grants','cron','config','rls','public_wrappers','public_grants') THEN
    RAISE EXCEPTION 'unknown export part: %', p_part USING ERRCODE = '22023';
  END IF;

  IF p_part = 'functions' THEN
    RETURN QUERY
    SELECT 'reporting/functions.sql'::text,
           string_agg(pg_get_functiondef(p.oid) || E';\n\n', ''
                      ORDER BY p.proname, pg_get_function_identity_arguments(p.oid))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'reporting' AND p.proname <> 'export_baseline';
    RETURN;
  END IF;

  IF p_part = 'views' THEN
    RETURN QUERY
    SELECT 'reporting/views.sql'::text,
           string_agg(
             CASE WHEN c.relkind = 'm'
               THEN format(E'CREATE MATERIALIZED VIEW reporting.%I AS\n%s;\n\n', c.relname, pg_get_viewdef(c.oid, true))
               ELSE format(E'CREATE OR REPLACE VIEW reporting.%I AS\n%s;\n\n', c.relname, pg_get_viewdef(c.oid, true))
             END, '' ORDER BY c.relkind DESC, c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'reporting' AND c.relkind IN ('v','m');
    RETURN;
  END IF;

  IF p_part = 'indexes' THEN
    RETURN QUERY
    SELECT 'reporting/indexes.sql'::text,
           string_agg(indexdef || E';\n', '' ORDER BY tablename, indexname)
    FROM pg_indexes WHERE schemaname = 'reporting';
    RETURN;
  END IF;

  IF p_part = 'grants' THEN
    RETURN QUERY
    -- `aclexplode` is expanded once, laterally, rather than being written out
    -- for each column. The original spelled it three times, which is not merely
    -- repetitive: it is why the grantee could not be resolved in a CASE at all,
    -- since "(aclexplode(...)).grantee" inside a CASE is rejected as
    -- "argument of CASE/WHEN must not return a set". A single lateral expansion
    -- gives the sort key and the emitted text the same value by construction.
    WITH rel AS (
      SELECT c.relname,
             a.privilege_type AS priv,
             CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                  ELSE pg_get_userbyid(a.grantee)
             END AS grantee_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN aclexplode(c.relacl) AS a
      WHERE n.nspname = 'reporting' AND c.relkind IN ('r','v','m','S')
    )
    SELECT 'reporting/grants.sql'::text,
           string_agg(format('GRANT %s ON reporting.%I TO %s;', r.priv, r.relname, r.grantee_name),
                      -- The third key is the whole point of this migration: two
                      -- roles holding the same privilege on one table were
                      -- previously tie-broken by whatever order Postgres chose.
                      E'\n' ORDER BY r.relname, r.priv, r.grantee_name)
    FROM rel r;
    RETURN;
  END IF;

  IF p_part = 'rls' THEN
    RETURN QUERY
    SELECT 'reporting/rls.sql'::text,
           string_agg(format('ALTER TABLE reporting.%I %s ROW LEVEL SECURITY; ALTER TABLE reporting.%I %s ROW LEVEL SECURITY;',
                             c.relname, CASE WHEN c.relrowsecurity THEN 'ENABLE' ELSE 'DISABLE' END,
                             c.relname, CASE WHEN c.relforcerowsecurity THEN 'FORCE' ELSE 'NO FORCE' END),
                      E'\n' ORDER BY c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'reporting' AND c.relkind = 'r';
    RETURN;
  END IF;

  IF p_part = 'cron' THEN
    RETURN QUERY
    SELECT 'reporting/cron.sql'::text,
           string_agg(format(E'SELECT cron.unschedule(%L) WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = %L);\nSELECT cron.schedule(%L, %L, %L);\n\n',
                             j.jobname, j.jobname, j.jobname, j.schedule, j.command),
                      '' ORDER BY j.jobname)
    FROM cron.job j WHERE j.jobname LIKE 'rpt-%';
    RETURN;
  END IF;

  IF p_part = 'public_wrappers' THEN
    RETURN QUERY
    SELECT 'public/reporting_wrappers.sql'::text,
           string_agg(pg_get_functiondef(p.oid) || E';\n\n', ''
                      ORDER BY p.proname, pg_get_function_identity_arguments(p.oid))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      -- Every public SECURITY DEFINER function is load-bearing: RLS predicates,
      -- auth triggers, report RPCs. Only the export tooling is excluded.
      AND p.proname <> 'export_schema_baseline';
    RETURN;
  END IF;

  IF p_part = 'public_grants' THEN
    RETURN QUERY
    SELECT 'public/grants.sql'::text,
           E'-- Tables deliberately not browser-readable: RLS enabled, no policies, and\n'
        || E'-- SELECT withheld from authenticated and anon. Derived from live ACLs (066).\n'
        || COALESCE(string_agg(
             format('REVOKE SELECT ON TABLE public.%I FROM authenticated, anon;', c.relname),
             E'\n' ORDER BY c.relname), '')
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
      AND NOT EXISTS (SELECT 1 FROM pg_policies pol
                      WHERE pol.schemaname='public' AND pol.tablename=c.relname)
      AND NOT has_table_privilege('authenticated', c.oid, 'SELECT')
      AND NOT has_table_privilege('anon', c.oid, 'SELECT');
    RETURN;
  END IF;

  RAISE EXCEPTION 'export part % is handled by a dedicated exporter', p_part USING ERRCODE = '0A000';
END;
$function$;

COMMENT ON FUNCTION reporting.export_baseline(text) IS
  'Emit one part of the reproducible schema baseline from live catalog state. Service-role only, enforced in-body as well as by grant (044). Every part is aggregated with a total order, so regenerating the baseline is a no-op unless the schema actually changed: grants sort by relname, privilege, then role NAME rather than oid, because oids are not preserved across a restore (106).';

