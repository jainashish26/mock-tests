-- 101_year_level_to_9.sql
-- Widen the served year range from 2-8 to 2-9 so a student can be Year 9.
-- The AI writing prompt bank already spans Years 2-9; this lifts the matching
-- CHECK constraints across the application and reporting schemas and adds the
-- Year 9 reporting-capacity row so the analytics ETL does not reject a Year 9
-- student.

ALTER TABLE public.student_profiles DROP CONSTRAINT IF EXISTS student_profiles_year_level_check;
ALTER TABLE public.student_profiles
  ADD CONSTRAINT student_profiles_year_level_check CHECK (year_level >= 2 AND year_level <= 9);

ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_year_level_check;
ALTER TABLE public.questions
  ADD CONSTRAINT questions_year_level_check CHECK (year_level >= 2 AND year_level <= 9);

ALTER TABLE reporting.dim_student DROP CONSTRAINT IF EXISTS dim_student_year_level_check;
ALTER TABLE reporting.dim_student
  ADD CONSTRAINT dim_student_year_level_check CHECK (year_level >= 2 AND year_level <= 9);

ALTER TABLE reporting.dim_year_level_cap DROP CONSTRAINT IF EXISTS dim_year_level_cap_year_level_check;
ALTER TABLE reporting.dim_year_level_cap
  ADD CONSTRAINT dim_year_level_cap_year_level_check CHECK (year_level >= 2 AND year_level <= 9);

-- Year 9 capacity row (NULL caps = unlimited, matching Years 2-8).
INSERT INTO reporting.dim_year_level_cap (year_level)
VALUES (9)
ON CONFLICT (year_level) DO NOTHING;