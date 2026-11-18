-- ============================================================================
-- reset/local_stubs.sql - ONLY for bare-Postgres targets (Phase 2 local proof).
-- NEVER needed on a Supabase project, where all of this is platform-provided.
--
-- The captures reference four Supabase roles, an `auth.users` table (FK
-- target of six public tables) and three auth helper functions used inside 71
-- policy/function bodies (auth.uid, auth.role, auth.jwt). Without stubs the
-- public dump cannot even be parsed, let alone applied.
--
-- LIMITATIONS, stated so nobody mistakes this stub for Supabase:
--   * auth.users carries only the columns the sample seed and FKs use.
--   * There is no GoTrue, no storage, no realtime, no PostgREST - so RLS
--     policies exist but nothing exercises them the way a browser would.
--   * auth.uid() reads the same GUCs Supabase sets, so the pgtap suite's
--     set_config('request.jwt.claims', ...) simulation works unchanged.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id                  uuid PRIMARY KEY,
  instance_id         uuid,
  aud                 varchar(255),
  role                varchar(255),
  email               varchar(255) UNIQUE,
  encrypted_password  varchar(255),
  email_confirmed_at  timestamptz,
  created_at          timestamptz,
  updated_at          timestamptz,
  raw_app_meta_data   jsonb,
  raw_user_meta_data  jsonb,
  is_sso_user         boolean NOT NULL DEFAULT false,
  is_anonymous        boolean NOT NULL DEFAULT false
);

-- Mirrors Supabase's definitions closely enough for RLS evaluation, including
-- the legacy 'request.jwt.claim.sub' GUC alongside the current claims JSON.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    'anon'
  )
$$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claims', true), ''),
    json_build_object(
      'sub', nullif(current_setting('request.jwt.claim.sub', true), ''),
      'role', nullif(current_setting('request.jwt.claim.role', true), '')
    )::text
  )::jsonb
$$;

CREATE OR REPLACE FUNCTION auth.email() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT auth.jwt() ->> 'email'
$$;