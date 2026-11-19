-- 107_year_level_caps.sql
-- Decision 4-A: per-year-level daily practice limits, as a CEILING plus a
-- separate RECOMMENDED target, stored in the database.
--
-- WHY THE DISTINCTION IS TWO COLUMNS AND NOT ONE
--   Q-4 asked for "daily practice caps per year level" and the answer arrived as
--   eight numbers described explicitly as a ceiling, with a recommended target
--   "at least 2" kept separate. Those are different kinds of number and collapsing
--   them would lose the distinction that matters:
--
--     * the CEILING is a guard. It bounds what a plan can ever demand of a child,
--       however far behind the calendar has left them. It is deliberately high -
--       10 to 25 full papers a day is not a suggestion, it is the point past which
--       the system refuses to go.
--     * the RECOMMENDED target is guidance. 2 to 3 papers a day is what a child
--       should actually be asked to do, and it is the number a parent recognises
--       as reasonable.
--
--   Reporting one as the other is how a product tells a seven-year-old to sit ten
--   mock exams today because their plan slipped. Both columns exist so that
--   choice can be made deliberately per surface instead of being inherited from a
--   single ambiguous field.
--
-- ⚠ CONSEQUENCE OF SEEDING, STATED BEFORE IT IS TRUE
--   `mv_student_daily_target.effective_cap` is
--
--       COALESCE(cap.max_tests_per_day, 2 * ceil(weekly_sessions_goal / 7))
--
--   While the caps are NULL - which is how they have sat since 013 - the fallback
--   gives a typical 3-sessions-a-week plan a cap of 2. Seeding Year 2 to 10
--   therefore RAISES the student-facing clamp from 2 to 10 for a child whose plan
--   demands it, because `daily_target_units = LEAST(required_daily, effective_cap)`.
--   That is the arithmetic of rule B7 as written ("the student keeps seeing the
--   cap"), not a bug introduced here.
--
--   It is safe to land now for one reason and one reason only: there are ZERO
--   current plans in the database, so the MV has no rows and no child's screen
--   changes. The decision this migration defers to the product owner is whether
--   the ceiling or the recommended target should clamp a student-facing daily
--   target once plans exist. It should be taken before the first study plan is
--   created, not after. Recorded in `16-delivery-backlog.md` as the open question
--   this seed raises rather than closes.
--
-- QUESTIONS ARE tests x 25, DELIBERATELY NOT tests x 35
--   The decision's derivation rule. Measured against the live catalogue, published
--   tests have a MEDIAN of 35 items (range 0-90, and only 6 of 59 sit at exactly
--   25), so 25 is a policy floor rather than a description of the average paper.
--   That is fine and arguably correct for a ceiling - it is stricter than the
--   median, so it binds first - but it must not be mistaken for an observation.
--   The two columns serve different `unit_kind`s and so never fight: a plan
--   measured in tests reads one, a plan measured in questions reads the other.

-- ─── 1. The recommended target, as its own column ───────────────────────────
ALTER TABLE reporting.dim_year_level_cap
  ADD COLUMN IF NOT EXISTS recommended_tests_per_day smallint,
  ADD COLUMN IF NOT EXISTS recommended_questions_per_day smallint;

COMMENT ON COLUMN reporting.dim_year_level_cap.recommended_tests_per_day IS
  'Guidance: papers a child at this year level should be asked to do on a normal day. Advisory only - nothing clamps to this column yet. Distinct from max_tests_per_day, which is a guard, not a suggestion (decision 4-A).';

COMMENT ON COLUMN reporting.dim_year_level_cap.recommended_questions_per_day IS
  'The recommended target for plans measured in questions. Derived from recommended_tests_per_day x 25, the same policy multiplier as the ceiling.';

-- ─── 2. Seed: ceilings exactly as decided, targets at 2 or 3 ────────────────
-- Years 2-9, ceilings 10/15/15/15/20/20/25/25; questions = ceiling x 25;
-- recommended 2 for Years 2-5 and 3 for Years 6-9 (never below 2, never above
-- the ceiling for that level).
WITH seed(year_level, max_tests, rec_tests) AS (
  VALUES (2::smallint, 10::smallint, 2::smallint),
         (3, 15, 2), (4, 15, 2), (5, 15, 2),
         (6, 20, 3), (7, 20, 3),
         (8, 25, 3), (9, 25, 3)
)
INSERT INTO reporting.dim_year_level_cap
      (year_level, max_tests_per_day, max_questions_per_day,
       recommended_tests_per_day, recommended_questions_per_day, updated_at)
SELECT s.year_level, s.max_tests, s.max_tests * 25,
       s.rec_tests,   s.rec_tests   * 25, now()
  FROM seed s
ON CONFLICT (year_level) DO UPDATE
   SET max_tests_per_day           = EXCLUDED.max_tests_per_day,
       max_questions_per_day       = EXCLUDED.max_questions_per_day,
       recommended_tests_per_day   = EXCLUDED.recommended_tests_per_day,
       recommended_questions_per_day = EXCLUDED.recommended_questions_per_day,
       updated_at                  = now();

-- ─── 3. Make the absence of a limit impossible ─────────────────────────────
-- NOT NULL rather than nullable-with-a-fallback. A child-safety limit that can be
-- left unset is not a limit; it is a config value whose NULL silently changes
-- behaviour somewhere else. With the constraint in place, adding Year 10 without
-- caps fails loudly at INSERT instead of quietly inheriting the
-- 2 x ceil(weekly_sessions_goal / 7) fallback - which is the right direction for
-- a mistake to travel in.
ALTER TABLE reporting.dim_year_level_cap
  ALTER COLUMN max_tests_per_day SET NOT NULL,
  ALTER COLUMN max_questions_per_day SET NOT NULL,
  ALTER COLUMN recommended_tests_per_day SET NOT NULL,
  ALTER COLUMN recommended_questions_per_day SET NOT NULL;

ALTER TABLE reporting.dim_year_level_cap
  DROP CONSTRAINT IF EXISTS dim_year_level_cap_tests_range,
  DROP CONSTRAINT IF EXISTS dim_year_level_cap_questions_range,
  DROP CONSTRAINT IF EXISTS dim_year_level_cap_tests_target_coherence,
  DROP CONSTRAINT IF EXISTS dim_year_level_cap_questions_target_coherence,
  ADD CONSTRAINT dim_year_level_cap_tests_range
    CHECK (max_tests_per_day BETWEEN 1 AND 40),
  ADD CONSTRAINT dim_year_level_cap_questions_range
    CHECK (max_questions_per_day BETWEEN 1 AND 2000),
  -- A recommendation above the ceiling is incoherent: it would advise a child to
  -- do more than the system has decided is ever acceptable.
  ADD CONSTRAINT dim_year_level_cap_tests_target_coherence
    CHECK (recommended_tests_per_day BETWEEN 2 AND max_tests_per_day),
  ADD CONSTRAINT dim_year_level_cap_questions_target_coherence
    CHECK (recommended_questions_per_day BETWEEN 2 AND max_questions_per_day);

-- ─── 4. Admin read wrapper ──────────────────────────────────────────────────
-- Matching admin_item_thresholds exactly: SECURITY DEFINER, in-body
-- has_role('ADMIN'), and a non-admin receives ZERO ROWS rather than an error, so
-- the response cannot be used to probe which configuration exists.
CREATE OR REPLACE FUNCTION public.admin_year_level_caps()
 RETURNS TABLE(year_level smallint, max_tests_per_day smallint,
               max_questions_per_day smallint, recommended_tests_per_day smallint,
               recommended_questions_per_day smallint, updated_at timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
  SELECT c.year_level, c.max_tests_per_day, c.max_questions_per_day,
         c.recommended_tests_per_day, c.recommended_questions_per_day, c.updated_at
  FROM reporting.dim_year_level_cap c
  WHERE public.has_role('ADMIN')
  ORDER BY c.year_level;
$function$;

COMMENT ON FUNCTION public.admin_year_level_caps() IS
  'Admin read wrapper over reporting.dim_year_level_cap. ADMIN only, enforced in-body: a non-admin receives zero rows, the same shape for every caller, so the response cannot be used to probe which year levels are configured.';

-- ─── 5. Admin write path ────────────────────────────────────────────────────
-- Validated in-body with messages a person can act on, because the table CHECKs
-- reject the same values as a constraint name from a table the operator has never
-- seen. The CHECKs remain the real guarantee; this is a better error, not a
-- weaker control.
CREATE OR REPLACE FUNCTION public.admin_set_year_level_cap(
  p_year_level smallint,
  p_max_tests smallint,
  p_max_questions smallint,
  p_recommended_tests smallint,
  p_recommended_questions smallint
) RETURNS TABLE(year_level smallint, max_tests_per_day smallint,
                max_questions_per_day smallint, recommended_tests_per_day smallint,
                recommended_questions_per_day smallint, updated_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
BEGIN
  IF NOT public.has_role('ADMIN') THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;

  IF p_year_level IS NULL OR p_year_level NOT BETWEEN 2 AND 9 THEN
    RAISE EXCEPTION 'year_level % is outside the configured range 2-9', p_year_level
      USING ERRCODE = '22023';
  END IF;
  IF p_max_tests IS NULL OR p_max_tests NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'max_tests_per_day must be between 1 and 40 (got %)', p_max_tests
      USING ERRCODE = '22023';
  END IF;
  IF p_max_questions IS NULL OR p_max_questions NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'max_questions_per_day must be between 1 and 2000 (got %)', p_max_questions
      USING ERRCODE = '22023';
  END IF;
  IF p_recommended_tests IS NULL OR p_recommended_tests < 2 THEN
    RAISE EXCEPTION 'recommended_tests_per_day must be at least 2 (got %)', p_recommended_tests
      USING ERRCODE = '22023';
  END IF;
  IF p_recommended_tests > p_max_tests THEN
    RAISE EXCEPTION 'recommended target % exceeds the ceiling % for Year %',
      p_recommended_tests, p_max_tests, p_year_level USING ERRCODE = '22023';
  END IF;
  IF p_recommended_questions IS NULL OR p_recommended_questions < 2 THEN
    RAISE EXCEPTION 'recommended_questions_per_day must be at least 2 (got %)', p_recommended_questions
      USING ERRCODE = '22023';
  END IF;
  IF p_recommended_questions > p_max_questions THEN
    RAISE EXCEPTION 'recommended question target % exceeds the ceiling % for Year %',
      p_recommended_questions, p_max_questions, p_year_level USING ERRCODE = '22023';
  END IF;

  UPDATE reporting.dim_year_level_cap c
     SET max_tests_per_day             = p_max_tests,
         max_questions_per_day         = p_max_questions,
         recommended_tests_per_day     = p_recommended_tests,
         recommended_questions_per_day = p_recommended_questions,
         updated_at                    = now()
   WHERE c.year_level = p_year_level;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no cap row for year_level %', p_year_level USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY SELECT c.year_level, c.max_tests_per_day, c.max_questions_per_day,
                       c.recommended_tests_per_day, c.recommended_questions_per_day,
                       c.updated_at
                  FROM reporting.dim_year_level_cap c
                 WHERE c.year_level = p_year_level;
END;
$function$;

COMMENT ON FUNCTION public.admin_set_year_level_cap(smallint, smallint, smallint, smallint, smallint) IS
  'Admin write path for the per-year-level daily practice limits. ADMIN only, checked in-body as well as by grant. Validates range and ceiling/target coherence with actionable messages; the table CHECKs are the actual guarantee, so this function improves the error rather than weakening the control. A ceiling change takes effect on the next refresh of mv_student_daily_target, not immediately.';

COMMENT ON TABLE reporting.dim_year_level_cap IS
  'Per-year-level daily practice limits (decision 4-A, seeded 2026-11-20). Two kinds of number, deliberately separate: max_* is a guard the system never exceeds; recommended_* is advice a plan should aim at. NOT NULL on all four so an unset limit is not representable. Read by mv_student_daily_target through max_* only, selected by unit_kind; recommended_* is not yet wired to any clamp - see the open question this seed raises in 16-delivery-backlog.md item 21.';

-- ─── 6. Grants: authenticated + service roles, never anon ──────────────────
-- The 044/045/072 rule: a public SECURITY DEFINER wrapper that an unauthenticated
-- caller can reach is an exposure even when it returns nothing, because its
-- existence and argument types are themselves information. `authenticated` stays,
-- because authorisation is the in-body has_role('ADMIN') check and the API route
-- calls through a session; `anon` is explicitly refused.
GRANT EXECUTE ON FUNCTION public.admin_year_level_caps() TO authenticated, postgres, service_role;
REVOKE EXECUTE ON FUNCTION public.admin_year_level_caps() FROM anon, PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_set_year_level_cap(smallint, smallint, smallint, smallint, smallint)
  TO authenticated, postgres, service_role;
REVOKE EXECUTE ON FUNCTION public.admin_set_year_level_cap(smallint, smallint, smallint, smallint, smallint)
  FROM anon, PUBLIC;

-- The table itself stays unreachable from the browser: the wrappers above are the
-- only surface, which is how every other threshold table is arranged.
REVOKE ALL ON reporting.dim_year_level_cap FROM anon, authenticated;
GRANT SELECT, UPDATE ON reporting.dim_year_level_cap TO postgres, service_role;



