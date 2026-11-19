-- 096_writing_assessment_reporting.sql
-- Writing Assessment reporting foundations for DeepSeek Flash marking.
--
-- 1. Adds a WRITING exam_type so writing-assessment tests/questions can be
--    classified without borrowing a misleading enum value (e.g. ENGLISH_OLYMPIAD).
-- 2. Promotes detail currently buried in writing_evaluations.raw_response into
--    first-class columns so reports can query it directly (13-bi-reporting
--    integrations-api-ux.md A5/A6/A7).
-- 3. Adds writing_practice_sessions so the AI Practice Lab can store standalone
--    practice grading without an attempts row (writing_evaluations.attempt_id is
--    NOT NULL UNIQUE -> cannot host non-test writing).
--
-- Access model mirrors 015_student_access_remediation.sql: students may CREATE
-- their own practice session but never SELECT a result; parents/tutors/admin
-- read results under may_read_results().

-- ---------------------------------------------------------------------------
-- 1. exam_type ---------------------------------------------------------------
-- ---------------------------------------------------------------------------
ALTER TYPE public.exam_type ADD VALUE 'WRITING';

-- ---------------------------------------------------------------------------
-- 2. writing_evaluations detail columns --------------------------------------
-- ---------------------------------------------------------------------------
ALTER TABLE public.writing_evaluations
  ADD COLUMN IF NOT EXISTS text_type text,
  ADD COLUMN IF NOT EXISTS category_scores jsonb,
  ADD COLUMN IF NOT EXISTS techniques_used jsonb,
  ADD COLUMN IF NOT EXISTS practice_exercise text,
  ADD COLUMN IF NOT EXISTS rubric_version text,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS word_count integer,
  ADD COLUMN IF NOT EXISTS graded_at timestamptz,
  ADD COLUMN IF NOT EXISTS duration_ms integer;

-- Backfill pre-existing rows whose detail lives only in raw_response.
UPDATE public.writing_evaluations
SET text_type         = raw_response->>'text_type',
    category_scores   = raw_response->'category_scores',
    techniques_used   = raw_response->'techniques_used',
    practice_exercise = raw_response->>'practice_exercise',
    rubric_version    = raw_response->>'rubric_version',
    model             = raw_response->>'model'
WHERE raw_response IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. writing_practice_sessions ----------------------------------------------
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.writing_practice_sessions (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id     uuid NOT NULL REFERENCES public.student_profiles(id) ON DELETE CASCADE,
    prompt_id      text NOT NULL,
    text_type      text NOT NULL,
    prompt_text    text NOT NULL,
    student_text   text NOT NULL,
    word_count     integer NOT NULL DEFAULT 0,
    year_level     integer NOT NULL,
    status         text NOT NULL DEFAULT 'PENDING',
    score_out_of100 numeric(5,2),
    evaluation     jsonb,
    rubric_version text,
    model          text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    graded_at      timestamptz,
    duration_ms    integer
);

COMMENT ON TABLE public.writing_practice_sessions IS
  'Standalone AI writing practice (AI Practice Lab). Students create their own row but never SELECT it; the evaluation is a result shown only to parents/tutors/admin.';

CREATE INDEX IF NOT EXISTS writing_practice_sessions_student_created_idx
  ON public.writing_practice_sessions (student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS writing_practice_sessions_status_created_idx
  ON public.writing_practice_sessions (status, created_at);

-- ---------------------------------------------------------------------------
-- 4. RLS --------------------------------------------------------------------
-- ---------------------------------------------------------------------------
ALTER TABLE public.writing_practice_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can view all writing practice"
  ON public.writing_practice_sessions FOR SELECT TO authenticated
  USING (public.may_read_results() AND public.has_role('ADMIN'::public.user_role));

CREATE POLICY "Admin can write writing practice"
  ON public.writing_practice_sessions FOR ALL TO authenticated
  USING (public.has_role('ADMIN'::public.user_role))
  WITH CHECK (public.has_role('ADMIN'::public.user_role));

CREATE POLICY "Parent can view student writing practice"
  ON public.writing_practice_sessions FOR SELECT TO authenticated
  USING (public.may_read_results() AND public.is_parent_of(student_id));

CREATE POLICY "Student can create own writing practice"
  ON public.writing_practice_sessions FOR INSERT TO authenticated
  WITH CHECK (public.is_student_self(student_id));

-- ---------------------------------------------------------------------------
-- 5. Grants -----------------------------------------------------------------
-- ---------------------------------------------------------------------------
GRANT INSERT, SELECT ON public.writing_practice_sessions TO authenticated;
GRANT ALL ON public.writing_practice_sessions TO service_role;
REVOKE ALL ON public.writing_practice_sessions FROM anon;