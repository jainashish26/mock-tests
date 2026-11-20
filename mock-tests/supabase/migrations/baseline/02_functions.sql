-- Generated baseline: functions
-- Source: live database via export_schema_baseline (migrations 051/052).
-- Do not hand-edit; regenerate with scripts/rebaseline_schema.py.
-- See supabase/migrations/README.md for apply order and caveats.

CREATE OR REPLACE FUNCTION reporting.business_day_deadline(p_from timestamp with time zone, p_business_days integer DEFAULT NULL::integer)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
END $function$
;

CREATE OR REPLACE FUNCTION reporting.evaluate_daily_targets(p_date_key integer DEFAULT NULL::integer)
 RETURNS TABLE(target_date integer, students_evaluated bigint, completed bigint, missed bigint, events_inserted bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'reporting', 'public'
AS $function$
DECLARE
  v_date      integer;
  v_evaluated bigint;
  v_completed bigint;
  v_missed    bigint;
  v_inserted  bigint;
BEGIN
  -- Default to yesterday in Melbourne, matching the date_key convention used
  -- throughout the fact tables (load_response_facts derives date_key with
  -- `AT TIME ZONE 'Australia/Melbourne'`). An explicit argument allows a
  -- backfill after an outage.
  v_date := COALESCE(
    p_date_key,
    (to_char((now() AT TIME ZONE 'Australia/Melbourne')::date - 1, 'YYYYMMDD'))::integer
  );

  CREATE TEMP TABLE _verdict ON COMMIT DROP AS
  WITH plan AS (
    SELECT dp.student_id, dp.unit_kind, dt.daily_target_units
    FROM reporting.dim_practice_plan dp
    JOIN reporting.dim_student ds
      ON ds.student_id = dp.student_id AND ds.is_current
    JOIN reporting.mv_student_daily_target dt
      ON dt.student_key = ds.student_key
    WHERE dp.is_current
      -- A zero target is a rest day or an exhausted plan. There is nothing to
      -- miss, and emitting MISSED for a day the plan deliberately left empty
      -- would punish a family for following the plan.
      AND dt.daily_target_units IS NOT NULL
      AND dt.daily_target_units > 0
  ),
  parent AS (
    -- The funnel row belongs to the PARENT: they are the buyer and the emails
    -- go to them. First link wins, matching recordAttemptForFunnel().
    SELECT DISTINCT ON (l.student_id) l.student_id, l.parent_user_id
    FROM public.parent_student_links l
    ORDER BY l.student_id, l.created_at ASC
  ),
  tests_done AS (
    SELECT f.student_id, COUNT(*) AS n
    FROM reporting.fact_test_attempt f
    WHERE f.date_key = v_date
      AND f.status IN ('SUBMITTED', 'COMPLETE')
    GROUP BY f.student_id
  ),
  questions_done AS (
    SELECT r.student_id, COUNT(*) AS n
    FROM reporting.fact_item_response r
    WHERE r.date_key = v_date
    GROUP BY r.student_id
  )
  SELECT
    p.student_id,
    pa.parent_user_id,
    p.unit_kind,
    p.daily_target_units,
    CASE WHEN p.unit_kind = 'tests'
         THEN COALESCE(t.n, 0)
         ELSE COALESCE(q.n, 0)
    END AS units_done
  FROM plan p
  -- INNER join: with no parent link there is no funnel row to attribute to,
  -- and funnel_events' identity CHECK would reject a row with neither
  -- user_id nor anonymous_id.
  JOIN parent pa       ON pa.student_id = p.student_id
  LEFT JOIN tests_done t     ON t.student_id = p.student_id
  LEFT JOIN questions_done q ON q.student_id = p.student_id;

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE units_done >= daily_target_units),
         COUNT(*) FILTER (WHERE units_done <  daily_target_units)
    INTO v_evaluated, v_completed, v_missed
  FROM _verdict;

  INSERT INTO public.funnel_events (user_id, anonymous_id, student_id, event, stage, props, path)
  SELECT
    v.parent_user_id,
    NULL,
    v.student_id,
    -- Renamed by migration 039 from STUDY_PLAN_SESSION_COMPLETED/_MISSED, which
    -- duplicated DAILY_TARGET_MET/_MISSED in the same funnel step. See header.
    CASE WHEN v.units_done >= v.daily_target_units
         THEN 'DAILY_TARGET_MET'
         ELSE 'DAILY_TARGET_MISSED' END,
    -- No EVENT_STAGE entry exists for these two, so stage stays NULL. They are
    -- engagement markers inside the onboard step, not stage transitions: a
    -- missed day does not un-onboard a family.
    NULL,
    jsonb_build_object(
      'dateKey',     v_date,
      'unitKind',    v.unit_kind,
      'dailyTarget', v.daily_target_units,
      'unitsDone',   v.units_done,
      'source',      'daily_target_job'
    ),
    NULL
  FROM _verdict v
  -- Idempotent per child per evaluated day, and matched on BOTH the new and the
  -- retired names. Without the retired names in this list, a re-run over a date
  -- already written under the old name would insert a second row for the same
  -- child-day and silently halve the measured adherence rate.
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.funnel_events f
    WHERE f.student_id = v.student_id
      AND f.event IN ('DAILY_TARGET_MET', 'DAILY_TARGET_MISSED',
                      'STUDY_PLAN_SESSION_COMPLETED', 'STUDY_PLAN_SESSION_MISSED')
      AND (f.props->>'dateKey')::integer = v_date
  );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN QUERY
  SELECT v_date, COALESCE(v_evaluated,0), COALESCE(v_completed,0),
         COALESCE(v_missed,0), COALESCE(v_inserted,0);
END;
$function$
;

CREATE OR REPLACE FUNCTION reporting.experiment_decision(p_n bigint, p_c bigint, p_control_n bigint, p_control_c bigint, p_min_sample integer, p_alpha numeric, p_min_lift_pp numeric)
 RETURNS TABLE(decision text, reason text)
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
DECLARE
  v_diff numeric;
  v_bounds numeric[];
  v_p numeric;
BEGIN
  IF COALESCE(p_n, 0) < p_min_sample OR COALESCE(p_control_n, 0) < p_min_sample THEN
    RETURN QUERY SELECT 'INSUFFICIENT_DATA'::text,
      format('Only %s exposed in this arm and %s in control; %s per arm are needed before any verdict. This is NOT evidence of no difference.',
             COALESCE(p_n, 0), COALESCE(p_control_n, 0), p_min_sample);
    RETURN;
  END IF;

  v_diff := 100.0 * p_c / p_n - 100.0 * p_control_c / p_control_n;
  v_bounds := reporting.newcombe_diff_bounds(p_c, p_n, p_control_c, p_control_n);
  v_p := reporting.two_proportion_p_value(p_c, p_n, p_control_c, p_control_n);

  IF v_p IS NULL THEN
    RETURN QUERY SELECT 'INSUFFICIENT_DATA'::text,
      'The comparison could not be computed (an arm is empty).'::text;
    RETURN;
  END IF;

  IF v_p >= p_alpha THEN
    RETURN QUERY SELECT 'EXTEND'::text,
      format('p=%s is not below %s, so the observed %s pp difference is within noise. Keep running or stop; do not read this as proof of equivalence.',
             ROUND(v_p, 4), p_alpha, ROUND(v_diff, 2));
    RETURN;
  END IF;

  IF v_bounds[1] > 0 AND v_diff >= p_min_lift_pp THEN
    RETURN QUERY SELECT 'SHIP'::text,
      format('Significant (p=%s) and the whole interval [%s, %s] pp is above zero, with a %s pp lift clearing the %s pp worth-shipping floor.',
             ROUND(v_p, 4), ROUND(v_bounds[1]*100, 2), ROUND(v_bounds[2]*100, 2),
             ROUND(v_diff, 2), p_min_lift_pp);
    RETURN;
  END IF;

  IF v_bounds[2] < 0 THEN
    RETURN QUERY SELECT 'REVERT'::text,
      format('Significant (p=%s) and the whole interval [%s, %s] pp is below zero: this arm converts worse than control.',
             ROUND(v_p, 4), ROUND(v_bounds[1]*100, 2), ROUND(v_bounds[2]*100, 2));
    RETURN;
  END IF;

  RETURN QUERY SELECT 'EXTEND'::text,
    format('Significant (p=%s) but the %s pp lift does not clear the %s pp worth-shipping floor, or the interval straddles it. Statistically detectable is not the same as worth shipping.',
           ROUND(v_p, 4), ROUND(v_diff, 2), p_min_lift_pp);
END;
$function$
;

CREATE OR REPLACE FUNCTION reporting.experiment_results()
 RETURNS TABLE(experiment_key text, experiment_name text, status text, variant text, is_control boolean, sample_size bigint, conversions bigint, variant_conversion_rate numeric, control_sample_size bigint, control_rate numeric, diff_pp numeric, ci_lower_pp numeric, ci_upper_pp numeric, p_value_experiment numeric, recommended_decision text, decision_reason text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
  WITH exposed AS (
    SELECT e.experiment_key, e.subject_key, e.variant, e.exposed_at, x.conversion_event
    FROM public.experiment_exposures e
    JOIN public.experiments x USING (experiment_key)
  ),
  flagged AS (
    SELECT ex.experiment_key, ex.variant, ex.subject_key,
           EXISTS (
             SELECT 1 FROM public.funnel_events f
             WHERE f.event = ex.conversion_event
               -- A conversion BEFORE exposure cannot have been caused by it.
               AND f.created_at >= ex.exposed_at
               AND (f.user_id::text = ex.subject_key
                    OR 'anon:' || f.anonymous_id = ex.subject_key)
           ) AS converted
    FROM exposed ex
  ),
  agg AS (
    SELECT experiment_key, variant,
           COUNT(*)                          AS n,
           COUNT(*) FILTER (WHERE converted) AS c
    FROM flagged GROUP BY experiment_key, variant
  ),
  ctrl AS (
    SELECT a.experiment_key, a.n AS control_n, a.c AS control_c
    FROM agg a JOIN public.experiments x USING (experiment_key)
    WHERE a.variant = x.control_variant
  ),
  joined AS (
    SELECT x.experiment_key, x.name, x.status, a.variant,
           (a.variant = x.control_variant) AS is_control,
           a.n, a.c, ct.control_n, ct.control_c,
           t.min_sample_size, t.alpha, t.min_meaningful_lift_pp
    FROM agg a
    JOIN public.experiments x USING (experiment_key)
    LEFT JOIN ctrl ct USING (experiment_key)
    CROSS JOIN reporting.experiment_thresholds t
    WHERE t.id = 1
  ),
  stats AS (
    SELECT j.*,
           CASE WHEN j.n > 0 THEN 100.0 * j.c / j.n END AS rate,
           CASE WHEN COALESCE(j.control_n, 0) > 0
                THEN 100.0 * j.control_c / j.control_n END AS control_rate,
           CASE WHEN NOT j.is_control AND COALESCE(j.control_n, 0) > 0 AND j.n > 0
                THEN 100.0 * j.c / j.n - 100.0 * j.control_c / j.control_n END AS diff_pp,
           CASE WHEN NOT j.is_control AND COALESCE(j.control_n, 0) > 0 AND j.n > 0
                THEN reporting.newcombe_diff_bounds(j.c, j.n, j.control_c, j.control_n) END AS bounds,
           CASE WHEN NOT j.is_control
                THEN reporting.two_proportion_p_value(j.c, j.n, j.control_c, j.control_n) END AS pval
    FROM joined j
  )
  SELECT
    s.experiment_key, s.name, s.status, s.variant, s.is_control,
    s.n, s.c,
    ROUND(s.rate, 2),
    s.control_n,
    ROUND(s.control_rate, 2),
    ROUND(s.diff_pp, 2),
    ROUND(s.bounds[1] * 100, 2),
    ROUND(s.bounds[2] * 100, 2),
    ROUND(s.pval, 6),
    CASE WHEN s.is_control THEN 'CONTROL' ELSE d.decision END,
    CASE WHEN s.is_control
         THEN 'Reference arm. All differences are measured against this.'
         ELSE d.reason END
  FROM stats s
  CROSS JOIN LATERAL reporting.experiment_decision(
    s.n, s.c, s.control_n, s.control_c,
    s.min_sample_size, s.alpha, s.min_meaningful_lift_pp
  ) d
  ORDER BY s.experiment_key, s.is_control DESC, s.variant;
$function$
;

CREATE OR REPLACE FUNCTION reporting.export_baseline_config()
 RETURNS TABLE(filename text, content text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
$function$
;

CREATE OR REPLACE FUNCTION reporting.export_baseline_tables()
 RETURNS TABLE(filename text, content text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
  WITH cols AS (
    SELECT c.oid AS relid, c.relname, a.attname, a.attnum,
           format_type(a.atttypid, a.atttypmod) AS typ,
           a.attnotnull,
           a.attidentity,
           pg_get_expr(d.adbin, d.adrelid) AS def
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
    WHERE n.nspname = 'reporting' AND c.relkind = 'r'
  ),
  coltext AS (
    SELECT relid, relname,
           string_agg(
             format('  %I %s%s%s%s',
               attname, typ,
               -- Identity is not a DEFAULT expression, so pg_get_expr misses it.
               -- Without this the exported table would silently lose its
               -- auto-numbering primary key.
               CASE WHEN attidentity = 'd' THEN ' GENERATED BY DEFAULT AS IDENTITY'
                    WHEN attidentity = 'a' THEN ' GENERATED ALWAYS AS IDENTITY'
                    ELSE '' END,
               CASE WHEN def IS NOT NULL AND attidentity = '' THEN ' DEFAULT ' || def ELSE '' END,
               CASE WHEN attnotnull THEN ' NOT NULL' ELSE '' END),
             E',\n' ORDER BY attnum) AS body
    FROM cols GROUP BY relid, relname
  ),
  cons AS (
    SELECT conrelid AS relid,
           string_agg(format('  CONSTRAINT %I %s', conname, pg_get_constraintdef(oid)),
                      E',\n' ORDER BY conname) AS body
    FROM pg_constraint
    WHERE connamespace = 'reporting'::regnamespace
    GROUP BY conrelid
  )
  SELECT 'reporting/tables.sql'::text,
         string_agg(
           format(E'CREATE TABLE IF NOT EXISTS reporting.%I (\n%s%s\n);\n\n',
                  ct.relname, ct.body,
                  CASE WHEN cs.body IS NOT NULL THEN E',\n' || cs.body ELSE '' END),
           '' ORDER BY ct.relname)
  FROM coltext ct LEFT JOIN cons cs ON cs.relid = ct.relid;
$function$
;

CREATE OR REPLACE FUNCTION reporting.fn_vic_holidays(p_year integer)
 RETURNS TABLE(holiday_date date, name text, is_substitute boolean)
 LANGUAGE sql
 STABLE
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION reporting.funnel_by_stage(p_from_date integer, p_to_date integer, p_segment_by text DEFAULT 'none'::text)
 RETURNS TABLE(stage text, stage_rank integer, channel text, campaign text, device_class text, visitors bigint, events bigint, prev_stage text, prev_stage_visitors bigint, stage_conversion_rate numeric, stage_dropoff_count bigint, suppressed boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public'
AS $function$
  WITH cur AS (
    SELECT
      m.stage, m.stage_rank,
      CASE WHEN p_segment_by = 'channel'  THEN m.channel      ELSE '(all)' END AS channel,
      CASE WHEN p_segment_by = 'campaign' THEN m.campaign     ELSE '(all)' END AS campaign,
      CASE WHEN p_segment_by = 'device'   THEN m.device_class ELSE '(all)' END AS device_class,
      SUM(m.visitors) AS visitors,
      SUM(m.events)   AS events
    FROM reporting.mv_funnel_stage m
    WHERE m.date_key BETWEEN p_from_date AND p_to_date
      AND m.stage_rank > 0
    GROUP BY 1, 2, 3, 4, 5
  ),
  chained AS (
    SELECT c.*,
      -- LAG over the populated stages, not over rank-1: a stage with no rows at
      -- all is skipped rather than breaking the chain.
      LAG(c.stage)       OVER w AS prev_stage,
      LAG(c.visitors)    OVER w AS prev_visitors,
      LAG(c.stage_rank)  OVER w AS prev_rank
    FROM cur c
    WINDOW w AS (PARTITION BY c.channel, c.campaign, c.device_class ORDER BY c.stage_rank)
  )
  SELECT
    ch.stage, ch.stage_rank, ch.channel, ch.campaign, ch.device_class,
    ch.visitors, ch.events,
    ch.prev_stage,
    ch.prev_visitors AS prev_stage_visitors,
    ROUND(100.0 * ch.visitors / NULLIF(ch.prev_visitors, 0), 2) AS stage_conversion_rate,
    GREATEST(0, COALESCE(ch.prev_visitors, 0) - ch.visitors)     AS stage_dropoff_count,
    -- Suppression uses the SMALLER side of the comparison: a rate computed from
    -- 4 visitors is noise whichever end of the ratio those 4 sit at.
    (SELECT t.min_segment_visitors IS NOT NULL
            AND LEAST(ch.visitors, COALESCE(ch.prev_visitors, ch.visitors)) < t.min_segment_visitors
       FROM reporting.funnel_thresholds t WHERE t.id = 1) AS suppressed
  FROM chained ch
  ORDER BY ch.stage_rank, ch.visitors DESC;
$function$
;

CREATE OR REPLACE FUNCTION reporting.funnel_outcomes(p_from_date integer, p_to_date integer)
 RETURNS TABLE(reached_paywall bigint, paying bigint, free_to_paid_rate numeric, checkout_started bigint, checkout_completed bigint, checkout_abandoned bigint, checkout_abandonment_rate numeric, median_hours_to_abandon numeric, signup_cohort bigint, activated bigint, activation_rate numeric, median_hours_to_first_value numeric, suppressed boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public'
AS $function$
  WITH thr AS (
    -- A single row read once. NOT NULL from this migration, so there is no
    -- "unset" branch to reason about; COALESCE stays as a belt for a restore
    -- from an older baseline that predates the constraint.
    SELECT COALESCE(t.checkout_abandon_minutes, 60) AS abandon_minutes
      FROM reporting.funnel_thresholds t
     WHERE t.id = 1
  ),
  per_user AS (
    SELECT
      COALESCE(f.user_id::text, 'anon:' || f.anonymous_id)                 AS vk,
      MAX(f.occurred_at) FILTER (WHERE f.event_name = 'PAYWALL_TRIGGERED') AS paywall_at,
      MAX(f.occurred_at) FILTER (WHERE f.event_name = 'CHECKOUT_STARTED')  AS started_at,
      MAX(f.occurred_at) FILTER (WHERE f.event_name = 'CHECKOUT_COMPLETED')AS completed_at,
      MAX(f.occurred_at) FILTER (WHERE f.event_name = 'CHECKOUT_ABANDONED')AS abandoned_at
    FROM reporting.fact_event f
    WHERE f.date_key BETWEEN p_from_date AND p_to_date
    GROUP BY 1
  ),
  ev AS (
    SELECT
      COUNT(*) FILTER (WHERE paywall_at  IS NOT NULL)     AS reached_paywall,
      COUNT(*) FILTER (WHERE completed_at IS NOT NULL)    AS paying,
      COUNT(*) FILTER (WHERE started_at  IS NOT NULL)     AS started,
      -- The window, applied. See the header for why `completed_at IS NULL`
      -- alone is not a measurement of abandonment.
      COUNT(*) FILTER (WHERE p.started_at IS NOT NULL
                        AND COALESCE(p.completed_at, now()) - p.started_at
                            > make_interval(mins => thr.abandon_minutes)) AS abandoned,
      -- Median time from first checkout open to the abandonment marker, in
      -- hours. NULL when nothing was abandoned, which is a good outcome and
      -- must not be rendered as zero.
      --
      -- DIFFERENT POPULATION FROM `abandoned`, AND NOT FIXED SILENTLY
      --   This median covers only visitors with an explicit CHECKOUT_ABANDONED
      --   event, whereas `abandoned` above is derived for everyone past the
      --   window. The two are not the same set of people, and a panel showing
      --   "1 abandoned - median 3.2h" would imply the median described the
      --   count. It describes the subset that pressed something we recognised
      --   as leaving.
      --
      --   Reconciling them means either dropping the event-based median or
      --   emitting a second column, and both change A11's contract. So the
      --   mismatch is stated here and in the function comment, and carried
      --   forward as a follow-up rather than papered over in this migration.
      (PERCENTILE_CONT(0.5) WITHIN GROUP (
         ORDER BY EXTRACT(EPOCH FROM (p.abandoned_at - p.started_at)) / 3600.0)
         FILTER (WHERE p.abandoned_at IS NOT NULL AND p.started_at IS NOT NULL)
      )::numeric                                          AS median_abandon_hours
    FROM per_user p CROSS JOIN thr
  ),
  -- C7 is a per-user duration, so it comes from funnel_state, which already
  -- holds both timestamps. Cohort is defined by SIGNUP date, so the median
  -- describes "parents who signed up in this window", not "parents who happened
  -- to finish a diagnostic in it" - the latter would silently exclude everyone
  -- who dropped out, which is the population the metric exists to measure.
  st AS (
    SELECT
      COUNT(*)                                                            AS cohort,
      COUNT(*) FILTER (WHERE s.diagnostic_completed_at IS NOT NULL)        AS activated,
      (PERCENTILE_CONT(0.5) WITHIN GROUP (
         ORDER BY EXTRACT(EPOCH FROM (s.diagnostic_completed_at - s.signed_up_at)) / 3600.0)
         FILTER (WHERE s.diagnostic_completed_at IS NOT NULL)
      )::numeric                                                          AS median_ttfv_hours
    FROM public.funnel_state s
    WHERE s.signed_up_at IS NOT NULL
      AND s.signed_up_at::date BETWEEN to_date(p_from_date::text, 'YYYYMMDD')
                                   AND to_date(p_to_date::text,   'YYYYMMDD')
  )
  SELECT
    ev.reached_paywall,
    ev.paying,
    ROUND(100.0 * ev.paying / NULLIF(ev.reached_paywall, 0), 2),
    ev.started,
    ev.paying,
    ev.abandoned,
    ROUND(100.0 * ev.abandoned / NULLIF(ev.started, 0), 2),
    ROUND(ev.median_abandon_hours, 2),
    st.cohort,
    st.activated,
    ROUND(100.0 * st.activated / NULLIF(st.cohort, 0), 2),
    ROUND(st.median_ttfv_hours, 2),
    -- Every one of these rates is a percentage, and a percentage without its
    -- denominator is how "0% conversion" gets reported for a window that simply
    -- had no traffic. The raw counts are returned alongside for that reason, and
    -- suppression applies to the smallest denominator present.
    (SELECT t.min_segment_visitors IS NOT NULL
            AND LEAST(ev.reached_paywall, ev.started, COALESCE(st.cohort, 0))
                < t.min_segment_visitors
       FROM reporting.funnel_thresholds t WHERE t.id = 1)
  FROM ev CROSS JOIN st;
$function$
;

CREATE OR REPLACE FUNCTION reporting.holiday_year_is_complete(p_year integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT count(*) > 0
     AND count(*) = (SELECT count(*) FROM reporting.fn_vic_holidays(p_year))
  FROM reporting.dim_public_holiday_vic
  WHERE EXTRACT(YEAR FROM holiday_date)::int = p_year
$function$
;

CREATE OR REPLACE FUNCTION reporting.in_blackout()
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM reporting.refresh_blackout b
    CROSS JOIN LATERAL (SELECT (now() AT TIME ZONE 'Australia/Melbourne') AS mel) t
    WHERE b.is_active
      AND (b.valid_from IS NULL OR t.mel::date >= b.valid_from)
      AND (b.valid_to   IS NULL OR t.mel::date <= b.valid_to)
      AND EXTRACT(ISODOW FROM t.mel)::smallint = ANY (b.days_of_week)
      AND ((b.from_time <= b.to_time AND t.mel::time BETWEEN b.from_time AND b.to_time)
        OR (b.from_time >  b.to_time AND (t.mel::time >= b.from_time OR t.mel::time <= b.to_time))));
$function$
;

CREATE OR REPLACE FUNCTION reporting.item_statistics(p_test_id uuid DEFAULT NULL::uuid, p_student_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(period_label text, test_id uuid, item_id uuid, subject text, topic text, responses bigint, students bigint, enough_evidence boolean, p_value numeric, point_biserial numeric, median_time_seconds numeric, skip_rate_pct numeric, skip_rate_reliable boolean, marking_reliable boolean, item_flag_rate_pct numeric, key_option text, distractors jsonb, dead_distractors text[], defect_reasons text[], is_defective boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
WITH cfg AS (
  SELECT * FROM reporting.item_thresholds WHERE id = 1
),
scoped AS (
  SELECT f.attempt_id, f.student_id, f.test_id, f.item_id,
         f.is_correct, f.is_skipped, f.time_spent_seconds,
         NULLIF(btrim(f.answer_option, '"'), '') AS answer_option
  FROM reporting.fact_item_response f
  WHERE (p_test_id IS NULL OR f.test_id = p_test_id)
    AND (p_student_ids IS NULL OR f.student_id = ANY (p_student_ids))
),
attempt_totals AS (
  SELECT s.attempt_id, SUM(s.is_correct::int) AS total_correct
  FROM scoped s
  GROUP BY s.attempt_id
),
-- Point-biserial with the item EXCLUDED from its own rest score, per §5:
-- "the most commonly botched item statistic".
usable AS (
  SELECT s.attempt_id, s.student_id, s.test_id, s.item_id,
         s.is_correct, s.is_skipped, s.time_spent_seconds, s.answer_option,
         (att.total_correct - s.is_correct::int) AS rest_score
  FROM scoped s
  JOIN attempt_totals att ON att.attempt_id = s.attempt_id
  JOIN reporting.fact_test_attempt a ON a.attempt_id = s.attempt_id
  WHERE a.score IS NOT NULL
),
per_item AS (
  SELECT u.test_id, u.item_id,
         COUNT(*)::bigint                     AS responses,
         COUNT(DISTINCT u.student_id)::bigint AS students,
         COUNT(*) FILTER (WHERE u.is_correct)::numeric
           / NULLIF(COUNT(*), 0)              AS p_value,
         CORR(u.is_correct::int::numeric, u.rest_score::numeric) AS point_biserial,
         (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY u.time_spent_seconds))::numeric
                                              AS median_time_seconds,
         COUNT(*) FILTER (WHERE u.is_skipped)::numeric
           / NULLIF(COUNT(*), 0) * 100        AS skip_rate_pct
  FROM usable u
  GROUP BY u.test_id, u.item_id
),
keyed AS (
  SELECT q.id AS item_id, NULLIF(btrim(q.correct_answer), '') AS key_option
  FROM public.questions q
),
opt AS (
  SELECT u.test_id, u.item_id, u.answer_option AS option, COUNT(*)::bigint AS n
  FROM usable u
  WHERE u.answer_option IS NOT NULL
  GROUP BY u.test_id, u.item_id, u.answer_option
),
opt_k AS (
  SELECT o.test_id, o.item_id, o.option, o.n,
         (o.option = k.key_option) AS is_key,
         k.key_option
  FROM opt o
  LEFT JOIN keyed k ON k.item_id = o.item_id
),
opt_sh AS (
  SELECT o.*,
         SUM(o.n) OVER w                            AS tot,
         MAX(o.n) FILTER (WHERE o.is_key)     OVER w AS key_n,
         MAX(o.n) FILTER (WHERE NOT o.is_key) OVER w AS top_distractor_n
  FROM opt_k o
  WINDOW w AS (PARTITION BY o.test_id, o.item_id)
),
opt_agg AS (
  SELECT s.test_id, s.item_id,
         jsonb_agg(jsonb_build_object(
                     'option',    s.option,
                     'n',         s.n,
                     'share_pct', ROUND(s.n::numeric / NULLIF(s.tot, 0) * 100, 1),
                     'is_key',    s.is_key)
                   ORDER BY s.n DESC, s.option) AS distractors,
         MAX(s.key_option)        AS key_option,
         MAX(s.key_n)             AS key_n,
         MAX(s.top_distractor_n)  AS top_distractor_n
  FROM opt_sh s
  GROUP BY s.test_id, s.item_id
),
authored AS (
  SELECT q.id AS item_id, x.option
  FROM public.questions q
  CROSS JOIN LATERAL (
    VALUES ('A', q.answer_a), ('B', q.answer_b), ('C', q.answer_c),
           ('D', q.answer_d), ('E', q.answer_e)
  ) AS x(option, txt)
  WHERE NULLIF(btrim(x.txt), '') IS NOT NULL
),
dead AS (
  SELECT p.test_id, p.item_id,
         array_agg(a.option ORDER BY a.option) AS dead_options
  FROM per_item p
  JOIN authored a ON a.item_id = p.item_id
  LEFT JOIN keyed k ON k.item_id = p.item_id
  WHERE a.option IS DISTINCT FROM k.key_option
    AND NOT EXISTS (
      SELECT 1 FROM opt o
      WHERE o.item_id = a.item_id AND o.test_id = p.test_id AND o.option = a.option
    )
  GROUP BY p.test_id, p.item_id
),
skip_capable AS (
  SELECT EXISTS (
    SELECT 1 FROM reporting.fact_item_response WHERE is_skipped
  ) AS reliable
),
-- 088: one shared rule, so A1/T4 and the A15 check cannot disagree.
marking_capable AS (
  SELECT (SELECT disagreeing FROM reporting.marking_disagreement()) = 0 AS reliable
),
enriched AS (
  SELECT
    'ALL_TIME'::text                                   AS period_label,
    p.test_id, p.item_id,
    d.subject, d.topic,
    p.responses, p.students,
    (p.responses >= c.min_responses_per_item)          AS enough_evidence,
    CASE WHEN p.responses >= c.min_responses_per_item
         THEN ROUND(p.p_value, 3) END                  AS p_value,
    CASE WHEN p.responses >= c.min_responses_per_item
         THEN ROUND(p.point_biserial::numeric, 3) END  AS point_biserial,
    ROUND(p.median_time_seconds, 0)                    AS median_time_seconds,
    ROUND(p.skip_rate_pct, 1)                          AS skip_rate_pct,
    sk.reliable                                        AS skip_rate_reliable,
    mk.reliable                                        AS marking_reliable,
    ROUND(COALESCE(q.flag_count, 0)::numeric
            / NULLIF(p.responses, 0) * 100, 2)         AS item_flag_rate_pct,
    oa.key_option,
    COALESCE(oa.distractors, '[]'::jsonb)              AS distractors,
    -- 090: same floor as the statistics. Below it, "nobody chose this option" is
    -- an artefact of a small sample, not a finding about the item.
    CASE WHEN p.responses >= c.min_responses_per_item
         THEN COALESCE(dd.dead_options, '{}'::text[])
         ELSE '{}'::text[] END                         AS dead_distractors,
    CASE WHEN p.responses < c.min_responses_per_item THEN '{}'::text[]
         ELSE array_remove(ARRAY[
           CASE WHEN p.p_value < c.p_value_floor   THEN 'TOO_HARD' END,
           CASE WHEN p.p_value > c.p_value_ceiling THEN 'TOO_EASY' END,
           CASE WHEN p.point_biserial IS NOT NULL
                 AND p.point_biserial::numeric < c.point_biserial_min
                THEN 'NO_DISCRIMINATION' END,
           CASE WHEN COALESCE(dd.dead_options, '{}'::text[]) <> '{}'::text[]
                THEN 'DEAD_DISTRACTOR' END,
           CASE WHEN oa.top_distractor_n IS NOT NULL AND oa.key_n IS NOT NULL
                 AND oa.top_distractor_n > oa.key_n
                THEN 'KEY_BEATEN' END,
           CASE WHEN p.median_time_seconds > c.median_time_max_seconds
                THEN 'SLOW' END,
           CASE WHEN sk.reliable AND p.skip_rate_pct > c.skip_rate_max_pct
                THEN 'HIGH_SKIP' END
         ], NULL)
    END                                                AS defect_reasons
  FROM per_item p
  CROSS JOIN cfg c
  CROSS JOIN skip_capable sk
  CROSS JOIN marking_capable mk
  LEFT JOIN reporting.dim_item d ON d.item_id = p.item_id
  LEFT JOIN public.questions  q ON q.id      = p.item_id
  LEFT JOIN opt_agg oa ON oa.test_id = p.test_id AND oa.item_id = p.item_id
  LEFT JOIN dead    dd ON dd.test_id = p.test_id AND dd.item_id = p.item_id
)
SELECT e.period_label, e.test_id, e.item_id, e.subject, e.topic,
       e.responses, e.students, e.enough_evidence,
       e.p_value, e.point_biserial, e.median_time_seconds,
       e.skip_rate_pct, e.skip_rate_reliable, e.marking_reliable,
       e.item_flag_rate_pct,
       e.key_option, e.distractors, e.dead_distractors, e.defect_reasons,
       cardinality(e.defect_reasons) > 0 AS is_defective
FROM enriched e;
$function$
;

CREATE OR REPLACE FUNCTION reporting.load_attempt_facts(p_full boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'reporting', 'public'
AS $function$
DECLARE v_since timestamptz; v_rows integer;
BEGIN
  IF p_full THEN
    v_since := 'epoch'::timestamptz;
  ELSE
    SELECT high_water INTO v_since FROM reporting.etl_watermark
     WHERE object_name = 'fact_test_attempt';
    IF v_since IS NULL THEN v_since := now() - interval '90 days'; END IF;
  END IF;

  -- Refresh dim_test (Type 1 here: test metadata changes are rare and nothing
  -- downstream restates history by title or time limit yet).
  INSERT INTO reporting.dim_test
    (test_id, title, exam_type, year_level_min, year_level_max, time_limit_mins,
     is_free, content_status)
  SELECT t.id, t.title, t.exam_type::text, t.year_level_min::smallint,
         t.year_level_max::smallint, t.time_limit_mins::smallint, t.is_free,
         t.status::text
  FROM public.tests t
  WHERE NOT EXISTS (SELECT 1 FROM reporting.dim_test d
                    WHERE d.test_id = t.id AND d.is_current)
  ON CONFLICT DO NOTHING;

  INSERT INTO reporting.fact_test_attempt
    (attempt_id, date_key, student_id, test_id, status, score, raw_accuracy,
     weighted_score, duration_seconds, section_scores, started_at, submitted_at)
  SELECT a.id,
         to_char(a.started_at AT TIME ZONE 'Australia/Melbourne', 'YYYYMMDD')::int,
         a.student_id, a.test_id, a.status::text,
         a.score_out_of100, a.raw_accuracy, a.weighted_score, a.time_spent_seconds,
         a.section_scores, a.started_at, a.submitted_at
  FROM public.attempts a
  WHERE a.started_at >= v_since
  ON CONFLICT (attempt_id) DO UPDATE SET
    status           = EXCLUDED.status,
    score            = EXCLUDED.score,
    raw_accuracy     = EXCLUDED.raw_accuracy,
    weighted_score   = EXCLUDED.weighted_score,
    duration_seconds = EXCLUDED.duration_seconds,
    section_scores   = EXCLUDED.section_scores,
    submitted_at     = EXCLUDED.submitted_at;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  INSERT INTO reporting.etl_watermark (object_name, high_water)
  VALUES ('fact_test_attempt', now())
  ON CONFLICT (object_name) DO UPDATE
    SET high_water = EXCLUDED.high_water, updated_at = now();

  RETURN v_rows;
END; $function$
;

CREATE OR REPLACE FUNCTION reporting.load_enquiry_facts(p_full boolean DEFAULT true)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'reporting', 'public'
AS $function$
DECLARE
  v_rows integer;
BEGIN
  -- The argument exists for symmetry with the other loaders and is honoured as a
  -- no-op on purpose: there is no cheaper correct plan than the full pass, so an
  -- incremental call must not silently do something different. See the header.
  IF NOT p_full THEN
    RAISE NOTICE 'load_enquiry_facts: no incremental path exists; rebuilding in full, which is the only correct option for a mutable record';
  END IF;

  -- Truncate rather than delete-and-upsert: the table is rebuilt from
  -- public.enquiries in the same statement, so any row not in the source is gone
  -- by construction rather than by a NOT IN that has to be remembered. It also
  -- means the etl_loaded_at stamp is uniform across the table, so a reader can
  -- tell how old the whole snapshot is instead of reasoning about 20,000
  -- individual load times.
  TRUNCATE TABLE reporting.fact_enquiry;

  INSERT INTO reporting.fact_enquiry (
    enquiry_id, date_key, received_at, channel, enquiry_type, status, outcome,
    parent_user_id, utm_source, first_response_at, resolved_at, converted_at,
    converted_ref_kind, first_response_minutes, resolution_minutes,
    response_recorded, converted, due_at, sla_measurable, etl_loaded_at)
  SELECT
    e.id,
    to_char(e.received_at AT TIME ZONE 'Australia/Melbourne', 'YYYYMMDD')::int,
    e.received_at, e.channel, e.enquiry_type, e.status, e.outcome,
    e.parent_user_id, e.utm_source,
    e.first_response_at, e.resolved_at, e.converted_at, e.converted_ref_kind,
    -- EXTRACT(EPOCH ...) is SECONDS; the /60 is what makes the column name true.
    -- This exact unit error corrupted three *_minutes columns in Phase B and was
    -- caught only by hand-computing a fixture, so it is written once here.
    CASE WHEN e.first_response_at IS NULL THEN NULL
         ELSE (EXTRACT(EPOCH FROM (e.first_response_at - e.received_at)) / 60)::int END,
    -- Same rule as the queue: a resolution with no recorded response has an
    -- unknown middle, and inventing one from the two ends would fill the single
    -- most interesting gap in the report with the admin's click time.
    CASE WHEN e.resolved_at IS NULL OR e.first_response_at IS NULL THEN NULL
         ELSE (EXTRACT(EPOCH FROM (e.resolved_at - e.received_at)) / 60)::int END,
    (e.first_response_at IS NOT NULL),
    (e.converted_order_id IS NOT NULL OR e.converted_ref IS NOT NULL),
    d.due_at,
    (d.due_at IS NOT NULL),
    now()
  FROM public.enquiries e
  CROSS JOIN reporting.enquiry_thresholds th
  CROSS JOIN LATERAL (
    SELECT CASE
             WHEN th.sla_basis = 'business'
               THEN reporting.business_day_deadline(e.received_at)
             ELSE e.received_at + make_interval(mins => th.first_response_sla_minutes)
           END AS due_at
  ) d
  WHERE th.id = 1;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- Recorded so DA-15 (refresh lag) can see this object the same way it sees the
  -- materialised views; a fact table nobody refreshes is a silent lie too.
  INSERT INTO reporting.etl_watermark (object_name, high_water)
  VALUES ('fact_enquiry', now())
  ON CONFLICT (object_name) DO UPDATE
    SET high_water = EXCLUDED.high_water, updated_at = now();

  RETURN v_rows;
END;
$function$
;

CREATE OR REPLACE FUNCTION reporting.load_event_facts(p_full boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'reporting', 'public'
AS $function$
DECLARE v_since timestamptz; v_rows integer;
BEGIN
  IF p_full THEN v_since := 'epoch'::timestamptz;
  ELSE
    SELECT high_water INTO v_since FROM reporting.etl_watermark
     WHERE object_name = 'fact_event';
    IF v_since IS NULL THEN v_since := now() - interval '90 days'; END IF;
  END IF;

  INSERT INTO reporting.fact_event
    (event_id, date_key, hour_of_day, event_name, funnel_step, user_id, anonymous_id,
     student_id, utm_source, utm_medium, utm_campaign, device_class, path, props,
     occurred_at)
  SELECT fe.id,
         to_char(fe.created_at AT TIME ZONE 'Australia/Melbourne','YYYYMMDD')::int,
         EXTRACT(HOUR FROM fe.created_at AT TIME ZONE 'Australia/Melbourne')::smallint,
         fe.event, fe.stage, fe.user_id, fe.anonymous_id, fe.student_id,
         fe.utm ->> 'source', fe.utm ->> 'medium', fe.utm ->> 'campaign',
         -- funnel_events has no device column (CRO requirement C9). Derived
         -- server-side by /api/events going forward; historical rows are
         -- 'unknown' rather than guessed.
         COALESCE(fe.props ->> 'device', 'unknown'),
         fe.path, fe.props, fe.created_at
  FROM public.funnel_events fe
  WHERE fe.created_at >= v_since
  ON CONFLICT (event_id) DO NOTHING;   -- append-only: an event is never rewritten

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  INSERT INTO reporting.etl_watermark (object_name, high_water)
  VALUES ('fact_event', now())
  ON CONFLICT (object_name) DO UPDATE SET high_water = EXCLUDED.high_water, updated_at = now();
  RETURN v_rows;
END; $function$
;

CREATE OR REPLACE FUNCTION reporting.load_response_facts(p_full boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'reporting', 'public'
AS $function$
DECLARE v_since timestamptz; v_rows integer; v_pruned integer := 0;
BEGIN
  IF p_full THEN
    v_since := 'epoch'::timestamptz;

    -- 091: reconcile deletions. A full reload asserts "the fact table matches the
    -- source", so rows with no surviving source response must go. Done BEFORE the
    -- upsert so the reported row count is the number loaded, not loaded-minus-pruned.
    DELETE FROM reporting.fact_item_response f
    WHERE NOT EXISTS (
      SELECT 1 FROM public.responses r
      WHERE r.attempt_id = f.attempt_id
        AND r.question_id = f.item_id
    );
    GET DIAGNOSTICS v_pruned = ROW_COUNT;
    IF v_pruned > 0 THEN
      RAISE NOTICE 'load_response_facts: pruned % orphaned fact rows', v_pruned;
    END IF;
  ELSE
    SELECT high_water INTO v_since FROM reporting.etl_watermark
     WHERE object_name = 'fact_item_response';
    IF v_since IS NULL THEN v_since := now() - interval '90 days'; END IF;
  END IF;

  INSERT INTO reporting.dim_item
    (item_id, item_type, subject, topic, sub_topic, exam_section, year_level,
     exam_type, authored_difficulty, difficulty_dynamic, discrimination_index,
     content_status, is_active)
  SELECT q.id, q.type::text, q.subject, q.topic, q.sub_topic, q.exam_section,
         q.year_level::smallint, q.exam_type::text, q.difficulty::smallint,
         q.difficulty_dynamic, q.discrimination_index, q.status::text,
         COALESCE(q.is_active, true)
  FROM public.questions q
  ON CONFLICT (item_id) DO UPDATE SET
    item_type = EXCLUDED.item_type, subject = EXCLUDED.subject, topic = EXCLUDED.topic,
    sub_topic = EXCLUDED.sub_topic, exam_section = EXCLUDED.exam_section,
    year_level = EXCLUDED.year_level, exam_type = EXCLUDED.exam_type,
    authored_difficulty = EXCLUDED.authored_difficulty,
    difficulty_dynamic = EXCLUDED.difficulty_dynamic,
    discrimination_index = EXCLUDED.discrimination_index,
    content_status = EXCLUDED.content_status, is_active = EXCLUDED.is_active,
    etl_loaded_at = now();

  -- date_key and student_id come from the parent attempt, not the response:
  -- a response has no timestamp of its own, and attributing it to the attempt's
  -- Melbourne-local day keeps it on the same day as the attempt (test DA-14).
  INSERT INTO reporting.fact_item_response
    (attempt_id, date_key, student_id, item_id, test_id, is_correct, is_skipped,
     answer_option, time_spent_seconds, section_name)
  SELECT r.attempt_id,
         to_char(a.started_at AT TIME ZONE 'Australia/Melbourne','YYYYMMDD')::int,
         a.student_id, r.question_id, a.test_id,
         COALESCE(r.is_correct, false),
         (r.answer IS NULL),
         r.answer,
         COALESCE(r.time_spent_seconds, 0),
         r.section_name
  FROM public.responses r
  JOIN public.attempts a ON a.id = r.attempt_id
  WHERE a.started_at >= v_since
  ON CONFLICT (attempt_id, item_id) DO UPDATE SET
    is_correct = EXCLUDED.is_correct, is_skipped = EXCLUDED.is_skipped,
    answer_option = EXCLUDED.answer_option,
    time_spent_seconds = EXCLUDED.time_spent_seconds,
    section_name = EXCLUDED.section_name;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  INSERT INTO reporting.etl_watermark (object_name, high_water)
  VALUES ('fact_item_response', now())
  ON CONFLICT (object_name) DO UPDATE SET high_water = EXCLUDED.high_water, updated_at = now();
  RETURN v_rows;
END;
$function$
;

CREATE OR REPLACE FUNCTION reporting.load_skill_areas()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'reporting', 'public'
AS $function$
DECLARE v_rows integer;
BEGIN
  INSERT INTO reporting.dim_skill_area (subject, topic, sub_topic)
  SELECT DISTINCT di.subject, di.topic, COALESCE(NULLIF(di.sub_topic,''), '(unspecified)')
  FROM reporting.dim_item di
  WHERE di.subject IS NOT NULL AND di.subject <> ''
    AND di.topic   IS NOT NULL AND di.topic   <> ''
  ON CONFLICT (subject, topic, sub_topic) DO NOTHING;

  UPDATE reporting.dim_skill_area sa
     SET item_count = sub.n
  FROM (
    SELECT di.subject, di.topic,
           COALESCE(NULLIF(di.sub_topic,''), '(unspecified)') AS sub_topic,
           COUNT(*)::integer AS n
    FROM reporting.dim_item di
    WHERE di.subject IS NOT NULL AND di.topic IS NOT NULL
    GROUP BY 1,2,3
  ) sub
  WHERE sa.subject = sub.subject AND sa.topic = sub.topic AND sa.sub_topic = sub.sub_topic;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END; $function$
;

CREATE OR REPLACE FUNCTION reporting.load_student_dims()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'reporting', 'public'
AS $function$
DECLARE v_today date := (now() AT TIME ZONE 'Australia/Melbourne')::date;
BEGIN
  -- SCD Type 2 on year_level: a Year 3 attempt stays a Year 3 attempt forever.
  UPDATE reporting.dim_student ds SET valid_to = v_today - 1, is_current = false
  FROM public.student_profiles sp
  WHERE sp.id = ds.student_id AND ds.is_current AND ds.year_level <> sp.year_level;

  INSERT INTO reporting.dim_student (student_id, pseudonym, year_level, valid_from)
  SELECT sp.id, sp.username, sp.year_level::smallint, v_today
  FROM public.student_profiles sp
  WHERE NOT EXISTS (SELECT 1 FROM reporting.dim_student d
    WHERE d.student_id = sp.id AND d.is_current AND d.year_level = sp.year_level);

  UPDATE reporting.dim_practice_plan dp SET valid_to = v_today - 1, is_current = false
  FROM public.student_exam_targets t
  WHERE t.student_id = dp.student_id AND dp.is_current
    AND (dp.exam_date IS DISTINCT FROM t.exam_date
      OR dp.target_exam IS DISTINCT FROM t.target_exam
      OR dp.weekly_sessions_goal <> t.weekly_sessions_goal);

  -- NEW (migration 037): retire plans whose source row no longer exists.
  -- The update above cannot see these, because it joins to the very table the
  -- row was deleted from. Without this, a deleted plan stays current forever.
  UPDATE reporting.dim_practice_plan dp
     SET valid_to = v_today - 1, is_current = false
   WHERE dp.is_current
     AND NOT EXISTS (
       SELECT 1 FROM public.student_exam_targets t
       WHERE t.student_id = dp.student_id
     );

  INSERT INTO reporting.dim_practice_plan
    (student_id, target_exam, exam_date, total_planned_units, unit_kind,
     weekly_sessions_goal, valid_from)
  SELECT t.student_id, t.target_exam, t.exam_date, 0, 'tests',
         t.weekly_sessions_goal::smallint, v_today
  FROM public.student_exam_targets t
  WHERE NOT EXISTS (SELECT 1 FROM reporting.dim_practice_plan p
    WHERE p.student_id = t.student_id AND p.is_current
      AND p.exam_date IS NOT DISTINCT FROM t.exam_date
      AND p.target_exam IS NOT DISTINCT FROM t.target_exam
      AND p.weekly_sessions_goal = t.weekly_sessions_goal);

  UPDATE reporting.dim_practice_plan dp SET student_key = ds.student_key
  FROM reporting.dim_student ds
  WHERE ds.student_id = dp.student_id AND ds.is_current AND dp.student_key IS NULL;

  -- No UI sets total_planned_units yet. Derive one planned session per week of the
  -- parent's weekly goal so the daily target is not permanently 0.
  UPDATE reporting.dim_practice_plan dp
     SET total_planned_units = GREATEST(0, CEIL(
           (dp.exam_date - v_today)::numeric / 7 * dp.weekly_sessions_goal)::int)
   WHERE dp.is_current AND dp.exam_date IS NOT NULL AND dp.total_planned_units = 0;
END;
$function$
;

CREATE OR REPLACE FUNCTION reporting.marking_disagreement()
 RETURNS TABLE(disagreeing bigint, total bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
  -- Letter-keyed items only. A free-text key is marked by regex in the real
  -- scoring path (src/lib/scoring/score-attempt.ts), so comparing strings here
  -- would report false disagreements rather than real ones.
  SELECT COUNT(*) FILTER (
           WHERE r.is_correct IS DISTINCT FROM ((r.answer #>> '{}') = q.correct_answer)
         )::bigint AS disagreeing,
         COUNT(*)::bigint AS total
  FROM public.responses r
  JOIN public.questions q ON q.id = r.question_id
  WHERE q.correct_answer ~ '^[A-E]$';
$function$
;

CREATE OR REPLACE FUNCTION reporting.net_ex_gst(p_gross_cents bigint, p_product_key text)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public'
AS $function$
DECLARE
  v_treatment text;
  v_rate      numeric;
BEGIN
  SELECT tax_treatment, gst_rate_percent
    INTO v_treatment, v_rate
  FROM reporting.product_tax_treatment
  WHERE product_key = p_product_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no declared tax treatment for product_key %', p_product_key
      USING ERRCODE = '22023';
  END IF;

  IF v_treatment = 'free' THEN
    RETURN p_gross_cents;
  END IF;

  -- Both 'inclusive' and 'exclusive' receive a GST-bearing gross figure here,
  -- so the divisor is the same. They differ in how the price is DISPLAYED, not
  -- in how net is recovered from a charge total.
  RETURN ROUND(p_gross_cents / (1 + v_rate / 100.0))::bigint;
END;
$function$
;

CREATE OR REPLACE FUNCTION reporting.newcombe_diff_bounds(p_successes1 bigint, p_trials1 bigint, p_successes2 bigint, p_trials2 bigint, p_z numeric DEFAULT 1.959963985)
 RETURNS numeric[]
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
DECLARE
  b1 numeric[];
  b2 numeric[];
  p1 numeric;
  p2 numeric;
  diff numeric;
BEGIN
  IF COALESCE(p_trials1, 0) <= 0 OR COALESCE(p_trials2, 0) <= 0 THEN
    RETURN ARRAY[NULL::numeric, NULL::numeric];
  END IF;

  b1 := reporting.wilson_bounds(p_successes1, p_trials1, p_z);
  b2 := reporting.wilson_bounds(p_successes2, p_trials2, p_z);
  p1 := COALESCE(p_successes1, 0)::numeric / p_trials1::numeric;
  p2 := COALESCE(p_successes2, 0)::numeric / p_trials2::numeric;
  diff := p1 - p2;

  -- Newcombe method 10: the lower bound borrows the variant's own lower error
  -- and the control's upper error, and vice versa. Applying a Wald formula to
  -- the difference instead would lose Wilson's boundary behaviour.
  RETURN ARRAY[
    diff - sqrt(power(p1 - b1[1], 2) + power(b2[2] - p2, 2)),
    diff + sqrt(power(b1[2] - p1, 2) + power(p2 - b2[1], 2))
  ];
END;
$function$
;

CREATE OR REPLACE FUNCTION reporting.normal_cdf(p_x numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
DECLARE
  x numeric := abs(p_x);
  t numeric;
  pdf numeric;
  tail numeric;
BEGIN
  IF p_x IS NULL THEN RETURN NULL; END IF;

  t := 1.0 / (1.0 + 0.2316419 * x);
  pdf := exp(-x * x / 2.0) / sqrt(2.0 * pi());
  tail := pdf * (0.319381530 * t
                 - 0.356563782 * power(t, 2)
                 + 1.781477937 * power(t, 3)
                 - 1.821255978 * power(t, 4)
                 + 1.330274429 * power(t, 5));

  -- The approximation is for the upper tail of a non-negative argument;
  -- symmetry gives the negative side.
  IF p_x >= 0 THEN
    RETURN 1.0 - tail;
  END IF;
  RETURN tail;
END;
$function$
;

CREATE OR REPLACE FUNCTION reporting.percentile_from_scores(p_score numeric, p_scores numeric[])
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT CASE
    WHEN p_score IS NULL OR p_scores IS NULL OR cardinality(p_scores) = 0 THEN NULL
    ELSE 100.0 * (COUNT(*) FILTER (WHERE s < p_score)
                + 0.5 * COUNT(*) FILTER (WHERE s = p_score))
         / cardinality(p_scores)
  END
  FROM unnest(p_scores) AS s;
$function$
;

CREATE OR REPLACE FUNCTION reporting.recommendations_scored(p_student_id uuid)
 RETURNS TABLE(recommendation_rank integer, subject text, topic text, items_answered bigint, accuracy_pct numeric, expected_impact_score numeric, reason text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
  WITH g AS (
    SELECT *
    FROM reporting.mv_skill_gap
    WHERE student_id = p_student_id
      -- An untagged topic cannot be practised: there is nothing to point the
      -- parent or tutor at. Surfacing "(untagged)" as a recommendation would be
      -- an instruction with no referent.
      AND subject <> '(untagged)'
      AND topic   <> '(untagged)'
  ),
  scored AS (
    SELECT
      g.subject, g.topic, g.items_answered, g.accuracy_pct,
      -- Headroom weighted by evidence volume. LN damps the volume term so
      -- 200 questions at 60% does not outrank 30 questions at 25%: the
      -- second is the weaker skill and the better use of this week.
      ((100 - g.accuracy_pct) * LN(1 + g.items_answered))::numeric
        AS expected_impact_score
    FROM g
    -- Below five responses there is no signal, only noise. A single missed
    -- question would otherwise produce a 0% "gap" and top the list.
    WHERE g.items_answered >= 5
  )
  SELECT
    ROW_NUMBER() OVER (ORDER BY s.expected_impact_score DESC)::integer
        AS recommendation_rank,
    s.subject, s.topic, s.items_answered, s.accuracy_pct,
    ROUND(s.expected_impact_score, 1) AS expected_impact_score,
    format('Got %s%% right in %s (%s) across %s questions.',
           s.accuracy_pct, s.topic, s.subject, s.items_answered) AS reason
  FROM scored s
  ORDER BY s.expected_impact_score DESC
  -- B12: at most three recommendations. Enforced in SQL so no client,
  -- present or future, can render a fourth.
  LIMIT 3;
$function$
;

CREATE OR REPLACE FUNCTION reporting.refresh_student_now()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'reporting', 'public'
AS $function$
BEGIN
  SET LOCAL statement_timeout = '30s';
  SET LOCAL lock_timeout = '5s';
  -- Non-concurrent: these MVs are tiny at launch volume, and a concurrent refresh
  -- takes a stronger lock path for no benefit at this size.
  EXECUTE 'REFRESH MATERIALIZED VIEW reporting.mv_student_countdown';
  EXECUTE 'REFRESH MATERIALIZED VIEW reporting.mv_student_daily_target';
  INSERT INTO reporting.refresh_log (object_name, ran_concurrently, status, finished_at)
  VALUES ('mv_student_countdown+daily_target (on demand)', false, 'ok', clock_timestamp());
END;
$function$
;

CREATE OR REPLACE FUNCTION reporting.safe_refresh(p_object regclass, p_concurrently boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'reporting', 'public'
AS $function$
DECLARE
  v_id      bigint;
  v_started timestamptz := clock_timestamp();
  v_relname text;
BEGIN
  SET LOCAL statement_timeout = '10min';
  SET LOCAL lock_timeout = '30s';

  -- Resolve the bare relation name from the catalog rather than comparing
  -- p_object::text. regclass output omits the schema when it is on search_path,
  -- so a text comparison would silently change meaning with search_path - the
  -- same class of bug migration 033 fixed in the refresh-lag check.
  SELECT c.relname INTO v_relname FROM pg_class c WHERE c.oid = p_object;

  IF reporting.in_blackout()
     AND NOT EXISTS (
       SELECT 1 FROM reporting.refresh_blackout_exempt e WHERE e.object_name = v_relname
     ) THEN
    INSERT INTO reporting.refresh_log (object_name, ran_concurrently, status, finished_at)
    VALUES (p_object::text, p_concurrently, 'skipped_blackout', clock_timestamp());
    RETURN;
  END IF;

  INSERT INTO reporting.refresh_log (object_name, ran_concurrently)
  VALUES (p_object::text, p_concurrently) RETURNING refresh_id INTO v_id;
  BEGIN
    IF p_concurrently THEN
      EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY %s', p_object::text);
    ELSE
      EXECUTE format('REFRESH MATERIALIZED VIEW %s', p_object::text);
    END IF;
    UPDATE reporting.refresh_log SET finished_at = clock_timestamp(),
      duration_ms = EXTRACT(EPOCH FROM clock_timestamp() - v_started)*1000, status='ok'
    WHERE refresh_id = v_id;
  EXCEPTION WHEN OTHERS THEN
    UPDATE reporting.refresh_log SET finished_at = clock_timestamp(), status='failed',
      error_text = SQLERRM WHERE refresh_id = v_id;
    RAISE;   -- re-raise so pg_cron records it and alert AL-28 fires
  END;
END; $function$
;

CREATE OR REPLACE FUNCTION reporting.snapshot_data_quality()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'reporting', 'public'
AS $function$
DECLARE v_rows integer;
BEGIN
  INSERT INTO reporting.data_quality_history
    (check_date, check_name, object_name, metric_value, threshold, status, detail, recorded_at)
  SELECT q.check_date, q.check_name, q.object_name, q.metric_value,
         q.threshold, q.status, q.detail, now()
  FROM reporting.mv_data_quality q
  ON CONFLICT (check_date, check_name, object_name) DO UPDATE SET
    metric_value = EXCLUDED.metric_value,
    threshold    = EXCLUDED.threshold,
    status       = EXCLUDED.status,
    detail       = EXCLUDED.detail,
    recorded_at  = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$function$
;

CREATE OR REPLACE FUNCTION reporting.student_today(p_student_id uuid)
 RETURNS TABLE(student_id uuid, exam_label text, exam_date date, days_to_exam integer, exam_passed boolean, daily_target_units integer, unit_kind text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public'
AS $function$
BEGIN
  -- Authorisation: the caller must be this student, a linked parent, or an admin.
  -- Checked here as well as in the view, so the two layers cannot both be wrong.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT (public.is_student_self(p_student_id)
          OR public.is_parent_of(p_student_id)
          OR public.has_role('ADMIN')) THEN
    RAISE EXCEPTION 'not authorised for this student';
  END IF;

  RETURN QUERY
  SELECT v.student_id,
         v.exam_label,
         v.exam_date,
         v.days_to_exam,
         v.exam_passed,
         v.daily_target_units,
         v.unit_kind
  FROM reporting.v_student_today v
  WHERE v.student_id = p_student_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION reporting.two_proportion_p_value(p_successes1 bigint, p_trials1 bigint, p_successes2 bigint, p_trials2 bigint)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
DECLARE
  n1 numeric; n2 numeric;
  p1 numeric; p2 numeric;
  pooled numeric;
  se numeric;
  z numeric;
BEGIN
  IF COALESCE(p_trials1, 0) <= 0 OR COALESCE(p_trials2, 0) <= 0 THEN
    RETURN NULL;
  END IF;

  n1 := p_trials1::numeric; n2 := p_trials2::numeric;
  p1 := COALESCE(p_successes1, 0)::numeric / n1;
  p2 := COALESCE(p_successes2, 0)::numeric / n2;

  pooled := (COALESCE(p_successes1, 0) + COALESCE(p_successes2, 0))::numeric / (n1 + n2);
  se := sqrt(pooled * (1.0 - pooled) * (1.0 / n1 + 1.0 / n2));

  -- Zero variance means both arms are identical and degenerate (both 0% or both
  -- 100%). There is no evidence of a difference, so p = 1 - not NULL, which a
  -- reader would interpret as "not computed".
  IF se = 0 THEN
    RETURN 1.0;
  END IF;

  z := (p1 - p2) / se;
  RETURN LEAST(1.0, GREATEST(0.0, 2.0 * (1.0 - reporting.normal_cdf(abs(z)))));
END;
$function$
;

CREATE OR REPLACE FUNCTION reporting.wilson_bounds(p_successes bigint, p_trials bigint, p_z numeric DEFAULT 1.959963985)
 RETURNS numeric[]
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
DECLARE
  n numeric;
  p numeric;
  z2 numeric;
  denom numeric;
  centre numeric;
  half numeric;
BEGIN
  IF p_trials IS NULL OR p_trials <= 0 THEN
    RETURN ARRAY[NULL::numeric, NULL::numeric];
  END IF;

  n := p_trials::numeric;
  p := COALESCE(p_successes, 0)::numeric / n;
  z2 := p_z * p_z;
  denom := 1.0 + z2 / n;

  centre := (p + z2 / (2.0 * n)) / denom;
  half := (p_z / denom) * sqrt(p * (1.0 - p) / n + z2 / (4.0 * n * n));

  -- Clamped: the algebra can drift a hair outside [0,1] at the boundaries, and
  -- a conversion rate of -0.3% is not a thing a reader should ever see.
  RETURN ARRAY[GREATEST(0.0, centre - half), LEAST(1.0, centre + half)];
END;
$function$
;

