-- ============================================================================
-- seeds/004_sample_writing.sql
--
-- WHAT THIS UNBLOCKS
--   Backlog item 17 (writing-mark capture and the five reports it feeds: P6, T6,
--   A5, A6, A7) has been blocked on data, not code. `public.writing_evaluations`
--   held ZERO rows and no child had ever sat one of the six published writing
--   tests, so every one of those reports would have rendered an empty screen. This
--   seed produces what a term of real usage would have produced: attempts on the
--   writing papers, the essays themselves, and the criterion-level marks.
--
-- THE MARKS ARE SHAPED LIKE THE RUBRIC, NOT LIKE A NUMBER
--   `category_scores` is the exact jsonb the marker writes and
--   `src/lib/writing/evaluation-detail.ts` reads - five categories, eleven
--   criteria, maxima 20/15/20/25/20 summing to 100:
--     language_mechanics (grammar, spelling, punctuation)        20
--     vocabulary (effective_word_choices, varied_word_usage)     15
--     cohesion_structure (cohesiveness, structure)               20
--     content_ideas (relevance, depth_originality, evidence_support) 25
--     engagement_style (engagement, tone_voice, language_features)   20
--   Each criterion is a real number here, and the category total equals the sum of
--   its criteria exactly - a fixture whose parts do not add up would make the
--   breakdown bars and the headline score disagree, and the first developer to
--   notice would waste an afternoon on it.
--
--   `score_out_of100` is the SUM of the category points, not an independent draw.
--   That keeps the headline consistent with the breakdown, which is what P6's band
--   and A5's drift analysis both assume.
--
-- WHAT IS DELIBERATELY UNIFORM
--   One model (`deepseek-flash`) and one rubric (`v1.0`) across every mark, because
--   that is what production looks like until someone changes it - and A5's whole
--   question is "did that change make marking worse". A fixture with mixed versions
--   would answer a question about the fixture. `duration_ms` and `word_count` DO
--   vary, because A6's length-bias correlation and A7's queue-time percentile both
--   need variance to have anything to measure.
--
--   Improvement objects carry `estimated_score_gain` and `rewrite`, which is the
--   shape the marker's JSON contract produces and the parent report renders. Flat
--   strings only would leave the richest part of P6 untestable.
--
-- DETERMINISTIC (md5 of test+student), reserved prefixes:
--   5d/5e = attempts/responses (the families 999 already removes)
--   52000000-â€¦ = writing_evaluations      53000000-â€¦ = writing_practice_sessions
-- Idempotent: every insert is guarded by ON CONFLICT on its primary key.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The fixture plan, in one temp table
-- ----------------------------------------------------------------------------
-- A temp table rather than a CTE repeated four times: the plan drives the attempt,
-- the essay, the marks and the score, and four copies of the same join would drift
-- the moment one filter changed. It is dropped at the end of this file - NOT
-- `ON COMMIT DROP`, which outside an explicit transaction would drop it at the end
-- of the CREATE statement itself.
DROP TABLE IF EXISTS writing_plan;
CREATE TEMP TABLE writing_plan AS
WITH w AS (
  SELECT
    t.id AS test_id,
    t.year_level_min,
    LEFT(t.title, 40) AS paper,
    (SELECT tq.question_id FROM public.test_questions tq
      JOIN public.questions q ON q.id = tq.question_id
     WHERE tq.test_id = t.id AND q.type = 'WRITING'
     LIMIT 1)         AS question_id,
    row_number() OVER (ORDER BY t.id) AS test_no
  FROM public.tests t
  WHERE t.status = 'PUBLISHED' AND t.exam_type = 'WRITING'
),
pairs AS (
  SELECT
    n,
    ('5a000000-0000-4000-8000-' || lpad(to_hex(((n - 1) % 200) + 1), 12, '0'))::uuid AS student_id,
    ((n - 1) % 6) + 1 AS test_no
  FROM generate_series(1, 36) AS n
)
SELECT
  p.n,
  p.student_id,
  w.test_id,
  w.question_id,
  w.year_level_min,
  w.paper,
  CASE WHEN p.test_no <= 3 THEN 'NARRATIVE' ELSE 'PERSUASIVE' END                AS text_type,
  ('5d000000-0000-4000-8000-' || lpad(to_hex(0x9000 + p.n), 12, '0'))::uuid       AS attempt_id,
  ('5e000000-0000-4000-8000-' || lpad(to_hex(0x9000 + p.n), 12, '0'))::uuid       AS response_id,
  ('52000000-0000-4000-8000-' || lpad(to_hex(p.n), 12, '0'))::uuid               AS evaluation_id,
  now() - make_interval(days => 30 + ((p.n * 13) % 210))                         AS submitted_at,
  ('x' || substr(md5(p.student_id::text || w.test_id::text), 1, 8))::bit(32)::int AS h
FROM pairs p
JOIN w ON w.test_no = p.test_no
WHERE w.question_id IS NOT NULL;


-- ----------------------------------------------------------------------------
-- 2. The attempts
-- ----------------------------------------------------------------------------
INSERT INTO public.attempts
  (id, student_id, test_id, started_at, submitted_at, status, score_out_of100,
   section_scores, time_spent_seconds, created_at)
SELECT
  pl.attempt_id,
  pl.student_id,
  pl.test_id,
  pl.submitted_at - interval '32 minutes',
  pl.submitted_at,
  'COMPLETE',
  NULL,                       -- filled in step 5, once the marks exist
  '{}'::jsonb,
  32 * 60,
  pl.submitted_at - interval '32 minutes'
FROM writing_plan pl
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. The essays
-- ----------------------------------------------------------------------------
-- Six bodies, three per text type, so `word_count` varies enough for A6's
-- length-bias correlation to have something to correlate. Writing `answer` as an
-- essay rather than a placeholder matters: the parent report renders the child's
-- own text beside the rewrite, and a fixture of "lorem ipsum" would make every
-- layout bug invisible.
INSERT INTO public.responses
  (id, attempt_id, question_id, section_name, difficulty_served, answer,
   is_correct, time_spent_seconds, created_at)
SELECT
  pl.response_id,
  pl.attempt_id,
  pl.question_id,
  'Writing',
  2,
  to_jsonb(v.body),
  -- Writing is not right-or-wrong; the column is NOT NULL, so it is true and the
  -- mark lives in writing_evaluations. Nothing reads it for writing items.
  true,
  900 + (abs(pl.h) % 500),
  pl.submitted_at - interval '2 minutes'
FROM writing_plan pl
JOIN (
  VALUES
    (0, 'NARRATIVE',
     'The old lighthouse had been dark for eleven years, but Mira still climbed the stairs every evening. Tonight the wind pushed against the glass like a hand. She set her lamp on the sill and waited, the way her father had taught her, though he never explained what he was waiting for. At nine o''clock a small boat appeared, rocking hard, its engine coughing. Mira swung the lamp twice. The boat turned toward the rocks and then, slowly, toward the harbour mouth. She watched until the lights were safe, then sat down on the cold step and cried for no reason she could name.'),
    (1, 'NARRATIVE',
     'My grandmother''s kitchen smelled of cardamom and rain. She never used a recipe; she used her hands, and when I asked how much, she said "enough". The afternoon I broke her blue bowl, I expected shouting. Instead she swept the pieces into her apron, sat me on the table, and told me about the winter she dropped a whole pot of soup in front of her new mother-in-law. We laughed until the kettle screamed. I still have one shard of that bowl in my drawer. It is not valuable. It is the only thing of hers that fits in my pocket.'),
    (2, 'NARRATIVE',
     'The last train home was always empty, which is why I liked it. I could put my feet on the seat and watch the city fold itself away, street by street, into fields. That night a man sat opposite me and asked whether I had ever noticed how stations are named after things that are no longer there. The mill. The quarry. The orchard. We listed them together until my stop, and when I stood up he said, "You will remember this." I do. I cannot remember his face at all.'),
    (3, 'PERSUASIVE',
     'Schools should teach every student to cook before they leave. It is a simple skill with serious consequences. Young adults who cannot cook rely on expensive takeaway food, which is often high in salt and low in vegetables, and they spend money they do not have. A weekly cooking class would teach planning, budgeting and basic nutrition at once, and it would be cheaper than the health costs of doing nothing. Critics argue that the timetable is already full, but a single lesson a week for a term is not a large commitment. It is a small investment with a lifetime of returns.'),
    (4, 'PERSUASIVE',
     'Our town should keep the library open on Sundays. The library is not only a place to borrow books; it is the warmest room in town for people who cannot afford to heat their own. Students use it to study when home is noisy. Older residents use it to see another face. Closing on Sunday saves a small amount of money and costs the community something much larger. I have seen the reading room full on a winter afternoon, and I have seen it empty. One of those rooms is a town. The other is just a building with books in it.'),
    (5, 'PERSUASIVE',
     'Homework should be limited, not abolished. Practice matters, and a short task each night keeps a student connected to what they learned. What does not work is three hours of repetition that leaves no time for sport, sleep or family. A sensible limit - forty minutes in primary school, ninety in secondary - respects the purpose of homework without pretending that more is always better. Teachers could then set fewer, better tasks. Students would arrive rested. The evidence on sleep and learning is clear, and a tired student learns nothing at all.')
) AS v(idx, kind, body)
  ON v.kind = pl.text_type
 AND v.idx = (pl.n - 1) % 3 + CASE WHEN pl.text_type = 'NARRATIVE' THEN 0 ELSE 3 END
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 4. The criterion-level marks
-- ----------------------------------------------------------------------------
-- The five category maxima are 20/15/20/25/20 = 100, and each category total is
-- the exact sum of its criteria. `score_out_of100` is the sum of the categories,
-- so the headline, the breakdown bars and the band agree by construction.
WITH calc AS (
  SELECT
    pl.*,
    r.answer #>> '{}' AS essay,
    11 + (abs(pl.h) % 8)       AS lm,
    8  + (abs(pl.h / 7) % 6)   AS voc,
    11 + (abs(pl.h / 11) % 8)  AS coh,
    14 + (abs(pl.h / 13) % 10) AS con,
    11 + (abs(pl.h / 17) % 8)  AS eng
  FROM writing_plan pl
  JOIN public.responses r ON r.id = pl.response_id
),
parts AS (
  SELECT
    c.*,
    (c.lm / 3)  AS g, (c.lm / 3) AS s,
    (c.voc / 2) AS v1,
    (c.coh / 2) AS c1,
    (c.con / 3) AS n1,
    (c.eng / 3) AS e1
  FROM calc c
)
INSERT INTO public.writing_evaluations
  (id, attempt_id, provider, score_out_of100, strengths, improvements,
   improvements_detail, improved_text, text_type, category_scores,
   techniques_used, practice_exercise, rubric_version, model, word_count,
   graded_at, duration_ms, raw_response, created_at)
SELECT
  p.evaluation_id,
  p.attempt_id,
  'DeepSeek',
  (p.lm + p.voc + p.coh + p.con + p.eng)::numeric,
  to_jsonb(CASE p.text_type
    WHEN 'NARRATIVE' THEN ARRAY[
      'Clear sense of place - the setting does real work',
      'The ending turns on a small, concrete detail',
      'Dialogue is used sparingly and it sounds like speech']
    ELSE ARRAY[
      'The position is stated in the first sentence and never wavers',
      'Concrete examples carry the argument',
      'The counter-argument is acknowledged rather than ignored']
  END),
  to_jsonb(CASE p.text_type
    WHEN 'NARRATIVE' THEN ARRAY[
      'Two sentences begin with "The" - vary the openings',
      'Show the feeling through action instead of naming it']
    ELSE ARRAY[
      'The third paragraph repeats the first point',
      'Add one statistic to the health claim so it is not just assertion']
  END),
  jsonb_build_array(
    jsonb_build_object(
      'suggestion', CASE p.text_type
        WHEN 'NARRATIVE' THEN 'Vary sentence openings so the rhythm does not flatten'
        ELSE 'Support the central claim with one concrete figure' END,
      'estimated_score_gain', 3,
      'rewrite', 'Instead of naming the emotion, let the action carry it.'),
    jsonb_build_object(
      'suggestion', 'Tighten the fourth paragraph - it restates rather than advances',
      'estimated_score_gain', 2,
      'rewrite', NULL)
  ),
  CASE p.text_type
    WHEN 'NARRATIVE' THEN
      'The light swung twice across the water, and the boat answered by turning. Mira did not move until the harbour mouth swallowed it, and even then she stayed on the step, listening to the wind lose interest.'
    ELSE
      'Keeping the library open on Sunday costs a few hundred dollars a week. Closing it costs a warm room, a quiet desk and a place to be known - and those are not the same kind of number.'
  END,
  -- Stored lowercase, matching what grade-writing.ts persists from the model's own
  -- JSON (`text_type: toText(parsed.text_type)`). The UI normalises either case,
  -- but a fixture that reads differently from production in a plain SELECT is a
  -- small lie that costs an hour to disprove.
  lower(p.text_type),
  jsonb_build_object(
    'language_mechanics', jsonb_build_object(
      'grammar', p.g,
      'spelling', p.s,
      'punctuation', p.lm - p.g - p.s),
    'vocabulary', jsonb_build_object(
      'effective_word_choices', p.v1,
      'varied_word_usage', p.voc - p.v1),
    'cohesion_structure', jsonb_build_object(
      'cohesiveness', p.c1,
      'structure', p.coh - p.c1),
    'content_ideas', jsonb_build_object(
      'relevance', p.n1,
      'depth_originality', p.n1,
      'evidence_support', p.con - (p.n1 * 2)),
    'engagement_style', jsonb_build_object(
      'engagement', p.e1,
      'tone_voice', p.e1,
      'language_features', p.eng - (p.e1 * 2))
  ),
  to_jsonb(CASE p.text_type
    WHEN 'NARRATIVE' THEN ARRAY['show_dont_tell', 'sensory_detail', 'dialogue']
    ELSE ARRAY['rhetorical_question', 'rule_of_three', 'anecdote']
  END),
  CASE p.text_type
    WHEN 'NARRATIVE' THEN 'Write one paragraph about a room your character has left, using only what they can see from the doorway.'
    ELSE 'Rewrite your opening paragraph as a single sentence under twelve words, then rebuild it without losing the claim.'
  END,
  'v1.0',
  'deepseek-flash',
  COALESCE(array_length(regexp_split_to_array(btrim(p.essay), '\s+'), 1), 0),
  p.submitted_at + interval '55 seconds',
  42000 + (abs(p.h) % 16000),
  jsonb_build_object(
    'model', 'deepseek-flash',
    'rubric_version', 'v1.0',
    'usage', jsonb_build_object('prompt_tokens', 640, 'completion_tokens', 512),
    'text_type', p.text_type),
  p.submitted_at + interval '55 seconds'
FROM parts p
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 5. Bring the attempt score into line with the mark
-- ----------------------------------------------------------------------------
-- A writing attempt's score IS the mark: the section breakdown carries the essay
-- average under "Writing" (that is what grade-writing.ts merges after scoring).
-- Leaving score_out_of100 NULL would make the attempt look unmarked on every
-- list that sorts by score.
UPDATE public.attempts a
   SET score_out_of100 = e.score_out_of100,
       section_scores  = jsonb_build_object('Writing', e.score_out_of100)
  FROM public.writing_evaluations e
 WHERE e.attempt_id = a.id
   AND a.id::text LIKE '5d000000-%';

-- ----------------------------------------------------------------------------
-- 6. AI Practice Lab sessions, so the writing progress chart has a second series
-- ----------------------------------------------------------------------------
-- P6's progress report reads practice sessions as well as tests; a fixture with
-- only test marks would leave half of that chart empty and half of its logic
-- unexercised.
INSERT INTO public.writing_practice_sessions
  (id, student_id, prompt_id, text_type, prompt_text, student_text, word_count,
   year_level, status, score_out_of100, evaluation, rubric_version, model,
   created_at, graded_at, duration_ms)
SELECT
  ('53000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
  ('5a000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
  'sample-practice-' || n,
  lower(CASE WHEN n % 2 = 1 THEN 'NARRATIVE' ELSE 'PERSUASIVE' END),
  CASE WHEN n % 2 = 1
       THEN 'Write about a moment when you had to decide whether to speak.'
       ELSE 'Argue for or against a later school start time.' END,
  'I had practised the sentence all morning, so when the moment came I said it too quickly and nobody heard. I tried again, louder, and the room turned. That was the first time I noticed that being right and being heard are not the same thing.',
  COALESCE(array_length(regexp_split_to_array(
    'I had practised the sentence all morning, so when the moment came I said it too quickly and nobody heard. I tried again, louder, and the room turned. That was the first time I noticed that being right and being heard are not the same thing.',
    '\s+'), 1), 0),
  5 + (n % 4),
  'GRADED',
  s.score,
  jsonb_build_object(
    'score_out_of100', s.score,
    'text_type', lower(CASE WHEN n % 2 = 1 THEN 'NARRATIVE' ELSE 'PERSUASIVE' END),
    'category_scores', jsonb_build_object(
      'language_mechanics', jsonb_build_object(
        'grammar', s.lm / 3, 'spelling', s.lm / 3, 'punctuation', s.lm - 2 * (s.lm / 3)),
      'vocabulary', jsonb_build_object(
        'effective_word_choices', s.voc / 2, 'varied_word_usage', s.voc - s.voc / 2),
      'cohesion_structure', jsonb_build_object(
        'cohesiveness', s.coh / 2, 'structure', s.coh - s.coh / 2),
      'content_ideas', jsonb_build_object(
        'relevance', s.con / 3, 'depth_originality', s.con / 3,
        'evidence_support', s.con - 2 * (s.con / 3)),
      'engagement_style', jsonb_build_object(
        'engagement', s.eng / 3, 'tone_voice', s.eng / 3,
        'language_features', s.eng - 2 * (s.eng / 3))),
    'strengths', jsonb_build_array('The ending lands on a concrete image'),
    'improvements', jsonb_build_array('Open with the decision, not the morning'),
    'improved_text', 'The sentence was ready. The room was not.',
    'practice_exercise', 'Rewrite your opening in six words or fewer.'),
  'v1.0',
  'deepseek-flash',
  now() - make_interval(days => 20 + n * 11),
  now() - make_interval(days => 20 + n * 11) + interval '48 seconds',
  38000 + n * 1500
FROM generate_series(1, 6) AS n
CROSS JOIN LATERAL (
  SELECT
    (58 + (n * 7) % 26)                        AS score,
    ROUND((58 + (n * 7) % 26) * 0.20)::int     AS lm,
    ROUND((58 + (n * 7) % 26) * 0.15)::int     AS voc,
    ROUND((58 + (n * 7) % 26) * 0.20)::int     AS coh,
    ROUND((58 + (n * 7) % 26) * 0.25)::int     AS con,
    (58 + (n * 7) % 26)
      - ROUND((58 + (n * 7) % 26) * 0.20)::int
      - ROUND((58 + (n * 7) % 26) * 0.15)::int
      - ROUND((58 + (n * 7) % 26) * 0.20)::int
      - ROUND((58 + (n * 7) % 26) * 0.25)::int AS eng
) s
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 7. Rebuild the reporting layer for the rows just created
-- ----------------------------------------------------------------------------
-- Attempt and response facts are ETL output, not fixture rows. Leaving them stale
-- means P4's history and A1's per-item counts would ignore these 36 attempts until
-- the next nightly load - and the first developer to notice would think the seed
-- had not worked.
SELECT reporting.load_student_dims();
SELECT reporting.load_attempt_facts(true);
SELECT reporting.load_response_facts(true);

-- ----------------------------------------------------------------------------
-- 8. Print the shape, then clean up
-- ----------------------------------------------------------------------------
SELECT
  (SELECT COUNT(*) FROM public.writing_evaluations
    WHERE id::text LIKE '52000000-%')                                    AS sample_marks,
  (SELECT COUNT(*) FROM public.responses
    WHERE id::text LIKE '5e000000-%'
      AND id::text >= '5e000000-0000-4000-8000-000000009000')            AS sample_essays,
  (SELECT COUNT(*) FROM public.writing_practice_sessions
    WHERE id::text LIKE '53000000-%')                                    AS sample_practice,
  (SELECT ROUND(AVG(score_out_of100), 1) FROM public.writing_evaluations
    WHERE id::text LIKE '52000000-%')                                    AS avg_mark,
  (SELECT COUNT(*) FROM public.writing_evaluations
    WHERE id::text LIKE '52000000-%'
      AND (category_scores->'language_mechanics'->>'grammar')::numeric
        + (category_scores->'language_mechanics'->>'spelling')::numeric
        + (category_scores->'language_mechanics'->>'punctuation')::numeric > 20) AS over_max_lm;

DROP TABLE IF EXISTS writing_plan;
