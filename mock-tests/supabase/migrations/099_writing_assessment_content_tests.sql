-- 099_writing_assessment_content_tests.sql
-- Seed 6 per-year-band "Writing Assessment" tests (3 bands x narrative/persuasive)
-- plus their sections and single writing question each (PM rule: max 1 writing
-- question per test). Idempotent.

INSERT INTO public.tests (id, title, exam_type, year_level_min, year_level_max, time_limit_mins, is_free, status, created_by, approved_by, published_at)
VALUES
  ('e1c00000-0000-4000-8000-000000000001', 'Writing Assessment — Narrative — Years 2–4',  'WRITING', 2, 4, 20, true, 'PUBLISHED', 'f34c58ab-46a4-4693-8bb1-f36de4da0f46', 'f34c58ab-46a4-4693-8bb1-f36de4da0f46', now()),
  ('e1c00000-0000-4000-8000-000000000002', 'Writing Assessment — Narrative — Years 5–6',  'WRITING', 5, 6, 30, true, 'PUBLISHED', 'f34c58ab-46a4-4693-8bb1-f36de4da0f46', 'f34c58ab-46a4-4693-8bb1-f36de4da0f46', now()),
  ('e1c00000-0000-4000-8000-000000000003', 'Writing Assessment — Narrative — Years 7–8',  'WRITING', 7, 8, 40, true, 'PUBLISHED', 'f34c58ab-46a4-4693-8bb1-f36de4da0f46', 'f34c58ab-46a4-4693-8bb1-f36de4da0f46', now()),
  ('e1c00000-0000-4000-8000-000000000004', 'Writing Assessment — Persuasive — Years 2–4', 'WRITING', 2, 4, 20, true, 'PUBLISHED', 'f34c58ab-46a4-4693-8bb1-f36de4da0f46', 'f34c58ab-46a4-4693-8bb1-f36de4da0f46', now()),
  ('e1c00000-0000-4000-8000-000000000005', 'Writing Assessment — Persuasive — Years 5–6', 'WRITING', 5, 6, 30, true, 'PUBLISHED', 'f34c58ab-46a4-4693-8bb1-f36de4da0f46', 'f34c58ab-46a4-4693-8bb1-f36de4da0f46', now()),
  ('e1c00000-0000-4000-8000-000000000006', 'Writing Assessment — Persuasive — Years 7–8', 'WRITING', 7, 8, 40, true, 'PUBLISHED', 'f34c58ab-46a4-4693-8bb1-f36de4da0f46', 'f34c58ab-46a4-4693-8bb1-f36de4da0f46', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.test_sections (test_id, name, section_order, question_count)
VALUES
  ('e1c00000-0000-4000-8000-000000000001', 'Writing', 1, 1),
  ('e1c00000-0000-4000-8000-000000000002', 'Writing', 1, 1),
  ('e1c00000-0000-4000-8000-000000000003', 'Writing', 1, 1),
  ('e1c00000-0000-4000-8000-000000000004', 'Writing', 1, 1),
  ('e1c00000-0000-4000-8000-000000000005', 'Writing', 1, 1),
  ('e1c00000-0000-4000-8000-000000000006', 'Writing', 1, 1)
ON CONFLICT (test_id, section_order) DO NOTHING;

INSERT INTO public.test_questions (test_id, question_id, section_name, base_difficulty, question_order)
VALUES
  ('e1c00000-0000-4000-8000-000000000001', 'e1a00000-0000-4000-8000-000000000001', 'Writing', 2, 1),
  ('e1c00000-0000-4000-8000-000000000002', 'e1a00000-0000-4000-8000-000000000004', 'Writing', 2, 1),
  ('e1c00000-0000-4000-8000-000000000003', 'e1a00000-0000-4000-8000-000000000008', 'Writing', 2, 1),
  ('e1c00000-0000-4000-8000-000000000004', 'e1b00000-0000-4000-8000-000000000002', 'Writing', 2, 1),
  ('e1c00000-0000-4000-8000-000000000005', 'e1b00000-0000-4000-8000-000000000005', 'Writing', 2, 1),
  ('e1c00000-0000-4000-8000-000000000006', 'e1b00000-0000-4000-8000-000000000004', 'Writing', 2, 1)
ON CONFLICT (test_id, question_id) DO NOTHING;