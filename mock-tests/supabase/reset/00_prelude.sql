-- ============================================================================
-- reset/00_prelude.sql - step 1 of the psql-based database reset.
--
-- Creates the two things NO baseline file contains, because on the live
-- database they predate the captures:
--   1. the `reporting` SCHEMA itself (baseline/01_tables.sql creates tables
--      but never the schema), and
--   2. the `reporting_ro` ROLE plus its memberships (created by hosted
--      migration 013, which has no file in this repo).
--
-- 016_reporting_role_non_inherited.sql runs LATER in the sequence and
-- re-tightens `authenticated` to non-inherited membership; the plain GRANT
-- here only exists so the baseline grant files can resolve the role.
--
-- pg_cron is enabled when available. On bare Postgres the guarded block logs
-- and continues; the runner then skips the cron step automatically.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS reporting;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reporting_ro') THEN
    CREATE ROLE reporting_ro NOLOGIN;
  END IF;
END $$;

GRANT reporting_ro TO authenticated, service_role, postgres;
GRANT USAGE ON SCHEMA reporting TO reporting_ro;

-- Same protective settings as migration 013 (the API also issues per-query
-- SET LOCAL statement_timeout, because ALTER ROLE only applies at login).
ALTER ROLE reporting_ro SET statement_timeout = '5s';
ALTER ROLE reporting_ro SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE reporting_ro SET lock_timeout = '2s';

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron unavailable here (%); the cron step will be skipped.', SQLERRM;
END $$;

-- citext backs public.enquiry_contacts.email (case-insensitive contact
-- matching). Live has it in `extensions`; a fresh project does not until
-- asked. Guarded for bare-Postgres targets without contrib installed.
CREATE SCHEMA IF NOT EXISTS extensions;
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA extensions;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'citext unavailable here (%); enquiry_contacts will fail to create.', SQLERRM;
END $$;