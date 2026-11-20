-- ============================================================================
-- 116 - load_enquiry_facts is not executable by the read-only reporting role
--
-- WHAT THIS FIXES, AND WHY IT MATTERS MORE THAN IT LOOKS
--   111 granted EXECUTE on reporting.load_enquiry_facts to `reporting_ro`. That
--   role's name says what it is for: reading. The grant does not merely widen
--   read access - load_enquiry_facts is SECURITY DEFINER and owned by postgres,
--   so it runs TRUNCATE and INSERT as the *owner*, regardless of what the caller
--   may do to the table. A role with no write privileges on any table can
--   therefore empty and rebuild the warehouse. The privilege check that makes
--   `reporting_ro` safe to hand to a dashboard tool is bypassed by the one thing
--   it was granted for convenience.
--
--   It is not even expensive to trigger: one call truncates fact_enquiry, and
--   until the next hourly load the A13 panel reports an empty queue. On a
--   dashboard whose headline is "are enquiries answered in time", an empty table
--   is indistinguishable from a good night.
--
--   The claim worth recording is how this was found. It was not reviewed into
--   place: 111's own text argues at length that the loader follows the house
--   watermark pattern, and the GRANT was written to match. It surfaced only when
--   the privilege matrix was queried directly, and the answer for every other
--   loader in the schema is `false` - so this was never the convention. The
--   comment in 111 that reads like a description of the codebase was a
--   description of what was assumed about it.
--
-- WHY AN INVARIANT RATHER THAN A SINGLE REVOCATION
--   AC-75 asserts across *all* reporting loaders, not just this one, because the
--   failure mode is repeating the mistake with the next fact table rather than
--   relearning it here.
--
-- Idempotent: safe to re-run.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION reporting.load_enquiry_facts(boolean) FROM reporting_ro;

COMMENT ON FUNCTION reporting.load_enquiry_facts(boolean) IS
  'Rebuilds reporting.fact_enquiry from public.enquiries. SECURITY DEFINER and postgres-owned, so it truncates as the owner: callable by the ETL cron job (postgres) and nothing else. 116 removed the reporting_ro grant - a read-only role must not be able to rebuild the warehouse through a definer function it cannot write to directly.';

-- ----------------------------------------------------------------------------
-- Self-check: no reporting loader is executable by the read-only role
-- ----------------------------------------------------------------------------
-- Written as a scan rather than a list of names, so a future load_* added with
-- the same well-meaning grant fails here instead of in production.
DO $$
DECLARE
  v_offenders text;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_offenders
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'reporting'
    AND p.prokind = 'f'
    AND p.proname LIKE 'load\_%'
    AND has_function_privilege('reporting_ro', p.oid::regprocedure, 'EXECUTE');

  IF v_offenders IS NOT NULL THEN
    RAISE EXCEPTION
      '116 self-test: reporting_ro can execute % - a read-only role reaching a SECURITY DEFINER writer bypasses its own table privileges',
      v_offenders
      USING ERRCODE = 'raise_exception';
  END IF;

  -- The scheduler must still be able to do the work, or this migration would
  -- have broken the pipeline it hardened.
  IF NOT has_function_privilege('postgres',
       'reporting.load_enquiry_facts(boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION '116 self-test: the ETL owner can no longer load enquiry facts'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- And the hourly job must be intact, since that is what actually calls this.
  IF NOT EXISTS (SELECT 1 FROM cron.job
                 WHERE jobname = 'rpt-enquiry-daily'
                   AND command LIKE '%load_enquiry_facts%') THEN
    RAISE EXCEPTION '116 self-test: the rpt-enquiry-daily job is missing'
      USING ERRCODE = 'raise_exception';
  END IF;
END $$;
