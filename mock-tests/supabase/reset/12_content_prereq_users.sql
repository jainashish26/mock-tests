-- ============================================================================
-- reset/12_content_prereq_users.sql
-- Identity anchors required by the content dump (13_content_data.sql):
-- tests.created_by / tests.approved_by FK to auth.users, so these three rows
-- must exist BEFORE the tests are inserted.
--
-- On live these are: the system admin (a0000000...), the owner's real account
-- (e434b9f9..., ADMIN, approver of the premium tests) and the content creator
-- account (f34c58ab..., TEST_CREATOR). Real accounts CANNOT be recreated by a
-- reset - password hashes are not extractable and must never be copied - so
-- the same UUIDs are inserted as PLACEHOLDER identities: unconfirmed, empty
-- password, .invalid email. The UUID is what the FKs and content rows need;
-- the credentials deliberately do not exist. On production this file is a
-- no-op (ON CONFLICT DO NOTHING against the real rows).
-- ============================================================================

INSERT INTO auth.users
  (id, instance_id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at,
   raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous)
VALUES
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'reset.admin@placeholder.invalid', '',
   NULL, now(), now(),
   '{"provider":"reset-kit","providers":["reset-kit"]}'::jsonb,
   '{"purpose":"FK anchor for tests.created_by (system admin)"}'::jsonb, false, false),
  ('e434b9f9-c2a5-4099-9200-e8e156aa57d1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'reset.approver@placeholder.invalid', '',
   NULL, now(), now(),
   '{"provider":"reset-kit","providers":["reset-kit"]}'::jsonb,
   '{"purpose":"FK anchor for tests.approved_by"}'::jsonb, false, false),
  ('f34c58ab-46a4-4693-8bb1-f36de4da0f46', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'reset.creator@placeholder.invalid', '',
   NULL, now(), now(),
   '{"provider":"reset-kit","providers":["reset-kit"]}'::jsonb,
   '{"purpose":"FK anchor for tests.created_by (content creator)"}'::jsonb, false, false)
ON CONFLICT (id) DO NOTHING;

-- Role rows so the anchors behave like their live counterparts if any check
-- ever reads has_role() for them.
INSERT INTO public.app_user_roles (user_id, role, created_at) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'ADMIN', now()),
  ('e434b9f9-c2a5-4099-9200-e8e156aa57d1', 'ADMIN', now()),
  ('f34c58ab-46a4-4693-8bb1-f36de4da0f46', 'TEST_CREATOR', now())
ON CONFLICT DO NOTHING;