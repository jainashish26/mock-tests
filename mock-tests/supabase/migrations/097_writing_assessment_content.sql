-- 097_writing_assessment_content.sql
-- Seed the 13 Writing Assessment prompts (8 narrative + 5 persuasive).
-- Idempotent: deterministic UUIDs + ON CONFLICT DO NOTHING.
-- created_by = f34c58ab-46a4-4693-8bb1-f36de4da0f46 (TEST_CREATOR in live DB).

INSERT INTO public.questions (id, type, stem, tags, status, created_by, exam_type, year_level, subject, topic, sub_topic, difficulty, skill_writing, is_active)
VALUES
  ('e1a00000-0000-4000-8000-000000000001', 'WRITING',
   'A photograph shows a child sitting alone on the edge of a swimming pool, goggles pushed up on their forehead, everyone else already in the water. Write a narrative inspired by this image.',
   '["Narrative","Writing","Prompt"]', 'PUBLISHED', 'f34c58ab-46a4-4693-8bb1-f36de4da0f46', 'WRITING', 5, 'English', 'Writing', 'Narrative', 2, 1, true),
  ('e1a00000-0000-4000-8000-000000000002', 'WRITING',
   'Begin your narrative with this sentence: "On my first morning, nobody could say my name."',
   '["Narrative","Writing","Prompt"]', 'PUBLISHED', 'f34c58ab-46a4-4693-8bb1-f36de4da0f46', 'WRITING', 5, 'English', 'Writing', 'Narrative', 2, 1, true),
  ('e1a00000-0000-4000-8000-000000000003', 'WRITING',
   'Your best friend hands you the answers to tomorrow''s test. You need that mark. Write a narrative about what happens next.',
   '["Narrative","Writing","Prompt"]', 'PUBLISHED', 'f34c58ab-46a4-4693-8bb1-f36de4da0f46', 'WRITING', 5, 'English', 'Writing', 'Narrative', 2, 1, true),
  ('e1a00000-0000-4000-8000-000000000004', 'WRITING',
   'End your narrative with this sentence: "I looked back once, then I didn''t."',
   '["Narrative","Writing","Prompt"]', 'PUBLISHED', 'f34c58ab-46a4-4693-8bb1-f36de4da0f46', 'WRITING', 5, 'English', 'Writing', 'Narrative', 2, 1, true),
  ('e1a00000-0000-4000-8000-000000000005', 'WRITING',
   'In the pocket of a second-hand coat, you find a key and a folded note with an address on it. Write a narrative.',
   '["Narrative","Writing","Prompt"]', 'PUBLISHED', 'f34c58ab-46a4-4693-8bb1-f36de4da0f46', 'WRITING', 5, 'English', 'Writing', 'Narrative', 2, 1, true),
  ('e1a00000-0000-4000-8000-000000000006', 'WRITING',
   '"It would have been easier to say nothing." Use this line anywhere in a narrative of your own.',
   '["Narrative","Writing","Prompt"]', 'PUBLISHED', 'f34c58ab-46a4-4693-8bb1-f36de4da0f46', 'WRITING', 5, 'English', 'Writing', 'Narrative', 2, 1, true),
  ('e1a00000-0000-4000-8000-000000000007', 'WRITING',
   'You broke something that mattered to someone else, and nobody saw you do it. Write a narrative.',
   '["Narrative","Writing","Prompt"]', 'PUBLISHED', 'f34c58ab-46a4-4693-8bb1-f36de4da0f46', 'WRITING', 5, 'English', 'Writing', 'Narrative', 2, 1, true),
  ('e1a00000-0000-4000-8000-000000000008', 'WRITING',
   'For one hour every day, the whole world stops moving, except you. Write a narrative set in that hour.',
   '["Narrative","Writing","Prompt"]', 'PUBLISHED', 'f34c58ab-46a4-4693-8bb1-f36de4da0f46', 'WRITING', 5, 'English', 'Writing', 'Narrative', 2, 1, true)
ON CONFLICT (id) DO NOTHING;