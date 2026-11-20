-- ============================================================================
-- 112 - A13 tracker RPCs (backlog item 21, Phase C)
--
-- WHY FUNCTIONS AND NOT A VIEW THE API QUERIES DIRECTLY
--   reporting.* is RLS-enabled and FORCED with no policy, so an app role reading
--   it directly gets zero rows and no error. Every report in this schema is
--   reached through a SECURITY DEFINER function that checks ADMIN first, and A13
--   is no different. The alternative - a policy - would open the whole warehouse
--   to the browser role to solve one screen's problem.
--
-- THREE CONFIG COLUMNS THAT EXISTED BUT WERE READ BY NOTHING
--   `resolution_sla_hours`, `min_enquiries_for_rate` and
--   `conversion_attribution_days` were all created by 104 and consulted by
--   nothing - the same defect 109 found in `sla_basis`, where a setting could be
--   changed with no effect anywhere and a green suite would not notice. They are
--   load-bearing here:
--     * resolution_sla_hours   -> resolution_over_sla, the second SLA the promise
--                                 implies but that nothing was measuring.
--     * min_enquiries_for_rate -> rate_is_reportable. A breach rate from four
--                                 enquiries is noise presented as a trend, and the
--                                 panel must be able to say "not yet" rather than
--                                 print 25.0%.
--     * conversion_attribution_days -> the conversion window. Conversions are
--                                 recorded, not inferred, but a reference typed
--                                 against the wrong enquiry should not count as a
--                                 conversion months after the conversation.
--   The standing rule from this work: a column in a config singleton is only
--   allowed if something reads it.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The headline row
-- ----------------------------------------------------------------------------
-- DROP before CREATE: the return type gains sla_minutes, and Postgres refuses to
-- change the return type of an existing function (42P13).
DROP FUNCTION IF EXISTS public.admin_enquiry_summary(integer, text, text);

CREATE FUNCTION public.admin_enquiry_summary(
  p_days    integer DEFAULT 90,
  p_channel text    DEFAULT NULL,
  p_type    text    DEFAULT NULL
)
RETURNS TABLE(
  window_days            integer,
  enquiries              bigint,
  sla_met                bigint,
  sla_breached           bigint,
  sla_at_risk            bigint,
  sla_within             bigint,
  sla_unmeasurable       bigint,
  response_unrecorded    bigint,
  response_recorded      bigint,
  sla_breach_rate        numeric,
  rate_is_reportable     boolean,
  min_enquiries_for_rate integer,
  resolution_over_sla    bigint,
  resolution_sla_hours   integer,
  -- Each window is reported only under the basis that uses it, exactly as
  -- admin_enquiry_queue does. Returning both would invite a reader to divide an
  -- age in minutes by a window measured in business days.
  sla_minutes            integer,
  first_response_hours_median numeric,
  resolution_hours_median     numeric,
  converted              bigint,
  conversion_rate        numeric,
  conversion_window_days integer,
  sla_basis              text,
  sla_business_days      integer,
  sla_is_confirmed       boolean,
  refreshed_at           timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $s$
DECLARE
  th reporting.enquiry_thresholds%ROWTYPE;
BEGIN
  IF NOT public.has_role('ADMIN') THEN
    RETURN;
  END IF;

  IF p_days IS NULL OR p_days < 1 OR p_days > 3650 THEN
    RAISE EXCEPTION 'p_days must be between 1 and 3650' USING ERRCODE = '22023';
  END IF;
  IF p_channel IS NOT NULL AND p_channel NOT IN ('web_form','email','chat') THEN
    RAISE EXCEPTION 'unknown enquiry channel: %', p_channel USING ERRCODE = '22023';
  END IF;
  IF p_type IS NOT NULL AND p_type NOT IN (
       'billing','technical','privacy','accessibility','product_question',
       'refund','complaint','other') THEN
    RAISE EXCEPTION 'unknown enquiry type: %', p_type USING ERRCODE = '22023';
  END IF;

  SELECT * INTO th FROM reporting.enquiry_thresholds WHERE id = 1;

  RETURN QUERY
  WITH scoped AS (
    SELECT
      f.*,
      CASE
        WHEN NOT f.sla_measurable THEN 'unmeasurable'
        WHEN f.status IN ('resolved','closed') AND NOT f.response_recorded
          THEN 'unrecorded'
        WHEN f.response_recorded
          THEN CASE WHEN f.first_response_at <= f.due_at THEN 'met' ELSE 'breached' END
        WHEN now() > f.due_at THEN 'breached'
        WHEN now() > f.received_at + ((f.due_at - f.received_at) * 0.75) THEN 'at_risk'
        ELSE 'within'
      END AS sla_state,
      -- A resolution that never happened has no duration to breach with, so this
      -- stays NULL rather than "still open, therefore late".
      CASE WHEN f.resolution_minutes IS NULL THEN NULL
           ELSE f.resolution_minutes > th.resolution_sla_hours * 60 END AS resolution_over
    FROM reporting.fact_enquiry f
    -- Windowed on the receipt DAY, not a rolling timestamp, so that this function
    -- and admin_enquiry_series describe exactly the same period. Keying one on
    -- now() - 90 days and the other on date - 90 would silently disagree by up to a
    -- day, and the two figures are read side by side on one screen.
    WHERE f.date_key >= to_char(
              ((now() AT TIME ZONE 'Australia/Melbourne')::date - p_days), 'YYYYMMDD')::int
      AND (p_channel IS NULL OR f.channel = p_channel)
      AND (p_type    IS NULL OR f.enquiry_type = p_type)
  ),
  agg AS (
    SELECT
      COUNT(*) AS n,
      COUNT(*) FILTER (WHERE s.sla_state = 'met')::bigint          AS met,
      COUNT(*) FILTER (WHERE s.sla_state = 'breached')::bigint     AS breached,
      COUNT(*) FILTER (WHERE s.sla_state = 'at_risk')::bigint      AS at_risk,
      COUNT(*) FILTER (WHERE s.sla_state = 'within')::bigint       AS within,
      COUNT(*) FILTER (WHERE s.sla_state = 'unmeasurable')::bigint AS unmeasurable,
      COUNT(*) FILTER (WHERE s.sla_state = 'unrecorded')::bigint   AS unrecorded,
      COUNT(*) FILTER (WHERE s.response_recorded)::bigint          AS recorded,
      ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY s.first_response_minutes))::numeric / 60, 2)
        AS fr_median,
      ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY s.resolution_minutes))::numeric / 60, 2)
        AS res_median,
      COUNT(*) FILTER (WHERE s.resolution_over)::bigint            AS over_sla,
      -- Counted only when the conversion actually landed inside the attribution
      -- window, so a reference typed against an unrelated old enquiry cannot
      -- inflate the number.
      COUNT(*) FILTER (WHERE s.converted
                         AND s.converted_at IS NOT NULL
                         AND s.converted_at >= s.received_at
                         AND s.converted_at <= s.received_at
                             + make_interval(days => th.conversion_attribution_days))::bigint
        AS conv
    FROM scoped s
  )
  SELECT
    p_days,
    a.n::bigint,
    a.met, a.breached, a.at_risk, a.within, a.unmeasurable, a.unrecorded, a.recorded,
    -- The denominator is enquiries with a measurable verdict, NOT all enquiries.
    -- Dividing by the total would let a gap in the holiday calendar improve the
    -- reported score, which is movement that looks like an improvement and is not
    -- one. Unmeasurable rows are returned separately for exactly that reason.
    CASE WHEN (a.met + a.breached) = 0 THEN NULL
         ELSE ROUND(a.breached::numeric / (a.met + a.breached) * 100, 1) END,
    (a.met + a.breached) >= th.min_enquiries_for_rate,
    th.min_enquiries_for_rate,
    a.over_sla,
    th.resolution_sla_hours,
    CASE WHEN th.sla_basis = 'calendar' THEN th.first_response_sla_minutes END,
    a.fr_median,
    a.res_median,
    a.conv,
    CASE WHEN a.n = 0 THEN NULL
         ELSE ROUND(a.conv::numeric / a.n * 100, 1) END,
    th.conversion_attribution_days,
    th.sla_basis,
    th.first_response_sla_business_days,
    th.sla_is_confirmed,
    (SELECT MAX(f.etl_loaded_at) FROM reporting.fact_enquiry f)
  FROM agg a;
END;
$s$;

REVOKE ALL ON FUNCTION public.admin_enquiry_summary(integer, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_enquiry_summary(integer, text, text)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. The daily series
-- ----------------------------------------------------------------------------
-- One row per receipt-day, already the A13 grain minus the type/status split, which
-- the panel filters on rather than re-deriving. Served from the materialised view
-- so the chart and the headline cannot disagree about the same period: both read
-- reporting.mv_enquiry_daily, which is the only place the verdict is computed.
CREATE OR REPLACE FUNCTION public.admin_enquiry_series(
  p_days    integer DEFAULT 90,
  p_channel text    DEFAULT NULL,
  p_type    text    DEFAULT NULL
)
RETURNS TABLE(
  date_key             integer,
  the_date             date,
  enquiries            bigint,
  sla_met              bigint,
  sla_breached         bigint,
  response_unrecorded  bigint,
  sla_unmeasurable     bigint,
  first_response_hours_median numeric,
  converted            bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $ser$
  SELECT
    m.date_key,
    m.the_date,
    SUM(m.enquiries)::bigint,
    SUM(m.sla_met)::bigint,
    SUM(m.sla_breached)::bigint,
    SUM(m.response_unrecorded)::bigint,
    SUM(m.sla_unmeasurable)::bigint,
    -- A median of medians is not a median. The daily view already holds the
    -- per-grain median; re-deriving the true figure would need the underlying
    -- rows, so this column is explicitly the midpoint of the day's group medians
    -- and the panel labels it as such rather than presenting it as the day's
    -- median response time.
    ROUND(AVG(m.first_response_hours_median)::numeric, 2),
    SUM(m.converted)::bigint
  FROM reporting.mv_enquiry_daily m
  -- Windowed on date_key, not the_date: the_date is nullable now that the view
  -- left-joins dim_date, and `NULL >= anything` is NULL, which would drop exactly
  -- the out-of-range rows the LEFT JOIN was added to keep. Same expression as the
  -- summary uses, so the two windows cannot drift.
  WHERE m.date_key >= to_char(
            ((now() AT TIME ZONE 'Australia/Melbourne')::date - p_days), 'YYYYMMDD')::int
    AND (p_channel IS NULL OR m.channel = p_channel)
    AND (p_type    IS NULL OR m.enquiry_type = p_type)
    AND public.has_role('ADMIN')
  GROUP BY m.date_key, m.the_date
  ORDER BY m.date_key
$ser$;

REVOKE ALL ON FUNCTION public.admin_enquiry_series(integer, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_enquiry_series(integer, text, text)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Self-check at apply time
-- ----------------------------------------------------------------------------
-- The functions above return zero rows to a non-admin, and zero rows is also what
-- a broken query returns, so "it ran" proves nothing. This exercises the shapes
-- with a real admin identity and asserts the properties that matter.
--
-- Refresh first: a scheduled load could have run between 111 and 112, and a
-- consistency check against a stale view would fail for a reason that has nothing
-- to do with the code under test.
SELECT reporting.load_enquiry_facts(true);
REFRESH MATERIALIZED VIEW reporting.mv_enquiry_daily;

DO $$
DECLARE
  v_row    record;
  v_sum    bigint;
  v_uid    uuid;
  v_series bigint;
BEGIN
  SELECT user_id INTO v_uid FROM public.app_user_roles WHERE role = 'ADMIN' LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '112 self-test: no ADMIN user exists to exercise the tracker';
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);

  FOR v_row IN SELECT * FROM public.admin_enquiry_summary(90, NULL, NULL) LOOP
    -- Verdict buckets must partition the window exactly. If they overlapped, the
    -- breach rate's denominator would be fiction; if they missed rows, an enquiry
    -- would silently stop being counted at all.
    IF v_row.sla_met + v_row.sla_breached + v_row.response_unrecorded
       + v_row.sla_at_risk + v_row.sla_within + v_row.sla_unmeasurable
       <> v_row.enquiries THEN
      RAISE EXCEPTION
        '112 self-test: SLA verdicts do not partition the window (% + % + % + % + % + % vs % rows)',
        v_row.sla_met, v_row.sla_breached, v_row.response_unrecorded,
        v_row.sla_at_risk, v_row.sla_within, v_row.sla_unmeasurable, v_row.enquiries
        USING ERRCODE = 'raise_exception';
    END IF;

    -- An empty window must yield a NULL rate, never 0%. Zero reads as "we never
    -- miss a deadline" and is the most misleading thing this report can say.
    IF v_row.enquiries = 0 AND v_row.sla_breach_rate IS NOT NULL THEN
      RAISE EXCEPTION '112 self-test: an empty window reported a breach rate of %',
        v_row.sla_breach_rate USING ERRCODE = 'raise_exception';
    END IF;

    IF v_row.enquiries < v_row.min_enquiries_for_rate AND v_row.rate_is_reportable THEN
      RAISE EXCEPTION '112 self-test: rate marked reportable on n=% (floor %)',
        v_row.enquiries, v_row.min_enquiries_for_rate USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;

  -- The headline and the chart must agree, because they are computed from the same
  -- rows by different code paths. Any drift between them means one is wrong, and
  -- there is no way for a reader to tell which - so the disagreement is asserted
  -- away rather than left to be noticed on a slide.
  SELECT COALESCE(SUM(s.enquiries), 0) INTO v_series
  FROM public.admin_enquiry_series(90, NULL, NULL) s;

  SELECT a.enquiries INTO v_sum FROM public.admin_enquiry_summary(90, NULL, NULL) a;

  IF v_series IS DISTINCT FROM v_sum THEN
    RAISE EXCEPTION
      '112 self-test: series totals % enquiries but the summary reports %',
      v_series, v_sum
      USING ERRCODE = 'raise_exception';
  END IF;
END $$;
