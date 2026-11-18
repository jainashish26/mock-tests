-- 009: Default role provisioning for social (OAuth) sign-ups
--
-- WHY THIS EXISTS
-- Every RLS policy in this app is gated behind public.has_role(...) and
-- requireRole() bounces role-less users back to "/". Until now the
-- `app_user_roles` row was inserted by a client-side `fetch` fired after
-- `signUp()`. That works for the email form, but it cannot work for OAuth:
-- Supabase GoTrue creates the auth.users row server-side during the token
-- exchange, so no browser code ever runs and no role row is ever written.
-- A first-time Google user would therefore land on a dashboard where every
-- RLS-gated query returns zero rows.
--
-- This trigger closes that gap for *every* sign-up path (Google today,
-- Facebook/Apple later, and email) and removes the client-side race that the
-- now-deleted /api/auth/assign-role endpoint was papering over.
--
-- Idempotent: safe to re-run.

-- 1. Default-role provisioning function -------------------------------------
-- SECURITY DEFINER is required because the trigger fires inside GoTrue's
-- transaction, where the acting role is `supabase_auth_admin` and would
-- otherwise be blocked by the app_user_roles RLS policies. The fixed
-- search_path prevents shadowing, matching the convention in 004/006/007.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Students authenticate with synthetic "<username>@students.mocktest.internal"
  -- credentials minted by a parent (see /api/parent/child), which inserts the
  -- STUDENT role itself immediately after createUser(). They must never be
  -- clobbered with the self-serve PARENT default, so skip them entirely.
  IF NEW.email IS NOT NULL AND NEW.email LIKE '%@students.mocktest.internal' THEN
    RETURN NEW;
  END IF;

  -- Self-serve sign-up (Google or email/password) always means PARENT.
  -- ADMIN / TUTOR / TEST_CREATOR are granted by an admin afterwards via
  -- POST /api/admin/users/[id]/role.
  -- ON CONFLICT keeps this a no-op when the role was already set.
  INSERT INTO public.app_user_roles (user_id, role)
  VALUES (NEW.id, 'PARENT')
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- 2. Backfill ------------------------------------------------------------------
-- Repair any auth user created before this trigger existed that never received
-- a role row (e.g. a Google sign-in attempted during rollout, or an email
-- sign-up whose client-side assign-role fetch lost the race / hit a network
-- error). No-op on a healthy database.
INSERT INTO public.app_user_roles (user_id, role)
SELECT u.id, 'PARENT'
FROM auth.users u
WHERE NOT EXISTS (
        SELECT 1 FROM public.app_user_roles r WHERE r.user_id = u.id
      )
  AND (u.email IS NULL OR u.email NOT LIKE '%@students.mocktest.internal')
ON CONFLICT (user_id) DO NOTHING;
