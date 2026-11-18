-- ============================================================================
-- 015_student_access_remediation.sql
--
-- CLOSES A LIVE BREACH of the platform's hardest access rule:
--   "The student role must have no SELECT permission on any results table."
--
-- Found by querying pg_policies on project ekdjrvjgrhpqolthbznr. Three policies
-- currently grant students SELECT over results:
--   attempts            "Student can view own attempts"   -> score_out_of100,
--                           raw_accuracy, weighted_score, section_scores
--   responses           "Student can view own responses"  -> is_correct, answer
--   writing_evaluations "Student can view own evals"      -> AI writing marks
-- and src/app/student/report/[attemptId]/page.tsx renders the full
-- TestReportView from them.
--
-- ----------------------------------------------------------------------------
-- A CORRECTION TO THE DESIGN DOCUMENT, found while implementing it.
-- ----------------------------------------------------------------------------
-- 12-bi-reporting-data-model.md §9.6 proposed COLUMN-LEVEL GRANTS as "the
-- decisive control". That is WRONG, and this migration does not rely on it.
--
-- Column privileges are granted per Postgres ROLE. Parents and students both
-- connect as the same role - `authenticated` - and Supabase derives the
-- application role from public.app_user_roles, not from the JWT role claim. So
-- `GRANT SELECT (score) TO authenticated` grants it to parents AND students
-- alike. Column grants can only withhold a column from EVERY authenticated user,
-- which would break the parent report.
--
-- What actually enforces the rule here, in order of strength:
--   1. No SELECT policy matches a student on any results table. RLS is
--      deny-by-default once enabled, so a student SELECT returns zero rows -
--      not an error, and not data.
--   2. public.may_read_results() is an explicit centralised guard on EVERY
--      remaining SELECT policy over results. It returns false for STUDENT
--      unconditionally, so even if a permissive student policy is re-added by
--      mistake later, the parent and admin policies still cannot leak to a
--      student. One function to audit instead of N policies.
--   3. The student write policies are narrowed from FOR ALL to INSERT/UPDATE.
--      FOR ALL includes SELECT, so leaving them as-is would silently undo step 1.
--      This is the easiest part of the fix to get wrong.
--   4. The runner's legitimate read-back of a student's own in-progress answers
--      goes through public.resume_attempt_answers(), whose RETURNS clause has no
--      correctness column. Leaking a result through it would require changing a
--      function signature, not editing a policy.
--
-- Verified before writing: src/app/api/runner/start/route.ts selects only
-- attempts(id, started_at) and attempts(id, status) - never responses. The save
-- and submit paths must be re-verified (assumption A-14); test AC-40 is the guard.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The central guard --------------------------------------------------------
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER so it can read app_user_roles regardless of the caller's own
-- row-level access to that table.
CREATE OR REPLACE FUNCTION public.may_read_results()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- A signed-out caller never reads results.
  SELECT auth.uid() IS NOT NULL
     -- A student never reads results. No exception, no override, no flag.
     AND NOT EXISTS (
       SELECT 1 FROM public.app_user_roles r
       WHERE r.user_id = auth.uid() AND r.role = 'STUDENT'
     );
$$;

REVOKE ALL ON FUNCTION public.may_read_results() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.may_read_results() TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. attempts -----------------------------------------------------------------
-- ----------------------------------------------------------------------------
-- Remove the student SELECT policy found in pg_policies.
DROP POLICY IF EXISTS "Student can view own attempts" ON public.attempts;

-- FOR ALL includes SELECT. Replacing it with explicit INSERT and UPDATE is what
-- actually removes the student's read access while keeping test-taking working.
DROP POLICY IF EXISTS "Student can write own attempts" ON public.attempts;

DROP POLICY IF EXISTS "Student can insert own attempts" ON public.attempts;
CREATE POLICY "Student can insert own attempts"
  ON public.attempts FOR INSERT TO authenticated
  WITH CHECK (public.is_student_self(student_id));

DROP POLICY IF EXISTS "Student can update own attempts" ON public.attempts;
CREATE POLICY "Student can update own attempts"
  ON public.attempts FOR UPDATE TO authenticated
  USING (public.is_student_self(student_id))
  WITH CHECK (public.is_student_self(student_id));

-- Re-create the parent and admin SELECT policies WITH the guard, so the exclusion
-- is explicit rather than merely "no student policy happens to exist".
DROP POLICY IF EXISTS "Parent can view student attempts" ON public.attempts;
CREATE POLICY "Parent can view student attempts"
  ON public.attempts FOR SELECT TO authenticated
  USING (public.may_read_results() AND public.is_parent_of(student_id));

DROP POLICY IF EXISTS "Admin can view all attempts" ON public.attempts;
CREATE POLICY "Admin can view all attempts"
  ON public.attempts FOR SELECT TO authenticated
  USING (public.may_read_results() AND public.has_role('ADMIN'));

-- ----------------------------------------------------------------------------
-- 3. responses ----------------------------------------------------------------
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Student can view own responses" ON public.responses;
DROP POLICY IF EXISTS "Student can write own responses" ON public.responses;

DROP POLICY IF EXISTS "Student can insert own responses" ON public.responses;
CREATE POLICY "Student can insert own responses"
  ON public.responses FOR INSERT TO authenticated
  WITH CHECK (public.is_attempt_owner(attempt_id));

DROP POLICY IF EXISTS "Student can update own responses" ON public.responses;
CREATE POLICY "Student can update own responses"
  ON public.responses FOR UPDATE TO authenticated
  USING (public.is_attempt_owner(attempt_id))
  WITH CHECK (public.is_attempt_owner(attempt_id));

DROP POLICY IF EXISTS "Parent can view student responses" ON public.responses;
CREATE POLICY "Parent can view student responses"
  ON public.responses FOR SELECT TO authenticated
  USING (public.may_read_results() AND public.is_attempt_parent(attempt_id));

DROP POLICY IF EXISTS "Admin can view all responses" ON public.responses;
CREATE POLICY "Admin can view all responses"
  ON public.responses FOR SELECT TO authenticated
  USING (public.may_read_results() AND public.has_role('ADMIN'));

-- ----------------------------------------------------------------------------
-- 4. writing_evaluations ------------------------------------------------------
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Student can view own evals" ON public.writing_evaluations;

DROP POLICY IF EXISTS "Parent can view student evals" ON public.writing_evaluations;
CREATE POLICY "Parent can view student evals"
  ON public.writing_evaluations FOR SELECT TO authenticated
  USING (public.may_read_results() AND public.is_attempt_parent(attempt_id));

DROP POLICY IF EXISTS "Admin can view all evals" ON public.writing_evaluations;
CREATE POLICY "Admin can view all evals"
  ON public.writing_evaluations FOR SELECT TO authenticated
  USING (public.may_read_results() AND public.has_role('ADMIN'));

-- ----------------------------------------------------------------------------
-- 5. The runner's read-back path ----------------------------------------------
-- ----------------------------------------------------------------------------
-- A student resuming an in-progress test needs their own saved answers. They get a
-- function, not a table grant. The RETURNS clause has no is_correct column and no
-- join to questions.correct_answer, so this cannot leak a result without a
-- signature change.
CREATE OR REPLACE FUNCTION public.resume_attempt_answers(p_attempt_id uuid)
RETURNS TABLE (question_id uuid, answer text, time_spent_seconds integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.question_id, r.answer, r.time_spent_seconds
  FROM public.responses r
  WHERE r.attempt_id = p_attempt_id
    AND public.is_attempt_owner(p_attempt_id);
$$;

REVOKE ALL ON FUNCTION public.resume_attempt_answers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resume_attempt_answers(uuid) TO authenticated;

-- Status-only read for the runner and the S3 completion screen. A student may see
-- that an attempt exists and whether it is IN_PROGRESS or SUBMITTED. No score
-- column is selected, and no policy returns one.
CREATE OR REPLACE FUNCTION public.my_attempt_status(p_attempt_id uuid)
RETURNS TABLE (id uuid, test_id uuid, status public.attempt_status,
               started_at timestamptz, submitted_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.test_id, a.status, a.started_at, a.submitted_at
  FROM public.attempts a
  WHERE a.id = p_attempt_id
    AND public.is_attempt_owner(p_attempt_id);
$$;

REVOKE ALL ON FUNCTION public.my_attempt_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_attempt_status(uuid) TO authenticated;

COMMENT ON FUNCTION public.may_read_results() IS
  'Central guard for every SELECT policy on a results table. Returns FALSE for any user holding the STUDENT app role, unconditionally. Students may still INSERT and UPDATE their own attempts and responses so they can sit a test; they can never SELECT a result.';
