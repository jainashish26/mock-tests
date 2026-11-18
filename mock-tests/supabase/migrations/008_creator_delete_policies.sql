-- 008: DELETE permissions for content creators
--
-- Until now RLS allowed creators to INSERT and UPDATE their own draft content but
-- had no DELETE policy at all, so a `delete()` from the /creator workspace always
-- affected 0 rows and silently "succeeded". These policies mirror the existing
-- update rules:
--   * a TEST_CREATOR may only delete their OWN content that is still unpublished
--     (DRAFT / PENDING_APPROVAL) - published material stays protected, and the
--     existing ON DELETE RESTRICT FKs from attempts/responses are a second guard;
--   * an ADMIN may delete anything.
--
-- test_questions / test_sections already cascade (or are covered by the existing
-- "Test Creator can write own test mapping" / "... test sections" FOR ALL policies,
-- which include DELETE), so removing a draft test cleans up its own rows.

-- tests -------------------------------------------------------------------
DROP POLICY IF EXISTS "Test Creator can delete own drafts" ON public.tests;
CREATE POLICY "Test Creator can delete own drafts" ON public.tests FOR DELETE USING (
  created_by = auth.uid()
  AND status IN ('DRAFT', 'PENDING_APPROVAL')
  AND public.has_role('TEST_CREATOR')
);

DROP POLICY IF EXISTS "Admin can delete any test" ON public.tests;
CREATE POLICY "Admin can delete any test" ON public.tests FOR DELETE USING (
  public.has_role('ADMIN')
);

-- questions ---------------------------------------------------------------
DROP POLICY IF EXISTS "Test Creator can delete own drafts" ON public.questions;
CREATE POLICY "Test Creator can delete own drafts" ON public.questions FOR DELETE USING (
  created_by = auth.uid()
  AND status IN ('DRAFT', 'PENDING_APPROVAL')
  AND public.has_role('TEST_CREATOR')
);

DROP POLICY IF EXISTS "Admin can delete any question" ON public.questions;
CREATE POLICY "Admin can delete any question" ON public.questions FOR DELETE USING (
  public.has_role('ADMIN')
);

-- `questions.tags` is NOT NULL without a default, which made every insert that
-- omitted it (the question editor form) fail with a constraint error.
ALTER TABLE public.questions ALTER COLUMN tags SET DEFAULT '[]'::jsonb;
