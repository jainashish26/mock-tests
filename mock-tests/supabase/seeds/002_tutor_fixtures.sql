-- ============================================================================
-- seeds/002_tutor_fixtures.sql
-- The tutor identities, links and LIVE consents the assurance suite depends on
-- (AC-21..26, T3/T5/T7 blocks) - two tutors over the first six sample students.
--
-- WHY THIS FILE EXISTS
--   These rows were created directly on the live database during the D-B
--   consent tranche and were never version-controlled. The reset proof on a
--   scratch project exposed the gap: schema parity passed, then the suite
--   failed because tutor 57000000-...-01 did not exist. Everything the suite
--   hardcodes must be reproducible from files - that is the whole point of
--   the reset kit.
--
-- FIDELITY NOTES (captured from live, 2026-11-19):
--   * The tutor users carry the PARENT role in app_user_roles on live. That is
--     reproduced EXACTLY rather than "corrected": tutor DATA access flows
--     through is_tutor_of() (link + live consent), not through the role row,
--     and silently changing seeded roles during a capture would make reset
--     output differ from production in an unexplained way. If tutor UI login
--     ever needs the TUTOR role, that is a deliberate migration, not a seed edit.
--   * Consent ids on live are random uuids; this seed uses deterministic ids
--     in the reserved 5e000000 family. Nothing reads consent ids by value.
--   * created_by on links is left NULL (nullable; not read by any report).
--   * Consent dates are RELATIVE (now + 12 months, the D-B default) so the
--     fixture stays live whenever it is seeded, matching production semantics.
--
-- Idempotent: every insert is guarded; safe against a database that already
-- holds the live rows (nothing is duplicated or updated).
-- ============================================================================

-- 1. Tutor auth users (sample pattern: .invalid TLD, empty password, never
--    confirmed - cannot sign in, cannot receive mail).
INSERT INTO auth.users
  (id, instance_id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at,
   raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous)
SELECT
  ('57000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'sample.tutor.' || lpad(n::text, 4, '0') || '@sample.invalid',
  '', NULL, now(), now(),
  '{"provider":"sample","providers":["sample"]}'::jsonb,
  jsonb_build_object('sample', true, 'kind', 'tutor', 'purpose', 'fixture dataset'),
  false, false
FROM generate_series(1, 2) AS n
ON CONFLICT (id) DO NOTHING;

-- 2. Role rows - PARENT, exactly as live (see fidelity note above).
INSERT INTO public.app_user_roles (user_id, role, created_at)
SELECT ('57000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid, 'PARENT', now()
FROM generate_series(1, 2) AS n
ON CONFLICT DO NOTHING;

-- 3. Tutor <-> student links: tutor 1 -> students 1-3, tutor 2 -> students 4-6.
--    Link ids match the live reserved-prefix family (58000000...).
INSERT INTO public.tutor_student_links (id, tutor_user_id, student_id)
SELECT
  ('58000000-0000-4000-8000-' || lpad(to_hex(10 + n), 12, '0'))::uuid,
  ('57000000-0000-4000-8000-' || lpad(to_hex(((n - 1) / 3) + 1), 12, '0'))::uuid,
  ('5a000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid
FROM generate_series(1, 6) AS n
ON CONFLICT (tutor_user_id, student_id) DO NOTHING;

-- 4. Live 12-month consents, granted by each student's parent. Guarded by
--    existence rather than id, so re-running against live (which holds the
--    original random-id rows) inserts nothing.
INSERT INTO public.consent_records
  (id, student_id, tutor_user_id, purpose, granted_by, granted_at, expires_at)
SELECT
  ('5e000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
  ('5a000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
  ('57000000-0000-4000-8000-' || lpad(to_hex(((n - 1) / 3) + 1), 12, '0'))::uuid,
  'TUTOR_REPORTING',
  (SELECT parent_user_id FROM public.parent_student_links
    WHERE student_id = ('5a000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid
    LIMIT 1),
  now(), now() + interval '12 months'
FROM generate_series(1, 6) AS n
WHERE NOT EXISTS (
  SELECT 1 FROM public.consent_records c
  WHERE c.student_id = ('5a000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid
    AND c.tutor_user_id = ('57000000-0000-4000-8000-' || lpad(to_hex(((n - 1) / 3) + 1), 12, '0'))::uuid
    AND c.revoked_at IS NULL
);