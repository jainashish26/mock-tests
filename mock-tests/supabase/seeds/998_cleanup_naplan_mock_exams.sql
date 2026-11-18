-- 998_cleanup_naplan_mock_exams.sql
-- Teardown for the 42 NAPLAN-style mock exams (Years 2-8, Reading + Numeracy)
-- seeded by scripts/seed_naplan_mocks.py from MockExams/.
--
-- Deletes ONLY rows belonging to those exams, identified by:
--   * tests.title  LIKE 'Year % NAPLAN-style % - Mock Exam %'
--   * questions.exam_id matching 'NAPLAN-Y{2..8}-{READING|NUMERACY}-M{1..3}'
-- Safe to re-run. Does not touch any other content.
--
-- NOTE: if students have already been assigned these tests or have attempts,
-- the RESTRICT foreign keys will block the final DELETE. In that case uncomment
-- the two guarded statements below FIRST (they remove assignment/attempt history
-- for these mocks only).

BEGIN;

-- Uncomment only if assignments/attempts exist for these mocks:
-- DELETE FROM public.assignments
--  WHERE test_id IN (SELECT id FROM public.tests
--                     WHERE title LIKE 'Year % NAPLAN-style % - Mock Exam %');
-- DELETE FROM public.attempts
--  WHERE test_id IN (SELECT id FROM public.tests
--                     WHERE title LIKE 'Year % NAPLAN-style % - Mock Exam %');

DELETE FROM public.test_questions
 WHERE test_id IN (SELECT id FROM public.tests
                    WHERE title LIKE 'Year % NAPLAN-style % - Mock Exam %');

DELETE FROM public.test_sections
 WHERE test_id IN (SELECT id FROM public.tests
                    WHERE title LIKE 'Year % NAPLAN-style % - Mock Exam %');

DELETE FROM public.questions
 WHERE exam_id ~ '^NAPLAN-Y[2-8]-(READING|NUMERACY)-M[1-3]$';

DELETE FROM public.tests
 WHERE title LIKE 'Year % NAPLAN-style % - Mock Exam %';

COMMIT;
