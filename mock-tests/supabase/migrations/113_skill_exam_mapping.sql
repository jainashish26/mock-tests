-- ============================================================================
-- 113 - Skill to readiness-exam mapping (decision 7-A, question Q-11)
--
-- WHY THIS IS A TABLE AND NOT A CONSTANT
--   readiness.ts holds an exam map as a TS literal, and ten `exam_type` values
--   are deliberately absent from it: GRAMMAR, SPELLING, VOCABULARY,
--   VERBAL_REASONING, NUMERICAL_REASONING, MENTAL_MATHS, GEOMETRY, WORD_PROBLEMS,
--   PROBLEM_SOLVING, CRITICAL_THINKING. Those are skill categories sharing an
--   enum with exam families, and mapping them onto an exam would assert that, say,
--   a GEOMETRY practice item is evidence of Selective School readiness. Nobody
--   decided that, so A-9 has them fall through to a cross-exam weight and Q-11
--   asked whether such a relationship may be asserted at all.
--
--   Decision 7-A: yes, but as configuration, labelled editorial and unvalidated.
--   The form matters more than the answer. Written into the readiness function the
--   mapping would be invisible, unfalsifiable and permanent; written as reviewed
--   rows it can be looked at, amended, and - the property that makes this safe -
--   withdrawn without a deploy.
--
-- WHAT `applied_to_readiness` IS FOR, AND WHY IT SHIPS FALSE
--   The rows below are a proposal, not an approved curriculum judgement. A derived
--   mapping presented as fact is how an unvalidated number becomes a parental
--   decision, and the readiness band is the number the paywall sells.
--
--   readiness.ts therefore READS this table on every computation - the mapping is
--   consulted, not decorative, which is the defect class this project has now
--   caught four times - but applies a row's exams only once a human sets
--   `applied_to_readiness = true` for it. Until then scores are unchanged and the
--   mapping is reviewable in place. Flipping a row is per skill: approving
--   GEOMETRY need not wait on SPELLING.
--
-- THE TWO FLAGS ARE DELIBERATELY SEPARATE
--   `is_validated` means the business accepts the assertion.
--   `applied_to_readiness` means it may score a child. Collapsing them is how a
--   guess ends up inside a report a parent trusts, so they are set independently.
--
-- Idempotent: safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS reporting.skill_exam_mapping (
  skill                text NOT NULL,
  readiness_exam       text NOT NULL
                       CHECK (readiness_exam IN ('NAPLAN','SCHOLARSHIP','SELECTIVE','OLYMPIAD')),

  -- Required, per row. A mapping nobody can justify is a mapping nobody can
  -- defend when a parent asks why a Year 4 result is being shown as Selective
  -- readiness. The length floor stops the column being satisfied by a space.
  rationale            text NOT NULL CHECK (length(btrim(rationale)) >= 20),

  is_validated         boolean NOT NULL DEFAULT false,
  applied_to_readiness boolean NOT NULL DEFAULT false,

  -- Where the assertion came from. Every row here is 'editorial proposal':
  -- nothing below is sourced from a published test specification.
  source               text NOT NULL DEFAULT 'editorial proposal',
  updated_at           timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (skill, readiness_exam),
  CHECK (btrim(skill) <> '')
);

COMMENT ON TABLE reporting.skill_exam_mapping IS
  'Editorial, UNVALIDATED mapping from practice skill areas to readiness exams. Read by src/lib/report/readiness.ts on every computation, but a row only affects a child''s band when applied_to_readiness is true. All rows ship false: this is a proposal for review, not an approved curriculum relationship.';

COMMENT ON COLUMN reporting.skill_exam_mapping.is_validated IS
  'Set by the business when the assertion has been reviewed. Distinct from applied_to_readiness: "we accept this" and "you may score on this" are separate decisions.';

-- ----------------------------------------------------------------------------
-- The proposal: 10 skills x the exams each is plausibly evidence for.
--
-- Deliberately asymmetric and conservative. Where a link is arguable the row is
-- omitted, because an over-claimed mapping inflates a band while an omitted one
-- only withholds a weak signal. The omissions are as intentional as the
-- inclusions: SPELLING is not asserted against SCHOLARSHIP or SELECTIVE
-- (jurisdictions differ and no paper here names it); CRITICAL_THINKING is not
-- asserted against NAPLAN (NAPLAN reports strands, not higher-order reasoning);
-- MENTAL_MATHS is not asserted against OLYMPIAD (olympiads reward depth over
-- speed); GEOMETRY is not asserted against SELECTIVE.
-- ----------------------------------------------------------------------------
INSERT INTO reporting.skill_exam_mapping (skill, readiness_exam, rationale) VALUES
  ('GRAMMAR','NAPLAN','NAPLAN Language Conventions assesses grammar and punctuation explicitly.'),
  ('GRAMMAR','SCHOLARSHIP','Scholarship papers assess written expression quality, of which accuracy is a marked component.'),
  ('SPELLING','NAPLAN','Spelling sits inside the NAPLAN Language Conventions test domain.'),
  ('VOCABULARY','NAPLAN','Vocabulary is assessed through reading comprehension items in NAPLAN.'),
  ('VOCABULARY','SCHOLARSHIP','Scholarship tests are conventionally vocabulary-heavy in the reading component.'),
  ('VOCABULARY','SELECTIVE','Selective School papers rely on vocabulary depth within reading and reasoning items.'),
  ('VERBAL_REASONING','SCHOLARSHIP','Verbal reasoning is a named section of most scholarship test formats.'),
  ('VERBAL_REASONING','SELECTIVE','Verbal reasoning is a core selective-school aptitude domain.'),
  ('NUMERICAL_REASONING','SCHOLARSHIP','Quantitative reasoning is a named scholarship section.'),
  ('NUMERICAL_REASONING','SELECTIVE','Numerical aptitude forms part of the selective-school reasoning domains.'),
  ('NUMERICAL_REASONING','OLYMPIAD','Mathematics olympiad papers are reasoning-forward rather than procedural.'),
  ('MENTAL_MATHS','SCHOLARSHIP','Timed scholarship papers reward the fluency that mental-maths practice evidences.'),
  ('GEOMETRY','NAPLAN','Measurement and geometry sit inside the NAPLAN numeracy domain.'),
  ('GEOMETRY','SCHOLARSHIP','Scholarship numeracy includes spatial and geometric items.'),
  ('GEOMETRY','OLYMPIAD','Olympiad papers weight geometry heavily, especially in the upper bands.'),
  ('WORD_PROBLEMS','NAPLAN','NAPLAN numeracy is largely problem solving from written contexts.'),
  ('WORD_PROBLEMS','SCHOLARSHIP','Word problems are the dominant numeracy format in scholarship tests.'),
  ('WORD_PROBLEMS','SELECTIVE','Applied mathematics items appear across selective-school numeracy sections.'),
  ('WORD_PROBLEMS','OLYMPIAD','Olympiad questions are almost entirely contextual problem solving.'),
  ('PROBLEM_SOLVING','NAPLAN','Problem solving is an explicit NAPLAN numeracy strand.'),
  ('PROBLEM_SOLVING','SCHOLARSHIP','Scholarship tests select on unfamiliar-problem handling under time pressure.'),
  ('PROBLEM_SOLVING','SELECTIVE','Aptitude sections are effectively general problem solving.'),
  ('PROBLEM_SOLVING','OLYMPIAD','Problem solving is the defining olympiad skill.'),
  ('CRITICAL_THINKING','SCHOLARSHIP','Higher-order inference and evaluation are assessed in scholarship reading.'),
  ('CRITICAL_THINKING','SELECTIVE','Selective aptitude sections target reasoning about unfamiliar material.'),
  ('CRITICAL_THINKING','OLYMPIAD','Olympiad items require evaluation of approaches, not recall of methods.')
ON CONFLICT (skill, readiness_exam) DO UPDATE
  -- Only the rationale may be refreshed by a re-apply. Neither flag is ever
  -- written here: resetting applied_to_readiness would silently withdraw an
  -- approval granted out of band, and setting it would grant one unreviewed.
  SET rationale  = EXCLUDED.rationale,
      updated_at = now();

-- ----------------------------------------------------------------------------
-- The read path readiness.ts uses
-- ----------------------------------------------------------------------------
-- A function rather than a SELECT, for the same reason every report here is one:
-- reporting.* is RLS-enabled and FORCED with no policy, so the parent-facing
-- server code would read zero rows and an empty mapping would look like an absent
-- one. It returns BOTH flags plus the rationale so the review can happen in the
-- product rather than in a psql session.
CREATE OR REPLACE FUNCTION public.readiness_skill_exam_map()
RETURNS TABLE(skill text, readiness_exam text, rationale text,
              is_validated boolean, applied_to_readiness boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $$
  SELECT m.skill, m.readiness_exam, m.rationale, m.is_validated, m.applied_to_readiness
  FROM reporting.skill_exam_mapping m
  ORDER BY m.skill, m.readiness_exam;
$$;

REVOKE ALL ON FUNCTION public.readiness_skill_exam_map() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.readiness_skill_exam_map() TO authenticated, service_role;
GRANT SELECT ON reporting.skill_exam_mapping TO reporting_ro;

ALTER TABLE reporting.skill_exam_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.skill_exam_mapping FORCE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- Teach the baseline exporter about the mapping
-- ----------------------------------------------------------------------------
-- The same trap 110 had to fix for dim_public_holiday_vic: export_baseline_config
-- discovers config tables by a `*_thresholds` name or a `(id = 1)` singleton
-- CHECK, and a 26-row reference table matches neither. Without this, a restored
-- database gets the mapping *table* and none of its rows - which fails silently
-- and, because readiness treats an empty mapping as "nothing applied", would look
-- entirely healthy while the proposal had been lost. Reproduced verbatim from the
-- live definition plus the one added table name.
CREATE OR REPLACE FUNCTION reporting.export_baseline_config()
RETURNS TABLE(filename text, content text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
DECLARE
  t text;
  v_rows text;
  v_out text := E'-- Hand-maintained reporting configuration (052/064/071/086/109/113).\n'
              || E'-- A schema dump does not carry these, and their absence silently\n'
              || E'-- disables features rather than raising an error.\n\n';
  v_tables text[];
BEGIN
  SELECT array_agg(DISTINCT z.t ORDER BY z.t) INTO v_tables
  FROM (
    -- Not derivable: no `*_thresholds` name and no singleton CHECK.
    SELECT unnest(ARRAY[
      'dim_year_level_cap', 'refresh_blackout',
      'refresh_blackout_exempt', 'product_tax_treatment',
      'dim_public_holiday_vic',
      -- Added by 113: the reviewed skill -> exam proposal.
      'skill_exam_mapping'
    ]) AS t
    UNION ALL
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'reporting'
      AND c.relkind = 'r'
      AND (c.relname LIKE '%\_thresholds'
           OR EXISTS (
             SELECT 1 FROM pg_constraint con
             WHERE con.conrelid = c.oid AND con.contype = 'c'
               AND pg_get_constraintdef(con.oid) ~ '\(id = 1\)'
           ))
  ) z;

  FOREACH t IN ARRAY v_tables LOOP
    EXECUTE format(
      'SELECT string_agg(format(%L, %L, %L, to_jsonb(x)::text), %L ORDER BY 1) FROM reporting.%I x',
      'INSERT INTO reporting.%I SELECT * FROM jsonb_populate_record(NULL::reporting.%I, %L) ON CONFLICT DO NOTHING;',
      t, t, E'\n', t
    ) INTO v_rows;
    v_out := v_out || format(E'-- %s\n%s\n\n', t, COALESCE(v_rows, '-- (no rows)'));
  END LOOP;

  RETURN QUERY SELECT 'reporting/config.sql'::text, v_out;
END;
$function$;

-- ----------------------------------------------------------------------------
-- Self-check
-- ----------------------------------------------------------------------------
-- Asserts the shape of the proposal, not its content: every unmapped skill is
-- represented, and nothing is applied before review. The expected skill count is
-- written out as the list rather than as a bare number, because the register and
-- the code disagreed (Q-11 says eleven, SKILL_EXAM_TYPES holds ten) and hardcoding
-- either figure would have turned a documentation slip into a failed deploy.
DO $$
DECLARE
  v_skills  integer;
  v_rows    integer;
  v_applied integer;
  v_skill   text;
BEGIN
  FOREACH v_skill IN ARRAY ARRAY[
    'GRAMMAR','SPELLING','VOCABULARY','VERBAL_REASONING','NUMERICAL_REASONING',
    'MENTAL_MATHS','GEOMETRY','WORD_PROBLEMS','PROBLEM_SOLVING','CRITICAL_THINKING'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM reporting.skill_exam_mapping m WHERE m.skill = v_skill) THEN
      RAISE EXCEPTION '113 self-test: skill % has no mapping row', v_skill
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;

  SELECT COUNT(DISTINCT skill), COUNT(*) INTO v_skills, v_rows
  FROM reporting.skill_exam_mapping;

  IF v_skills <> 10 THEN
    RAISE EXCEPTION '113 self-test: expected 10 distinct skills, found %', v_skills
      USING ERRCODE = 'raise_exception';
  END IF;

  -- The gate that makes this shippable at all. Any applied row means an
  -- unreviewed editorial assertion is currently scoring children.
  SELECT COUNT(*) INTO v_applied FROM reporting.skill_exam_mapping WHERE applied_to_readiness;
  IF v_applied > 0 THEN
    RAISE EXCEPTION
      '113 self-test: % mapping row(s) are applied_to_readiness without review', v_applied
      USING ERRCODE = 'raise_exception';
  END IF;

  IF v_rows <= v_skills THEN
    RAISE EXCEPTION
      '113 self-test: % rows across % skills is not a mapping, it is a one-to-one guess',
      v_rows, v_skills
      USING ERRCODE = 'raise_exception';
  END IF;
END $$;
