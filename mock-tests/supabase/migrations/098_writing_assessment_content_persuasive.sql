-- 098_writing_assessment_content_persuasive.sql
-- Seed the 5 persuasive Writing Assessment prompts.
-- Idempotent: deterministic UUIDs + ON CONFLICT DO NOTHING.

INSERT INTO public.questions (id, type, stem, tags, status, created_by, exam_type, year_level, subject, topic, sub_topic, difficulty, skill_writing, is_active)
VALUES
  ('e1b00000-0000-4000-8000-000000000001', 'WRITING',
   'Some schools want to replace marks and grades with written feedback only. Write a persuasive text for your school newsletter arguing whether grades should be kept.',
   '["Persuasive","Writing","Prompt"]', 'PUBLISHED', 'f34c58ab-46a4-4693-8bb1-f36de4da0f46', 'WRITING', 5, 'English', 'Writing', 'Persuasive', 2, 1, true),
  ('e1b00000-0000-4000-8000-000000000002', 'WRITING',
   '"Children under fourteen should not own a smartphone." Do you agree? Write a persuasive text.',
   '["Persuasive","Writing","Prompt"]', 'PUBLISHED', 'f34c58ab-46a4-4693-8bb1-f36de4da0f46', 'WRITING', 5, 'English', 'Writing', 'Persuasive', 2, 1, true),
  ('e1b00000-0000-4000-8000-000000000003', 'WRITING',
   'Your council plans to remove fifty street trees to widen a road and cut travel times. As a local student, write a speech to the council meeting.',
   '["Persuasive","Writing","Prompt"]', 'PUBLISHED', 'f34c58ab-46a4-4693-8bb1-f36de4da0f46', 'WRITING', 5, 'English', 'Writing', 'Persuasive', 2, 1, true),
  ('e1b00000-0000-4000-8000-000000000004', 'WRITING',
   '"Treating everyone the same is not the same as treating everyone fairly." Write a persuasive text responding to this idea.',
   '["Persuasive","Writing","Prompt"]', 'PUBLISHED', 'f34c58ab-46a4-4693-8bb1-f36de4da0f46', 'WRITING', 5, 'English', 'Writing', 'Persuasive', 2, 1, true),
  ('e1b00000-0000-4000-8000-000000000005', 'WRITING',
   'Competitive sport teaches children to win at any cost. Others say it builds character. Argue whether competitive sport should be compulsory in primary school.',
   '["Persuasive","Writing","Prompt"]', 'PUBLISHED', 'f34c58ab-46a4-4693-8bb1-f36de4da0f46', 'WRITING', 5, 'English', 'Writing', 'Persuasive', 2, 1, true)
ON CONFLICT (id) DO NOTHING;