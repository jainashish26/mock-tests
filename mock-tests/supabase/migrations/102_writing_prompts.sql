-- 102_writing_prompts.sql
-- Database-backed AI writing prompt bank so the Quiz Master (TEST_CREATOR) and
-- ADMIN can add / edit / delete / manage prompts, instead of the prompts being
-- hardcoded in src/lib/writing/prompts-catalog.ts. The catalog remains the seed
-- source and the home of the per-year calibration + marking criteria.
--
-- Access mirrors the questions CMS: a creator manages their own prompts, an
-- admin manages every prompt, and any signed-in user may read PUBLISHED prompts
-- (the AI Practice Lab serves them to students).

CREATE TABLE IF NOT EXISTS public.writing_prompts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year_level  integer NOT NULL CHECK (year_level BETWEEN 2 AND 9),
  territory   text NOT NULL,
  type        text NOT NULL CHECK (type IN ('narrative', 'persuasive')),
  text        text NOT NULL,
  status      public.content_status NOT NULL DEFAULT 'DRAFT',
  created_by  uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS writing_prompts_year_type_idx ON public.writing_prompts (year_level, type);
CREATE INDEX IF NOT EXISTS writing_prompts_status_idx ON public.writing_prompts (status);
CREATE INDEX IF NOT EXISTS writing_prompts_created_by_idx ON public.writing_prompts (created_by);

ALTER TABLE public.writing_prompts ENABLE ROW LEVEL SECURITY;

-- Admin: full control.
CREATE POLICY "Admin can view all writing prompts" ON public.writing_prompts
  FOR SELECT TO authenticated USING (public.has_role('ADMIN'::public.user_role));
CREATE POLICY "Admin can create writing prompts" ON public.writing_prompts
  FOR INSERT TO authenticated WITH CHECK (public.has_role('ADMIN'::public.user_role));
CREATE POLICY "Admin can update writing prompts" ON public.writing_prompts
  FOR UPDATE TO authenticated
  USING (public.has_role('ADMIN'::public.user_role))
  WITH CHECK (public.has_role('ADMIN'::public.user_role));
CREATE POLICY "Admin can delete writing prompts" ON public.writing_prompts
  FOR DELETE TO authenticated USING (public.has_role('ADMIN'::public.user_role));

-- Quiz Master (TEST_CREATOR): full control of their own prompts.
CREATE POLICY "Creator can view own writing prompts" ON public.writing_prompts
  FOR SELECT TO authenticated
  USING (created_by = auth.uid() AND public.has_role('TEST_CREATOR'::public.user_role));
CREATE POLICY "Creator can create writing prompts" ON public.writing_prompts
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.has_role('TEST_CREATOR'::public.user_role));
CREATE POLICY "Creator can update own writing prompts" ON public.writing_prompts
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid() AND public.has_role('TEST_CREATOR'::public.user_role))
  WITH CHECK (created_by = auth.uid() AND public.has_role('TEST_CREATOR'::public.user_role));
CREATE POLICY "Creator can delete own writing prompts" ON public.writing_prompts
  FOR DELETE TO authenticated
  USING (created_by = auth.uid() AND public.has_role('TEST_CREATOR'::public.user_role));

-- Published prompts are readable by any signed-in user (students/parents).
CREATE POLICY "Signed-in users can view published writing prompts" ON public.writing_prompts
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND status = 'PUBLISHED'::public.content_status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.writing_prompts TO authenticated;
GRANT ALL ON public.writing_prompts TO service_role;
REVOKE ALL ON public.writing_prompts FROM anon;