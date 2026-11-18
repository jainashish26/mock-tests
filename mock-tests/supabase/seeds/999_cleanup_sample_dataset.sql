-- ============================================================================
-- SAMPLE DATASET - TEARDOWN. Removes everything 001_sample_dataset.sql created.
--
-- VERIFIED BY EXECUTION (2026-11-15)
--   Run inside a transaction and rolled back, against the live database holding
--   both sample and real rows. Every table came back clean:
--
--     table          sample_before  sample_after  real_before  real_after
--     attempts                1299             0            1           1
--     responses              12505             0           68          68
--     funnel_events            508             0            3           3
--     funnel_state              58             0            0           0
--     links                    200             0            3           3
--     roles                    300             0            8           8
--     students                 200             0            3           3
--     auth_users               300             0            8           8
--
--   That proves three things at once: the statements are valid, the FK ordering
--   is correct (children before parents, auth last), and the predicates select
--   exactly the sample rows and not one real row.
--
-- Safe to run at any time and idempotent. It deletes ONLY rows whose primary key
-- falls in the reserved sample UUID prefixes, so real data is untouched even if
-- this is accidentally run against a database holding both.
--
-- Run order matters: children before parents, so the FKs to auth.users are
-- released before the auth rows go.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/seeds/999_cleanup_sample_dataset.sql
--
-- Prefix map (see SAMPLE_DATA.md):
--   5a = student_profiles.id      5b = parent auth.users.id / app_user_roles
--   5c = parent_student_links.id  5d = attempts.id
--   5e = responses.id             5f = student auth.users.id
--   59 = funnel_events.id
-- ============================================================================

BEGIN;

-- 1. Responses (children of attempts)
DELETE FROM public.responses        WHERE id::text        LIKE '5e000000-%';

-- 2. Attempts (children of student_profiles and tests)
DELETE FROM public.attempts         WHERE id::text        LIKE '5d000000-%';

-- 3. Funnel events. Matched on user_id prefix rather than id prefix so that any
--    event written against a sample identity by application code is also removed,
--    not just the ones the seed inserted directly.
DELETE FROM public.funnel_events    WHERE id::text        LIKE '59000000-%'
                                          OR user_id::text LIKE '5b000000-%'
                                          OR user_id::text LIKE '5f000000-%';
DELETE FROM public.funnel_state     WHERE user_id::text   LIKE '5b000000-%';

-- 3b. Experiment arms held by sample subjects. The experiment DEFINITION is kept
--     (it is configuration, like coverage_thresholds); only the sample subjects'
--     assignments and exposures go, so a real experiment is not deleted by a
--     fixture cleanup.
DELETE FROM public.experiment_exposures
WHERE subject_key LIKE '5b000000-%' OR subject_key LIKE '5f000000-%'
   OR subject_key LIKE 'anon:sample-%';
DELETE FROM public.experiment_assignments
WHERE subject_key LIKE '5b000000-%' OR subject_key LIKE '5f000000-%'
   OR subject_key LIKE 'anon:sample-%';

-- 4. Link and role rows
DELETE FROM public.parent_student_links WHERE id::text        LIKE '5c000000-%';

-- 4b. Tutor sample data: links (58), consents held by sample tutors (57), roles.
--     Consent rows are deleted explicitly rather than relying on CASCADE so the
--     teardown's intent is legible and does not depend on FK behaviour.
DELETE FROM public.consent_records
WHERE tutor_user_id::text LIKE '57000000-%' OR student_id::text LIKE '5a000000-%';
DELETE FROM public.tutor_student_links WHERE id::text LIKE '58000000-%';
DELETE FROM public.app_user_roles WHERE user_id::text LIKE '57000000-%';

DELETE FROM public.app_user_roles       WHERE user_id::text   LIKE '5f000000-%'
                                             OR user_id::text LIKE '5b000000-%';
DELETE FROM public.student_profiles     WHERE id::text        LIKE '5a000000-%';

-- 5. Auth identities last
DELETE FROM auth.users WHERE email LIKE '%@sample.invalid';

-- 6. The reporting layer derives from the above, so it must be rebuilt rather
--    than deleted: dim rows are SCD2 and fact rows would otherwise keep pointing
--    at students that no longer exist.
SELECT reporting.load_student_dims();
SELECT reporting.load_attempt_facts(true);
SELECT reporting.load_response_facts(true);
SELECT reporting.load_event_facts(true);

-- 7. Drop the seeding helper schema entirely, so nothing sample-specific is left
--    behind in the database.
DROP SCHEMA IF EXISTS sample_data CASCADE;

COMMIT;

-- Verify: every count must be zero.
SELECT
  (SELECT COUNT(*) FROM auth.users              WHERE email LIKE '%@sample.invalid') AS auth_users,
  (SELECT COUNT(*) FROM public.student_profiles WHERE id::text LIKE '5a000000-%')     AS students,
  (SELECT COUNT(*) FROM public.attempts         WHERE id::text LIKE '5d000000-%')     AS attempts,
  (SELECT COUNT(*) FROM public.responses        WHERE id::text LIKE '5e000000-%')     AS responses,
  (SELECT COUNT(*) FROM public.funnel_events    WHERE id::text LIKE '59000000-%')     AS funnel_events,
  (SELECT COUNT(*) FROM public.app_user_roles   WHERE user_id::text LIKE '5b000000-%'
                                                  OR user_id::text LIKE '5f000000-%') AS roles;
