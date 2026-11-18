-- ============================================================================
-- app_baseline/auth_triggers.sql
--
-- The two CUSTOM triggers this application installs on auth.users. Captured
-- from the live database (pg_get_triggerdef), because pg_dump of the whole
-- `auth` schema is neither possible nor desirable: it is Supabase-internal,
-- and only these two triggers belong to the application.
--
-- Both trigger FUNCTIONS live in public and are captured in
-- public_schema.sql:
--   public.handle_new_auth_user()     - role provisioning on signup (009)
--   public.handle_new_user_profile()  - profiles row creation on signup
--
-- Apply AFTER public_schema.sql. CREATE OR REPLACE makes re-application safe
-- (Postgres 14+).
-- ============================================================================

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

CREATE OR REPLACE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_profile();