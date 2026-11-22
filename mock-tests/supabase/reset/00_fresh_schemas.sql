-- ============================================================================
-- reset/00_fresh_schemas.sql - optional step 0, run ONLY with --fresh.
--
-- WHY THIS EXISTS (found 2026-11-22, by trying to re-run the proof):
-- Every step in this pipeline is additive. The prelude uses CREATE SCHEMA IF
-- NOT EXISTS, the captures use CREATE OR REPLACE, and 10_cron.sql unschedules
-- before scheduling. NOTHING in the whole sequence drops. The header of
-- scripts/reset-via-psql.mjs says it "rebuilds schemas destructively" and the
-- production-refusal message repeats the claim - but the destructive part was
-- never implemented, because the proof was only ever run against a brand-new
-- project, where "empty" came free from the platform.
--
-- So the 2026-11-19 scratch reset proof could not be repeated on the same
-- project: applying the captures onto the schema that proof left behind
-- produced 303 errors reading `type "attempt_status" already exists`, all of
-- them classified "unexpected" by auditTolerantErrors (they mention neither
-- `reporting` nor a wrapper name nor a platform noise), which aborted the run
-- at step 3 with a diagnosis that pointed at the captures rather than at the
-- dirty target. That is the same disease migration 118 fixed in the parity
-- numbers: a check whose failure message describes something other than the
-- actual cause, so the reader cannot act on it.
--
-- WHAT IT DROPS, and why nothing else:
--   public, reporting, sample_data - the three schemas this pipeline creates.
--   NOT extensions (holds citext, which public.enquiry_contacts needs and which
--   no capture recreates from nothing), NOT auth/storage/graphql/vault/cron
--   (platform-owned; dropping them is neither ours to do nor recoverable by
--   these files).
--
-- The GRANT list below is NOT a recollection of Supabase defaults. It was read
-- from pg_namespace.nspacl on both the live project and this scratch project on
-- 2026-11-22, and both showed the same grantees: PUBLIC, anon, authenticated,
-- service_role, plus the owner's own UC. The OWNERS differ and that difference
-- is left alone rather than hidden: live's `public` is owned by
-- `pg_database_owner` (Supabase's newer convention) while this scratch project
-- is owned by `postgres`, as it has been since the 2026-11-19 proof created it.
-- Recreating with owner=postgres reproduces the state the proven run actually
-- produced; nothing in privilege_parity_checks() or the assurance suite reads
-- schema ownership, so the divergence is not what the parity checks grade.
-- No capture file grants anything ON SCHEMA public (verified by search), so
-- recreating public without those four grantees would silently revoke API
-- access and then report it as a privilege-invariant violation caused by the
-- reset itself - a false alarm from my own tooling, which is the worst kind to
-- chase.
-- ============================================================================

DROP SCHEMA IF EXISTS sample_data CASCADE;
DROP SCHEMA IF EXISTS reporting CASCADE;
DROP SCHEMA IF EXISTS public CASCADE;

CREATE SCHEMA public;
ALTER SCHEMA public OWNER TO postgres;

-- Mirrors the measured ACL. PUBLIC gets USAGE only (as on live); table-level
-- access comes from the captures, never from here.
GRANT USAGE ON SCHEMA public TO PUBLIC;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
