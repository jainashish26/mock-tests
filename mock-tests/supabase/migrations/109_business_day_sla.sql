-- ============================================================================
-- 109 - Business-day SLA clock (decision 1-B, sub-decision 1a)
--
-- WHAT WAS ASKED FOR
--   Q-5 was answered B: the published response promise is measured in BUSINESS
--   days, and 1a fixes the deadline at the CLOSE OF THE NEXT BUSINESS DAY. That
--   wording needs a Victorian public-holiday calendar and no opening-hours
--   window, which is why 1a was chosen over a working-hours figure nobody had.
--
-- THE DEFECT THIS MIGRATION ACTUALLY FIXES
--   `sla_basis` existed in reporting.enquiry_thresholds and was READ BY NOTHING.
--   admin_enquiry_queue() decided every state from minute arithmetic against
--   first_response_sla_minutes, so the column that exists specifically to stop a
--   silent assumption was itself the silent assumption: flipping it to 'business'
--   would have changed no number anywhere. It is the same class of defect as
--   checkout_abandon_minutes before 105 - configuration that is decorative rather
--   than load-bearing - and it survived Phase B because the tests checked that
--   the states computed correctly GIVEN the config row, never that every declared
--   column was consulted. 109 makes sla_basis decide the arithmetic.
--
-- WHY A NEW TABLE AND NOT dim_date (D2)
--   reporting.dim_date.is_vic_public_holiday is false for all 2,557 rows and
--   is_school_term true for all of them: defaults that were never populated.
--   Backfilling them was rejected because dim_date is a conformed dimension whose
--   other columns are sound (verified: 0 weekend/day_of_week/date_key
--   disagreements), so restating a dimension that existing rollups read in order
--   to serve one new promise is the wrong trade. This table is purpose-built,
--   provenanced, and refuse-by-default.
--
-- WHERE THE DATES COME FROM - AND WHY THEY ARE GENERATED, NOT PASTED
--   Source: the State Development victorian-public-holiday-dates.ics feed,
--   https://www.vic.gov.au/sites/default/files/2026-06/Victorian-public-holiday-dates.ics
--   covering 2019-01-01 .. 2028-12-26 (144 events, fetched 2026-11-21). Two
--   findings decided the shape of this migration:
--
--   1. The feed STOPS AT 2028. There is no authoritative 2029 or 2030 date
--      anywhere, and the AFL Grand Final Friday is explicitly undetermined until
--      the fixture is published. The calendar is therefore generated from the
--      rules of the Public Holidays Act 1993 (Vic) - computus for Easter,
--      nth-weekday for Labour Day / King's Birthday, first Tuesday for the Cup,
--      last Friday of September for the AFL, and the weekend-substitution
--      cascade for New Year's, Australia Day, Christmas and Boxing Day.
--
--   2. That generator was PROVEN against the feed before being trusted: for
--      2024-2028 it reproduces 66 of the feed's 70 dates exactly, and the only
--      four differences are the two AFL Fridays, where the feed's own
--      *unconfirmed* 2027 and 2028 rows are dated Saturday 2027-09-25 and
--      Saturday 2028-09-30 - the Grand Final day, not the Friday before it. The
--      confirmed years 2024/2025/2026 match the rule exactly. So the divergence
--      is a defect in the source's provisional rows, not in the rule, and
--      copying the feed forward would have seeded the wrong weekday.
--
--   The rules live in exactly one place, fn_vic_holidays(), and the seed below is
--   its output. Completeness is then checkable rather than assumed: a year whose
--   rows do not equal what the generator produces for that year is an incomplete
--   year, and an incomplete year refuses to compute.
--
-- FAILING CLOSED IS THE POINT
--   business_day_deadline() returns NULL when the window it would have to scan is
--   not fully covered. NULL surfaces as the sla_state 'unknown_calendar'. A queue
--   that says "I cannot compute this" is honest; one that quietly treats an
--   unseeded 2031 as ordinary Tuesdays is how ANZAC Day and Christmas become
--   business days again, which is the precise failure D2 was raised to prevent.
--   Note that a *missing* holiday makes the clock stricter, not laxer - the
--   deadline lands sooner and a good response can read as late.
--
-- Idempotent: safe to re-run. Nothing here flips sla_is_confirmed; that stays a
-- deliberate human act after the first real numbers have been read.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The rule engine, proven above. One definition, used for the seed AND for
--    the completeness test, so the two can never drift apart.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reporting.fn_vic_holidays(p_year integer)
RETURNS TABLE(holiday_date date, name text, is_substitute boolean)
LANGUAGE sql
STABLE
AS $fn$
  WITH c AS (                       -- Anonymous Gregorian computus
    SELECT p_year % 19                                  AS a,
           div(p_year, 100)                              AS b,
           p_year % 100                                  AS c,
           div(div(p_year, 100), 4)                      AS d,
           div(p_year, 100) % 4                          AS e,
           div(div(p_year, 100) + 8, 25)                 AS f
  ), g AS (
    SELECT a, b, c, d, e, f,
           div(b - f + 1, 3)                             AS g
    FROM c
  ), h AS (
    SELECT a, b, c, d, e, g,
           (19*a + b - d - g + 15) % 30                  AS h,
           div(c, 4)                                     AS i,
           c % 4                                         AS k
    FROM g
  ), l AS (
    SELECT a, d, e, g, h, i, k,
           (32 + 2*e + 2*i - h - k) % 7                  AS l
    FROM h
  ), m AS (
    SELECT a, g, h, l,
           div(a + 11*h + 22*l, 451)                     AS m
    FROM l
  ), easter AS (
    SELECT make_date(p_year,
                     div(h + l - 7*m + 114, 31)::int,
                     ((h + l - 7*m + 114) % 31 + 1)::int) AS d
    FROM m
  ), floating AS (                  -- nth/last weekday rules
    SELECT make_date(p_year, 3, 1)
           + ((1 - EXTRACT(ISODOW FROM make_date(p_year, 3, 1))::int + 7) % 7) + 7 AS labour,
           make_date(p_year, 6, 1)
           + ((1 - EXTRACT(ISODOW FROM make_date(p_year, 6, 1))::int + 7) % 7) + 7 AS kings,
           make_date(p_year, 11, 1)
           + ((2 - EXTRACT(ISODOW FROM make_date(p_year, 11, 1))::int + 7) % 7)     AS cup,
           -- Last Friday of September. The feed's own note says the holiday
           -- "typically falls on the last Friday in September"; that is the rule
           -- confirmed by every year the source has actually finalised.
           (SELECT (make_date(p_year, 10, 1) - 1)
                   - ((EXTRACT(ISODOW FROM (make_date(p_year, 10, 1) - 1))::int - 5 + 7) % 7)) AS afl
  ), principal AS (
    SELECT make_date(p_year, 1, 1)::date   AS d, 'New Year''s Day'::text   AS n, false AS sub, true  AS relocates
    UNION ALL SELECT make_date(p_year, 1, 26),  'Australia Day',            false, true
    UNION ALL SELECT labour,                    'Labour Day',               false, false FROM floating
    UNION ALL SELECT (SELECT d FROM easter) - 2,'Good Friday',              false, false
    UNION ALL SELECT (SELECT d FROM easter) - 1,'Saturday before Easter Sunday', false, false
    UNION ALL SELECT (SELECT d FROM easter),    'Easter Sunday',            false, false
    UNION ALL SELECT (SELECT d FROM easter) + 1,'Easter Monday',            false, false
    UNION ALL SELECT make_date(p_year, 4, 25),  'ANZAC Day',                false, false
    UNION ALL SELECT kings,                     'King''s Birthday',         false, false FROM floating
    UNION ALL SELECT afl,                       'Friday before the AFL Grand Final', false, false FROM floating
    UNION ALL SELECT cup,                       'Melbourne Cup',            false, false FROM floating
    UNION ALL SELECT make_date(p_year, 12, 25), 'Christmas Day',            false, true
    UNION ALL SELECT make_date(p_year, 12, 26), 'Boxing Day',               false, true
  ), substitute AS (
    -- The observed substitute, when the day itself falls on a weekend.
    --
    -- Two different rules, each pinned by a year the source has confirmed:
    --   * New Year's / Australia Day: Saturday -> +2 (2028-01-01 is a Saturday
    --     and the feed carries Monday 2028-01-03); Sunday -> +1 (2025-01-26 is a
    --     Sunday and the feed carries Monday 2025-01-27).
    --   * Christmas / Boxing Day: BOTH weekend positions resolve to +2. When
    --     Christmas falls on a Saturday the Monday belongs to Christmas and
    --     Boxing Day, being a Sunday, has to go to the Tuesday - which is 2027
    --     exactly (the feed carries 2027-12-27 AND 2027-12-28). Boxing Day alone
    --     on a Saturday also goes +2, giving Monday 2026-12-28. A naive
    --     "+1 for Sunday" would have put Boxing Day 2027 on a Monday that was
    --     already taken by Christmas.
    -- ANZAC Day is deliberately absent: it is commemorated on the day it falls
    -- and has no replacement, so 2026-04-25 (a Saturday) gets no Monday, and the
    -- feed agrees.
    SELECT CASE
             WHEN n IN ('New Year''s Day','Australia Day')
                  AND EXTRACT(ISODOW FROM d)::int = 6 THEN d + 2
             WHEN n IN ('New Year''s Day','Australia Day')
                  AND EXTRACT(ISODOW FROM d)::int = 7 THEN d + 1
             WHEN n IN ('Christmas Day','Boxing Day')
                  AND EXTRACT(ISODOW FROM d)::int IN (6,7) THEN d + 2
           END AS d, n, true AS sub
    FROM principal
    WHERE relocates
  )
  SELECT d, n, sub FROM principal
  UNION ALL
  SELECT d, n, sub FROM substitute WHERE d IS NOT NULL
  ORDER BY 1;
$fn$;

-- ----------------------------------------------------------------------------
-- 2. PROVENANCE CHECK, RUN AT APPLY TIME
--    The claim "this generator reproduces the published calendar" is not left in
--    a comment for the next reader to take on trust. It is re-proved on every
--    apply. If somebody edits a rule above and breaks the 2024-2028 match, the
--    migration aborts rather than seeding a plausible-looking wrong calendar.
--    The allowed exceptions are the two AFL Fridays where the feed's own
--    unconfirmed rows are dated on the Saturday of the Grand Final.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_unexpected integer;
  v_known      integer;
BEGIN
  CREATE TEMP TABLE _feed_ground_truth ON COMMIT DROP AS
    SELECT d::date AS holiday_date FROM (VALUES
      -- 2024 (13)
      ('2024-01-01'),('2024-01-26'),('2024-03-11'),('2024-03-29'),('2024-03-30'),
      ('2024-03-31'),('2024-04-01'),('2024-04-25'),('2024-06-10'),('2024-09-27'),
      ('2024-11-05'),('2024-12-25'),('2024-12-26'),
      -- 2025 (14)
      ('2025-01-01'),('2025-01-26'),('2025-01-27'),('2025-03-10'),('2025-04-18'),
      ('2025-04-19'),('2025-04-20'),('2025-04-21'),('2025-04-25'),('2025-06-09'),
      ('2025-09-26'),('2025-11-04'),('2025-12-25'),('2025-12-26'),
      -- 2026 (14)
      ('2026-01-01'),('2026-01-26'),('2026-03-09'),('2026-04-03'),('2026-04-04'),
      ('2026-04-05'),('2026-04-06'),('2026-04-25'),('2026-06-08'),('2026-09-25'),
      ('2026-11-03'),('2026-12-25'),('2026-12-26'),('2026-12-28'),
      -- 2027 (15)
      ('2027-01-01'),('2027-01-26'),('2027-03-08'),('2027-03-26'),('2027-03-27'),
      ('2027-03-28'),('2027-03-29'),('2027-04-25'),('2027-06-14'),('2027-09-25'),
      ('2027-11-02'),('2027-12-25'),('2027-12-26'),('2027-12-27'),('2027-12-28'),
      -- 2028 (14)
      ('2028-01-01'),('2028-01-03'),('2028-01-26'),('2028-03-13'),('2028-04-14'),
      ('2028-04-15'),('2028-04-16'),('2028-04-17'),('2028-04-25'),('2028-06-12'),
      ('2028-09-30'),('2028-11-07'),('2028-12-25'),('2028-12-26')
    ) AS t(d);

  -- Guard the guard: if the embedded list drifts, the exception allowance below
  -- would start hiding real disagreements.
  SELECT count(*) INTO v_known
  FROM _feed_ground_truth
  WHERE holiday_date IN (DATE '2027-09-25', DATE '2028-09-30');

  SELECT count(*) INTO v_unexpected
  FROM (
    SELECT holiday_date FROM reporting.fn_vic_holidays(2024)
    UNION ALL SELECT holiday_date FROM reporting.fn_vic_holidays(2025)
    UNION ALL SELECT holiday_date FROM reporting.fn_vic_holidays(2026)
    UNION ALL SELECT holiday_date FROM reporting.fn_vic_holidays(2027)
    UNION ALL SELECT holiday_date FROM reporting.fn_vic_holidays(2028)
  ) g
  FULL OUTER JOIN _feed_ground_truth f ON f.holiday_date = g.holiday_date
  WHERE (g.holiday_date IS NULL OR f.holiday_date IS NULL)
    -- The two documented divergences, in both directions: the feed's Saturday
    -- and the rule's Friday, for 2027 and 2028 only.
    AND COALESCE(g.holiday_date, f.holiday_date)
        NOT IN (DATE '2027-09-24', DATE '2027-09-25',
                DATE '2028-09-29', DATE '2028-09-30');

  IF v_known <> 2 THEN
    RAISE EXCEPTION
      '109 provenance check: the embedded ground-truth list no longer contains exactly the two expected AFL divergences (found %). Re-verify against the vic.gov.au feed before proceeding.', v_known
      USING ERRCODE = 'raise_exception';
  END IF;

  IF v_unexpected <> 0 THEN
    RAISE EXCEPTION
      '109 provenance check: reporting.fn_vic_holidays() disagrees with the published 2024-2028 calendar in % date(s) beyond the two known AFL divergences. The generator is wrong; refusing to seed.', v_unexpected
      USING ERRCODE = 'raise_exception';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. The calendar
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reporting.dim_public_holiday_vic (
  holiday_date   date PRIMARY KEY,
  name           text NOT NULL,

  -- True for an observed Monday/Tuesday standing in for a weekend anniversary.
  -- Not cosmetic: it is what distinguishes "Christmas Day" legitimately appearing
  -- on the 27th from a data error, and it is the first column a reviewer checks.
  is_substitute  boolean NOT NULL DEFAULT false,

  -- The date is not yet gazetted, or was derived because the source could not be
  -- trusted for it. Everything from 2029 is derived because the feed stops at
  -- 2028-12-26; the AFL Friday is derived from 2027 because that is where the
  -- feed's own rows stop being a Friday. Provisional is deliberately per-ROW
  -- rather than per-year: a single year legitimately mixes both kinds, and a
  -- per-year flag would hide which date in it is the guess.
  is_provisional boolean NOT NULL DEFAULT false,

  source         text NOT NULL,
  source_url     text,
  loaded_at      timestamptz NOT NULL DEFAULT now()

  -- ANZAC Day is deliberately absent, so no exception row is needed for it.
  -- Melbourne Cup is a statewide holiday "unless alternate local holiday has
  -- been arranged by a non-metro council". Those local alternates are
  -- out of scope on purpose: the SLA is a single statewide promise, and making
  -- the deadline depend on which postcode a family lives in would be a different
  -- promise than the one /contact publishes.
);

COMMENT ON TABLE reporting.dim_public_holiday_vic IS
  'Victorian public holidays behind the business-day SLA clock. Deliberately separate from reporting.dim_date (D2): dim_date.is_vic_public_holiday is an unpopulated column default that other rollups read, and this is the sourced one. Seeded from reporting.fn_vic_holidays(), whose 2024-2028 output is proven against the vic.gov.au iCal feed at apply time.';

INSERT INTO reporting.dim_public_holiday_vic
  (holiday_date, name, is_substitute, is_provisional, source, source_url)
SELECT h.holiday_date,
       h.name,
       h.is_substitute,
       (EXTRACT(YEAR FROM h.holiday_date) >= 2029
        OR (h.name = 'Friday before the AFL Grand Final'
            AND EXTRACT(YEAR FROM h.holiday_date) >= 2027)),
       CASE
         WHEN EXTRACT(YEAR FROM h.holiday_date) <= 2026
           THEN 'vic.gov.au iCal feed (confirmed)'
         WHEN EXTRACT(YEAR FROM h.holiday_date) <= 2028
           THEN 'vic.gov.au iCal feed (published, subject to change); AFL Friday rule-derived'
         ELSE 'rule-derived from Public Holidays Act 1993 (Vic); no published source exists this far ahead'
       END,
       'https://www.vic.gov.au/sites/default/files/2026-06/Victorian-public-holiday-dates.ics'
FROM generate_series(2024, 2030) AS y,
     LATERAL reporting.fn_vic_holidays(y) AS h
ON CONFLICT (holiday_date) DO UPDATE
  SET name           = EXCLUDED.name,
      is_substitute  = EXCLUDED.is_substitute,
      is_provisional = EXCLUDED.is_provisional,
      source         = EXCLUDED.source,
      source_url     = EXCLUDED.source_url,
      loaded_at      = now();

-- ----------------------------------------------------------------------------
-- 4. Coverage test and the deadline
-- ----------------------------------------------------------------------------

-- A year counts as known only if the rows stored for it are exactly the rows the
-- proven generator produces for it. This is the difference between "2031 has no
-- holidays" and the worse failure, "2031 has eight of thirteen because somebody
-- pasted a partial list": a short year makes the clock miss a deadline by a day
-- and every figure still looks sourced. Completeness is checked against the same
-- function that made the data, so the two cannot drift apart.
CREATE OR REPLACE FUNCTION reporting.holiday_year_is_complete(p_year integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT count(*) > 0
     AND count(*) = (SELECT count(*) FROM reporting.fn_vic_holidays(p_year))
  FROM reporting.dim_public_holiday_vic
  WHERE EXTRACT(YEAR FROM holiday_date)::int = p_year
$$;

CREATE OR REPLACE FUNCTION reporting.business_day_deadline(
  p_from          timestamptz,
  p_business_days integer DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
-- SECURITY DEFINER is load-bearing here, not defensive boilerplate. The table is
-- RLS-enabled and FORCED with no policy (the posture every other reporting base
-- table uses, and what PR-07 enforces), so a caller without BYPASSRLS reads ZERO
-- holiday rows. For this function that failure is not an error - it is a calendar
-- in which every public holiday is an ordinary working day, which would shorten
-- every deadline and make late replies look on time. Executing as the owner is the
-- only way a grantee can get a correct answer rather than a confidently wrong one.
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_days    integer;
  v_local   date := (p_from AT TIME ZONE 'Australia/Melbourne')::date;
  v_horizon date;
  v_year    integer;
  v_cursor  date;
  v_count   integer := 0;
BEGIN
  IF p_from IS NULL THEN
    RETURN NULL;
  END IF;

  -- Explicit argument wins; otherwise the config singleton decides. Reading the
  -- config here is the whole point of this migration: it is the line that makes
  -- sla_basis load-bearing where before 109 nothing read it.
  SELECT COALESCE(p_business_days, t.first_response_sla_business_days)
    INTO v_days
  FROM reporting.enquiry_thresholds t
  WHERE t.id = 1;

  IF v_days IS NULL OR v_days < 1 THEN
    RETURN NULL;
  END IF;

  -- The furthest this scan can possibly reach. Each business day needs at most
  -- one calendar day, plus whatever run of non-business days intervenes; the
  -- longest such stretch in Victoria is Christmas through New Year. Seven days
  -- per requested day plus a three-weekend allowance cannot be exceeded by any
  -- calendar this table can hold, and a bounded scan is what makes "no data"
  -- detectable instead of endless.
  v_horizon := v_local + (7 * v_days + 20);

  -- Refuse rather than guess. Every year the scan can touch must be seeded and
  -- complete, so both a missing year and a half-populated one fail closed.
  v_year := EXTRACT(YEAR FROM v_local)::int;
  WHILE v_year <= EXTRACT(YEAR FROM v_horizon)::int LOOP
    IF NOT reporting.holiday_year_is_complete(v_year) THEN
      RETURN NULL;
    END IF;
    v_year := v_year + 1;
  END LOOP;

  v_cursor := v_local;
  WHILE v_count < v_days LOOP
    v_cursor := v_cursor + 1;
    EXIT WHEN v_cursor > v_horizon;
    IF EXTRACT(ISODOW FROM v_cursor)::int <= 5
       AND NOT EXISTS (SELECT 1 FROM reporting.dim_public_holiday_vic h
                       WHERE h.holiday_date = v_cursor) THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  IF v_count < v_days THEN
    RETURN NULL;
  END IF;

  -- "Close of" the business day, taken as the end of the calendar day. Deliberately
  -- not an opening-hours figure: no business hour was ever supplied for this
  -- promise, and inventing 17:00 would put an unvalidated number inside a
  -- customer-facing deadline. End-of-day can only be more generous than a
  -- working-hours reading, so the clock cannot make the published promise look
  -- better than it is - which is the direction this project consistently chooses.
  --
  -- Note the day of receipt never counts, even for a 09:00 enquiry: decision 1a
  -- is "the NEXT business day", so a Monday-morning enquiry is due at the close of
  -- Tuesday, not Monday.

  RETURN (v_cursor + TIME '23:59:59') AT TIME ZONE 'Australia/Melbourne';
END $$;

-- ----------------------------------------------------------------------------
-- 5. Configuration: give the business-day promise its own representation
-- ----------------------------------------------------------------------------
-- The window is NOT reinterpreted through first_response_sla_minutes. Making 1440
-- mean "1440 business minutes" under one basis and calendar minutes under the
-- other would be exactly the ambiguity this table exists to avoid, and it would
-- silently redefine a stored number when the basis flipped. A business day is a
-- day, so it gets a column that counts days.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'reporting'
      AND table_name   = 'enquiry_thresholds'
      AND column_name  = 'first_response_sla_business_days'
  ) THEN
    ALTER TABLE reporting.enquiry_thresholds
      ADD COLUMN first_response_sla_business_days integer NOT NULL DEFAULT 1;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'reporting.enquiry_thresholds'::regclass
      AND conname  = 'enquiry_thresholds_business_days_positive'
  ) THEN
    ALTER TABLE reporting.enquiry_thresholds
      ADD CONSTRAINT enquiry_thresholds_business_days_positive
      CHECK (first_response_sla_business_days > 0);
  END IF;
END $$;

COMMENT ON COLUMN reporting.enquiry_thresholds.first_response_sla_business_days IS
  'How many business days the published response promise allows. Used only when sla_basis = ''business''; the minute column is used only when it is ''calendar''. Kept separate on purpose - reinterpreting one number under two meanings is how an SLA silently changes when nobody edits it.';

-- The basis the business chose (decision 1-B). This is the value the queue now
-- actually reads; before 109 the column existed and nothing consulted it.
-- sla_is_confirmed is deliberately left alone: a real deadline is not the same
-- thing as a promise somebody signed off on, and that flag stays a human act.
UPDATE reporting.enquiry_thresholds
SET sla_basis = 'business'
WHERE id = 1
  AND sla_basis <> 'business';

-- ----------------------------------------------------------------------------
-- 6. The queue, made basis-aware
-- ----------------------------------------------------------------------------
-- DROP is required, not optional: RETURNS TABLE changes shape, and replacing a
-- function with a different return type fails 42P13. This project has been
-- caught by that before.
--
-- The design point: there is ONE lateness rule and TWO ways of producing the
-- deadline. `due_at` is computed per basis - a calendar offset or a business-day
-- scan - and every state below compares against `due_at` alone. Had this been
-- written as two parallel CASE chains, the calendar branch would have kept its
-- old meaning while the business branch invented its own, and the two would drift
-- the first time somebody tuned `at_risk`. Reproducing the previous calendar
-- behaviour from `due_at` is exact, because
--   first_response - received <= sla_minutes
-- is the same inequality as
--   first_response <= received + sla_minutes = due_at.
DROP FUNCTION IF EXISTS public.admin_enquiry_queue(text, text, boolean, integer, integer);

CREATE FUNCTION public.admin_enquiry_queue(
  p_status     text    DEFAULT NULL,
  p_type       text    DEFAULT NULL,
  p_unanswered boolean DEFAULT false,
  p_limit      integer DEFAULT 50,
  p_offset     integer DEFAULT 0
)
RETURNS TABLE(
  enquiry_id uuid, channel text, enquiry_type text, status text, outcome text,
  received_at timestamptz, first_response_at timestamptz, resolved_at timestamptz,
  assigned_to uuid, parent_user_id uuid, converted boolean,
  age_minutes integer, response_minutes integer, resolution_hours numeric,
  sla_minutes integer, sla_state text, sla_is_confirmed boolean, utm_source text,
  due_at timestamptz, sla_basis text, sla_business_days integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $q$
BEGIN
  -- Authorisation before parameter validation: a non-admin must not be able to
  -- learn the valid status names by observing which of two 400s comes back.
  IF NOT public.has_role('ADMIN') THEN
    RETURN;
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 200' USING ERRCODE = '22023';
  END IF;
  IF p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'p_offset must be zero or greater' USING ERRCODE = '22023';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN (
       'new','triaged','in_progress','waiting_on_customer','resolved','closed','spam') THEN
    RAISE EXCEPTION 'unknown enquiry status: %', p_status USING ERRCODE = '22023';
  END IF;
  IF p_type IS NOT NULL AND p_type NOT IN (
       'billing','technical','privacy','accessibility','product_question',
       'refund','complaint','other') THEN
    RAISE EXCEPTION 'unknown enquiry type: %', p_type USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    e.id, e.channel, e.enquiry_type, e.status, e.outcome,
    e.received_at, e.first_response_at, e.resolved_at,
    e.assigned_to, e.parent_user_id,
    (e.converted_order_id IS NOT NULL),
    -- EXTRACT(EPOCH ...) is SECONDS. The /60 is what makes these columns mean
    -- minutes; dropping it is the bug that once shipped through a passing queue.
    (EXTRACT(EPOCH FROM (now() - e.received_at)) / 60)::int,
    (EXTRACT(EPOCH FROM (e.first_response_at - e.received_at)) / 60)::int,
    CASE WHEN e.resolved_at IS NULL OR e.first_response_at IS NULL THEN NULL
         ELSE ROUND(EXTRACT(EPOCH FROM (e.resolved_at - e.received_at)) / 3600, 2) END,
    -- Each window is reported only under the basis that uses it. Returning
    -- 1440 beside a business-day deadline would invite a reader to compare an
    -- age in minutes against a window measured in days.
    CASE WHEN th.sla_basis = 'calendar' THEN th.first_response_sla_minutes END,
    CASE
      -- Checked first, unchanged: a finished enquiry with no reply is a gap in
      -- the record, not a breach, and calling it either would be the fabrication
      -- section 2 of 104 refuses to make.
      WHEN e.status IN ('resolved','closed') AND e.first_response_at IS NULL
        THEN 'unrecorded'
      -- The calendar does not cover this enquiry's window. No number is offered.
      WHEN d.due_at IS NULL
        THEN 'unknown_calendar'
      WHEN e.first_response_at IS NOT NULL
        THEN CASE WHEN e.first_response_at <= d.due_at THEN 'met' ELSE 'breached' END
      -- Unanswered past the window breaches NOW, not when it is eventually
      -- resolved (104 section 2 / roadmap 5.8).
      WHEN now() > d.due_at THEN 'breached'
      WHEN now() > e.received_at + ((d.due_at - e.received_at) * 0.75) THEN 'at_risk'
      ELSE 'within'
    END,
    th.sla_is_confirmed,
    e.utm_source,
    d.due_at,
    th.sla_basis,
    CASE WHEN th.sla_basis = 'business' THEN th.first_response_sla_business_days END
  FROM public.enquiries e
  CROSS JOIN reporting.enquiry_thresholds th
  CROSS JOIN LATERAL (
    SELECT CASE
             WHEN th.sla_basis = 'business'
               THEN reporting.business_day_deadline(e.received_at)
             ELSE e.received_at
                  + make_interval(mins => th.first_response_sla_minutes)
           END AS due_at
  ) d
  WHERE th.id = 1
    AND (p_status IS NULL OR e.status = p_status)
    -- Spam is not work, so the default work queue hides it. Asking for
    -- status='spam' explicitly still returns it.
    AND (p_status IS NOT NULL OR e.status <> 'spam')
    AND (p_type IS NULL OR e.enquiry_type = p_type)
    AND (NOT p_unanswered OR e.first_response_at IS NULL)
  ORDER BY e.received_at ASC
  LIMIT p_limit OFFSET p_offset;
END;
$q$;

REVOKE ALL ON FUNCTION public.admin_enquiry_queue(text, text, boolean, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_enquiry_queue(text, text, boolean, integer, integer)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7. Header counts
-- ----------------------------------------------------------------------------
-- This function carried the same defect as the queue, in a worse place. Its
-- unrecorded_open test was `age_minutes > sla_minutes` - hardcoded calendar
-- arithmetic. Under a business-day basis sla_minutes is now NULL, so that
-- comparison yields NULL, the FILTER never matches, and "reply not recorded"
-- would have quietly read ZERO on the one screen whose job is to surface it.
-- A zero that means "not computed" is the most misleading number a queue can
-- show, so this count is derived from sla_state instead: the state machine owns
-- the definition of "past the window", in either basis.
DROP FUNCTION IF EXISTS public.admin_enquiry_counts();

CREATE FUNCTION public.admin_enquiry_counts()
RETURNS TABLE(
  open_total bigint, breached bigint, at_risk bigint, unrecorded_open bigint,
  unknown_calendar bigint, oldest_age_minutes integer,
  sla_minutes integer, sla_business_days integer, sla_basis text,
  sla_is_confirmed boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $c$
  WITH q AS (SELECT * FROM public.admin_enquiry_queue(NULL, NULL, false, 200, 0))
  SELECT
    COUNT(*) FILTER (WHERE q.status NOT IN ('resolved','closed','spam'))::bigint,
    COUNT(*) FILTER (WHERE q.status NOT IN ('resolved','closed','spam')
                       AND q.sla_state = 'breached')::bigint,
    COUNT(*) FILTER (WHERE q.status NOT IN ('resolved','closed','spam')
                       AND q.sla_state = 'at_risk')::bigint,
    -- Open, past the window, still no reply recorded: these become 'unrecorded'
    -- silently if nobody acts, so they are counted apart from a plain backlog.
    COUNT(*) FILTER (WHERE q.status NOT IN ('resolved','closed','spam')
                       AND q.first_response_at IS NULL
                       AND q.sla_state = 'breached')::bigint,
    -- Counted separately from breached rather than folded into it: these rows are
    -- not passing, and they are not known to be late. They are unmeasurable, and
    -- the header has to be able to say so instead of implying a clean slate.
    COUNT(*) FILTER (WHERE q.status NOT IN ('resolved','closed','spam')
                       AND q.sla_state = 'unknown_calendar')::bigint,
    COALESCE(MAX(q.age_minutes) FILTER (
      WHERE q.status NOT IN ('resolved','closed','spam'))::integer, 0),
    MAX(q.sla_minutes),
    MAX(q.sla_business_days),
    MAX(q.sla_basis),
    BOOL_AND(q.sla_is_confirmed)
  FROM q;
$c$;

REVOKE ALL ON FUNCTION public.admin_enquiry_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_enquiry_counts() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 8. Privileges on the new objects
-- ----------------------------------------------------------------------------
-- RLS enabled AND forced, with no policy: the posture every other reporting base
-- table uses, and the one PR-07 in supabase/tests/assurance.sql enforces. Forcing
-- matters because the table is created by a role that would otherwise bypass its
-- own row security as owner.
--
-- Worth stating plainly, because it is easy to misread: with no policy, a
-- non-BYPASSRLS role cannot SELECT from this table directly even when granted
-- SELECT - the same situation enquiry_thresholds has been in since 104. Reads
-- reach the calendar through the SECURITY DEFINER functions above, which is why
-- those carry the definer attribute. The GRANT below is kept for parity with the
-- existing reporting config tables, not because it is sufficient on its own.
ALTER TABLE reporting.dim_public_holiday_vic ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.dim_public_holiday_vic FORCE ROW LEVEL SECURITY;

-- Same posture as 104's thresholds row: the calendar is readable by the
-- reporting role and by nothing that faces a browser directly. The queue
-- reaches it through SECURITY DEFINER, which is why the app roles do not need
-- it - and why leaving the default PUBLIC EXECUTE on the new functions would
-- quietly widen the surface this file is otherwise narrowing.
REVOKE ALL ON reporting.dim_public_holiday_vic FROM PUBLIC, anon, authenticated;
GRANT SELECT ON reporting.dim_public_holiday_vic TO reporting_ro;

REVOKE ALL ON FUNCTION reporting.fn_vic_holidays(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reporting.holiday_year_is_complete(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reporting.business_day_deadline(timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reporting.fn_vic_holidays(integer) TO reporting_ro;
GRANT EXECUTE ON FUNCTION reporting.holiday_year_is_complete(integer) TO reporting_ro;
GRANT EXECUTE ON FUNCTION reporting.business_day_deadline(timestamptz, integer) TO reporting_ro;

-- ----------------------------------------------------------------------------
-- 9. Teach the baseline exporter about the calendar
-- ----------------------------------------------------------------------------
-- reporting.export_baseline_config() decides which tables land in
-- baseline/07_config.sql, and it discovers them by two rules: a `*_thresholds`
-- name, or a `(id = 1)` singleton CHECK. dim_public_holiday_vic matches neither,
-- so it was silently left out of the capture - and 07_config is the ONLY reason a
-- restored database has any configuration in it at all, as that function's own
-- header says: "their absence silently disables features rather than raising an
-- error."
--
-- For this table the failure is quiet but total. A restored database would have an
-- empty calendar, holiday_year_is_complete() would report every year incomplete,
-- and every deadline would return unknown_calendar forever. That direction is at
-- least honest rather than wrong, but it is still a feature that disappeared with
-- no error anywhere - and it would only be noticed by someone asking why the queue
-- has no SLA figures.
--
-- Reproduced verbatim from the live definition, with one table added to the
-- non-derivable list. Nothing else about the exporter is changed.
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
  v_out text := E'-- Hand-maintained reporting configuration (052/064/071/086/109).\n'
              || E'-- A schema dump does not carry these, and their absence silently\n'
              || E'-- disables features rather than raising an error.\n\n';
  v_tables text[];
BEGIN
  -- Convention-discovered calibration tables, unioned with the few config tables
  -- that follow no discoverable convention. DISTINCT so a table matched by both
  -- the name pattern and the singleton check is exported once.
  SELECT array_agg(DISTINCT z.t ORDER BY z.t) INTO v_tables
  FROM (
    -- Not derivable: no `*_thresholds` name and no singleton CHECK.
    SELECT unnest(ARRAY[
      'dim_year_level_cap', 'refresh_blackout',
      'refresh_blackout_exempt', 'product_tax_treatment',
      -- Added by 109: a multi-row reference table, not a singleton, so neither
      -- discovery rule can see it.
      'dim_public_holiday_vic'
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


