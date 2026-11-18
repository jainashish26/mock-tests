-- ============================================================================
-- 006_student_flow_fixes.sql
-- Fixes the four data/RLS defects that break the student testing flow:
--   1. Assigned (paid) tests are invisible to the student  -> "Assignment not found"
--   2. Parents cannot read their child's responses / writing evaluations
--   3. test_questions.question_order is NULL -> questions render in random order
--   4. Missing indexes for the hot student-path queries
-- Idempotent: safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Access control: an assignment is itself a grant of access, and a student
--    inherits an active entitlement held by a linked parent.
--    SECURITY DEFINER + fixed search_path => no recursion into RLS policies.
-- ---------------------------------------------------------------------------
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
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. New helper: is the caller a linked parent of the student who owns this attempt?
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_attempt_parent(target_attempt_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.attempts a
    JOIN public.parent_student_links psl ON psl.student_id = a.student_id
    WHERE a.id = target_attempt_id
      AND psl.parent_user_id = auth.uid()
  );
$$;

-- Rebuild the two mis-scoped parent policies (they used is_attempt_owner,
-- which can never be true for a parent).
DROP POLICY IF EXISTS "Parent can view student responses" ON public.responses;
CREATE POLICY "Parent can view student responses"
  ON public.responses FOR SELECT
  USING (is_attempt_parent(attempt_id));

DROP POLICY IF EXISTS "Parent can view student evals" ON public.writing_evaluations;
CREATE POLICY "Parent can view student evals"
  ON public.writing_evaluations FOR SELECT
  USING (is_attempt_parent(attempt_id));

-- ---------------------------------------------------------------------------
-- 3. Deterministic question ordering.
--    Order by section (when a test_sections row exists), then section name,
--    then question id so the sequence is stable across reloads.
-- ---------------------------------------------------------------------------
WITH ordered AS (
  SELECT
    tq.id,
    row_number() OVER (
      PARTITION BY tq.test_id
      ORDER BY COALESCE(ts.section_order, 999), tq.section_name, tq.question_id
    ) AS rn
  FROM public.test_questions tq
  LEFT JOIN public.test_sections ts
         ON ts.test_id = tq.test_id AND ts.name = tq.section_name
)
UPDATE public.test_questions tq
   SET question_order = ordered.rn
  FROM ordered
 WHERE tq.id = ordered.id
   AND tq.question_order IS NULL;

-- Make the ordering contract explicit going forward.
ALTER TABLE public.test_questions ALTER COLUMN question_order SET DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 3b. Backfill missing test_sections rows so section metadata is consistent
--     for CSV-imported tests (harmless no-op where sections already exist).
-- ---------------------------------------------------------------------------
-- Only backfill tests that have no section metadata at all, so we never
-- collide with hand-authored section_order values (UNIQUE (test_id, section_order)).
INSERT INTO public.test_sections (test_id, name, section_order, question_count)
SELECT
  agg.test_id,
  agg.name,
  agg.section_order,
  agg.question_count
FROM (
  SELECT
    tq.test_id,
    tq.section_name AS name,
    (dense_rank() OVER (
       PARTITION BY tq.test_id
       ORDER BY MIN(tq.question_order), tq.section_name
     ))::int AS section_order,
    count(*)::int AS question_count
  FROM public.test_questions tq
  WHERE NOT EXISTS (
    SELECT 1 FROM public.test_sections ts WHERE ts.test_id = tq.test_id
  )
  GROUP BY tq.test_id, tq.section_name
) agg
WHERE agg.question_count > 0
ON CONFLICT (test_id, section_order) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Indexes for the hot student paths
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_attempts_student_status
  ON public.attempts (student_id, status);
CREATE INDEX IF NOT EXISTS idx_assignments_student
  ON public.assignments (student_id);
CREATE INDEX IF NOT EXISTS idx_test_questions_test_order
  ON public.test_questions (test_id, question_order);
CREATE INDEX IF NOT EXISTS idx_responses_attempt_question
  ON public.responses (attempt_id, question_id);
CREATE INDEX IF NOT EXISTS idx_entitlements_test
  ON public.entitlements (test_id) WHERE active = true;
