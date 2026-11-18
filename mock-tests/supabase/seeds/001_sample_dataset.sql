-- ============================================================================
-- SAMPLE DATASET - deterministic, labelled, and fully reversible.
--
-- THIS IS NOT REAL DATA. Every row it creates is synthetic and every identifier
-- lives in a reserved UUID prefix family (5a/5b/5c/5d/5e/5f/59) that no real row
-- can collide with. See SAMPLE_DATA.md for the full inventory and the
-- replacement plan, and supabase/seeds/999_cleanup_sample_dataset.sql to remove
-- all of it in one statement per table.
--
-- WHY IT IS NOT A MIGRATION
--   Migrations are replayed on every environment, including production. Sample
--   students, attempts and funnel events must never reach a production database:
--   they would contaminate every revenue, conversion and attainment figure the
--   business makes decisions from. So this lives in supabase/seeds/ and is run
--   deliberately, never automatically.
--
-- WHAT IT UNBLOCKS
--   Before this seed the database held 3 students, 1 attempt and 3 funnel events.
--   That is not enough to exercise anything:
--     * P2 percentile needs a cohort of n>=20 (below that it is suppressed by
--       design), so the report could not exist at all.
--     * P4 trend needs several attempts per child spread over months.
--     * P3 mastery needs >=5 responses per topic before it will state a verdict.
--     * A11 funnel conversion needs volume across stages, including drop-off.
--   14-...md 15.1 makes the same point: "the database is empty... fixtures are
--   the product."
--
-- DESIGN PRINCIPLES
--   1. DETERMINISTIC. Every value derives from an md5 hash of a stable key, never
--      from random() or clock-dependent state. Running this twice produces
--      identical data, so an expected value computed today still holds tomorrow.
--      A fixture that changes silently is worse than no fixture.
--   2. IDEMPOTENT. Every INSERT is ON CONFLICT DO NOTHING, so a re-run neither
--      duplicates nor errors.
--   3. REALISTIC SHAPE, NOT REALISTIC VALUES. Ability is drawn per student,
--      difficulty comes from the real test_questions.base_difficulty, and ability
--      drifts upward over the year so trend reports show progress. Nothing here
--      claims to predict a real child's performance.
--   4. REUSES REAL CONTENT. Attempts point at the 11 genuinely published tests
--      and responses at genuinely published questions, so topic and sub-topic
--      tagging - and therefore P3, P8, A3 and TC1 - exercise the real taxonomy
--      rather than invented labels.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Deterministic uniform [0,1) helper.
--
-- Lives in its own schema so the cleanup script can drop the whole thing rather
-- than leaving a seeding helper behind in public.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS sample_data;

CREATE OR REPLACE FUNCTION sample_data.u01(p_seed text)
RETURNS numeric
LANGUAGE sql IMMUTABLE
SET search_path TO 'sample_data', 'public', 'pg_catalog'
AS $function$
  -- 28 bits of md5, so the result is always non-negative and evenly spread.
  SELECT (('x' || substr(md5(p_seed), 1, 7))::bit(28)::int)::numeric / 268435455.0;
$function$;

COMMENT ON FUNCTION sample_data.u01(text) IS
  'Deterministic uniform [0,1) from md5. Used by the sample dataset seed so results are reproducible across runs. Dropped by 999_cleanup_sample_dataset.sql.';

-- ---------------------------------------------------------------------------
-- 1. Identities: 200 sample students, 100 sample parents, 2 children per parent
-- ---------------------------------------------------------------------------
-- Year levels 3-8 (six levels, ~33 students each) so percentile cohorts clear
-- the n>=20 suppression floor without being so large that the distribution is
-- meaningless.
--
-- auth.users ROWS ARE REQUIRED
--   student_profiles.auth_user_id, app_user_roles.user_id,
--   parent_student_links.parent_user_id, funnel_events.user_id and email_log.user_id
--   all carry FKs to auth.users, so the sample identities need real auth rows.
--
--   They are created so they can NEVER be used to sign in or receive mail:
--     * email uses the `.invalid` TLD, reserved by RFC 2606 and guaranteed
--       non-routable, so no real mailbox can ever be contacted;
--     * encrypted_password is empty, so password auth cannot succeed;
--     * email_confirmed_at stays NULL, so the account is unconfirmed;
--     * raw_user_meta_data carries {"sample": true} so a human or a query can
--       identify these rows without relying on the UUID prefix alone.
--
--   NOTE on introspection: `conrelid::regclass::text` omits the schema when that
--   schema is on search_path, so a filter like `= 'public.student_profiles'`
--   silently matches nothing. Match on regclass OIDs or on both renderings.

INSERT INTO auth.users
  (id, instance_id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at,
   raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous)
SELECT
  ('5f000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'sample.student.' || lpad(n::text, 4, '0') || '@sample.invalid',
  '', NULL,
  now() - make_interval(days => (n * 7) % 365),
  now(),
  '{"provider":"sample","providers":["sample"]}'::jsonb,
  jsonb_build_object('sample', true, 'kind', 'student', 'purpose', 'fixture dataset'),
  false, false
FROM generate_series(1, 200) AS n
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users
  (id, instance_id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at,
   raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous)
SELECT
  ('5b000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'sample.parent.' || lpad(n::text, 4, '0') || '@sample.invalid',
  '', NULL,
  now() - make_interval(days => (n * 7) % 365),
  now(),
  '{"provider":"sample","providers":["sample"]}'::jsonb,
  jsonb_build_object('sample', true, 'kind', 'parent', 'purpose', 'fixture dataset'),
  false, false
FROM generate_series(1, 100) AS n
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.student_profiles (id, auth_user_id, year_level, username, created_at, updated_at)
SELECT
  ('5a000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
  ('5f000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
  3 + (n % 6),
  'sample.student.' || lpad(n::text, 4, '0'),
  -- Signup spread across the past year so cohort and tenure views have shape.
  now() - make_interval(days => (n * 7) % 365),
  now()
FROM generate_series(1, 200) AS n
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.app_user_roles (user_id, role, created_at)
SELECT ('5f000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid, 'STUDENT', now()
FROM generate_series(1, 200) AS n
ON CONFLICT DO NOTHING;

INSERT INTO public.app_user_roles (user_id, role, created_at)
SELECT ('5b000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid, 'PARENT', now()
FROM generate_series(1, 100) AS n
ON CONFLICT DO NOTHING;

-- Two children per parent. Deliberate: sibling households are the case the N-5
-- sibling-offer lever targets, and a dataset of only-child families could never
-- exercise it.
INSERT INTO public.parent_student_links (id, parent_user_id, student_id, created_at)
SELECT
  ('5c000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
  ('5b000000-0000-4000-8000-' || lpad(to_hex(((n - 1) / 2) + 1), 12, '0'))::uuid,
  ('5a000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
  now() - make_interval(days => (n * 7) % 365)
FROM generate_series(1, 200) AS n
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Attempts: 2-10 per student across the last 12 months
-- ---------------------------------------------------------------------------
-- Scores are filled in step 5, after responses exist: a score written before the
-- responses it summarises is exactly the DA-03 reconciliation defect the test
-- plan warns about.
--
-- ~8% of attempts are left IN_PROGRESS on purpose. Without abandoned attempts,
-- A4's abandonment metrics and the expiry finaliser have nothing to measure, and
-- a completion rate computed only from finished tests is 100% by construction.

WITH s AS (
  SELECT n,
         ('5a000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid AS student_id,
         3 + (n % 6)                                                    AS year_level,
         now() - make_interval(days => (n * 7) % 365)                    AS signed_up
  FROM generate_series(1, 200) AS n
),
seq AS (
  SELECT s.n, s.student_id, s.year_level, s.signed_up, k.k
  FROM s
  CROSS JOIN LATERAL generate_series(
    1, 2 + (sample_data.u01('natt:' || s.n)::numeric * 9)::int) AS k(k)
),
picked AS (
  SELECT sq.n, sq.student_id, sq.k, sq.signed_up,
         t.id AS test_id,
         -- Deterministic pick of one eligible test per (student, attempt).
         row_number() OVER (
           PARTITION BY sq.student_id, sq.k
           ORDER BY sample_data.u01('tp:' || sq.n || ':' || sq.k || ':' || t.id::text)
         ) AS rn
  FROM seq sq
  JOIN public.tests t
    ON t.status = 'PUBLISHED'
   AND sq.year_level BETWEEN t.year_level_min AND t.year_level_max
),
chosen AS (
  SELECT p.*,
         -- Only the FIRST attempt of a (student, test) pair may be left
         -- IN_PROGRESS: attempts_one_in_progress_per_student_test forbids a
         -- second open attempt, exactly as the real retry path does (the expiry
         -- finaliser closes the old one before a new one starts). Violating this
         -- fails the whole seed, so it is handled rather than worked around.
         row_number() OVER (PARTITION BY p.student_id, p.test_id ORDER BY p.k) AS dup_rank
  FROM picked p
  WHERE p.rn = 1
)
INSERT INTO public.attempts
  (id, student_id, test_id, started_at, submitted_at, status,
   time_spent_seconds, created_at)
SELECT
  ('5d000000-0000-4000-8000-' || lpad(to_hex(p.n * 100 + p.k), 12, '0'))::uuid,
  p.student_id,
  p.test_id,
  ts.started_at,
  CASE WHEN ts.abandoned THEN NULL
       ELSE ts.started_at + make_interval(mins => ts.mins) END,
  CASE WHEN ts.abandoned THEN 'IN_PROGRESS'::attempt_status
       -- Both terminal states appear because they are distinct in the source
       -- system and the ETL treats them alike; a fixture using only one would
       -- hide a filter written against the other.
       WHEN (p.k % 3 = 0) THEN 'SUBMITTED'::attempt_status
       ELSE 'COMPLETE'::attempt_status END,
  CASE WHEN ts.abandoned THEN ts.mins * 20 ELSE ts.mins * 60 END,
  ts.started_at
FROM chosen p
CROSS JOIN LATERAL (
  SELECT
    -- Clamp inside [signup, now-2h] so no attempt lands in the future, which
    -- would corrupt date_key bucketing and make trend windows look empty.
    GREATEST(
      p.signed_up + make_interval(hours => 6),
      LEAST(now() - make_interval(hours => 2),
            p.signed_up + make_interval(days => (p.k - 1) * 28))
    )                                                            AS started_at,
    (20 + (sample_data.u01('mins:' || p.n || ':' || p.k)::numeric * 40)::int) AS mins,
    (sample_data.u01('abn:' || p.n || ':' || p.k) < 0.08 AND p.dup_rank = 1) AS abandoned
) ts
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Responses, with an ability model that produces realistic spread and trend
-- ---------------------------------------------------------------------------
-- Shape mirrors the one real attempt already in the database: responses.answer
-- is a JSON STRING ("A"), not an object, and attempts.section_scores maps a
-- section name to a numeric percentage.
--
-- The model, and why each term is there:
--   ability   0.35..0.85, fixed per student - gives the cohort a real
--             distribution, which is what makes percentile meaningful instead of
--             a flat line.
--   growth    up to +0.12 over a year of tenure - without it P4's trend is flat
--             and P1's projection has nothing to project from.
--   difficulty -0.07 per step of base_difficulty, taken from the REAL
--             test_questions row - so topic-level accuracy varies, which is what
--             P3 mastery and P8 recommendations rank on.
--
-- THE ANSWER IS DERIVED FROM THE VERDICT, NOT DRAWN BESIDE IT. This used to pick
-- a letter from one md5 seed ('ans:') and is_correct from a different one ('r:'),
-- and never compared either to questions.correct_answer. The two were therefore
-- statistically independent: measured across the old dataset, is_correct was TRUE
-- for 54.3% of answers that MATCHED the key and 54.0% of answers that did NOT, and
-- 6,528 of 12,499 MCQ responses (52.2%) contradicted it. Every accuracy-derived
-- metric on the platform - A1 p_value, P3 mastery, T1 levels, T2 gaps, T3 at-risk
-- and T7/P8 recommendations - reads that column, so all of them were counting
-- marks rather than right answers.
--
-- Ability now drives WHICH OPTION IS CHOSEN: with probability p(correct) the
-- student picks the authored key, otherwise a distractor drawn uniformly from the
-- question's real option set. is_correct is then simply "the key was picked", so
-- marking cannot disagree with content by construction. The probability model is
-- unchanged, so the score spread, the tenure trend and the difficulty gradient all
-- survive - only the link between answer and verdict is repaired.
--
-- Two details fall out of using the AUTHORED option set:
--   * Questions with five options can now be answered "E". The old `% 4` could
--     never emit it, which would have made E a dead distractor on all 348
--     five-option items and tripped A1's DEAD_DISTRACTOR flag spuriously.
--   * The one SHORT_ANSWER item has a free-text key ("Canberra") and no option
--     letters, so it is handled on its own branch.
--
-- Every term is derived from md5 of a stable key, so the dataset is identical on
-- every run.

WITH att AS (
  SELECT a.id AS attempt_id, a.test_id, a.started_at,
         (0.35 + 0.50 * sample_data.u01('ability:' || a.student_id::text))::numeric AS ability,
         -- Tenure in years since signup, clamped to [0,1].
         GREATEST(0.0, LEAST(1.0,
           (EXTRACT(EPOCH FROM (a.started_at - sp.created_at)) / 86400.0 / 365.0)::numeric
         )) AS tenure_years
  FROM public.attempts a
  JOIN public.student_profiles sp ON sp.id = a.student_id
  WHERE a.id::text LIKE '5d000000-%'
),
ranked AS (
  SELECT att.attempt_id, att.started_at, att.ability, att.tenure_years,
         tq.question_id, tq.section_name, tq.base_difficulty,
         row_number() OVER (
           PARTITION BY att.attempt_id
           ORDER BY sample_data.u01('q:' || att.attempt_id || ':' || tq.question_id)
         ) AS rn
  FROM att
  JOIN public.test_questions tq ON tq.test_id = att.test_id
),
-- The authored key and the authored option letters, taken from the content. This
-- mirrors the `authored` CTE in reporting.item_statistics() so the generator and
-- the auditor agree on what an item's options are.
keyed AS (
  SELECT q.id AS question_id,
         NULLIF(btrim(q.correct_answer), '') AS key_text,
         (SELECT array_agg(x.letter ORDER BY x.letter)
          FROM (VALUES ('A', q.answer_a), ('B', q.answer_b), ('C', q.answer_c),
                       ('D', q.answer_d), ('E', q.answer_e)) AS x(letter, txt)
          WHERE NULLIF(btrim(x.txt), '') IS NOT NULL) AS letters
  FROM public.questions q
),
served AS (
  SELECT r.attempt_id, r.started_at, r.question_id, r.section_name,
         r.base_difficulty, r.rn,
         k.key_text,
         -- Options that are NOT the key; a wrong answer must be one of these.
         (SELECT array_agg(x.letter ORDER BY x.letter)
          FROM unnest(COALESCE(k.letters, '{}'::text[])) AS x(letter)
          WHERE x.letter IS DISTINCT FROM k.key_text) AS distractors,
         -- p(correct), clamped so no item is impossible or automatic.
         GREATEST(0.05, LEAST(0.97,
           r.ability + 0.12 * r.tenure_years - 0.07 * (r.base_difficulty - 1)
         )) AS p_correct
  FROM ranked r
  LEFT JOIN keyed k ON k.question_id = r.question_id
  WHERE r.rn <= 12 + (sample_data.u01('k:' || r.attempt_id)::numeric * 9)::int
),
marked AS (
  SELECT s.*,
         (sample_data.u01('r:' || s.attempt_id || ':' || s.question_id) < s.p_correct)
           AS is_right
  FROM served s
),
answered AS (
  SELECT m.*,
         CASE
           WHEN m.key_text ~ '^[A-E]$' AND COALESCE(array_length(m.distractors, 1), 0) > 0 THEN
             CASE WHEN m.is_right THEN m.key_text
                  -- u01() can return exactly 1.0, so the modulo is what keeps the
                  -- subscript inside the array; floor() alone would overflow it by
                  -- one and yield a NULL answer.
                  ELSE m.distractors[
                    1 + (floor(sample_data.u01('d:' || m.attempt_id || ':' || m.question_id)::numeric
                               * array_length(m.distractors, 1))::int
                         % array_length(m.distractors, 1))]
             END
           -- Free-text key, or a malformed item with no usable options.
           WHEN m.is_right THEN m.key_text
           ELSE '(wrong)'
         END AS answer_text
  FROM marked m
)
INSERT INTO public.responses
  (id, attempt_id, question_id, section_name, difficulty_served, answer,
   is_correct, time_spent_seconds, created_at)
SELECT
  ('5e000000-0000-4000-8000-' || lpad(to_hex(row_number() OVER ()), 12, '0'))::uuid,
  r.attempt_id,
  r.question_id,
  r.section_name,
  r.base_difficulty,
  -- A bare letter (or the free-text key), matching the existing rows.
  to_jsonb(r.answer_text),
  r.is_right,
  (18 + r.base_difficulty * 12
        + (sample_data.u01('t:' || r.attempt_id || ':' || r.question_id)::numeric * 70)::int),
  -- Ordered within the attempt so position-based analytics have a real sequence.
  r.started_at + make_interval(secs => (r.rn - 1) * 45)
FROM answered r
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Reconcile attempt scores FROM the responses
-- ---------------------------------------------------------------------------
-- Deliberately derived rather than seeded independently: if the score and the
-- responses were generated separately they would drift, and DA-03 (score
-- reconciliation) would be testing nothing. Deriving it is also what the real
-- submission path does.
--
-- IN_PROGRESS attempts are excluded - an abandoned attempt has no score, and
-- giving it one would corrupt A4's completion and abandonment metrics.

WITH per_sec AS (
  SELECT r.attempt_id, r.section_name,
         COUNT(*)                              AS n,
         COUNT(*) FILTER (WHERE r.is_correct)  AS c
  FROM public.responses r
  WHERE r.id::text LIKE '5e000000-%'
  GROUP BY r.attempt_id, r.section_name
),
rolled AS (
  SELECT attempt_id,
         jsonb_object_agg(section_name, ROUND(100.0 * c / NULLIF(n, 0), 1)) AS sections,
         SUM(n) AS total_n,
         SUM(c) AS total_c
  FROM per_sec
  GROUP BY attempt_id
)
UPDATE public.attempts a
SET score_out_of100  = ROUND(100.0 * r.total_c / NULLIF(r.total_n, 0), 2),
    raw_accuracy     = ROUND(100.0 * r.total_c / NULLIF(r.total_n, 0), 2),
    weighted_score   = ROUND(100.0 * r.total_c / NULLIF(r.total_n, 0), 2),
    section_scores   = r.sections
FROM rolled r
WHERE a.id = r.attempt_id
  AND a.status <> 'IN_PROGRESS';

-- ---------------------------------------------------------------------------
-- 6. Funnel events: 100 sample parents walking the real conversion path
-- ---------------------------------------------------------------------------
-- Resulting shape (verified after seeding):
--   LANDING_VIEWED 100 -> SIGNUP_STARTED 75 -> SIGNUP_COMPLETED 58
--   -> STUDENT_ADDED 41 -> DIAGNOSTIC_STARTED 28 -> REPORT_EMAILED 18
--   -> PAYWALL_TRIGGERED 12 -> CHECKOUT_STARTED 8 -> CHECKOUT_COMPLETED 5
--
-- A 5% landing-to-customer rate with plausible stage drop-off. The shape matters
-- more than the level: A11 computes stage-to-stage conversion, and a fixture
-- where everyone reaches every stage produces a 100% funnel that hides any bug in
-- the stage logic. Drop-off is what makes the report testable.
--
-- Event names and stage values are taken verbatim from the catalogue in
-- src/lib/funnel/events.ts (EVENT_STEP / EVENT_STAGE). None are invented - an
-- invented name would silently create a funnel stage nothing else reports on.
--
-- UTM is varied deterministically across four sources and three campaigns so
-- A11's segment analysis has something to segment by.

WITH p AS (
  SELECT n,
    ('5b000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid     AS parent_id,
    ('5a000000-0000-4000-8000-' || lpad(to_hex(2 * n - 1), 12, '0'))::uuid AS first_student,
    now() - make_interval(days => (n * 7) % 300)                        AS t0,
    sample_data.u01('depth:' || n)                                      AS u
  FROM generate_series(1, 100) AS n
),
depthed AS (
  SELECT p.*,
    CASE WHEN u < 0.28 THEN 0 WHEN u < 0.45 THEN 1 WHEN u < 0.58 THEN 2
         WHEN u < 0.68 THEN 3 WHEN u < 0.78 THEN 4 WHEN u < 0.86 THEN 5
         WHEN u < 0.92 THEN 6 WHEN u < 0.96 THEN 7 ELSE 8 END           AS depth
  FROM p
),
-- exact_depth marks TERMINAL ALTERNATIVES. CHECKOUT_ABANDONED must fire only for
-- a parent who stopped at checkout, never for one who also completed it - a
-- single `req_depth <= depth` test cannot express "and not further". Without
-- this, 5 paying customers also appear as abandonments, which would deflate the
-- abandonment metric that the offer-expiry worker is measured on.
steps(req_depth, seq, event, stage, mins, path, needs_student, exact_depth) AS (
  VALUES
    (0, 1 ,'LANDING_VIEWED'          , NULL               ,    0, '/'                , false, false),
    (1, 2 ,'SIGNUP_STARTED'          , NULL               ,    5, '/signup'          , false, false),
    (2, 3 ,'SIGNUP_COMPLETED'        , 'SIGNED_UP'        ,    9, '/signup'          , false, false),
    (3, 4 ,'STUDENT_ADDED'           , 'STUDENT_ADDED'    ,   18, '/onboarding'      , true , false),
    (3, 5 ,'EXAM_TARGET_SET'         , NULL               ,   22, '/onboarding'      , true , false),
    (4, 6 ,'DIAGNOSTIC_OFFERED'      , NULL               ,   30, '/onboarding'      , true , false),
    (4, 7 ,'DIAGNOSTIC_STARTED'      , 'DIAGNOSTIC_STARTED', 1450, '/runner'         , true , false),
    (4, 8 ,'DIAGNOSTIC_COMPLETED'    , 'FIRST_VALUE'      , 1510, '/runner'          , true , false),
    (5, 9 ,'READINESS_REPORT_EMAILED', 'REPORT_SENT'      , 1530, '/'                , true , false),
    (5, 10,'READINESS_REPORT_VIEWED' , NULL               , 1720, '/parent/readiness', true , false),
    (6, 11,'PAYWALL_TRIGGERED'       , 'PAYWALL_READY'    , 2900, '/parent/readiness', true , false),
    (6, 12,'PAYWALL_VIEWED'          , NULL               , 2905, '/parent/readiness', true , false),
    (6, 13,'PAYWALL_LOCK_CLICKED'    , NULL               , 2912, '/parent/readiness', true , false),
    (7, 14,'OFFER_MADE'              , 'OFFER_MADE'       , 2960, '/parent/offer'    , true , false),
    (7, 15,'OFFER_VIEWED'            , NULL               , 2975, '/parent/offer'    , true , false),
    (7, 16,'CHECKOUT_STARTED'        , NULL               , 3010, '/checkout'        , true , false),
    (7, 17,'CHECKOUT_ABANDONED'      , NULL               , 4450, '/checkout'        , true , true ),
    (8, 18,'CHECKOUT_COMPLETED'      , 'CUSTOMER'         , 3060, '/checkout'        , true , false),
    (8, 19,'STUDY_PLAN_CREATED'      , 'ONBOARDED'        , 3090, '/onboarding'      , true , false)
)
-- PAYWALL_LOCK_CLICKED carries `insight`, which is what lever N-7 reads back to
-- order the offer's benefit list. Without it the event is captured but the offer
-- cannot personalise - the write-only failure N-7 exists to fix. Assigned per
-- parent so all five insight titles appear across the sample.
INSERT INTO public.funnel_events
  (id, user_id, anonymous_id, student_id, event, stage, props, path, utm, created_at)
SELECT
  ('59000000-0000-4000-8000-' || lpad(to_hex(d.n * 100 + s.seq), 12, '0'))::uuid,
  d.parent_id,
  'sample-anon-' || lpad(d.n::text, 4, '0'),
  CASE WHEN s.needs_student THEN d.first_student END,
  s.event, s.stage,
  -- `sample: true` in props is a second marker alongside the UUID prefix, so the
  -- rows are identifiable even if someone queries by something other than id.
  --
  -- `device` is what reporting.load_event_facts() reads into
  -- fact_event.device_class, and therefore what makes C9 (device split on every
  -- funnel number) demonstrable. Assigned per PARENT, not per event: a real
  -- visitor does not switch device mid-journey, and per-event assignment would
  -- produce a funnel where the same person is mobile at signup and desktop at
  -- checkout. Mix is ~58% mobile / 12% tablet / 30% desktop, plausible for a
  -- parent-facing product.
  jsonb_build_object(
    'sample', true,
    'depth', d.depth,
    'device', CASE WHEN sample_data.u01('dev:' || d.parent_id::text) < 0.58 THEN 'mobile'
                   WHEN sample_data.u01('dev:' || d.parent_id::text) < 0.70 THEN 'tablet'
                   ELSE 'desktop' END)
  -- Only the lock-click event carries an insight; merging conditionally keeps
  -- `"insight": null` out of every other event's props.
  || CASE WHEN s.event = 'PAYWALL_LOCK_CLICKED'
          THEN jsonb_build_object('insight',
                 (ARRAY['Time per question','Question-level review','Progress trend',
                        'Adaptive study plan','Further AI writing marks'])
                   [1 + ((sample_data.u01('ins:' || d.parent_id::text)::numeric * 5)::int % 5)])
          ELSE '{}'::jsonb END,
  s.path,
  jsonb_build_object(
    'source',   (ARRAY['google', 'facebook', 'organic', 'referral'])[1 + (d.n % 4)],
    'medium',   CASE WHEN d.n % 4 IN (0, 1) THEN 'cpc' ELSE 'organic' END,
    'campaign', CASE WHEN d.n % 3 = 0 THEN 'naplan_2026'
                     WHEN d.n % 3 = 1 THEN 'selective_prep'
                     ELSE 'evergreen' END),
  -- Timed along the real journey: diagnostic a day after signup (the 24-hour
  -- nudge window), report shortly after, paywall and offer two days on.
  d.t0 + make_interval(mins => s.mins)
FROM depthed d
JOIN steps s
  ON s.req_depth <= d.depth
 AND (NOT s.exact_depth OR d.depth = s.req_depth)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. funnel_state, DERIVED from the events above
-- ---------------------------------------------------------------------------
-- funnel_state is the funnel's authoritative current-state row per user, and the
-- lifecycle worker, the offer-expiry logic and A11's outcome metrics all read it.
-- Seeding it independently of funnel_events would let the two disagree - a parent
-- whose events say CUSTOMER but whose state row says SIGNED_UP would silently
-- break every downstream metric. Deriving it from the events makes agreement
-- structural rather than hopeful, the same reasoning that derives attempt scores
-- from responses in step 5.
--
-- Only parents who reached SIGNUP_COMPLETED get a row. The application creates
-- funnel_state at signup, not at first page view, so a bounced visitor has none -
-- and inventing one would give the lifecycle worker a user it would never have.

WITH ev AS (
  SELECT f.user_id,
    MAX(f.created_at) FILTER (WHERE f.event = 'SIGNUP_COMPLETED')         AS signed_up_at,
    MAX(f.created_at) FILTER (WHERE f.event = 'STUDENT_ADDED')            AS first_student_at,
    MAX(f.created_at) FILTER (WHERE f.event = 'DIAGNOSTIC_STARTED')       AS diagnostic_started_at,
    MAX(f.created_at) FILTER (WHERE f.event = 'DIAGNOSTIC_COMPLETED')     AS diagnostic_completed_at,
    MAX(f.created_at) FILTER (WHERE f.event = 'READINESS_REPORT_EMAILED') AS report_sent_at,
    MAX(f.created_at) FILTER (WHERE f.event = 'OFFER_MADE')               AS offer_made_at,
    MAX(f.created_at) FILTER (WHERE f.event = 'CHECKOUT_COMPLETED')       AS first_purchase_at,
    MAX(f.created_at) FILTER (WHERE f.event = 'STUDY_PLAN_CREATED')       AS onboarded_at,
    MAX(f.created_at) FILTER (WHERE f.stage IS NOT NULL)                  AS stage_updated_at,
    COUNT(*) FILTER (WHERE f.event IN ('DIAGNOSTIC_COMPLETED','SECOND_SESSION_COMPLETED'))
                                                                          AS completed_attempts
  FROM public.funnel_events f
  WHERE f.user_id::text LIKE '5b000000-%'
  GROUP BY f.user_id
  HAVING MAX(f.created_at) FILTER (WHERE f.event = 'SIGNUP_COMPLETED') IS NOT NULL
)
INSERT INTO public.funnel_state
  (user_id, stage, stage_updated_at, signed_up_at, first_student_at, diagnostic_started_at,
   diagnostic_completed_at, report_sent_at, completed_attempts,
   offer_made_at, offer_expires_at, first_purchase_at, first_purchase_amount_cents,
   lifetime_value_cents, products_purchased, onboarded_at, email, marketing_opt_in,
   email_suppressed, updated_at)
SELECT
  ev.user_id,
  -- Furthest stage reached, by the canonical ranker rather than by recency: a
  -- later event can belong to an earlier stage (e.g. a report re-sent after an
  -- offer), and recency would then move the parent BACKWARD in the funnel.
  COALESCE((SELECT f2.stage FROM public.funnel_events f2
             WHERE f2.user_id = ev.user_id AND f2.stage IS NOT NULL
             ORDER BY public.funnel_stage_rank(f2.stage) DESC, f2.created_at DESC
             LIMIT 1), 'SIGNED_UP'),
  COALESCE(ev.stage_updated_at, ev.signed_up_at),
  ev.signed_up_at, ev.first_student_at, ev.diagnostic_started_at,
  ev.diagnostic_completed_at, ev.report_sent_at, ev.completed_attempts,
  ev.offer_made_at,
  -- X-3: 72-hour offer window, never extended, never re-shown as "final".
  CASE WHEN ev.offer_made_at IS NOT NULL
       THEN ev.offer_made_at + interval '72 hours' END,
  ev.first_purchase_at,
  -- SYNTHETIC REVENUE. 14900 cents = $149.00 flat for every sample customer.
  -- Real prices live in Stripe and Stripe ingestion is Phase 3; see
  -- SAMPLE_DATA.md. Do not report revenue figures from this dataset.
  CASE WHEN ev.first_purchase_at IS NOT NULL THEN 14900 END,
  CASE WHEN ev.first_purchase_at IS NOT NULL THEN 14900 ELSE 0 END,
  CASE WHEN ev.first_purchase_at IS NOT NULL THEN 1 ELSE 0 END,
  ev.onboarded_at,
  u.email,
  -- ~70% opt in so both branches of the suppression logic are exercised.
  (sample_data.u01('mkt:' || ev.user_id::text) < 0.70),
  false,
  now()
FROM ev
JOIN auth.users u ON u.id = ev.user_id
ON CONFLICT (user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 8. Rebuild the reporting layer from the seeded source tables
-- ---------------------------------------------------------------------------
SELECT reporting.load_student_dims();
SELECT reporting.load_skill_areas();
SELECT reporting.load_attempt_facts(true);
SELECT reporting.load_response_facts(true);
SELECT reporting.load_event_facts(true);




