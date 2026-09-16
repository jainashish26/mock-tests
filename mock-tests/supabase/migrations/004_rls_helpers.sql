-- 004_rls_helpers.sql
-- Helper functions for Row Level Security (RLS) policies

-- Return true if current user has the specified application role
CREATE OR REPLACE FUNCTION public.has_role(target_role public.user_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_user_roles 
    WHERE user_id = auth.uid() AND role = target_role
  );
$$;

-- Return true if current user is linked as a parent to the given student
CREATE OR REPLACE FUNCTION public.is_parent_of(target_student_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.parent_student_links 
    WHERE parent_user_id = auth.uid() AND student_id = target_student_id
  );
$$;

-- Return true if current user is the student that owns the student_profiles row
CREATE OR REPLACE FUNCTION public.is_student_self(target_student_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.student_profiles 
    WHERE id = target_student_id AND auth_user_id = auth.uid()
  );
$$;

-- Return true if current user is the student who owns the attempt
CREATE OR REPLACE FUNCTION public.is_attempt_owner(target_attempt_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.attempts a
    JOIN public.student_profiles s ON a.student_id = s.id
    WHERE a.id = target_attempt_id AND s.auth_user_id = auth.uid()
  );
$$;

-- Return true if current user has an active entitlement for the given test
CREATE OR REPLACE FUNCTION public.has_entitlement(target_test_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.entitlements 
    WHERE user_id = auth.uid() AND test_id = target_test_id AND active = true
  );
$$;

-- Central gate: user is logged in AND (test is free OR user has an active entitlement)
CREATE OR REPLACE FUNCTION public.can_access_published_test(target_test_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tests t
    WHERE t.id = target_test_id AND t.status = 'PUBLISHED'::public.content_status AND (
      t.is_free = true OR public.has_entitlement(target_test_id)
    )
  );
$$;
