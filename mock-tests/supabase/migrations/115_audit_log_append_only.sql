-- ============================================================================
-- 115 - The contact access log is append-only, including for service_role
--
-- WHY THIS EXISTS
--   AC-37 in this suite was written to check that the audit trail cannot be
--   edited, and it failed on the first run. `service_role` holds INSERT, SELECT,
--   UPDATE *and* DELETE on public.enquiry_contact_access_log - not from any
--   deliberate grant in this project's migrations, but from the platform default
--   of granting ALL on the app schema to the service credential.
--
--   That matters more here than it would on an ordinary table. The entire privacy
--   story for enquiry contacts is: details live in a table no app role can read,
--   and the only door is a function that writes a record of who opened it. If the
--   credential the backend runs as can quietly delete or rewrite those records,
--   the door exists but the ledger does not, and every claim in 12-...md about
--   audited access is still true in prose and false in practice. This is also the
--   least visible kind of gap, because nothing in the application needs those
--   privileges: an audit trail's guarantees are only exercised when something
--   goes wrong, which is exactly when the log matters and nobody has tested it.
--
--   Verified before revoking: the only writer is read_enquiry_contact, a
--   SECURITY DEFINER function owned by postgres, so it inserts as the owner and is
--   unaffected. No cron job, migration or function deletes or updates this table.
--   Nothing that currently works will stop working.
--
-- WHAT IS DELIBERATELY LEFT ALONE
--   service_role keeps INSERT and SELECT. The ingest paths write as it in places,
--   and operators query it. Removing UPDATE/DELETE is the whole claim; a table
--   nobody can insert into is a different bug.
--
--   The same default almost certainly applies to other append-only-ish tables
--   (event logs, refresh_log). Each needs its own check that no legitimate job
--   prunes it, so they are not batched in here: a security grant changed under a
--   "while I am here" banner is how retention jobs break in production. This
--   migration fixes the one table whose contents are a privacy guarantee.
--
-- Idempotent: safe to re-run.
-- ============================================================================

REVOKE UPDATE, DELETE ON public.enquiry_contact_access_log FROM service_role;
REVOKE UPDATE, DELETE ON public.enquiry_contact_access_log FROM anon, authenticated;
REVOKE UPDATE, DELETE ON public.enquiry_contact_access_log FROM reporting_ro;

COMMENT ON TABLE public.enquiry_contact_access_log IS
  'Append-only record of every enquiry contact reveal. 115 revoked UPDATE and DELETE from service_role as well as the app roles: the privacy promise this table exists to evidence is only as good as the impossibility of editing it. Owner (postgres) retains all privileges for recovery, and read_enquiry_contact writes as SECURITY DEFINER so it is unaffected.';

DO $$
BEGIN
  IF has_table_privilege('service_role','public.enquiry_contact_access_log','UPDATE')
     OR has_table_privilege('service_role','public.enquiry_contact_access_log','DELETE') THEN
    RAISE EXCEPTION '115 self-test: service_role can still % the access log',
      CASE WHEN has_table_privilege('service_role','public.enquiry_contact_access_log','UPDATE')
           THEN 'update' ELSE 'delete' END
      USING ERRCODE = 'raise_exception';
  END IF;

  -- The writer must still be able to write, or this migration would have
  -- disabled auditing rather than protected it.
  IF NOT has_table_privilege('postgres','public.enquiry_contact_access_log','INSERT') THEN
    RAISE EXCEPTION '115 self-test: the audit log can no longer be written to'
      USING ERRCODE = 'raise_exception';
  END IF;
END $$;
