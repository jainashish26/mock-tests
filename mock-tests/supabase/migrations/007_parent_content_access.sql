-- ============================================================================
-- 007_parent_content_access.sql
-- Closes the remaining gap in the parent report flow.
--
-- 006 gave parents SELECT on `responses` and `writing_evaluations`, but the
-- question text is read through `questions` / `test_questions`, whose policies
-- are gated by can_access_published_test(test_id). That function only covered:
--   a) free tests, b) the caller's own entitlement,
--   c) a student inheriting a parent's entitlement, d) a student's assignment.
--
-- A PARENT viewing a child's report satisfies none of those unless the parent
-- personally bought the test, so `questions(...)` came back null and the report
-- rendered answers with no stems, no correct answers and no explanations.
--
-- Branch (e) adds: the caller is a linked parent of a student who can access
-- the test by assignment or entitlement.
-- Idempotent: safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.can_access_published_test(target_test_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.tests t
    WHERE t.id = target_test_id
      AND t.status = 'PUBLISHED'::public.content_status
      AND (
        -- a) genuinely free content
        t.is_free = true
        -- b) the signed-in user holds the entitlement themselves
        OR EXISTS (
          SELECT 1 FROM public.entitlements e
          WHERE e.test_id = t.id AND e.active = true AND e.user_id = auth.uid()
        )
        -- c) the signed-in student inherits a linked parent's entitlement
        OR EXISTS (
          SELECT 1
          FROM public.entitlements e
          JOIN public.parent_student_links psl ON psl.parent_user_id = e.user_id
          JOIN public.student_profiles sp        ON sp.id = psl.student_id
          WHERE e.test_id = t.id AND e.active = true AND sp.auth_user_id = auth.uid()
        )
        -- d) the signed-in student has been assigned this test
        OR EXISTS (
          SELECT 1
          FROM public.assignments a
          JOIN public.student_profiles sp ON sp.id = a.student_id
          WHERE a.test_id = t.id AND sp.auth_user_id = auth.uid()
        )
        -- e) the signed-in PARENT is linked to a child who can take this test
        --    (assigned to the child, or the child holds/inherits an entitlement)
        OR EXISTS (
          SELECT 1
          FROM public.parent_student_links psl
          JOIN public.student_profiles sp ON sp.id = psl.student_id
          WHERE psl.parent_user_id = auth.uid()
            AND (
              EXISTS (
                SELECT 1 FROM public.assignments a
                WHERE a.test_id = t.id AND a.student_id = sp.id
              )
              OR EXISTS (
                SELECT 1 FROM public.entitlements e
                WHERE e.test_id = t.id AND e.active = true AND e.user_id = sp.auth_user_id
              )
            )
        )
      )
  );
$$;
