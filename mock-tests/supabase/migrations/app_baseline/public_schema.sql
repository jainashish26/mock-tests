--
-- PostgreSQL database dump
--

\restrict ole5dk7EtKu1pPuWRJKPxgO988Iuyh3AvFgy8XLzYykuW8T9jPGPdrfxPmzbfRc

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.12

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: attempt_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.attempt_status AS ENUM (
    'IN_PROGRESS',
    'SUBMITTED',
    'WRITING_PENDING',
    'COMPLETE'
);


--
-- Name: content_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.content_status AS ENUM (
    'DRAFT',
    'PENDING_APPROVAL',
    'PUBLISHED',
    'ARCHIVED'
);


--
-- Name: exam_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.exam_type AS ENUM (
    'BENCHMARK',
    'NAPLAN_STYLE_READING',
    'NAPLAN_STYLE_NUMERACY',
    'NAPLAN_STYLE_LANGUAGE_CONVENTION',
    'MATHS_OLYMPIAD',
    'ENGLISH_OLYMPIAD',
    'SELECTIVE',
    'GRAMMAR',
    'VERBAL_REASONING',
    'NUMERICAL_REASONING',
    'SPELLING',
    'MENTAL_MATHS',
    'GEOMETRY',
    'WORD_PROBLEMS',
    'PROBLEM_SOLVING',
    'CRITICAL_THINKING',
    'VOCABULARY',
    'WRITING'
);


--
-- Name: question_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.question_type AS ENUM (
    'MCQ',
    'SHORT_ANSWER',
    'WRITING',
    'READING_COMPREHENSION'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'PARENT',
    'TUTOR',
    'STUDENT',
    'TEST_CREATOR',
    'ADMIN'
);


--
-- Name: admin_coverage_gaps(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_coverage_gaps(p_exam_type text DEFAULT NULL::text) RETURNS TABLE(subject text, topic text, sub_topic text, exam_type text, item_count bigint, published_count bigint, draft_count bigint, min_items_required integer, threshold_configured boolean, coverage_status text, avg_authored_difficulty numeric, avg_observed_difficulty numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'public'
    AS $$
  SELECT
    c.subject, c.topic, c.sub_topic, c.exam_type,
    c.item_count, c.published_count, c.draft_count,
    t.min_items_per_subtopic                     AS min_items_required,
    (t.min_items_per_subtopic IS NOT NULL)       AS threshold_configured,
    c.coverage_status,
    c.avg_authored_difficulty,
    c.avg_observed_difficulty
  FROM reporting.mv_topic_coverage c
  CROSS JOIN reporting.coverage_thresholds t
  WHERE t.id = 1
    AND public.has_role('ADMIN')
    -- Real gaps when a threshold exists. When it does not, coverage_status
    -- cannot express "too few", so returning only non-ADEQUATE rows would
    -- return nothing at all and read as a clean bill of health. See header.
    AND (c.coverage_status <> 'ADEQUATE' OR t.min_items_per_subtopic IS NULL)
    AND (NULLIF(trim(COALESCE(p_exam_type, '')), '') IS NULL
         OR c.exam_type = trim(p_exam_type))
  ORDER BY CASE c.coverage_status WHEN 'NONE_PUBLISHED' THEN 0 ELSE 1 END,
           c.published_count ASC,
           c.subject, c.topic, c.sub_topic, c.exam_type;
$$;


--
-- Name: FUNCTION admin_coverage_gaps(p_exam_type text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.admin_coverage_gaps(p_exam_type text) IS 'A3 coverage gaps, ADMIN only. While coverage_thresholds.min_items_per_subtopic is NULL, returns ALL sub-topics thinnest-first with threshold_configured = false rather than zero rows - an empty result would read as "no gaps anywhere" when the truth is that gaps cannot be classified. Optional p_exam_type filter.';


--
-- Name: admin_data_quality(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_data_quality(p_from_date integer, p_to_date integer) RETURNS TABLE(check_date date, check_name text, object_name text, metric_value bigint, threshold bigint, status text, detail text, as_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'public'
    AS $$
BEGIN
  IF NOT public.has_role('ADMIN') THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;

  IF to_date(p_to_date::text, 'YYYYMMDD')
   - to_date(p_from_date::text, 'YYYYMMDD') > 366 THEN
    RAISE EXCEPTION 'date range exceeds 366 days' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT h.check_date, h.check_name, h.object_name, h.metric_value,
         h.threshold, h.status, h.detail, h.recorded_at AS as_at
  FROM reporting.data_quality_history h
  WHERE h.check_date BETWEEN to_date(p_from_date::text, 'YYYYMMDD')
                         AND to_date(p_to_date::text, 'YYYYMMDD')
  -- Newest day first, then worst first within the day: an operator opening a
  -- multi-day range wants today's failures at the top, not last week's.
  ORDER BY h.check_date DESC,
           CASE h.status WHEN 'FAIL' THEN 0 WHEN 'WARN' THEN 1
                         WHEN 'NOT_IMPLEMENTED' THEN 2 ELSE 3 END,
           h.check_name, h.object_name;
END;
$$;


--
-- Name: FUNCTION admin_data_quality(p_from_date integer, p_to_date integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.admin_data_quality(p_from_date integer, p_to_date integer) IS 'A15 data quality over a real date range, from reporting.data_quality_history (migration 038). ADMIN only, range capped at 366 days. Ordered newest day first then worst-first within the day.';


--
-- Name: admin_enquiry_counts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_enquiry_counts() RETURNS TABLE(open_total bigint, breached bigint, at_risk bigint, unrecorded_open bigint, unknown_calendar bigint, oldest_age_minutes integer, sla_minutes integer, sla_business_days integer, sla_basis text, sla_is_confirmed boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
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
$$;


--
-- Name: admin_enquiry_queue(text, text, boolean, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_enquiry_queue(p_status text DEFAULT NULL::text, p_type text DEFAULT NULL::text, p_unanswered boolean DEFAULT false, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0) RETURNS TABLE(enquiry_id uuid, channel text, enquiry_type text, status text, outcome text, received_at timestamp with time zone, first_response_at timestamp with time zone, resolved_at timestamp with time zone, assigned_to uuid, parent_user_id uuid, converted boolean, age_minutes integer, response_minutes integer, resolution_hours numeric, sla_minutes integer, sla_state text, sla_is_confirmed boolean, utm_source text, due_at timestamp with time zone, sla_basis text, sla_business_days integer, converted_ref text, converted_ref_kind text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
BEGIN
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
    -- Either path counts. An enquiry that points at a subscription is converted
    -- as fully as one that points at a purchases row.
    (e.converted_order_id IS NOT NULL OR e.converted_ref IS NOT NULL),
    (EXTRACT(EPOCH FROM (now() - e.received_at)) / 60)::int,
    (EXTRACT(EPOCH FROM (e.first_response_at - e.received_at)) / 60)::int,
    CASE WHEN e.resolved_at IS NULL OR e.first_response_at IS NULL THEN NULL
         ELSE ROUND(EXTRACT(EPOCH FROM (e.resolved_at - e.received_at)) / 3600, 2) END,
    CASE WHEN th.sla_basis = 'calendar' THEN th.first_response_sla_minutes END,
    CASE
      WHEN e.status IN ('resolved','closed') AND e.first_response_at IS NULL
        THEN 'unrecorded'
      WHEN d.due_at IS NULL
        THEN 'unknown_calendar'
      WHEN e.first_response_at IS NOT NULL
        THEN CASE WHEN e.first_response_at <= d.due_at THEN 'met' ELSE 'breached' END
      WHEN now() > d.due_at THEN 'breached'
      WHEN now() > e.received_at + ((d.due_at - e.received_at) * 0.75) THEN 'at_risk'
      ELSE 'within'
    END,
    th.sla_is_confirmed,
    e.utm_source,
    d.due_at,
    th.sla_basis,
    CASE WHEN th.sla_basis = 'business' THEN th.first_response_sla_business_days END,
    -- Table-qualified: RETURNS TABLE turns converted_ref into an OUT variable, so
    -- a bare reference here is ambiguous with the column (42702).
    e.converted_ref,
    e.converted_ref_kind
  FROM public.enquiries e
  CROSS JOIN reporting.enquiry_thresholds th
  CROSS JOIN LATERAL (
    SELECT CASE
             WHEN th.sla_basis = 'business'
               THEN reporting.business_day_deadline(e.received_at)
             ELSE e.received_at + make_interval(mins => th.first_response_sla_minutes)
           END AS due_at
  ) d
  WHERE th.id = 1
    AND (p_status IS NULL OR e.status = p_status)
    AND (p_status IS NOT NULL OR e.status <> 'spam')
    AND (p_type IS NULL OR e.enquiry_type = p_type)
    AND (NOT p_unanswered OR e.first_response_at IS NULL)
  ORDER BY e.received_at ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;


--
-- Name: admin_enquiry_series(integer, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_enquiry_series(p_days integer DEFAULT 90, p_channel text DEFAULT NULL::text, p_type text DEFAULT NULL::text) RETURNS TABLE(date_key integer, the_date date, enquiries bigint, sla_met bigint, sla_breached bigint, response_unrecorded bigint, sla_unmeasurable bigint, first_response_hours_median numeric, converted bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'public', 'pg_catalog'
    AS $$
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
$$;


--
-- Name: admin_enquiry_summary(integer, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_enquiry_summary(p_days integer DEFAULT 90, p_channel text DEFAULT NULL::text, p_type text DEFAULT NULL::text) RETURNS TABLE(window_days integer, enquiries bigint, sla_met bigint, sla_breached bigint, sla_at_risk bigint, sla_within bigint, sla_unmeasurable bigint, response_unrecorded bigint, response_recorded bigint, sla_breach_rate numeric, rate_is_reportable boolean, min_enquiries_for_rate integer, resolution_over_sla bigint, resolution_sla_hours integer, sla_minutes integer, first_response_hours_median numeric, resolution_hours_median numeric, converted bigint, conversion_rate numeric, conversion_window_days integer, sla_basis text, sla_business_days integer, sla_is_confirmed boolean, refreshed_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'public', 'pg_catalog'
    AS $$
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
$$;


--
-- Name: admin_enquiry_transition(uuid, text, text, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_enquiry_transition(p_enquiry_id uuid, p_action text, p_outcome text DEFAULT NULL::text, p_assignee uuid DEFAULT NULL::uuid, p_convert_ref text DEFAULT NULL::text, p_convert_kind text DEFAULT NULL::text) RETURNS TABLE(enquiry_id uuid, status text, outcome text, first_response_at timestamp with time zone, first_response_minutes integer, resolved_at timestamp with time zone, resolution_hours numeric, response_recorded boolean, response_was_missing boolean, converted_at timestamp with time zone, converted_ref text, converted_ref_kind text, conversion_recorded boolean, conversion_withdrawn boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_now      timestamptz := now();
  v_e        public.enquiries%ROWTYPE;
  v_target   text;
  v_new_fr   timestamptz;
  v_new_res  timestamptz;
  v_new_conv timestamptz;
  v_new_ref  text;
  v_new_kind text;
BEGIN
  IF NOT public.has_role('ADMIN') THEN
    RAISE EXCEPTION 'only an administrator can change an enquiry''s status'
      USING ERRCODE = '42501';
  END IF;

  IF p_action IS NULL OR p_action NOT IN
     ('triage','start','reply','resolve','close','reopen','assign','spam',
      'convert','unconvert') THEN
    RAISE EXCEPTION 'unknown enquiry action: %', p_action USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_e FROM public.enquiries WHERE id = p_enquiry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such enquiry' USING ERRCODE = 'P0002';
  END IF;

  v_target   := v_e.status;
  v_new_fr   := v_e.first_response_at;
  v_new_res  := v_e.resolved_at;
  -- Carried forward so an unrelated action preserves a conversion recorded
  -- weeks ago instead of silently blanking it.
  v_new_conv := v_e.converted_at;
  v_new_ref  := v_e.converted_ref;
  v_new_kind := v_e.converted_ref_kind;

  CASE p_action
    WHEN 'triage'  THEN v_target := 'triaged';
    WHEN 'start'   THEN v_target := 'in_progress';
    WHEN 'reply'   THEN v_target := 'waiting_on_customer';
    WHEN 'resolve' THEN v_target := 'resolved';
    WHEN 'close'   THEN v_target := 'closed';
    WHEN 'reopen'  THEN v_target := 'in_progress';
    WHEN 'spam'    THEN v_target := 'spam';
    -- Assignment and conversion move the record without moving the queue.
    WHEN 'assign'    THEN v_target := v_e.status;
    WHEN 'convert'   THEN v_target := v_e.status;
    WHEN 'unconvert' THEN v_target := v_e.status;
  END CASE;

  IF p_action = 'reply' THEN
    IF v_e.first_response_at IS NOT NULL THEN
      RAISE EXCEPTION 'the first response was already recorded at %',
        v_e.first_response_at USING ERRCODE = '22023';
    END IF;
    IF v_e.resolved_at IS NOT NULL OR v_e.status IN ('resolved','closed') THEN
      RAISE EXCEPTION
        'cannot record a first response after an enquiry is resolved or closed; '
        'the response was never recorded, and A13 reports it as such'
        USING ERRCODE = '22023';
    END IF;
    v_new_fr := v_now;
  END IF;

  IF p_action IN ('resolve','close') THEN
    IF p_outcome IS NULL OR p_outcome NOT IN
       ('answered','refunded','escalated','no_action','spam','duplicate','withdrawn') THEN
      RAISE EXCEPTION 'resolving or closing requires a valid outcome'
        USING ERRCODE = '22023';
    END IF;
    v_new_res := COALESCE(v_e.resolved_at, v_now);
  END IF;

  IF p_action = 'spam' THEN
    v_new_res := COALESCE(v_e.resolved_at, v_now);
  END IF;

  IF p_action = 'reopen' THEN
    v_new_res := NULL;
  END IF;

  IF p_action = 'assign' AND p_assignee IS NULL THEN
    RAISE EXCEPTION 'the assign action needs an assignee' USING ERRCODE = '22023';
  END IF;

  IF p_action = 'convert' THEN
    -- Refused rather than rounded: a spam row that "converted" is the metric
    -- being fed by the queue's own rubbish, and nobody would ever notice.
    IF v_e.status = 'spam' THEN
      RAISE EXCEPTION 'a spam enquiry cannot be recorded as a conversion'
        USING ERRCODE = '22023';
    END IF;
    IF p_convert_ref IS NULL OR length(btrim(p_convert_ref)) = 0 THEN
      RAISE EXCEPTION 'the convert action needs the order reference it points at'
        USING ERRCODE = '22023';
    END IF;
    IF p_convert_kind IS NULL OR p_convert_kind NOT IN
       ('purchase','subscription','invoice','other') THEN
      RAISE EXCEPTION
        'the convert action needs a reference kind of purchase, subscription, invoice or other'
        USING ERRCODE = '22023';
    END IF;
    -- First conversion wins on the timestamp: re-recording corrects what it
    -- points at, it does not move when the family actually decided.
    v_new_conv := COALESCE(v_e.converted_at, v_now);
    v_new_ref  := btrim(p_convert_ref);
    v_new_kind := p_convert_kind;
  END IF;

  IF p_action = 'unconvert' THEN
    v_new_conv := NULL;
    v_new_ref  := NULL;
    v_new_kind := NULL;
  END IF;

  -- Every right-hand reference is table-qualified: RETURNS TABLE turns each
  -- output column into a plpgsql variable, so a bare `converted_at` here would be
  -- ambiguous between the OUT parameter and the column (42702).
  UPDATE public.enquiries AS e
     SET status             = v_target,
         first_response_at  = v_new_fr,
         resolved_at        = v_new_res,
         outcome            = COALESCE(p_outcome,
                            CASE WHEN p_action = 'spam' THEN 'spam' ELSE e.outcome END),
         assigned_to        = COALESCE(p_assignee, e.assigned_to),
         converted_at       = v_new_conv,
         converted_ref      = v_new_ref,
         converted_ref_kind = v_new_kind,
         updated_at         = v_now
   WHERE e.id = p_enquiry_id;

  RETURN QUERY
  SELECT
    p_enquiry_id,
    v_target,
    COALESCE(p_outcome,
      CASE WHEN p_action = 'spam' THEN 'spam' ELSE v_e.outcome END),
    v_new_fr,
    -- Minutes, not seconds (see the units note in admin_enquiry_queue).
    CASE WHEN v_new_fr IS NULL THEN NULL
         ELSE (EXTRACT(EPOCH FROM (v_new_fr - v_e.received_at)) / 60)::int END,
    v_new_res,
    CASE WHEN v_new_res IS NULL OR v_new_fr IS NULL THEN NULL
         ELSE ROUND(EXTRACT(EPOCH FROM (v_new_res - v_e.received_at)) / 3600, 2) END,
    (p_action = 'reply' AND v_e.first_response_at IS NULL),
    (p_action IN ('resolve','close') AND v_e.first_response_at IS NULL),
    v_new_conv,
    v_new_ref,
    v_new_kind,
    -- Only this call recording a first-ever conversion should fire the event.
    (p_action = 'convert' AND v_e.converted_at IS NULL),
    (p_action = 'unconvert' AND v_e.converted_at IS NOT NULL);
END;
$$;


--
-- Name: admin_experiment_results(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_experiment_results() RETURNS TABLE(experiment_key text, experiment_name text, status text, variant text, is_control boolean, sample_size bigint, conversions bigint, variant_conversion_rate numeric, control_sample_size bigint, control_rate numeric, diff_pp numeric, ci_lower_pp numeric, ci_upper_pp numeric, p_value_experiment numeric, recommended_decision text, decision_reason text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'public'
    AS $$
  SELECT * FROM reporting.experiment_results() WHERE public.has_role('ADMIN');
$$;


--
-- Name: FUNCTION admin_experiment_results(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.admin_experiment_results() IS 'A12 experiment results, ADMIN only. Returns NO subject identifiers - only per-arm aggregates. Wilson/Newcombe intervals, two-proportion z-test as p_value_experiment (never p_value, which means item difficulty). recommended_decision is a recommendation with a reasoning string, never an automatic action; below min_sample_size it is INSUFFICIENT_DATA and explicitly not "no difference".';


--
-- Name: admin_funnel_by_stage(integer, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_funnel_by_stage(p_from_date integer, p_to_date integer, p_segment_by text DEFAULT 'none'::text) RETURNS TABLE(stage text, stage_rank integer, channel text, campaign text, device_class text, visitors bigint, events bigint, prev_stage text, prev_stage_visitors bigint, stage_conversion_rate numeric, stage_dropoff_count bigint, suppressed boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'public'
    AS $$
  SELECT * FROM reporting.funnel_by_stage(p_from_date, p_to_date, p_segment_by)
  WHERE public.has_role('ADMIN');
$$;


--
-- Name: FUNCTION admin_funnel_by_stage(p_from_date integer, p_to_date integer, p_segment_by text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.admin_funnel_by_stage(p_from_date integer, p_to_date integer, p_segment_by text) IS 'A11 stage-to-stage funnel. ADMIN only. p_segment_by: none (default) | channel | campaign | device. `prev_stage` names the stage each rate is measured against, because chaining skips stages with no rows (migration 056) - a rate versus REPORT_SENT is not the same measurement as a rate versus PAYWALL_READY and must not be presented as one. Returns rate AND absolute dropoff together. `suppressed` marks segments below min_segment_visitors (20). device_class is always ''unknown'': no device is captured, so C9 is not yet possible.';


--
-- Name: admin_funnel_outcomes(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_funnel_outcomes(p_from_date integer, p_to_date integer) RETURNS TABLE(reached_paywall bigint, paying bigint, free_to_paid_rate numeric, checkout_started bigint, checkout_completed bigint, checkout_abandoned bigint, checkout_abandonment_rate numeric, median_hours_to_abandon numeric, signup_cohort bigint, activated bigint, activation_rate numeric, median_hours_to_first_value numeric, suppressed boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'public'
    AS $$
  SELECT * FROM reporting.funnel_outcomes(p_from_date, p_to_date)
  WHERE public.has_role('ADMIN');
$$;


--
-- Name: FUNCTION admin_funnel_outcomes(p_from_date integer, p_to_date integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.admin_funnel_outcomes(p_from_date integer, p_to_date integer) IS 'A11 outcome metrics: free_to_paid_rate (denominator PAYWALL_TRIGGERED per 5.4, not signups), checkout_abandonment_rate (started-minus-completed, derived not event-counted), and median time_to_first_value_hours from funnel_state. ADMIN only. All counts are DISTINCT VISITORS, not events. Raw counts are returned beside every rate so no percentage is ever shown without its denominator. `suppressed` is true when the smallest denominator is below min_segment_visitors.';


--
-- Name: admin_item_statistics(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_item_statistics(p_test_id uuid DEFAULT NULL::uuid) RETURNS TABLE(period_label text, test_id uuid, item_id uuid, subject text, topic text, responses bigint, students bigint, enough_evidence boolean, p_value numeric, point_biserial numeric, median_time_seconds numeric, skip_rate_pct numeric, skip_rate_reliable boolean, marking_reliable boolean, item_flag_rate_pct numeric, key_option text, distractors jsonb, dead_distractors text[], defect_reasons text[], is_defective boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'public', 'pg_catalog'
    AS $$
  SELECT s.period_label, s.test_id, s.item_id, s.subject, s.topic,
         s.responses, s.students, s.enough_evidence,
         s.p_value, s.point_biserial, s.median_time_seconds,
         s.skip_rate_pct, s.skip_rate_reliable, s.marking_reliable,
         s.item_flag_rate_pct, s.key_option, s.distractors,
         s.dead_distractors, s.defect_reasons, s.is_defective
  FROM reporting.mv_item_statistics s
  WHERE public.has_role('ADMIN')
    AND (p_test_id IS NULL OR s.test_id = p_test_id)
  ORDER BY s.is_defective DESC, s.p_value ASC NULLS LAST, s.responses DESC;
$$;


--
-- Name: admin_item_thresholds(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_item_thresholds() RETURNS TABLE(min_responses_per_item integer, p_value_floor numeric, p_value_ceiling numeric, point_biserial_min numeric, median_time_max_seconds integer, skip_rate_max_pct numeric, updated_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'public', 'pg_catalog'
    AS $$
  SELECT t.min_responses_per_item,
         t.p_value_floor,
         t.p_value_ceiling,
         t.point_biserial_min,
         t.median_time_max_seconds,
         t.skip_rate_max_pct,
         t.updated_at
  FROM reporting.item_thresholds t
  WHERE t.id = 1
    AND public.has_role('ADMIN');
$$;


--
-- Name: admin_platform_health(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_platform_health(p_from_date integer, p_to_date integer) RETURNS TABLE(hour_start timestamp with time zone, date_key integer, hour_of_day smallint, active_users bigint, peak_concurrency bigint, concurrency_vs_cap numeric, peak_concurrency_cap integer, cap_is_measured boolean, tests_started bigint, tests_submitted bigint, errors bigint, test_error_rate numeric, submit_errors bigint, failed_submission_rate numeric, as_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'public'
    AS $$
BEGIN
  IF NOT public.has_role('ADMIN') THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;

  IF to_date(p_to_date::text, 'YYYYMMDD')
   - to_date(p_from_date::text, 'YYYYMMDD') > 366 THEN
    RAISE EXCEPTION 'date range exceeds 366 days' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT h.hour_start, h.date_key, h.hour_of_day, h.active_users,
         h.peak_concurrency, h.concurrency_vs_cap, h.peak_concurrency_cap,
         h.cap_is_measured, h.tests_started, h.tests_submitted, h.errors,
         h.test_error_rate, h.submit_errors, h.failed_submission_rate, h.as_at
  FROM reporting.mv_platform_health h
  WHERE h.date_key BETWEEN p_from_date AND p_to_date
  ORDER BY h.hour_start DESC;
END;
$$;


--
-- Name: FUNCTION admin_platform_health(p_from_date integer, p_to_date integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.admin_platform_health(p_from_date integer, p_to_date integer) IS 'A14 platform health, hour grain, ADMIN only. p_from_date/p_to_date are YYYYMMDD integers, range capped at 366 days. concurrency_vs_cap divides by an unmeasured target (A-13) - cap_is_measured is returned so the UI can say so.';


--
-- Name: admin_set_year_level_cap(smallint, smallint, smallint, smallint, smallint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_year_level_cap(p_year_level smallint, p_max_tests smallint, p_max_questions smallint, p_recommended_tests smallint, p_recommended_questions smallint, p_daily_target_basis text DEFAULT 'recommended'::text) RETURNS TABLE(year_level smallint, max_tests_per_day smallint, max_questions_per_day smallint, recommended_tests_per_day smallint, recommended_questions_per_day smallint, daily_target_basis text, updated_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'reporting', 'public', 'pg_catalog'
    AS $$
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
  -- Spelled out rather than trusting the table CHECK, because the failure mode of
  -- a typo here ('Recommend', 'recommended ') is a row that silently keeps the
  -- previous policy while the operator believes they changed it.
  IF p_daily_target_basis IS NULL OR p_daily_target_basis NOT IN ('recommended', 'ceiling') THEN
    RAISE EXCEPTION 'daily_target_basis must be ''recommended'' or ''ceiling'' (got %)',
      p_daily_target_basis USING ERRCODE = '22023';
  END IF;

  UPDATE reporting.dim_year_level_cap c
     SET max_tests_per_day             = p_max_tests,
         max_questions_per_day         = p_max_questions,
         recommended_tests_per_day     = p_recommended_tests,
         recommended_questions_per_day = p_recommended_questions,
         daily_target_basis            = p_daily_target_basis,
         updated_at                    = now()
   WHERE c.year_level = p_year_level;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no cap row for year_level %', p_year_level USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY SELECT c.year_level, c.max_tests_per_day, c.max_questions_per_day,
                       c.recommended_tests_per_day, c.recommended_questions_per_day,
                       c.daily_target_basis, c.updated_at
                  FROM reporting.dim_year_level_cap c
                 WHERE c.year_level = p_year_level;
END;
$$;


--
-- Name: FUNCTION admin_set_year_level_cap(p_year_level smallint, p_max_tests smallint, p_max_questions smallint, p_recommended_tests smallint, p_recommended_questions smallint, p_daily_target_basis text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.admin_set_year_level_cap(p_year_level smallint, p_max_tests smallint, p_max_questions smallint, p_recommended_tests smallint, p_recommended_questions smallint, p_daily_target_basis text) IS 'Admin write path for the per-year-level daily practice limits and the clamp policy. ADMIN only, checked in-body as well as by grant. Validates range, ceiling/target coherence and the basis enum with actionable messages; the table CHECKs are the actual guarantee, so this function improves the error rather than weakening the control. Takes effect on the next refresh of mv_student_daily_target, not immediately.';


--
-- Name: admin_year_level_caps(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_year_level_caps() RETURNS TABLE(year_level smallint, max_tests_per_day smallint, max_questions_per_day smallint, recommended_tests_per_day smallint, recommended_questions_per_day smallint, daily_target_basis text, updated_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'public', 'pg_catalog'
    AS $$
  SELECT c.year_level, c.max_tests_per_day, c.max_questions_per_day,
         c.recommended_tests_per_day, c.recommended_questions_per_day,
         c.daily_target_basis, c.updated_at
  FROM reporting.dim_year_level_cap c
  WHERE public.has_role('ADMIN')
  ORDER BY c.year_level;
$$;


--
-- Name: FUNCTION admin_year_level_caps(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.admin_year_level_caps() IS 'Admin read wrapper over reporting.dim_year_level_cap, including daily_target_basis so the screen can state which limit is actually clamping a child. ADMIN only, enforced in-body: a non-admin receives zero rows, the same shape for every caller, so the response cannot be used to probe which year levels are configured.';


--
-- Name: advance_funnel_stage(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.advance_funnel_stage(target_user_id uuid, new_stage text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.funnel_state (user_id, stage, stage_updated_at)
  VALUES (target_user_id, new_stage, now())
  ON CONFLICT (user_id) DO UPDATE
    SET stage = EXCLUDED.stage, stage_updated_at = now()
    -- Monotonic: never regress on an out-of-order webhook or replayed job.
    WHERE public.funnel_stage_rank(public.funnel_state.stage)
        < public.funnel_stage_rank(EXCLUDED.stage);
END;
$$;


--
-- Name: can_access_published_test(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_published_test(target_test_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tests t
    WHERE t.id = target_test_id
      AND t.status = 'PUBLISHED'::public.content_status
      AND (
        t.is_free = true
        OR EXISTS (SELECT 1 FROM public.entitlements e
                   WHERE e.test_id = t.id AND e.active = true AND e.user_id = auth.uid())
        OR EXISTS (SELECT 1 FROM public.entitlements e
                   JOIN public.parent_student_links psl ON psl.parent_user_id = e.user_id
                   JOIN public.student_profiles sp ON sp.id = psl.student_id
                   WHERE e.test_id = t.id AND e.active = true AND sp.auth_user_id = auth.uid())
        OR EXISTS (SELECT 1 FROM public.assignments a
                   JOIN public.student_profiles sp ON sp.id = a.student_id
                   WHERE a.test_id = t.id AND sp.auth_user_id = auth.uid())
        OR EXISTS (SELECT 1 FROM public.parent_student_links psl
                   JOIN public.student_profiles sp ON sp.id = psl.student_id
                   WHERE psl.parent_user_id = auth.uid()
                     AND (EXISTS (SELECT 1 FROM public.assignments a
                                  WHERE a.test_id = t.id AND a.student_id = sp.id)
                       OR EXISTS (SELECT 1 FROM public.entitlements e
                                  WHERE e.test_id = t.id AND e.active = true
                                    AND e.user_id = sp.auth_user_id)))
        OR public.has_active_subscription(auth.uid())
        OR EXISTS (SELECT 1 FROM public.parent_student_links psl
                   JOIN public.student_profiles sp ON sp.id = psl.student_id
                   WHERE sp.auth_user_id = auth.uid()
                     AND public.has_active_subscription(psl.parent_user_id))
      )
  );
$$;


--
-- Name: child_attempt_history(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.child_attempt_history(p_student_id uuid) RETURNS TABLE(attempt_id uuid, started_at timestamp with time zone, status text, score numeric, section_scores jsonb, test_id uuid, test_title text, exam_type text, family_group text, family_group_label text, year_level smallint, attempt_ordinal bigint, personal_progress_delta numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'public'
    AS $$
  SELECT h.attempt_id, h.started_at, h.status, h.score, h.section_scores,
         h.test_id, h.title, h.exam_type, h.family_group, h.family_group_label,
         h.year_level, h.attempt_ordinal, h.personal_progress_delta
  FROM reporting.mv_attempt_history h
  WHERE h.student_id = p_student_id
    -- A student is rejected here even though they are the subject of the row.
    AND public.may_read_results()
    AND (public.is_parent_of(p_student_id) OR public.has_role('ADMIN'));
$$;


--
-- Name: FUNCTION child_attempt_history(p_student_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.child_attempt_history(p_student_id uuid) IS 'Report P1/P4 input. Returns a linked child''s attempt history INCLUDING scores. Gated by may_read_results() (which rejects the STUDENT role unconditionally) plus is_parent_of/ADMIN, so a student cannot read their own row through it. Deliberately separate from reporting.student_today(), which returns no numeric result at all.';


--
-- Name: creator_coverage_queue(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.creator_coverage_queue(p_limit integer DEFAULT 50) RETURNS TABLE(production_priority bigint, subject text, topic text, sub_topic text, exam_type text, published_count bigint, draft_count bigint, min_items_required integer, threshold_configured boolean, deficit bigint, oldest_draft_age_days integer, coverage_status text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'public'
    AS $$
BEGIN
  -- Checked here, not only in the route: PostgREST exposes this function
  -- directly at /rest/v1/rpc/creator_coverage_queue, so a route-level check
  -- alone is not a control. Same convention as the pre-existing
  -- creator_coverage_queue() this replaces and as admin_data_quality().
  IF NOT (public.has_role('TEST_CREATOR') OR public.has_role('ADMIN')) THEN
    RAISE EXCEPTION 'creator or admin role required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH q AS (
    SELECT
      c.subject, c.topic, c.sub_topic, c.exam_type,
      c.published_count, c.draft_count, c.coverage_status,
      t.min_items_per_subtopic AS min_required,
      -- NULL rather than 0 while unconfigured: 0 reads as "nothing needed".
      CASE WHEN t.min_items_per_subtopic IS NULL THEN NULL
           ELSE GREATEST(t.min_items_per_subtopic::bigint - c.published_count, 0)
      END AS deficit,
      -- Oldest sitting draft, not the average: an average hides a four-month-old
      -- draft behind two written yesterday.
      d.oldest_draft_age_days
    FROM reporting.mv_topic_coverage c
    CROSS JOIN reporting.coverage_thresholds t
    LEFT JOIN LATERAL (
      SELECT MAX(EXTRACT(EPOCH FROM (now() - qq.created_at)) / 86400.0)::integer
               AS oldest_draft_age_days
      FROM public.questions qq
      WHERE qq.status::text = 'DRAFT'
        AND qq.subject = c.subject
        AND qq.topic   = c.topic
        AND COALESCE(NULLIF(qq.sub_topic, ''), '(unspecified)') = c.sub_topic
        AND qq.exam_type::text = c.exam_type
    ) d ON true
    WHERE t.id = 1
      -- With no threshold every row is ADEQUATE, so filtering to non-ADEQUATE
      -- would hand the creator an empty queue and imply there is nothing to
      -- write (migration 043).
      AND (c.coverage_status <> 'ADEQUATE' OR t.min_items_per_subtopic IS NULL)
  )
  SELECT
    ROW_NUMBER() OVER (
      ORDER BY CASE q.coverage_status WHEN 'NONE_PUBLISHED' THEN 0 ELSE 1 END,
               q.deficit DESC NULLS LAST,
               q.published_count ASC,
               q.subject, q.topic, q.sub_topic
    )                                    AS production_priority,
    q.subject, q.topic, q.sub_topic, q.exam_type,
    q.published_count, q.draft_count,
    q.min_required                       AS min_items_required,
    (q.min_required IS NOT NULL)         AS threshold_configured,
    q.deficit,
    q.oldest_draft_age_days,
    q.coverage_status
  FROM q
  ORDER BY production_priority
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500);
END;
$$;


--
-- Name: FUNCTION creator_coverage_queue(p_limit integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.creator_coverage_queue(p_limit integer) IS 'TC1 authoring queue, ranked. TEST_CREATOR or ADMIN only, enforced HERE as well as in the route because PostgREST exposes the function directly. Reads the same mv_topic_coverage as A3. While min_items_per_subtopic is NULL, deficit is NULL and ranking falls through to published_count ascending so the queue is not empty. Superseded and dropped the older zero-argument overload (migration 044).';


--
-- Name: enquiry_id_for_source_ref(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enquiry_id_for_source_ref(p_source_ref text) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
  SELECT e.id
    FROM public.enquiries e
   WHERE e.channel = 'web_form'
     AND e.ingest_source_ref = p_source_ref;
$$;


--
-- Name: FUNCTION enquiry_id_for_source_ref(p_source_ref text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.enquiry_id_for_source_ref(p_source_ref text) IS 'Returns the enquiry already recorded under a web-form submission reference, so the route can answer a retry with the same reference instead of a rate-limit refusal. Service-role only; the reference is a 128-bit nonce from a signed token, so it is not enumerable.';


--
-- Name: enquiry_throttle_check(text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enquiry_throttle_check(p_fp text, p_min_interval_seconds integer DEFAULT 60, p_daily_cap integer DEFAULT 5) RETURNS TABLE(allowed boolean, retry_after_seconds integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $_$
DECLARE
  v_now     timestamptz := now();
  v_row     public.enquiry_throttle%ROWTYPE;
  v_elapsed integer;
  v_allowed boolean;
  v_retry   integer;
BEGIN
  IF p_fp IS NULL OR p_fp !~ '^[0-9a-f]{64}$' THEN
    -- An exception, not a refusal: a malformed fingerprint is a bug in the
    -- route, and answering it with "slow down" would hide it behind a 429.
    RAISE EXCEPTION 'invalid throttle fingerprint: expected 64 hex characters'
      USING ERRCODE = '22023';
  END IF;

  IF p_daily_cap IS NULL OR p_daily_cap < 1 THEN
    RAISE EXCEPTION 'p_daily_cap must be at least 1' USING ERRCODE = '22023';
  END IF;

  -- FOR UPDATE serialises concurrent submissions from the same address, so two
  -- simultaneous POSTs cannot both read submissions=1 and both pass a cap of 5.
  SELECT * INTO v_row
    FROM public.enquiry_throttle
   WHERE fp = p_fp
     FOR UPDATE;

  IF NOT FOUND THEN
    -- First sighting is recorded but not yet counted as a submission: the
    -- UPDATE below is the only place submissions ever becomes 1.
    INSERT INTO public.enquiry_throttle (fp, last_seen_at, window_start, submissions)
      VALUES (p_fp, v_now, v_now, 0);
    v_row.fp := p_fp;
    v_row.last_seen_at := v_now;
    v_row.window_start := v_now;
    v_row.submissions := 0;
  END IF;

  -- A rolling 24h window rather than a calendar day: a cap that resets at
  -- midnight lets a bot spend its whole allowance twice in one working day.
  IF v_now - v_row.window_start >= interval '24 hours' THEN
    v_row.window_start := v_now;
    v_row.submissions := 0;
  END IF;

  v_elapsed := EXTRACT(EPOCH FROM (v_now - v_row.last_seen_at))::integer;
  v_allowed := TRUE;
  v_retry   := 0;

  -- The interval applies only after a first accepted submission, so the interval
  -- and the cap cannot both refuse the same request and disagree about why.
  IF v_row.submissions > 0
     AND v_elapsed < greatest(coalesce(p_min_interval_seconds, 60), 0) THEN
    v_allowed := FALSE;
    v_retry := greatest(coalesce(p_min_interval_seconds, 60), 0) - v_elapsed;
  ELSIF v_row.submissions >= p_daily_cap THEN
    v_allowed := FALSE;
    v_retry := greatest(
      1,
      EXTRACT(EPOCH FROM (v_row.window_start + interval '24 hours' - v_now))::integer
    );
  END IF;

  IF v_allowed THEN
    UPDATE public.enquiry_throttle
       SET last_seen_at = v_now,
           window_start = v_row.window_start,
           submissions  = v_row.submissions + 1
     WHERE fp = p_fp;
  ELSE
    -- A refusal refreshes last_seen_at but NOT the counter: an already-blocked
    -- address must not extend its own lockout by hammering.
    UPDATE public.enquiry_throttle
       SET last_seen_at = v_now
     WHERE fp = p_fp;
  END IF;

  -- Opportunistic prune, only on the path that creates a row, so ordinary
  -- traffic against a settled table does not pay for a delete every call.
  IF v_row.submissions = 0 THEN
    DELETE FROM public.enquiry_throttle
      WHERE last_seen_at < v_now - interval '30 days';
  END IF;

  RETURN QUERY SELECT v_allowed, v_retry;
END;
$_$;


--
-- Name: FUNCTION enquiry_throttle_check(p_fp text, p_min_interval_seconds integer, p_daily_cap integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.enquiry_throttle_check(p_fp text, p_min_interval_seconds integer, p_daily_cap integer) IS 'Decide whether a fingerprint may submit an enquiry, and record the decision atomically (SELECT ... FOR UPDATE). A rolling 24h window plus a minimum interval between accepted submissions. The counter advances only for submissions the route already accepted as well-formed, so a filtered bot cannot use the cap to lock a real parent out of the support channel.';


--
-- Name: experiment_assign(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.experiment_assign(p_experiment_key text, p_subject_key text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'reporting', 'public', 'pg_catalog'
    AS $$
DECLARE
  e record;
  v_existing text;
  v_bucket numeric;
  v_total numeric;
  v_acc numeric := 0;
  v_variant text;
  i integer;
BEGIN
  IF current_user NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF p_subject_key IS NULL OR length(trim(p_subject_key)) = 0 THEN
    RETURN NULL;
  END IF;

  -- An existing assignment always wins, even if the experiment has since been
  -- re-weighted or concluded. Moving a user between arms mid-experiment would
  -- invalidate every observation already collected.
  SELECT a.variant INTO v_existing
  FROM public.experiment_assignments a
  WHERE a.experiment_key = p_experiment_key AND a.subject_key = p_subject_key;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT * INTO e FROM public.experiments WHERE experiment_key = p_experiment_key;
  IF NOT FOUND OR e.status <> 'RUNNING' THEN
    RETURN NULL;
  END IF;
  IF jsonb_array_length(e.variants) <> jsonb_array_length(e.weights) THEN
    RAISE EXCEPTION 'experiment % has mismatched variants/weights', p_experiment_key
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM((w)::numeric), 0) INTO v_total
  FROM jsonb_array_elements_text(e.weights) AS w;
  IF v_total <= 0 THEN
    RETURN NULL;
  END IF;

  -- Deterministic bucket in [0, total). md5 rather than random() so the same
  -- subject lands in the same arm on every call, including across processes.
  v_bucket := (('x' || substr(md5(p_experiment_key || ':' || p_subject_key), 1, 7))::bit(28)::int)::numeric
              / 268435455.0 * v_total;

  FOR i IN 0 .. jsonb_array_length(e.variants) - 1 LOOP
    v_acc := v_acc + (e.weights ->> i)::numeric;
    IF v_bucket < v_acc THEN
      v_variant := e.variants ->> i;
      EXIT;
    END IF;
  END LOOP;
  -- Floating-point edge: fall back to the last arm rather than returning NULL.
  v_variant := COALESCE(v_variant, e.variants ->> (jsonb_array_length(e.variants) - 1));

  INSERT INTO public.experiment_assignments (experiment_key, subject_key, variant)
  VALUES (p_experiment_key, p_subject_key, v_variant)
  ON CONFLICT (experiment_key, subject_key) DO NOTHING;

  -- Re-read: a concurrent call may have won the insert, and both callers must
  -- observe the SAME arm.
  SELECT a.variant INTO v_variant
  FROM public.experiment_assignments a
  WHERE a.experiment_key = p_experiment_key AND a.subject_key = p_subject_key;

  RETURN v_variant;
END;
$$;


--
-- Name: experiment_expose(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.experiment_expose(p_experiment_key text, p_subject_key text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'reporting', 'public', 'pg_catalog'
    AS $$
DECLARE v_variant text;
BEGIN
  IF current_user NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  -- Exposure is only meaningful for a subject who was assigned. Inventing an
  -- assignment here would let a rendering bug populate an arm nobody was put in.
  SELECT a.variant INTO v_variant
  FROM public.experiment_assignments a
  WHERE a.experiment_key = p_experiment_key AND a.subject_key = p_subject_key;
  IF v_variant IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.experiment_exposures (experiment_key, subject_key, variant)
  VALUES (p_experiment_key, p_subject_key, v_variant)
  ON CONFLICT (experiment_key, subject_key) DO NOTHING;

  RETURN true;
END;
$$;


--
-- Name: FUNCTION experiment_expose(p_experiment_key text, p_subject_key text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.experiment_expose(p_experiment_key text, p_subject_key text) IS 'Records that a subject actually SAW their assigned arm. Returns false when they were never assigned, rather than inventing an assignment. Callers must invoke this only when the treatment genuinely rendered - see the N-7 offer page, which skips it when no personalisation applied.';


--
-- Name: export_baseline_function_acls(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.export_baseline_function_acls() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'pg_catalog'
    AS $$
  SELECT reporting.export_baseline_function_acls();
$$;


--
-- Name: export_baseline_parity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.export_baseline_parity() RETURNS TABLE(label text, expected bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'pg_catalog'
    AS $$
  SELECT * FROM reporting.export_baseline_parity();
$$;


--
-- Name: export_schema_baseline(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.export_schema_baseline(p_part text) RETURNS TABLE(filename text, content text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'public', 'pg_catalog'
    AS $$
BEGIN
  -- Authorise here as well as by grant: PostgREST reaches this directly, so a
  -- grant alone is not a control (the lesson of migration 044).
  IF current_user NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  IF p_part = 'tables' THEN
    RETURN QUERY SELECT * FROM reporting.export_baseline_tables();
  ELSIF p_part = 'config' THEN
    RETURN QUERY SELECT * FROM reporting.export_baseline_config();
  ELSE
    RETURN QUERY SELECT * FROM reporting.export_baseline(p_part);
  END IF;
END;
$$;


--
-- Name: FUNCTION export_schema_baseline(p_part text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.export_schema_baseline(p_part text) IS 'Public entry point for the read-only schema export (053), delegating to reporting.export_baseline*. service_role only, enforced by both grant and an explicit current_user check. Accepts a whitelisted part name; executes no caller-supplied SQL. Exists because PostgREST cannot route RPC calls into the reporting schema.';


--
-- Name: funnel_stage_rank(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.funnel_stage_rank(stage_name text) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE stage_name
    WHEN 'SIGNED_UP' THEN 1           WHEN 'STUDENT_ADDED' THEN 2
    WHEN 'DIAGNOSTIC_STARTED' THEN 3  WHEN 'FIRST_VALUE' THEN 4
    WHEN 'REPORT_SENT' THEN 5         WHEN 'SECOND_OFFERED' THEN 6
    WHEN 'PAYWALL_READY' THEN 7       WHEN 'OFFER_MADE' THEN 8
    WHEN 'CUSTOMER' THEN 9            WHEN 'ONBOARDED' THEN 10
    WHEN 'EXPANDED' THEN 11           WHEN 'RENEWED' THEN 12
    ELSE 0 END;
$$;


--
-- Name: handle_new_auth_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_auth_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  -- Students authenticate with synthetic "<username>@students.mocktest.internal"
  -- credentials minted by a parent (see /api/parent/child), which inserts the
  -- STUDENT role itself immediately after createUser(). Skip them entirely.
  IF NEW.email IS NOT NULL AND NEW.email LIKE '%@students.mocktest.internal' THEN
    RETURN NEW;
  END IF;

  -- Self-serve sign-up (Google or email/password) always means PARENT.
  INSERT INTO public.app_user_roles (user_id, role)
  VALUES (NEW.id, 'PARENT')
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;


--
-- Name: handle_new_user_profile(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user_profile() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (id) VALUES (NEW.id) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;


--
-- Name: has_active_subscription(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_active_subscription(target_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.user_id = target_user_id
      -- past_due keeps access while Stripe retries a failed card. Cutting off a
      -- paying customer for one declined retry costs far more support load than
      -- the small window of free access.
      AND s.status IN ('trialing','active','past_due')
      AND (s.current_period_end IS NULL OR s.current_period_end > now())
  );
$$;


--
-- Name: has_entitlement(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_entitlement(target_test_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.entitlements 
    WHERE user_id = auth.uid() AND test_id = target_test_id AND active = true
  );
$$;


--
-- Name: has_live_tutor_consent(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_live_tutor_consent(target_student_id uuid, target_tutor_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.consent_records c
    WHERE c.student_id = target_student_id
      AND c.tutor_user_id = target_tutor_user_id
      AND c.purpose = 'TUTOR_REPORTING'
      AND c.revoked_at IS NULL
      AND c.expires_at > now()
  );
$$;


--
-- Name: has_role(public.user_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role(target_role public.user_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_user_roles 
    WHERE user_id = auth.uid() AND role = target_role
  );
$$;


--
-- Name: ingest_enquiry(text, timestamp with time zone, text, text, uuid, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ingest_enquiry(p_channel text, p_received_at timestamp with time zone, p_enquiry_type text, p_source_ref text, p_parent_user_id uuid, p_utm jsonb, p_contact jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE v_id uuid;
BEGIN
  IF p_channel NOT IN ('web_form','email','chat') THEN
    RAISE EXCEPTION 'unknown channel: %', p_channel;
  END IF;
  -- Idempotency: a retried webhook returns the existing row.
  IF p_source_ref IS NOT NULL THEN
    SELECT e.id INTO v_id FROM public.enquiries e
     WHERE e.channel = p_channel AND e.ingest_source_ref = p_source_ref;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  INSERT INTO public.enquiries (
    channel, received_at, enquiry_type, parent_user_id, ingest_source_ref,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content)
  VALUES (
    p_channel, COALESCE(p_received_at, now()), COALESCE(p_enquiry_type,'other'),
    p_parent_user_id, p_source_ref,
    NULLIF(trim(p_utm ->> 'source'),''),   NULLIF(trim(p_utm ->> 'medium'),''),
    NULLIF(trim(p_utm ->> 'campaign'),''), NULLIF(trim(p_utm ->> 'term'),''),
    NULLIF(trim(p_utm ->> 'content'),''))
  RETURNING id INTO v_id;

  -- Same transaction: an enquiry can never exist without its contact row.
  IF p_contact IS NOT NULL THEN
    INSERT INTO public.enquiry_contacts (enquiry_id, full_name, email, phone, message_body)
    VALUES (v_id,
      NULLIF(trim(p_contact ->> 'fullName'),''),
      NULLIF(trim(p_contact ->> 'email'),'')::extensions.citext,
      NULLIF(trim(p_contact ->> 'phone'),''),
      NULLIF(trim(p_contact ->> 'messageBody'),''))
    ON CONFLICT (enquiry_id) DO NOTHING;
  END IF;
  RETURN v_id;
END; $$;


--
-- Name: is_attempt_owner(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_attempt_owner(target_attempt_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.attempts a
    JOIN public.student_profiles s ON a.student_id = s.id
    WHERE a.id = target_attempt_id AND s.auth_user_id = auth.uid()
  );
$$;


--
-- Name: is_attempt_parent(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_attempt_parent(target_attempt_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.attempts a
    JOIN public.parent_student_links psl ON psl.student_id = a.student_id
    WHERE a.id = target_attempt_id
      AND psl.parent_user_id = auth.uid()
  );
$$;


--
-- Name: is_parent_of(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_parent_of(target_student_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.parent_student_links 
    WHERE parent_user_id = auth.uid() AND student_id = target_student_id
  );
$$;


--
-- Name: is_student_self(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_student_self(target_student_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.student_profiles 
    WHERE id = target_student_id AND auth_user_id = auth.uid()
  );
$$;


--
-- Name: is_tutor_of(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_tutor_of(target_student_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tutor_student_links l
    WHERE l.tutor_user_id = auth.uid()
      AND l.student_id = target_student_id
      AND public.has_live_tutor_consent(target_student_id, auth.uid())
  );
$$;


--
-- Name: FUNCTION is_tutor_of(target_student_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.is_tutor_of(target_student_id uuid) IS 'True when the CALLER is a tutor linked to this student AND a current consent exists. Requires both; either alone is insufficient. Evaluated per query so revocation and expiry are immediate. Not anon-executable (072): unlike is_parent_of/has_role it is referenced by no RLS policy, only by SECURITY DEFINER report functions, so anon has no path needing it.';


--
-- Name: may_read_results(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.may_read_results() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT auth.uid() IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.app_user_roles r
       WHERE r.user_id = auth.uid() AND r.role = 'STUDENT'
     );
$$;


--
-- Name: FUNCTION may_read_results(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.may_read_results() IS 'Central guard for every SELECT policy on a results table. Returns FALSE for any user holding the STUDENT app role, unconditionally. Students may still INSERT and UPDATE their own attempts and responses so they can sit a test; they can never SELECT a result.';


--
-- Name: my_attempt_context(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_attempt_context(p_attempt_id uuid) RETURNS TABLE(id uuid, student_id uuid, test_id uuid, status public.attempt_status, exam_type public.exam_type, started_at timestamp with time zone, submitted_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT a.id, a.student_id, a.test_id, a.status, t.exam_type, a.started_at, a.submitted_at
  FROM public.attempts a
  LEFT JOIN public.tests t ON t.id = a.test_id
  WHERE a.id = p_attempt_id
    AND (public.is_attempt_owner(p_attempt_id) OR public.has_role('ADMIN'));
$$;


--
-- Name: FUNCTION my_attempt_context(p_attempt_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.my_attempt_context(p_attempt_id uuid) IS 'Runner-only read of attempt fields needed to orchestrate start/save/submit. Returns id, student_id, test_id, status, exam_type, started_at, submitted_at. No score, accuracy or correctness column, so a student cannot read a result through it. Used by start/route.ts (exam_type for TEST_STARTED), save/route.ts (student_id + status for ownership + IN_PROGRESS check), and submit/route.ts (all fields).';


--
-- Name: my_attempt_status(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_attempt_status(p_attempt_id uuid) RETURNS TABLE(id uuid, test_id uuid, status public.attempt_status, started_at timestamp with time zone, submitted_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT a.id, a.test_id, a.status, a.started_at, a.submitted_at
  FROM public.attempts a
  WHERE a.id = p_attempt_id
    AND public.is_attempt_owner(p_attempt_id);
$$;


--
-- Name: my_completed_attempt_count(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_completed_attempt_count(p_student_id uuid) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COUNT(*)::integer
  FROM public.attempts a
  WHERE a.student_id = p_student_id
    AND a.status IN ('SUBMITTED', 'COMPLETE')
    -- Authorisation: only the student themself, a linked parent, or an admin.
    AND (public.is_student_self(p_student_id)
         OR public.is_parent_of(p_student_id)
         OR public.has_role('ADMIN'));
$$;


--
-- Name: FUNCTION my_completed_attempt_count(p_student_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.my_completed_attempt_count(p_student_id uuid) IS 'Count of a student''s own submitted/complete attempts. A practice quantity, not a result: RETURNS integer, so no score, percentage or correctness value can be carried. Restores the student dashboard "Tests Done" counter that migration 015 would otherwise have pinned to zero.';


--
-- Name: parent_grant_tutor_consent(uuid, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.parent_grant_tutor_consent(p_student_id uuid, p_tutor_user_id uuid, p_months integer DEFAULT 12) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.may_read_results() OR NOT public.is_parent_of(p_student_id) THEN
    RAISE EXCEPTION 'only a linked parent may grant consent' USING ERRCODE = '42501';
  END IF;

  -- The grantee must actually hold the TUTOR role. Granting to an arbitrary user
  -- id would create a link that looks like tutor access in the UI.
  IF NOT EXISTS (
    SELECT 1 FROM public.app_user_roles r
    WHERE r.user_id = p_tutor_user_id AND r.role = 'TUTOR'
  ) THEN
    RAISE EXCEPTION 'grantee does not hold the TUTOR role' USING ERRCODE = '22023';
  END IF;

  -- Bounded: 1..24 months. An indefinite grant is not offered at all, because
  -- access to a child's data should always have an end date.
  IF p_months IS NULL OR p_months < 1 OR p_months > 24 THEN
    RAISE EXCEPTION 'consent duration must be between 1 and 24 months' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.tutor_student_links (tutor_user_id, student_id, created_by)
  VALUES (p_tutor_user_id, p_student_id, auth.uid())
  ON CONFLICT (tutor_user_id, student_id) DO NOTHING;

  -- A fresh record rather than resurrecting a revoked one: the audit trail keeps
  -- the old grant and its revocation intact.
  INSERT INTO public.consent_records (student_id, tutor_user_id, granted_by, expires_at)
  VALUES (p_student_id, p_tutor_user_id, auth.uid(), now() + make_interval(months => p_months))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


--
-- Name: parent_grant_tutor_consent_by_email(uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.parent_grant_tutor_consent_by_email(p_student_id uuid, p_tutor_email text, p_months integer DEFAULT 12) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_tutor uuid;
BEGIN
  -- Authorise before any lookup, so an unauthorised caller cannot probe accounts.
  IF NOT public.may_read_results() OR NOT public.is_parent_of(p_student_id) THEN
    RAISE EXCEPTION 'only a linked parent may grant consent' USING ERRCODE = '42501';
  END IF;

  SELECT r.user_id INTO v_tutor
  FROM public.app_user_roles r
  JOIN auth.users u ON u.id = r.user_id
  WHERE r.role = 'TUTOR'
    AND lower(u.email) = lower(trim(p_tutor_email))
  LIMIT 1;

  -- One generic message for "no such tutor" and "not a tutor". Distinguishing
  -- them would turn this into an account-enumeration oracle.
  IF v_tutor IS NULL THEN
    RAISE EXCEPTION 'no tutor found for that address' USING ERRCODE = '22023';
  END IF;

  RETURN public.parent_grant_tutor_consent(p_student_id, v_tutor, p_months);
END;
$$;


--
-- Name: FUNCTION parent_grant_tutor_consent_by_email(p_student_id uuid, p_tutor_email text, p_months integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.parent_grant_tutor_consent_by_email(p_student_id uuid, p_tutor_email text, p_months integer) IS 'P10 grant by tutor email. Authorises the caller BEFORE resolving the address, and returns one generic error for unknown-address and not-a-tutor so it cannot be used to enumerate accounts. Delegates to parent_grant_tutor_consent for the actual grant.';


--
-- Name: parent_mastery(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.parent_mastery(p_student_id uuid) RETURNS TABLE(subject text, topic text, items_answered bigint, items_correct bigint, accuracy_pct numeric, mastery_level text, mastery_label text, has_signal boolean, last_practised_date_key integer, as_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'public'
    AS $$
  WITH g AS (
    SELECT *
    FROM reporting.mv_skill_gap
    WHERE student_id = p_student_id
      AND public.may_read_results()
      AND (public.is_parent_of(p_student_id) OR public.has_role('ADMIN'))
      AND subject <> '(untagged)'
      AND topic   <> '(untagged)'
  )
  SELECT
    g.subject,
    g.topic,
    g.items_answered,
    g.items_correct,
    g.accuracy_pct,
    -- Thresholds copied from severityForAccuracy(). If that function changes,
    -- this must change with it; scripts/reporting.test.mts asserts the pairing.
    CASE
      WHEN g.accuracy_pct IS NULL THEN 'unknown'
      WHEN g.accuracy_pct < 50 THEN 'critical'
      WHEN g.accuracy_pct < 75 THEN 'watch'
      ELSE 'secure'
    END                                          AS mastery_level,
    CASE
      WHEN g.accuracy_pct IS NULL THEN 'Not enough practice yet'
      WHEN g.accuracy_pct < 50 THEN 'Needs work'
      WHEN g.accuracy_pct < 75 THEN 'Watch this'
      ELSE 'Solid'
    END                                          AS mastery_label,
    -- Below five responses there is no signal, only noise: one missed question
    -- would otherwise paint a topic red and send a parent to work on something
    -- the child got wrong once. Same floor P8 uses, so the two reports cannot
    -- disagree about whether a topic is worth naming. The row is still returned
    -- (a map with holes looks broken) but flagged, so the UI renders it as
    -- "not enough practice yet" rather than as a verdict.
    (g.items_answered >= 5)                      AS has_signal,
    g.last_practised_date_key,
    g.as_at
  FROM g
  -- Weakest first among topics that have signal, so the map leads with the
  -- answer to the question the parent actually asked. Unsignalled topics sort
  -- last: they are context, not conclusions.
  --
  -- The predicate is repeated rather than referencing the `has_signal` output
  -- alias: Postgres will not accept a table-qualified alias in ORDER BY, and
  -- an unqualified one is ambiguous against a column of the same name.
  ORDER BY (g.items_answered >= 5) DESC,
           CASE WHEN g.accuracy_pct IS NULL THEN 1 ELSE 0 END,
           g.accuracy_pct ASC,
           g.items_answered DESC,
           g.subject, g.topic;
$$;


--
-- Name: FUNCTION parent_mastery(p_student_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.parent_mastery(p_student_id uuid) IS 'P3 mastery map at student x subject x topic, read from reporting.mv_skill_gap (the same view P8 ranks from, so accuracy has one owner). mastery_level thresholds mirror severityForAccuracy() in src/lib/report/readiness.ts. has_signal is false below 5 responses. Parent or ADMIN only; may_read_results() rejects a student even for their own row. No curriculum codes exist in this taxonomy, so the P3 no-codes rule holds by construction.';


--
-- Name: parent_percentile(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.parent_percentile(p_student_id uuid) RETURNS TABLE(family_group text, family_group_label text, year_level smallint, latest_score numeric, percentile_rank integer, percentile_band integer, suppressed boolean, cohort_size bigint, cohort_window_months integer, cohort_definition text, window_start date, window_end date, personal_progress_delta numeric, attempts_completed bigint, as_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'public', 'pg_catalog'
    AS $$
BEGIN
  IF NOT (public.may_read_results()
          AND (public.is_parent_of(p_student_id) OR public.has_role('ADMIN'))) THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.attempts a
    WHERE a.student_id = p_student_id
      AND a.status IN ('SUBMITTED','COMPLETE')
      AND a.score_out_of100 IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'percentile requires a completed test first (P1 readiness does not resolve)'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH hist AS (
    SELECT h.family_group AS fg,
           COUNT(*) AS n,
           (array_agg(h.personal_progress_delta ORDER BY h.started_at DESC))[1] AS delta
    FROM reporting.mv_attempt_history h
    WHERE h.student_id = p_student_id AND h.score IS NOT NULL
    GROUP BY h.family_group
  )
  SELECT pc.family_group, pc.family_group_label, pc.year_level,
         pc.latest_score, pc.percentile_rank, pc.percentile_band,
         pc.suppressed, pc.cohort_size, pc.cohort_window_months,
         pc.cohort_definition, pc.window_start, pc.window_end,
         hist.delta, hist.n, pc.as_at
  FROM reporting.mv_percentile_cohort pc
  LEFT JOIN hist ON hist.fg = pc.family_group
  WHERE pc.student_id = p_student_id
  ORDER BY hist.n DESC NULLS LAST, pc.family_group;
END;
$$;


--
-- Name: parent_plan_get(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.parent_plan_get(p_student_id uuid) RETURNS TABLE(student_id uuid, target_exam text, target_exam_type text, exam_date date, days_to_exam integer, weekly_sessions_goal integer, unit_kind text, daily_target_units numeric, required_daily numeric, effective_cap integer, plan_overload_flag boolean, updated_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'public'
    AS $$
  SELECT
    t.student_id,
    t.target_exam,
    t.target_exam_type::text,
    t.exam_date,
    -- Floored at 0, matching public.student_today(): "-3 days" is
    -- meaningless and reads as an error.
    CASE WHEN t.exam_date IS NULL THEN NULL
         ELSE GREATEST(t.exam_date - CURRENT_DATE, 0) END  AS days_to_exam,
    t.weekly_sessions_goal,
    d.unit_kind,
    d.daily_target_units,
    d.required_daily,
    d.effective_cap,
    d.plan_overload_flag,
    t.updated_at
  FROM public.student_exam_targets t
  LEFT JOIN reporting.dim_student ds
         ON ds.student_id = t.student_id AND ds.is_current
  LEFT JOIN reporting.mv_student_daily_target d
         ON d.student_key = ds.student_key
  WHERE t.student_id = p_student_id
    AND (public.is_parent_of(p_student_id) OR public.has_role('ADMIN'));
$$;


--
-- Name: FUNCTION parent_plan_get(p_student_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.parent_plan_get(p_student_id uuid) IS 'P9 plan read. Parent or ADMIN only. The sole surface exposing plan_overload_flag and required_daily - both are parent-facing by design and absent from public.student_today().';


--
-- Name: parent_plan_set(uuid, text, text, date, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.parent_plan_set(p_student_id uuid, p_target_exam text, p_target_exam_type text, p_exam_date date, p_weekly_sessions_goal integer) RETURNS TABLE(student_id uuid, target_exam text, target_exam_type text, exam_date date, weekly_sessions_goal integer, updated_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'reporting', 'public'
    AS $$
DECLARE
  v_type public.exam_type;
BEGIN
  -- Authorisation first, before any validation, so an unauthorised caller
  -- learns nothing about which of their inputs were malformed.
  IF NOT (public.is_parent_of(p_student_id) OR public.has_role('ADMIN')) THEN
    RAISE EXCEPTION 'not authorised to set this plan'
      USING ERRCODE = '42501';
  END IF;

  -- Mirror of the table CHECK constraint. Raised here rather than left to
  -- the constraint so the caller gets a readable message instead of a
  -- constraint-violation code it cannot display.
  IF p_weekly_sessions_goal IS NOT NULL
     AND (p_weekly_sessions_goal < 1 OR p_weekly_sessions_goal > 14) THEN
    RAISE EXCEPTION 'weekly_sessions_goal must be between 1 and 14'
      USING ERRCODE = '22023';
  END IF;

  -- A past exam date would make days_to_exam permanently 0 and the
  -- projection permanently meaningless.
  IF p_exam_date IS NOT NULL AND p_exam_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'exam_date cannot be in the past'
      USING ERRCODE = '22023';
  END IF;

  -- Validate against the enum before casting. An unchecked ::exam_type cast
  -- raises an invalid_text_representation error whose message embeds the
  -- caller's raw input.
  IF NULLIF(trim(COALESCE(p_target_exam_type, '')), '') IS NOT NULL THEN
    SELECT e.enumlabel::public.exam_type INTO v_type
    FROM pg_enum e
    JOIN pg_type ty ON ty.oid = e.enumtypid
    WHERE ty.typname = 'exam_type'
      AND e.enumlabel = trim(p_target_exam_type);

    IF v_type IS NULL THEN
      RAISE EXCEPTION 'unknown exam type' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_type := NULL;
  END IF;

  RETURN QUERY
  INSERT INTO public.student_exam_targets
    (student_id, target_exam, target_exam_type, exam_date,
     weekly_sessions_goal, updated_at)
  VALUES
    (p_student_id,
     NULLIF(trim(COALESCE(p_target_exam, '')), ''),
     v_type,
     p_exam_date,
     COALESCE(p_weekly_sessions_goal, 3),
     now())
  ON CONFLICT (student_id) DO UPDATE SET
    target_exam          = EXCLUDED.target_exam,
    target_exam_type     = EXCLUDED.target_exam_type,
    exam_date            = EXCLUDED.exam_date,
    weekly_sessions_goal = EXCLUDED.weekly_sessions_goal,
    updated_at           = now()
  RETURNING
    s.student_id, s.target_exam, s.target_exam_type::text,
    s.exam_date, s.weekly_sessions_goal, s.updated_at;

  -- The plan feeds dim_practice_plan and mv_student_daily_target. Without
  -- this the child's daily target would not move until the nightly load,
  -- and "Save plan" would appear to do nothing.
  PERFORM reporting.load_student_dims();
  PERFORM reporting.refresh_student_now();
END;
$$;


--
-- Name: FUNCTION parent_plan_set(p_student_id uuid, p_target_exam text, p_target_exam_type text, p_exam_date date, p_weekly_sessions_goal integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.parent_plan_set(p_student_id uuid, p_target_exam text, p_target_exam_type text, p_exam_date date, p_weekly_sessions_goal integer) IS 'P9 plan write-through. Validates goal 1..14, rejects past exam dates, validates the exam_type enum before casting, then refreshes the student dims so the daily target moves immediately.';


--
-- Name: parent_progress_summary(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.parent_progress_summary(p_student_id uuid) RETURNS TABLE(family_group text, family_group_label text, attempts_completed bigint, first_score numeric, latest_score numeric, overall_delta numeric, mean_delta numeric, sd_delta numeric, latest_attempt_id uuid, latest_started_at timestamp with time zone, trend text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'public'
    AS $$
  WITH h AS (
    SELECT *
    FROM reporting.mv_attempt_history
    WHERE student_id = p_student_id
      AND public.may_read_results()
      AND (public.is_parent_of(p_student_id) OR public.has_role('ADMIN'))
  ),
  agg AS (
    SELECT
      h.family_group,
      h.family_group_label,
      COUNT(*)                                       AS attempts_completed,
      array_agg(h.score      ORDER BY h.started_at)      AS scores_asc,
      array_agg(h.attempt_id ORDER BY h.started_at DESC) AS ids_desc,
      array_agg(h.started_at ORDER BY h.started_at DESC) AS times_desc,
      AVG(h.personal_progress_delta)                 AS mean_delta,
      STDDEV_SAMP(h.personal_progress_delta)         AS sd_delta
    FROM h
    GROUP BY h.family_group, h.family_group_label
  )
  SELECT
    a.family_group,
    a.family_group_label,
    a.attempts_completed,
    a.scores_asc[1]                                   AS first_score,
    a.scores_asc[array_length(a.scores_asc, 1)]       AS latest_score,
    a.scores_asc[array_length(a.scores_asc, 1)] - a.scores_asc[1]
                                                      AS overall_delta,
    ROUND(a.mean_delta::numeric, 1)                   AS mean_delta,
    ROUND(a.sd_delta::numeric, 2)                     AS sd_delta,
    a.ids_desc[1]                                     AS latest_attempt_id,
    a.times_desc[1]                                   AS latest_started_at,
    -- Trend is first-to-latest, not last-two-attempts: with three or four
    -- attempts a single bad sitting would otherwise flip the label, and a
    -- parent reading "declining" off one off-day is misinformed.
    CASE
      WHEN a.attempts_completed < 2 THEN 'NOT_ENOUGH_DATA'
      WHEN a.scores_asc[array_length(a.scores_asc, 1)] - a.scores_asc[1] > 0 THEN 'IMPROVING'
      WHEN a.scores_asc[array_length(a.scores_asc, 1)] - a.scores_asc[1] < 0 THEN 'DECLINING'
      ELSE 'STEADY'
    END                                               AS trend
  FROM agg a
  ORDER BY a.attempts_completed DESC, a.family_group;
$$;


--
-- Name: FUNCTION parent_progress_summary(p_student_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.parent_progress_summary(p_student_id uuid) IS 'P4 trend summary per test family, from reporting.mv_attempt_history. Parent or ADMIN only; a student is rejected by may_read_results() even for their own row.';


--
-- Name: parent_readiness_projection(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.parent_readiness_projection(p_student_id uuid) RETURNS TABLE(eligible boolean, attempts_completed bigint, exam_date date, weeks_to_exam numeric, point_projection numeric, range_low numeric, range_high numeric, projected_band_low text, projected_band_high text, confidence text, reason text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'public'
    AS $$
  WITH h AS (
    SELECT *
    FROM reporting.mv_attempt_history
    WHERE student_id = p_student_id
      AND public.may_read_results()
      AND (public.is_parent_of(p_student_id) OR public.has_role('ADMIN'))
  ),
  stats AS (
    SELECT
      COUNT(*)                                              AS n,
      MIN(h.started_at)                                     AS first_at,
      MAX(h.started_at)                                     AS last_at,
      (array_agg(h.score ORDER BY h.started_at))[1]         AS first_score,
      (array_agg(h.score ORDER BY h.started_at DESC))[1]    AS latest_score,
      STDDEV_SAMP(h.personal_progress_delta)                AS sd_delta
    FROM h
  ),
  -- Total questions answered drives the confidence label, so P1 uses the
  -- same confidenceForSample() thresholds as the emailed readiness report
  -- (<20 low, <60 medium, else high) and the two cannot disagree.
  vol AS (
    SELECT COUNT(*) AS questions_answered
    FROM reporting.fact_item_response r
    WHERE r.student_id = p_student_id
  ),
  tgt AS (
    SELECT t.exam_date
    FROM public.student_exam_targets t
    WHERE t.student_id = p_student_id
      AND t.exam_date IS NOT NULL
      AND t.exam_date >= CURRENT_DATE
    ORDER BY t.exam_date ASC
    LIMIT 1
  ),
  calc AS (
    SELECT
      s.n,
      s.latest_score,
      COALESCE(s.sd_delta, 0)::numeric                       AS sd_delta,
      g.exam_date,
      v.questions_answered,
      GREATEST((g.exam_date - CURRENT_DATE)::numeric / 7.0, 0) AS weeks_to_exam,
      -- Observed slope per week across the child's own attempts. Requires
      -- two distinct sittings; a single attempt has no slope.
      CASE
        WHEN s.n >= 2 AND s.last_at > s.first_at
          AND EXTRACT(EPOCH FROM (s.last_at - s.first_at)) > 0
        THEN (s.latest_score - s.first_score)::numeric
             / (EXTRACT(EPOCH FROM (s.last_at - s.first_at)) / 604800.0)
        ELSE 0
      END                                                    AS slope_per_week
    FROM stats s
    LEFT JOIN tgt g ON true
    CROSS JOIN vol v
  ),
  projected AS (
    SELECT
      c.n,
      c.exam_date,
      c.weeks_to_exam,
      c.questions_answered,
      c.sd_delta,
      (c.latest_score + (c.slope_per_week * c.weeks_to_exam))::numeric AS point,
      -- t shrinks as evidence grows: 1 + 3/n gives 2.0 at three attempts,
      -- 1.5 at six, 1.3 at ten. Guardrail 2 - GREATEST against sd_delta
      -- means the band can never be narrower than the child's own observed
      -- score variability, because a model cannot be more certain than the
      -- data it was fitted to.
      GREATEST(((1 + 3.0 / NULLIF(c.n, 0)) * c.sd_delta)::numeric, c.sd_delta)
        AS half_width
    FROM calc c
  )
  SELECT
    (p.n >= 3 AND p.exam_date IS NOT NULL)                   AS eligible,
    p.n                                                      AS attempts_completed,
    p.exam_date,
    ROUND(p.weeks_to_exam, 1)                                AS weeks_to_exam,
    -- Guardrail 1: fewer than three completed attempts, or no exam date,
    -- means no projection at all. NULL, not a low-confidence number - a
    -- number would be read as a forecast.
    CASE WHEN p.n >= 3 AND p.exam_date IS NOT NULL
         THEN ROUND(LEAST(GREATEST(p.point, 0), 100), 0) END AS point_projection,
    CASE WHEN p.n >= 3 AND p.exam_date IS NOT NULL
         THEN ROUND(LEAST(GREATEST(p.point - p.half_width, 0), 100), 0)
    END                                                      AS range_low,
    CASE WHEN p.n >= 3 AND p.exam_date IS NOT NULL
         THEN ROUND(LEAST(GREATEST(p.point + p.half_width, 0), 100), 0)
    END                                                      AS range_high,
    -- Guardrail 3: bands, never a decimal. Thresholds mirror
    -- bandForScore() in src/lib/report/readiness.ts exactly, so the
    -- projected band and the emailed readiness band share one vocabulary.
    CASE WHEN p.n >= 3 AND p.exam_date IS NOT NULL THEN
      CASE WHEN LEAST(GREATEST(p.point - p.half_width, 0), 100) < 50  THEN 'Needs support'
           WHEN LEAST(GREATEST(p.point - p.half_width, 0), 100) < 75  THEN 'Developing'
           WHEN LEAST(GREATEST(p.point - p.half_width, 0), 100) < 90  THEN 'Exceeding'
           ELSE 'Strongly exceeding' END
    END                                                      AS projected_band_low,
    CASE WHEN p.n >= 3 AND p.exam_date IS NOT NULL THEN
      CASE WHEN LEAST(GREATEST(p.point + p.half_width, 0), 100) < 50  THEN 'Needs support'
           WHEN LEAST(GREATEST(p.point + p.half_width, 0), 100) < 75  THEN 'Developing'
           WHEN LEAST(GREATEST(p.point + p.half_width, 0), 100) < 90  THEN 'Exceeding'
           ELSE 'Strongly exceeding' END
    END                                                      AS projected_band_high,
    -- Same thresholds as confidenceForSample().
    CASE WHEN p.questions_answered < 20 THEN 'low'
         WHEN p.questions_answered < 60 THEN 'medium'
         ELSE 'high' END                                     AS confidence,
    CASE
      WHEN p.n < 3
        THEN format('Not enough practice yet to project - %s of 3 tests completed.', p.n)
      WHEN p.exam_date IS NULL
        THEN 'Set an exam date to see a projection.'
      ELSE NULL
    END                                                      AS reason
  FROM projected p;
$$;


--
-- Name: FUNCTION parent_readiness_projection(p_student_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.parent_readiness_projection(p_student_id uuid) IS 'P1 projection: linear extrapolation of observed platform scores, range from the child''s own attempt variability. Guardrails 1-3 of 11-...md 4.4 enforced here. Bands mirror bandForScore(); confidence mirrors confidenceForSample(). Not a predictive model and not presented as one.';


--
-- Name: parent_recommendations(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.parent_recommendations(p_student_id uuid) RETURNS TABLE(recommendation_rank integer, subject text, topic text, items_answered bigint, accuracy_pct numeric, expected_impact_score numeric, reason text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'public', 'pg_catalog'
    AS $$
  SELECT r.recommendation_rank, r.subject, r.topic, r.items_answered,
         r.accuracy_pct, r.expected_impact_score, r.reason
  -- Authorise first; the scoring function is never reached otherwise.
  FROM (SELECT 1 AS ok
        WHERE public.may_read_results()
          AND (public.is_parent_of(p_student_id) OR public.has_role('ADMIN'))
       ) k
  CROSS JOIN LATERAL reporting.recommendations_scored(p_student_id) r;
$$;


--
-- Name: FUNCTION parent_recommendations(p_student_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.parent_recommendations(p_student_id uuid) IS 'P8 Next-Best Recommendations for a parent (or ADMIN). Authorisation here; the metric itself is reporting.recommendations_scored(), shared with T7 so parent and tutor cannot drift apart.';


--
-- Name: parent_revoke_tutor_consent(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.parent_revoke_tutor_consent(p_student_id uuid, p_tutor_user_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
DECLARE n integer;
BEGIN
  IF NOT public.may_read_results() OR NOT public.is_parent_of(p_student_id) THEN
    RAISE EXCEPTION 'only a linked parent may revoke consent' USING ERRCODE = '42501';
  END IF;

  UPDATE public.consent_records
  SET revoked_at = now(), revoked_by = auth.uid()
  WHERE student_id = p_student_id
    AND tutor_user_id = p_tutor_user_id
    AND revoked_at IS NULL;

  GET DIAGNOSTICS n = ROW_COUNT;
  -- The link is deliberately left in place: the parent can re-grant without
  -- re-adding the tutor. Access stops because is_tutor_of() requires live consent.
  RETURN n;
END;
$$;


--
-- Name: FUNCTION parent_revoke_tutor_consent(p_student_id uuid, p_tutor_user_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.parent_revoke_tutor_consent(p_student_id uuid, p_tutor_user_id uuid) IS 'P10 revocation. Marks every live consent for this tutor/student revoked; takes effect on the tutor''s next query because is_tutor_of() evaluates consent at read time. Leaves the link intact so access can be re-granted without re-adding the tutor. Never deletes: a consent record is an audit trail.';


--
-- Name: parent_study_behaviour(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.parent_study_behaviour(p_student_id uuid, p_weeks integer DEFAULT 12) RETURNS TABLE(week_start date, week_end date, year_level smallint, sessions bigint, weekly_sessions_goal smallint, target_adherence numeric, items_answered bigint, time_on_task_seconds bigint, median_seconds_per_item numeric, peer_median_seconds numeric, pace_vs_expected numeric, skip_rate numeric, guess_rate numeric, as_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'public'
    AS $$
  SELECT
    b.week_start, b.week_end, b.year_level, b.sessions, b.weekly_sessions_goal,
    b.target_adherence, b.items_answered, b.time_on_task_seconds,
    b.median_seconds_per_item, b.peer_median_seconds, b.pace_vs_expected,
    b.skip_rate, b.guess_rate, b.as_at
  FROM reporting.mv_study_behaviour b
  WHERE b.student_id = p_student_id
    AND public.may_read_results()
    AND (public.is_parent_of(p_student_id) OR public.has_role('ADMIN'))
    -- 13-...md 12.2 caps `weeks` at 26. Clamped here rather than validated
    -- in the route so no caller can widen the window by skipping the route.
    AND b.week_start >= (date_trunc('week', CURRENT_DATE)::date
                         - (LEAST(GREATEST(COALESCE(p_weeks, 12), 1), 26) * 7)::integer)
  ORDER BY b.week_start DESC;
$$;


--
-- Name: FUNCTION parent_study_behaviour(p_student_id uuid, p_weeks integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.parent_study_behaviour(p_student_id uuid, p_weeks integer) IS 'P7 study behaviour by ISO week from reporting.mv_study_behaviour. p_weeks clamped to 1..26. guess_rate is a rapid-wrong-answer proxy (<=10s and incorrect), not a measured flag.';


--
-- Name: parent_tutor_consents(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.parent_tutor_consents(p_student_id uuid) RETURNS TABLE(tutor_user_id uuid, tutor_email text, linked_at timestamp with time zone, consent_id uuid, granted_at timestamp with time zone, expires_at timestamp with time zone, revoked_at timestamp with time zone, is_current boolean, state text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
  SELECT
    l.tutor_user_id,
    u.email::text,
    l.created_at,
    c.id,
    c.granted_at,
    c.expires_at,
    c.revoked_at,
    (c.id IS NOT NULL AND c.revoked_at IS NULL AND c.expires_at > now()) AS is_current,
    CASE
      WHEN c.id IS NULL THEN 'NO_CONSENT'
      WHEN c.revoked_at IS NOT NULL THEN 'REVOKED'
      WHEN c.expires_at <= now() THEN 'EXPIRED'
      ELSE 'ACTIVE'
    END AS state
  FROM public.tutor_student_links l
  JOIN auth.users u ON u.id = l.tutor_user_id
  -- Most recent consent per tutor, so a re-grant after a revocation shows the
  -- live row rather than an arbitrary historical one.
  LEFT JOIN LATERAL (
    SELECT * FROM public.consent_records c2
    WHERE c2.student_id = l.student_id AND c2.tutor_user_id = l.tutor_user_id
    ORDER BY c2.granted_at DESC LIMIT 1
  ) c ON true
  WHERE l.student_id = p_student_id
    AND public.may_read_results()
    AND public.is_parent_of(p_student_id)
  ORDER BY is_current DESC, l.created_at;
$$;


--
-- Name: privilege_parity_checks(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.privilege_parity_checks() RETURNS TABLE(name text, holds boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'pg_catalog'
    AS $$
  SELECT * FROM reporting.privilege_parity_checks();
$$;


--
-- Name: read_enquiry_contact(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.read_enquiry_contact(p_enquiry_id uuid, p_task_reason text) RETURNS TABLE(full_name text, email text, phone text, message_body text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
BEGIN
  IF NOT public.has_role('ADMIN') THEN RAISE EXCEPTION 'not authorised'; END IF;
  IF p_task_reason IS NULL OR length(trim(p_task_reason)) < 12 THEN
    RAISE EXCEPTION 'a task reason of at least 12 characters is required';
  END IF;
  -- Audit BEFORE data: no path returns contact details without a record.
  INSERT INTO public.enquiry_contact_access_log (admin_user_id, enquiry_id, task_reason)
  VALUES (auth.uid(), p_enquiry_id, trim(p_task_reason));
  RETURN QUERY
  SELECT c.full_name, c.email::text, c.phone, c.message_body
  FROM public.enquiry_contacts c WHERE c.enquiry_id = p_enquiry_id;
END; $$;


--
-- Name: readiness_skill_exam_map(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.readiness_skill_exam_map() RETURNS TABLE(skill text, readiness_exam text, rationale text, is_validated boolean, applied_to_readiness boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'public', 'pg_catalog'
    AS $$
  SELECT m.skill, m.readiness_exam, m.rationale, m.is_validated, m.applied_to_readiness
  FROM reporting.skill_exam_mapping m
  ORDER BY m.skill, m.readiness_exam;
$$;


--
-- Name: record_inbound_email(text, text, text, text, timestamp with time zone, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_inbound_email(p_provider_message_id text, p_from_address text, p_to_address text, p_subject text DEFAULT NULL::text, p_received_at timestamp with time zone DEFAULT now(), p_payload jsonb DEFAULT '{}'::jsonb) RETURNS TABLE(id uuid, created boolean, accepted boolean, reason text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'reporting', 'pg_catalog'
    AS $$
DECLARE
  v_row public.inbound_email_messages%ROWTYPE;
BEGIN
  -- Service-role only by grant, but checked again here: this will be called from
  -- a route handler, and a route that ever forwards a user JWT must not be able
  -- to inject rows into the capture table.
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'inbound email may only be recorded by the service role'
      USING ERRCODE = '42501';
  END IF;

  IF p_provider_message_id IS NULL OR btrim(p_provider_message_id) = '' THEN
    RAISE EXCEPTION 'a provider message id is required' USING ERRCODE = '22023';
  END IF;

  IF NOT (SELECT t.inbound_email_enabled FROM reporting.enquiry_thresholds t WHERE t.id = 1) THEN
    RETURN QUERY SELECT NULL::uuid, false, false, 'disabled'::text;
    RETURN;
  END IF;

  INSERT INTO public.inbound_email_messages
    (provider_message_id, from_address, to_address, subject, received_at, payload)
  VALUES
    (btrim(p_provider_message_id), lower(btrim(p_from_address)), lower(btrim(p_to_address)),
     nullif(btrim(coalesce(p_subject,'')), ''), p_received_at, coalesce(p_payload, '{}'::jsonb))
  ON CONFLICT (provider_message_id) DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    -- A retry, not an error: accepted so the provider stops redelivering,
    -- created=false so the log cannot claim a new message arrived.
    SELECT m.id INTO v_row.id
    FROM public.inbound_email_messages m
    WHERE m.provider_message_id = btrim(p_provider_message_id);
    RETURN QUERY SELECT v_row.id, false, true, 'duplicate'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT v_row.id, true, true, 'stored'::text;
END;
$$;


--
-- Name: reporting_refresh_lag(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reporting_refresh_lag(p_object text) RETURNS TABLE(object_name text, last_refreshed_at timestamp with time zone, lag_minutes bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'public'
    AS $$
  SELECT
    'reporting.' || m.matviewname                              AS object_name,
    last.finished_at                                           AS last_refreshed_at,
    CASE WHEN last.finished_at IS NULL THEN NULL
         ELSE GREATEST(EXTRACT(EPOCH FROM (now() - last.finished_at)) / 60.0, 0)::bigint
    END                                                        AS lag_minutes
  FROM pg_matviews m
  LEFT JOIN LATERAL (
    SELECT MAX(r.finished_at) AS finished_at
    FROM reporting.refresh_log r
    WHERE r.object_name = m.matviewname   -- bare name, as safe_refresh() writes it
      AND r.status = 'ok'                 -- 'skipped_blackout' is NOT a refresh
      AND r.finished_at IS NOT NULL
  ) last ON true
  WHERE m.schemaname = 'reporting'
    -- Matched on the bare name so callers pass 'mv_attempt_history' rather
    -- than a schema-qualified string. An unknown name returns zero rows
    -- rather than an error, so a typo degrades to "lag unknown" instead of
    -- failing the whole report.
    AND m.matviewname = NULLIF(trim(COALESCE(p_object, '')), '');
$$;


--
-- Name: FUNCTION reporting_refresh_lag(p_object text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.reporting_refresh_lag(p_object text) IS 'Refresh lag for a reporting materialised view, by BARE name (e.g. mv_attempt_history). Counts only status=''ok'' - a skipped_blackout run is not a refresh. Exposes refresh metadata only: no student identifier, no score. Backs ReportEnvelope.meta.refreshLagMinutes.';


--
-- Name: resume_attempt_answers(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resume_attempt_answers(p_attempt_id uuid) RETURNS TABLE(question_id uuid, answer text, time_spent_seconds integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT r.question_id, r.answer, r.time_spent_seconds
  FROM public.responses r
  WHERE r.attempt_id = p_attempt_id
    AND public.is_attempt_owner(p_attempt_id);
$$;


--
-- Name: student_today(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.student_today(p_student_id uuid) RETURNS TABLE(student_id uuid, exam_label text, exam_date date, days_to_exam integer, exam_passed boolean, daily_target_units integer, unit_kind text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'public'
    AS $$
  SELECT * FROM reporting.student_today(p_student_id);
$$;


--
-- Name: FUNCTION student_today(p_student_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.student_today(p_student_id uuid) IS 'PostgREST-exposed wrapper for reporting.student_today(uuid) - reports S1 (exam countdown) and S2 (daily practice target). Authorisation is performed by the underlying function. Returns no result-bearing field of any kind.';


--
-- Name: tutor_assign_test(uuid, uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tutor_assign_test(p_student_id uuid, p_test_id uuid, p_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'reporting', 'public', 'pg_catalog'
    AS $$
DECLARE
  v_year_level integer;
  v_test       record;
  v_id         uuid := gen_random_uuid();
BEGIN
  -- Consent first, before anything is revealed about the student or the test.
  -- Checking the test's existence first would let a tutor probe which tests
  -- exist for students they have no access to.
  IF NOT public.is_tutor_of(p_student_id) THEN
    RAISE EXCEPTION 'no current consent for this student'
      USING ERRCODE = '42501';
  END IF;

  SELECT t.status::text AS status, t.title, t.year_level_min, t.year_level_max
    INTO v_test
  FROM public.tests t
  WHERE t.id = p_test_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown test' USING ERRCODE = '22023';
  END IF;

  -- Assigning a draft would hand a student unfinished content, and would also
  -- poison A1: item statistics for an unpublished form are not comparable with
  -- a live one.
  IF v_test.status <> 'PUBLISHED' THEN
    RAISE EXCEPTION 'only a published test can be assigned'
      USING ERRCODE = '22023';
  END IF;

  -- A past deadline creates an instantly OVERDUE row in T5, which is not a
  -- mistake a tutor can see or undo from the tracker.
  IF p_due_at IS NOT NULL AND p_due_at <= now() THEN
    RAISE EXCEPTION 'due date must be in the future' USING ERRCODE = '22023';
  END IF;

  SELECT sp.year_level INTO v_year_level
  FROM public.student_profiles sp WHERE sp.id = p_student_id;

  -- Enforced only when the year level is known. Refusing to assign because a
  -- profile is incomplete would block a tutor who knows the child well, and the
  -- year band is guidance rather than a safety control.
  IF v_year_level IS NOT NULL
     AND (v_year_level < v_test.year_level_min OR v_year_level > v_test.year_level_max) THEN
    RAISE EXCEPTION 'test year band % to % does not include this student (year %)',
      v_test.year_level_min, v_test.year_level_max, v_year_level
      USING ERRCODE = '22023';
  END IF;

  -- Re-assigning the same test is allowed and is NOT deduplicated: the live data
  -- already contains a student with the same test assigned twice, and setting it
  -- again after a poor attempt is a legitimate teaching action. T5 attributes each
  -- attempt to exactly one assignment (075), so duplicates do not corrupt status.
  INSERT INTO public.assignments (id, student_id, test_id, assigned_by, assigned_at, due_at)
  VALUES (v_id, p_student_id, p_test_id, auth.uid(), now(), p_due_at);

  RETURN v_id;
END;
$$;


--
-- Name: tutor_assignable_tests(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tutor_assignable_tests(p_student_id uuid, p_subject text DEFAULT NULL::text, p_topic text DEFAULT NULL::text) RETURNS TABLE(test_id uuid, title text, exam_type text, year_level_min integer, year_level_max integer, time_limit_mins integer, matching_items bigint, total_items bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'public', 'pg_catalog'
    AS $$
  WITH consented AS (
    -- No consent, no catalogue. Checked before anything is returned so this
    -- cannot be used to enumerate published tests by a caller without access.
    SELECT 1 AS ok WHERE public.is_tutor_of(p_student_id)
  ),
  student AS (
    SELECT sp.year_level FROM public.student_profiles sp WHERE sp.id = p_student_id
  ),
  per_test AS (
    SELECT t.id AS test_id, t.title, t.exam_type::text AS exam_type,
           t.year_level_min, t.year_level_max, t.time_limit_mins,
           COUNT(tq.question_id)::bigint AS total_items,
           COUNT(tq.question_id) FILTER (
             WHERE (NULLIF(btrim(p_subject), '') IS NULL OR q.subject = btrim(p_subject))
               AND (NULLIF(btrim(p_topic),   '') IS NULL OR q.topic   = btrim(p_topic))
           )::bigint AS matching_items
    FROM public.tests t
    JOIN public.test_questions tq ON tq.test_id = t.id
    JOIN public.questions q       ON q.id = tq.question_id
    WHERE t.status::text = 'PUBLISHED'
    GROUP BY t.id, t.title, t.exam_type, t.year_level_min, t.year_level_max, t.time_limit_mins
  )
  SELECT p.test_id, p.title, p.exam_type,
         p.year_level_min, p.year_level_max, p.time_limit_mins,
         p.matching_items, p.total_items
  FROM per_test p
  CROSS JOIN consented c
  LEFT JOIN student s ON true
  -- A test with no question on the recommended topic does not address the
  -- recommendation, so it is not offered at all rather than offered and ranked
  -- last: assigning it would look like acting on the advice while not doing so.
  WHERE (NULLIF(btrim(p_subject), '') IS NULL AND NULLIF(btrim(p_topic), '') IS NULL
         OR p.matching_items > 0)
    -- Year band applies only when the student's year level is known. Blocking an
    -- assignment over an incomplete profile would stop a tutor who knows the child.
    AND (s.year_level IS NULL
         OR (s.year_level >= p.year_level_min AND s.year_level <= p.year_level_max))
  ORDER BY p.matching_items DESC, p.total_items DESC, p.title;
$$;


--
-- Name: tutor_assignments(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tutor_assignments(p_status text DEFAULT NULL::text) RETURNS TABLE(assignment_id uuid, student_id uuid, student_name text, test_id uuid, test_title text, assigned_at timestamp with time zone, due_at timestamp with time zone, due_state text, assignment_status text, is_overdue boolean, attempt_status text, attempts_n integer, last_activity_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'public', 'pg_catalog'
    AS $$
  WITH consented AS (
    SELECT l.student_id
    FROM public.tutor_student_links l
    WHERE l.tutor_user_id = auth.uid()
      AND public.is_tutor_of(l.student_id)
  ),
  derived AS (
    SELECT p.assignment_id, p.student_id, p.test_id,
           -- Mutable fields come from the live table, NOT the MV snapshot (076).
           asg.assigned_at, asg.due_at,
           p.attempt_status, p.attempts_n, p.last_activity_at,
           -- A null due date is never overdue.
           (asg.due_at IS NOT NULL AND NOT p.is_finished AND asg.due_at < now()) AS is_overdue,
           CASE WHEN asg.due_at IS NULL  THEN 'NO_DUE_DATE'
                WHEN p.is_finished       THEN 'MET'
                WHEN asg.due_at < now()  THEN 'OVERDUE'
                ELSE 'ON_TIME' END AS due_state,
           CASE WHEN p.is_finished THEN 'COMPLETED'
                WHEN asg.due_at IS NOT NULL AND asg.due_at < now() THEN 'OVERDUE'
                WHEN p.is_started  THEN 'STARTED'
                ELSE 'ASSIGNED' END AS assignment_status
    FROM reporting.mv_assignment_progress p
    JOIN public.assignments asg ON asg.id = p.assignment_id
    -- Only work THIS tutor set, and only for currently-consented students.
    WHERE p.assigned_by = auth.uid()
      AND p.student_id IN (SELECT student_id FROM consented)
  )
  SELECT d.assignment_id, d.student_id, sp.username, d.test_id, t.title,
         d.assigned_at, d.due_at, d.due_state, d.assignment_status, d.is_overdue,
         d.attempt_status, d.attempts_n, d.last_activity_at
  FROM derived d
  JOIN public.student_profiles sp ON sp.id = d.student_id
  LEFT JOIN public.tests t        ON t.id = d.test_id
  WHERE p_status IS NULL OR d.assignment_status = upper(p_status)
  ORDER BY d.is_overdue DESC, d.due_at NULLS LAST, sp.username;
$$;


--
-- Name: FUNCTION tutor_assignments(p_status text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.tutor_assignments(p_status text) IS 'T5 Assignment Tracker. One row per assignment the CALLING TUTOR set, for students with a current TUTOR_REPORTING consent. assignment_status is a strict partition COMPLETED/OVERDUE/STARTED/ASSIGNED; due_state separately distinguishes NO_DUE_DATE from ON_TIME because due_at is nullable. Attempt facts come from mv_assignment_progress (hourly); due_at, consent and overdue are read live, so an assignment turns OVERDUE the moment its due date passes. p_status filters case-insensitively.';


--
-- Name: tutor_at_risk(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tutor_at_risk() RETURNS TABLE(student_id uuid, student_name text, at_risk_rule text, at_risk_severity text, rule_detail text, thresholds_validated boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'public', 'pg_catalog'
    AS $$
  WITH mine AS (
    SELECT DISTINCT l.student_id
    FROM public.tutor_student_links l
    WHERE l.tutor_user_id = auth.uid() AND public.is_tutor_of(l.student_id)
  ),
  activity AS (
    SELECT f.student_id,
           COUNT(*) FILTER (WHERE f.status IN ('SUBMITTED','COMPLETE')) AS n,
           AVG(f.score) FILTER (WHERE f.status IN ('SUBMITTED','COMPLETE')
                                  AND f.submitted_at >= now() - interval '30 days') AS recent,
           AVG(f.score) FILTER (WHERE f.status IN ('SUBMITTED','COMPLETE')
                                  AND f.submitted_at < now() - interval '30 days'
                                  AND f.submitted_at >= now() - interval '60 days') AS earlier,
           MAX(GREATEST(f.started_at, COALESCE(f.submitted_at, f.started_at))) AS last_activity
    FROM reporting.fact_test_attempt f
    WHERE f.student_id IN (SELECT student_id FROM mine)
    GROUP BY f.student_id
  ),
  targets AS (
    SELECT t.student_id, MIN(t.exam_date) AS next_exam_date
    FROM public.student_exam_targets t
    WHERE t.student_id IN (SELECT student_id FROM mine)
      AND t.exam_date IS NOT NULL
      AND t.exam_date >= (now() AT TIME ZONE 'Australia/Melbourne')::date
    GROUP BY t.student_id
  ),
  weak AS (
    SELECT g.student_id, COUNT(*) AS weak_topics
    FROM reporting.mv_skill_gap g
    WHERE g.student_id IN (SELECT student_id FROM mine)
      AND g.items_answered >= 5 AND g.accuracy_pct < 50
    GROUP BY g.student_id
  )
  SELECT m.student_id, sp.username, r.rule, r.severity, r.detail, false
  FROM mine m
  JOIN public.student_profiles sp ON sp.id = m.student_id
  LEFT JOIN activity a ON a.student_id = m.student_id
  LEFT JOIN weak w     ON w.student_id = m.student_id
  LEFT JOIN targets g  ON g.student_id = m.student_id
  CROSS JOIN reporting.at_risk_thresholds t
  CROSS JOIN LATERAL (
    VALUES
      ('DECLINING_TREND', 'high',
       format('Average fell %s pp over the last two 30-day periods (%s attempts).',
              ROUND(COALESCE(a.earlier,0) - COALESCE(a.recent,0), 1), COALESCE(a.n,0)),
       (COALESCE(a.n,0) >= t.declining_min_attempts
        AND a.earlier IS NOT NULL AND a.recent IS NOT NULL
        AND a.earlier - a.recent >= t.declining_drop_pp)),
      ('LOW_ENGAGEMENT', 'medium',
       CASE WHEN a.last_activity IS NULL
         THEN format('No practice session yet, with an exam target on %s.',
                     to_char(g.next_exam_date, 'DD Mon YYYY'))
         ELSE format('No practice session for %s days, with an exam target on %s.',
                     GREATEST(0, EXTRACT(DAY FROM now() - a.last_activity)::int),
                     to_char(g.next_exam_date, 'DD Mon YYYY'))
       END,
       (g.student_id IS NOT NULL
        AND (a.last_activity IS NULL
             OR a.last_activity < now() - make_interval(days => t.low_engagement_days)))),
      ('REPEATED_MISCONCEPTION', 'high',
       format('%s topic(s) below 50%% across at least 5 responses each.', COALESCE(w.weak_topics,0)),
       (COALESCE(w.weak_topics,0) >= t.misconception_min_attempts))
  ) AS r(rule, severity, detail, fired)
  WHERE t.id = 1 AND r.fired
  ORDER BY CASE r.severity WHEN 'high' THEN 0 ELSE 1 END, sp.username;
$$;


--
-- Name: FUNCTION tutor_at_risk(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.tutor_at_risk() IS 'T3 at-risk list, consented students only. Every row names its rule and explains it in words, because TU1 requires that a tutor be able to disagree with a flag. thresholds_validated is false: seeded defaults, not validated cut-points.';


--
-- Name: tutor_item_analysis(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tutor_item_analysis(p_test_id uuid) RETURNS TABLE(period_label text, test_id uuid, item_id uuid, subject text, topic text, responses bigint, students bigint, enough_evidence boolean, p_value numeric, point_biserial numeric, median_time_seconds numeric, skip_rate_pct numeric, skip_rate_reliable boolean, marking_reliable boolean, item_flag_rate_pct numeric, key_option text, distractors jsonb, dead_distractors text[], defect_reasons text[], is_defective boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'public', 'pg_catalog'
    AS $$
DECLARE
  v_students uuid[];
BEGIN
  IF p_test_id IS NULL THEN
    RAISE EXCEPTION 'testId is required' USING ERRCODE = '22023';
  END IF;

  -- §4.5: an assignments row with assigned_by = auth.uid() for THIS test,
  -- combined with current consent. 403, not an empty list (§12).
  IF NOT EXISTS (
    SELECT 1 FROM public.assignments a
    WHERE a.test_id = p_test_id AND a.assigned_by = auth.uid()
  ) THEN
    RAISE EXCEPTION 'item analysis requires a test this tutor assigned'
      USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(DISTINCT a.student_id)
    INTO v_students
  FROM public.assignments a
  WHERE a.test_id = p_test_id
    AND a.assigned_by = auth.uid()
    AND public.is_tutor_of(a.student_id);

  IF v_students IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT s.period_label, s.test_id, s.item_id, s.subject, s.topic,
         s.responses, s.students, s.enough_evidence,
         s.p_value, s.point_biserial, s.median_time_seconds,
         s.skip_rate_pct, s.skip_rate_reliable, s.marking_reliable,
         s.item_flag_rate_pct, s.key_option, s.distractors,
         s.dead_distractors, s.defect_reasons, s.is_defective
  FROM reporting.item_statistics(p_test_id, v_students) s;
END;
$$;


--
-- Name: tutor_recommendations(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tutor_recommendations(p_student_id uuid DEFAULT NULL::uuid) RETURNS TABLE(student_id uuid, student_name text, recommendation_rank integer, subject text, topic text, items_answered bigint, accuracy_pct numeric, expected_impact_score numeric, reason text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'public', 'pg_catalog'
    AS $$
  WITH mine AS (
    SELECT l.student_id
    FROM public.tutor_student_links l
    WHERE l.tutor_user_id = auth.uid()
      AND public.is_tutor_of(l.student_id)
      AND (p_student_id IS NULL OR l.student_id = p_student_id)
  )
  SELECT m.student_id, sp.username, r.recommendation_rank, r.subject, r.topic,
         r.items_answered, r.accuracy_pct, r.expected_impact_score, r.reason
  FROM mine m
  JOIN public.student_profiles sp ON sp.id = m.student_id
  CROSS JOIN LATERAL reporting.recommendations_scored(m.student_id) r
  ORDER BY sp.username, r.recommendation_rank;
$$;


--
-- Name: FUNCTION tutor_recommendations(p_student_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.tutor_recommendations(p_student_id uuid) IS 'T7 Next-Best Recommendations for a tutor: the same ranked recommendations the parent sees (reporting.recommendations_scored, shared with P8), scoped to students the tutor is linked to AND has a current TUTOR_REPORTING consent for. At most three per student (B12). p_student_id is an optional filter. Read-only: the Assign action is not wired - see the note in migration 074.';


--
-- Name: tutor_remind(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tutor_remind(p_assignment_id uuid) RETURNS TABLE(queued integer, already_sent integer, unreachable integer, reason text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'reporting', 'public', 'pg_catalog'
    AS $$
DECLARE
  v_assignment  record;
  v_day         text := to_char(now(), 'YYYY-MM-DD');
  v_recipient   record;
  v_queued      integer := 0;
  v_already     integer := 0;
  v_unreachable integer := 0;
  v_expected    integer := 0;
BEGIN
  SELECT a.student_id, a.test_id, a.assigned_by, a.due_at
    INTO v_assignment
  FROM public.assignments a
  WHERE a.id = p_assignment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown assignment' USING ERRCODE = '22023';
  END IF;

  -- Only the tutor who SET the work may chase it.
  IF v_assignment.assigned_by <> auth.uid() THEN
    RAISE EXCEPTION 'this assignment belongs to another tutor'
      USING ERRCODE = '42501';
  END IF;

  -- Re-checks live consent, so a revocation blocks reminders immediately.
  IF NOT public.is_tutor_of(v_assignment.student_id) THEN
    RAISE EXCEPTION 'no current consent for this student'
      USING ERRCODE = '42501';
  END IF;

  -- Every linked recipient, whether or not they can actually be emailed, so the
  -- unreachable count is measured rather than inferred from what happened to
  -- succeed.
  CREATE TEMP TABLE IF NOT EXISTS _remind_recipients (
    user_id uuid, email text, kind text
  ) ON COMMIT DROP;
  DELETE FROM _remind_recipients;

  INSERT INTO _remind_recipients (user_id, email, kind)
  SELECT sp.auth_user_id, u.email, 'STUDENT'
  FROM public.student_profiles sp
  LEFT JOIN auth.users u ON u.id = sp.auth_user_id
  WHERE sp.id = v_assignment.student_id
  UNION ALL
  SELECT psl.parent_user_id, u.email, 'PARENT'
  FROM public.parent_student_links psl
  LEFT JOIN auth.users u ON u.id = psl.parent_user_id
  WHERE psl.student_id = v_assignment.student_id;

  SELECT COUNT(*) INTO v_expected FROM _remind_recipients;

  FOR v_recipient IN
    SELECT * FROM _remind_recipients WHERE email IS NOT NULL
  LOOP
    BEGIN
      INSERT INTO public.email_log
        (user_id, recipient, template, dedupe_key, status, subject, payload)
      VALUES (
        v_recipient.user_id,
        v_recipient.email,
        'tutor_assignment_reminder',
        format('%s:%s', p_assignment_id, v_day),
        'QUEUED',
        'A reminder about work set by your tutor',
        jsonb_build_object(
          'assignment_id',  p_assignment_id,
          'student_id',     v_assignment.student_id,
          'test_id',        v_assignment.test_id,
          'tutor_user_id',  auth.uid(),
          'recipient_kind', v_recipient.kind,
          'due_at',         v_assignment.due_at
        )
      );
      v_queued := v_queued + 1;
    EXCEPTION WHEN unique_violation THEN
      -- Already reminded this recipient about this assignment today. Counted
      -- separately, never merged into the queued total.
      v_already := v_already + 1;
    END;
  END LOOP;

  v_unreachable := v_expected - v_queued - v_already;

  queued       := v_queued;
  already_sent := v_already;
  unreachable  := v_unreachable;
  reason       := CASE
    WHEN v_expected = 0
      THEN 'This student has no linked recipient, so nothing could be queued.'
    WHEN v_queued > 0 AND v_already = 0 AND v_unreachable = 0
      THEN format('Reminder queued for %s recipient%s.',
                  v_queued, CASE WHEN v_queued = 1 THEN '' ELSE 's' END)
    WHEN v_queued > 0
      THEN format('Reminder queued for %s recipient%s%s%s.',
                  v_queued, CASE WHEN v_queued = 1 THEN '' ELSE 's' END,
                  CASE WHEN v_already > 0
                       THEN format('; %s already reminded today', v_already) ELSE '' END,
                  CASE WHEN v_unreachable > 0
                       THEN format('; %s has no email on record', v_unreachable) ELSE '' END)
    WHEN v_already > 0 AND v_unreachable = 0
      THEN 'A reminder for this assignment was already sent today.'
    WHEN v_already = 0
      THEN 'No recipient for this student has an email address on record, so nothing could be queued.'
    ELSE 'A reminder was already sent today, and no other recipient has an email on record.'
  END;

  RETURN NEXT;
END;
$$;


--
-- Name: tutor_skill_gaps(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tutor_skill_gaps() RETURNS TABLE(student_id uuid, student_name text, subject text, topic text, items_answered bigint, accuracy_pct numeric, mastery_level text, has_signal boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'public', 'pg_catalog'
    AS $$
  SELECT g.student_id, sp.username, g.subject, g.topic,
         g.items_answered, g.accuracy_pct,
         CASE WHEN g.accuracy_pct IS NULL THEN 'unknown'
              WHEN g.accuracy_pct < 50 THEN 'critical'
              WHEN g.accuracy_pct < 75 THEN 'watch'
              ELSE 'secure' END,
         (g.items_answered >= 5)
  FROM reporting.mv_skill_gap g
  JOIN public.student_profiles sp ON sp.id = g.student_id
  WHERE public.is_tutor_of(g.student_id)
    AND g.subject <> '(untagged)' AND g.topic <> '(untagged)'
  ORDER BY sp.username, (g.items_answered >= 5) DESC, g.accuracy_pct ASC NULLS LAST;
$$;


--
-- Name: tutor_student_overview(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tutor_student_overview(p_period_days integer DEFAULT 30) RETURNS TABLE(student_id uuid, student_name text, year_level integer, assigned_count bigint, completed_count bigint, completion_rate numeric, current_attempts bigint, current_score numeric, prior_attempts bigint, prior_score numeric, movement_pp numeric, consent_expires_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'reporting', 'public', 'pg_catalog'
    AS $$
  WITH mine AS (
    SELECT l.student_id,
           (SELECT max(c.expires_at) FROM public.consent_records c
             WHERE c.student_id = l.student_id AND c.tutor_user_id = auth.uid()
               AND c.revoked_at IS NULL AND c.expires_at > now()) AS consent_expires_at
    FROM public.tutor_student_links l
    WHERE l.tutor_user_id = auth.uid() AND public.is_tutor_of(l.student_id)
  ),
  att AS (
    SELECT f.student_id,
           COUNT(*) FILTER (WHERE f.submitted_at >= now() - make_interval(days => p_period_days)) AS cur_n,
           AVG(f.score) FILTER (WHERE f.submitted_at >= now() - make_interval(days => p_period_days)) AS cur_score,
           COUNT(*) FILTER (WHERE f.submitted_at < now() - make_interval(days => p_period_days)
                              AND f.submitted_at >= now() - make_interval(days => p_period_days * 2)) AS prior_n,
           AVG(f.score) FILTER (WHERE f.submitted_at < now() - make_interval(days => p_period_days)
                              AND f.submitted_at >= now() - make_interval(days => p_period_days * 2)) AS prior_score
    FROM reporting.fact_test_attempt f
    WHERE f.status IN ('SUBMITTED','COMPLETE') AND f.student_id IN (SELECT student_id FROM mine)
    GROUP BY f.student_id
  ),
  asg AS (
    SELECT a.student_id, COUNT(*) AS assigned_n,
           COUNT(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM public.attempts at
             WHERE at.student_id = a.student_id AND at.test_id = a.test_id
               AND at.status IN ('SUBMITTED','COMPLETE')
           )) AS completed_n
    FROM public.assignments a
    WHERE a.assigned_by = auth.uid() AND a.student_id IN (SELECT student_id FROM mine)
    GROUP BY a.student_id
  )
  SELECT m.student_id, sp.username, sp.year_level,
         COALESCE(asg.assigned_n, 0), COALESCE(asg.completed_n, 0),
         CASE WHEN COALESCE(asg.assigned_n,0) > 0
              THEN ROUND(100.0 * asg.completed_n / asg.assigned_n, 1) END,
         COALESCE(att.cur_n, 0), ROUND(att.cur_score, 1),
         COALESCE(att.prior_n, 0), ROUND(att.prior_score, 1),
         CASE WHEN COALESCE(att.cur_n,0) >= 2 AND COALESCE(att.prior_n,0) >= 2
              THEN ROUND(att.cur_score - att.prior_score, 1) END,
         m.consent_expires_at
  FROM mine m
  JOIN public.student_profiles sp ON sp.id = m.student_id
  LEFT JOIN att ON att.student_id = m.student_id
  LEFT JOIN asg ON asg.student_id = m.student_id
  ORDER BY sp.username;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: app_user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_user_roles (
    user_id uuid NOT NULL,
    role public.user_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    test_id uuid NOT NULL,
    assigned_by uuid NOT NULL,
    assigned_at timestamp with time zone DEFAULT now(),
    due_at timestamp with time zone
);


--
-- Name: attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    test_id uuid NOT NULL,
    started_at timestamp with time zone DEFAULT now(),
    submitted_at timestamp with time zone,
    status public.attempt_status DEFAULT 'IN_PROGRESS'::public.attempt_status,
    score_out_of100 numeric(5,2),
    section_scores jsonb,
    raw_accuracy numeric(5,2),
    weighted_score numeric(5,2),
    time_spent_seconds integer,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: consent_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consent_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    tutor_user_id uuid NOT NULL,
    purpose text DEFAULT 'TUTOR_REPORTING'::text NOT NULL,
    granted_by uuid NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '1 year'::interval) NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT consent_expiry_after_grant CHECK ((expires_at > granted_at)),
    CONSTRAINT consent_purpose_chk CHECK ((purpose = 'TUTOR_REPORTING'::text)),
    CONSTRAINT consent_revoker_is_grantor_side CHECK (((revoked_at IS NULL) OR (revoked_by IS NOT NULL)))
);


--
-- Name: TABLE consent_records; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.consent_records IS 'Parent-granted permission for a tutor to read a student''s reports (067, D-B). Current = purpose TUTOR_REPORTING AND revoked_at IS NULL AND expires_at > now(), evaluated at query time so revocation and expiry take effect immediately with no job. Default duration 12 months.';


--
-- Name: email_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    recipient text NOT NULL,
    template text NOT NULL,
    dedupe_key text DEFAULT ''::text NOT NULL,
    provider text DEFAULT 'resend'::text NOT NULL,
    provider_message_id text,
    status text DEFAULT 'QUEUED'::text NOT NULL,
    error text,
    subject text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    CONSTRAINT email_log_status_check CHECK ((status = ANY (ARRAY['QUEUED'::text, 'SENT'::text, 'FAILED'::text, 'SKIPPED'::text, 'BOUNCED'::text])))
);


--
-- Name: TABLE email_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.email_log IS 'Outbound email audit log. SELECT revoked from authenticated and anon (migration 048): touched only by src/lib/email/provider.ts via the service role. Contains recipient addresses (PII) and `payload`, which for the readiness report holds the child''s full score, band and topic gaps. RLS is enabled with no policies (default-deny); the grant removal is what makes that durable against a future permissive policy.';


--
-- Name: enquiries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enquiries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    enquiry_type text DEFAULT 'other'::text NOT NULL,
    parent_user_id uuid,
    status text DEFAULT 'new'::text NOT NULL,
    assigned_to uuid,
    first_response_at timestamp with time zone,
    resolved_at timestamp with time zone,
    outcome text,
    converted_order_id uuid,
    converted_at timestamp with time zone,
    ingest_source_ref text,
    utm_source text,
    utm_medium text,
    utm_campaign text,
    utm_term text,
    utm_content text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    converted_ref text,
    converted_ref_kind text,
    CONSTRAINT enquiries_channel_check CHECK ((channel = ANY (ARRAY['web_form'::text, 'email'::text, 'chat'::text]))),
    CONSTRAINT enquiries_conversion_needs_when CHECK ((((converted_order_id IS NULL) AND (converted_ref IS NULL)) OR (converted_at IS NOT NULL))),
    CONSTRAINT enquiries_conversion_reference_needs_ref CHECK (((converted_ref_kind IS NULL) OR (converted_ref IS NOT NULL))),
    CONSTRAINT enquiries_conversion_reference_sane CHECK (((converted_ref IS NULL) OR ((converted_ref_kind IS NOT NULL) AND (converted_ref_kind = ANY (ARRAY['purchase'::text, 'subscription'::text, 'invoice'::text, 'other'::text])) AND ((length(btrim(converted_ref)) >= 1) AND (length(btrim(converted_ref)) <= 200))))),
    CONSTRAINT enquiries_converted_has_order CHECK (((converted_at IS NULL) OR (converted_order_id IS NOT NULL) OR (converted_ref IS NOT NULL))),
    CONSTRAINT enquiries_enquiry_type_check CHECK ((enquiry_type = ANY (ARRAY['billing'::text, 'technical'::text, 'privacy'::text, 'accessibility'::text, 'product_question'::text, 'refund'::text, 'complaint'::text, 'other'::text]))),
    CONSTRAINT enquiries_outcome_check CHECK ((outcome = ANY (ARRAY['answered'::text, 'refunded'::text, 'escalated'::text, 'no_action'::text, 'spam'::text, 'duplicate'::text, 'withdrawn'::text]))),
    CONSTRAINT enquiries_resolved_has_outcome CHECK (((status <> ALL (ARRAY['resolved'::text, 'closed'::text])) OR (outcome IS NOT NULL))),
    CONSTRAINT enquiries_status_check CHECK ((status = ANY (ARRAY['new'::text, 'triaged'::text, 'in_progress'::text, 'waiting_on_customer'::text, 'resolved'::text, 'closed'::text, 'spam'::text]))),
    CONSTRAINT enquiries_timeline_sane CHECK (((first_response_at IS NULL) OR (resolved_at IS NULL) OR (first_response_at <= resolved_at)))
);

ALTER TABLE ONLY public.enquiries FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE enquiries; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.enquiries IS 'Inbound enquiries across web_form, email and chat. Reportable: contains no free-text field and no contact detail, so reporting.fact_enquiry can be built from this table alone. Written only through public.ingest_enquiry() - INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER are revoked from anon and authenticated so that the two-table transaction inside that function is the only way an enquiry can come into existence.';


--
-- Name: COLUMN enquiries.ingest_source_ref; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.enquiries.ingest_source_ref IS 'Provider message id (email), transcript id (chat) or server-generated id (web form). With `channel` this is the idempotency key that stops a retried webhook double-counting an enquiry.';


--
-- Name: COLUMN enquiries.converted_ref; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.enquiries.converted_ref IS 'External reference for the order this enquiry became when it is not a purchases row: a subscription id, an invoice id, or a purchase id. Recorded by an admin, never inferred.';


--
-- Name: COLUMN enquiries.converted_ref_kind; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.enquiries.converted_ref_kind IS 'What converted_ref points at: purchase | subscription | invoice | other. Required whenever converted_ref is set, because a bare identifier with no stated type cannot be checked later by anyone, including whoever wrote it.';


--
-- Name: enquiry_contact_access_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enquiry_contact_access_log (
    log_id bigint NOT NULL,
    accessed_at timestamp with time zone DEFAULT now() NOT NULL,
    admin_user_id uuid NOT NULL,
    enquiry_id uuid NOT NULL,
    task_reason text NOT NULL,
    CONSTRAINT enquiry_contact_access_log_task_reason_check CHECK ((length(TRIM(BOTH FROM task_reason)) >= 12))
);

ALTER TABLE ONLY public.enquiry_contact_access_log FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE enquiry_contact_access_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.enquiry_contact_access_log IS 'Append-only record of every enquiry contact reveal. 115 revoked UPDATE and DELETE from service_role as well as the app roles: the privacy promise this table exists to evidence is only as good as the impossibility of editing it. Owner (postgres) retains all privileges for recovery, and read_enquiry_contact writes as SECURITY DEFINER so it is unaffected.';


--
-- Name: enquiry_contact_access_log_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.enquiry_contact_access_log ALTER COLUMN log_id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.enquiry_contact_access_log_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: enquiry_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enquiry_contacts (
    enquiry_id uuid NOT NULL,
    full_name text,
    email extensions.citext,
    phone text,
    message_body text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.enquiry_contacts FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE enquiry_contacts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.enquiry_contacts IS 'RESTRICTED. Excluded from the reporting schema: no view, no MV, no join path. NO RLS policy for any role; readable only through public.read_enquiry_contact(enquiry_id, task_reason), which audits before returning.';


--
-- Name: enquiry_throttle; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enquiry_throttle (
    fp text NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    window_start timestamp with time zone DEFAULT now() NOT NULL,
    submissions integer DEFAULT 0 NOT NULL,
    CONSTRAINT enquiry_throttle_count_shape CHECK ((submissions >= 0)),
    CONSTRAINT enquiry_throttle_fp_shape CHECK ((fp ~ '^[0-9a-f]{64}$'::text))
);

ALTER TABLE ONLY public.enquiry_throttle FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE enquiry_throttle; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.enquiry_throttle IS 'Spam control for POST /api/enquiries. One row per visitor fingerprint (peppered SHA-256 of the client IP - the raw IP is never stored). Written and read only by public.enquiry_throttle_check(), which is service-role-only. Excluded from the reporting schema and given no RLS policy for any app role.';


--
-- Name: entitlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entitlements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    purchase_id uuid NOT NULL,
    test_id uuid NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: experiment_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.experiment_assignments (
    experiment_key text NOT NULL,
    subject_key text NOT NULL,
    variant text NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: experiment_exposures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.experiment_exposures (
    experiment_key text NOT NULL,
    subject_key text NOT NULL,
    variant text NOT NULL,
    exposed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE experiment_exposures; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.experiment_exposures IS 'A12 exposure log: first actual sighting of an arm per subject. Separate from assignment because counting assigned-but-never-shown users biases every experiment toward the null (11-...md 5.4). First-exposure-only: every A12 metric counts DISTINCT subjects, so repeats add no information.';


--
-- Name: experiments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.experiments (
    experiment_key text NOT NULL,
    name text NOT NULL,
    hypothesis text,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    variants jsonb DEFAULT '["control", "variant"]'::jsonb NOT NULL,
    control_variant text DEFAULT 'control'::text NOT NULL,
    weights jsonb DEFAULT '[50, 50]'::jsonb NOT NULL,
    conversion_event text DEFAULT 'CHECKOUT_COMPLETED'::text NOT NULL,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT experiments_control_in_variants_chk CHECK ((variants ? control_variant)),
    CONSTRAINT experiments_status_chk CHECK ((status = ANY (ARRAY['DRAFT'::text, 'RUNNING'::text, 'CONCLUDED'::text]))),
    CONSTRAINT experiments_variants_array_chk CHECK ((jsonb_typeof(variants) = 'array'::text)),
    CONSTRAINT experiments_weights_array_chk CHECK ((jsonb_typeof(weights) = 'array'::text))
);


--
-- Name: TABLE experiments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.experiments IS 'A12 experiment definitions. SELECT revoked from authenticated and anon (migration 065): results are served only through public.admin_experiment_results(), which returns per-arm aggregates and no definitions. `variants` and `weights` are parallel jsonb arrays. Assignment is persisted in experiment_assignments so editing weights mid-flight cannot retroactively move users between arms. `conversion_event` names the funnel event counted as a conversion.';


--
-- Name: funnel_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.funnel_state (
    user_id uuid NOT NULL,
    stage text DEFAULT 'SIGNED_UP'::text NOT NULL,
    stage_updated_at timestamp with time zone DEFAULT now() NOT NULL,
    signed_up_at timestamp with time zone,
    first_student_at timestamp with time zone,
    diagnostic_started_at timestamp with time zone,
    diagnostic_completed_at timestamp with time zone,
    report_sent_at timestamp with time zone,
    second_session_offered_at timestamp with time zone,
    second_session_expires_at timestamp with time zone,
    second_session_completed_at timestamp with time zone,
    completed_attempts integer DEFAULT 0 NOT NULL,
    offer_id uuid,
    offer_made_at timestamp with time zone,
    offer_expires_at timestamp with time zone,
    offer_redeemed_at timestamp with time zone,
    first_purchase_at timestamp with time zone,
    first_purchase_amount_cents integer,
    lifetime_value_cents integer DEFAULT 0 NOT NULL,
    products_purchased integer DEFAULT 0 NOT NULL,
    onboarded_at timestamp with time zone,
    expanded_at timestamp with time zone,
    renewed_at timestamp with time zone,
    referred_by_code text,
    marketing_opt_in boolean DEFAULT false NOT NULL,
    email_suppressed boolean DEFAULT false NOT NULL,
    email text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT funnel_state_stage_check CHECK ((stage = ANY (ARRAY['SIGNED_UP'::text, 'STUDENT_ADDED'::text, 'DIAGNOSTIC_STARTED'::text, 'FIRST_VALUE'::text, 'REPORT_SENT'::text, 'SECOND_OFFERED'::text, 'PAYWALL_READY'::text, 'OFFER_MADE'::text, 'CUSTOMER'::text, 'ONBOARDED'::text, 'EXPANDED'::text, 'RENEWED'::text])))
);


--
-- Name: TABLE funnel_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.funnel_state IS 'One row per parent: current funnel stage, stage timestamps, offer window and contact preferences. Server-written; clients may read their own row only.';


--
-- Name: funnel_conversion; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.funnel_conversion AS
 SELECT stage,
    public.funnel_stage_rank(stage) AS stage_rank,
    count(*) AS users,
    count(*) FILTER (WHERE (completed_attempts >= 1)) AS did_diagnostic,
    count(*) FILTER (WHERE (completed_attempts >= 2)) AS reached_paywall,
    count(*) FILTER (WHERE (first_purchase_at IS NOT NULL)) AS became_customer,
    count(*) FILTER (WHERE (expanded_at IS NOT NULL)) AS bought_second,
    count(*) FILTER (WHERE (renewed_at IS NOT NULL)) AS renewed,
    round(avg(lifetime_value_cents)) AS avg_ltv_cents
   FROM public.funnel_state s
  GROUP BY stage;


--
-- Name: funnel_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.funnel_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    anonymous_id text,
    student_id uuid,
    event text NOT NULL,
    stage text,
    props jsonb DEFAULT '{}'::jsonb NOT NULL,
    utm jsonb,
    referrer text,
    path text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT funnel_events_identity CHECK (((user_id IS NOT NULL) OR (anonymous_id IS NOT NULL)))
);


--
-- Name: TABLE funnel_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.funnel_events IS 'Append-only funnel event store. SELECT is revoked from authenticated and anon (migration 047): every read goes through src/lib/funnel/track.ts using the service role. RLS is enabled with no policies, which is default-deny, but the grant removal is what makes that durable - a future permissive policy cannot expose the table without also re-granting SELECT. Results (score, band, correctness) must never appear in props: this table is written from student sessions.';


--
-- Name: inbound_email_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inbound_email_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_message_id text NOT NULL,
    from_address text NOT NULL,
    to_address text NOT NULL,
    subject text,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    payload jsonb NOT NULL,
    disposition text DEFAULT 'pending'::text NOT NULL,
    enquiry_id uuid,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inbound_email_converted_has_enquiry CHECK (((disposition <> 'converted'::text) OR (enquiry_id IS NOT NULL))),
    CONSTRAINT inbound_email_messages_disposition_check CHECK ((disposition = ANY (ARRAY['pending'::text, 'converted'::text, 'rejected'::text, 'ignored'::text]))),
    CONSTRAINT inbound_email_messages_provider_message_id_check CHECK ((btrim(provider_message_id) <> ''::text)),
    CONSTRAINT inbound_email_payload_bounded CHECK ((octet_length((payload)::text) <= 262144)),
    CONSTRAINT inbound_email_pending_has_no_enquiry CHECK (((disposition <> 'pending'::text) OR (enquiry_id IS NULL)))
);

ALTER TABLE ONLY public.inbound_email_messages FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE inbound_email_messages; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.inbound_email_messages IS 'Inbound support email captured but NOT yet converted to enquiries (decision 3-A, shipped dark). PII-bearing. RLS enabled and forced with no policy: reachable only via record_inbound_email as service_role. Nothing reads disposition yet; conversion awaits a verified provider contract.';


--
-- Name: my_access; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.my_access AS
 SELECT auth.uid() AS user_id,
    public.has_active_subscription(auth.uid()) AS is_unlimited;


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    link_url text,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: offers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.offers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    kind text NOT NULL,
    stripe_price_id text,
    original_amount_cents integer,
    offer_amount_cents integer NOT NULL,
    currency text DEFAULT 'AUD'::text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    guarantee_days integer DEFAULT 14 NOT NULL,
    per_user_window_hours integer,
    per_user_limit integer DEFAULT 1 NOT NULL,
    eligible_from_stage text,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT offers_guarantee_days_check CHECK ((guarantee_days >= 0)),
    CONSTRAINT offers_offer_amount_cents_check CHECK ((offer_amount_cents >= 0)),
    CONSTRAINT offers_original_amount_cents_check CHECK ((original_amount_cents >= 0)),
    CONSTRAINT offers_per_user_limit_check CHECK ((per_user_limit >= 1)),
    CONSTRAINT offers_per_user_window_hours_check CHECK (((per_user_window_hours IS NULL) OR (per_user_window_hours > 0)))
);


--
-- Name: parent_student_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parent_student_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    parent_user_id uuid NOT NULL,
    student_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: practice_rest_days; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.practice_rest_days (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    rest_date date NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: processed_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.processed_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id text NOT NULL,
    job_type text NOT NULL,
    processed_at timestamp with time zone DEFAULT now()
);


--
-- Name: processed_webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.processed_webhook_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text DEFAULT 'Stripe'::text NOT NULL,
    event_id text NOT NULL,
    processed_at timestamp with time zone DEFAULT now()
);


--
-- Name: product_tests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_tests (
    product_id uuid NOT NULL,
    test_id uuid NOT NULL
);


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    active boolean DEFAULT true,
    price_cents integer NOT NULL,
    currency text DEFAULT 'AUD'::text NOT NULL,
    stripe_price_id text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT products_price_cents_check CHECK ((price_cents >= 0))
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    stripe_customer_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE profiles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.profiles IS '1:1 with auth.users. Holds stripe_customer_id so the Customer Portal and webhooks can resolve an account, and so a parent does not accumulate duplicate Stripe customers. Rows are created by the on_auth_user_created_profile trigger; without it the webhook UPDATE silently affects zero rows.';


--
-- Name: purchases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    provider text DEFAULT 'Stripe'::text NOT NULL,
    provider_ref text,
    total_amount_cents integer NOT NULL,
    currency text DEFAULT 'AUD'::text NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    stripe_customer_id text,
    product_id uuid,
    payment_intent text,
    CONSTRAINT purchases_total_amount_cents_check CHECK ((total_amount_cents >= 0))
);


--
-- Name: questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type public.question_type NOT NULL,
    stem text NOT NULL,
    comprehension_text text,
    image_url text,
    correct_answer text,
    explanation text,
    explanation_steps jsonb,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    status public.content_status DEFAULT 'DRAFT'::public.content_status NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    exam_id text,
    exam_type public.exam_type,
    exam_section text,
    year_level integer,
    subject text,
    topic text,
    sub_topic text,
    answer_a text,
    answer_b text,
    answer_c text,
    answer_d text,
    answer_e text,
    difficulty integer DEFAULT 2,
    difficulty_dynamic numeric,
    discrimination_index numeric,
    average_time_seconds integer,
    explanation_media text,
    is_active boolean DEFAULT true,
    correct_answer_score integer DEFAULT 1,
    skill_grammar numeric DEFAULT 0,
    skill_spelling numeric DEFAULT 0,
    skill_vocabulary numeric DEFAULT 0,
    skill_reading numeric DEFAULT 0,
    skill_writing numeric DEFAULT 0,
    skill_algebra numeric DEFAULT 0,
    skill_word_problems numeric DEFAULT 0,
    skill_geometry numeric DEFAULT 0,
    skill_statistics numeric DEFAULT 0,
    skill_mental_maths numeric DEFAULT 0,
    skill_problem_solving numeric DEFAULT 0,
    skill_numerical_reasoning numeric DEFAULT 0,
    skill_verbal_reasoning numeric DEFAULT 0,
    skill_logical_reasoning numeric DEFAULT 0,
    skill_critical_thinking numeric DEFAULT 0,
    total_attempts integer DEFAULT 0,
    correct_attempts integer DEFAULT 0,
    success_rate numeric,
    avg_time_taken_seconds integer,
    most_common_wrong_answer text,
    skip_rate numeric,
    flag_count integer DEFAULT 0,
    CONSTRAINT questions_difficulty_check CHECK (((difficulty >= 1) AND (difficulty <= 5))),
    CONSTRAINT questions_year_level_check CHECK (((year_level >= 2) AND (year_level <= 9)))
);


--
-- Name: referral_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referral_codes (
    code text NOT NULL,
    owner_user_id uuid,
    kind text DEFAULT 'PARENT'::text NOT NULL,
    reward_kind text DEFAULT 'CREDIT_CENTS'::text NOT NULL,
    reward_value integer DEFAULT 0 NOT NULL,
    referee_offer_id uuid,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT referral_codes_kind_check CHECK ((kind = ANY (ARRAY['PARENT'::text, 'CAMPAIGN'::text]))),
    CONSTRAINT referral_codes_reward_kind_check CHECK ((reward_kind = ANY (ARRAY['CREDIT_CENTS'::text, 'FREE_MONTH'::text, 'NONE'::text]))),
    CONSTRAINT referral_codes_reward_value_check CHECK ((reward_value >= 0))
);


--
-- Name: referrals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referrals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    referee_user_id uuid NOT NULL,
    referred_at timestamp with time zone DEFAULT now() NOT NULL,
    activated_at timestamp with time zone,
    converted_at timestamp with time zone,
    reward_state text DEFAULT 'PENDING'::text NOT NULL,
    reward_value integer DEFAULT 0 NOT NULL,
    rewarded_at timestamp with time zone,
    utm jsonb,
    CONSTRAINT referrals_reward_state_check CHECK ((reward_state = ANY (ARRAY['PENDING'::text, 'GRANTED'::text, 'VOID'::text])))
);


--
-- Name: responses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.responses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    attempt_id uuid NOT NULL,
    question_id uuid NOT NULL,
    section_name text NOT NULL,
    difficulty_served integer NOT NULL,
    answer jsonb NOT NULL,
    is_correct boolean,
    time_spent_seconds integer,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT responses_difficulty_served_check CHECK (((difficulty_served >= 1) AND (difficulty_served <= 4)))
);


--
-- Name: student_exam_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_exam_targets (
    student_id uuid NOT NULL,
    target_exam text,
    target_exam_type public.exam_type,
    exam_date date,
    weekly_sessions_goal integer DEFAULT 3 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT student_exam_targets_weekly_sessions_goal_check CHECK (((weekly_sessions_goal >= 1) AND (weekly_sessions_goal <= 14)))
);


--
-- Name: student_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    auth_user_id uuid NOT NULL,
    year_level integer NOT NULL,
    username text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT student_profiles_year_level_check CHECK (((year_level >= 2) AND (year_level <= 9)))
);


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    stripe_customer_id text NOT NULL,
    stripe_subscription_id text NOT NULL,
    stripe_price_id text NOT NULL,
    status text NOT NULL,
    "interval" text NOT NULL,
    current_period_end timestamp with time zone,
    cancel_at_period_end boolean DEFAULT false NOT NULL,
    trial_end timestamp with time zone,
    ended_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscriptions_interval_check CHECK (("interval" = ANY (ARRAY['month'::text, 'year'::text])))
);


--
-- Name: TABLE subscriptions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.subscriptions IS 'Mirrors Stripe subscription state. Written only by the Stripe webhook using the service-role client; RLS permits owners to read their own row.';


--
-- Name: test_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.test_questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    test_id uuid NOT NULL,
    question_id uuid NOT NULL,
    section_name text NOT NULL,
    base_difficulty integer NOT NULL,
    question_order integer DEFAULT 0,
    CONSTRAINT test_questions_base_difficulty_check CHECK (((base_difficulty >= 1) AND (base_difficulty <= 4)))
);


--
-- Name: test_sections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.test_sections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    test_id uuid NOT NULL,
    name text NOT NULL,
    section_order integer NOT NULL,
    time_limit_mins integer,
    question_count integer NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT test_sections_question_count_check CHECK ((question_count > 0))
);


--
-- Name: tests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    exam_type public.exam_type NOT NULL,
    year_level_min integer NOT NULL,
    year_level_max integer NOT NULL,
    time_limit_mins integer NOT NULL,
    is_free boolean DEFAULT false NOT NULL,
    status public.content_status DEFAULT 'DRAFT'::public.content_status NOT NULL,
    created_by uuid NOT NULL,
    approved_by uuid,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT tests_time_limit_mins_check CHECK ((time_limit_mins > 0))
);


--
-- Name: tutor_student_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutor_student_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tutor_user_id uuid NOT NULL,
    student_id uuid NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE tutor_student_links; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tutor_student_links IS 'Tutor-to-student relationship (migration 067, decision D-B). A link alone grants NO report access - a current consent_records row is also required. Keeping them separate lets a parent revoke access without removing the tutor, and re-grant without re-adding them.';


--
-- Name: writing_evaluations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.writing_evaluations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    attempt_id uuid NOT NULL,
    provider text DEFAULT 'DeepSeek'::text NOT NULL,
    score_out_of100 numeric(5,2) NOT NULL,
    strengths jsonb,
    improvements jsonb,
    improved_text text,
    raw_response jsonb,
    created_at timestamp with time zone DEFAULT now(),
    text_type text,
    category_scores jsonb,
    techniques_used jsonb,
    practice_exercise text,
    rubric_version text,
    model text,
    word_count integer,
    graded_at timestamp with time zone,
    duration_ms integer,
    improvements_detail jsonb
);


--
-- Name: writing_practice_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.writing_practice_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    prompt_id text NOT NULL,
    text_type text NOT NULL,
    prompt_text text NOT NULL,
    student_text text NOT NULL,
    word_count integer DEFAULT 0 NOT NULL,
    year_level integer NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    score_out_of100 numeric(5,2),
    evaluation jsonb,
    rubric_version text,
    model text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    graded_at timestamp with time zone,
    duration_ms integer
);


--
-- Name: TABLE writing_practice_sessions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.writing_practice_sessions IS 'Standalone AI writing practice (AI Practice Lab). Students create their own row but never SELECT it; the evaluation is a result shown only to parents/tutors/admin.';


--
-- Name: writing_prompts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.writing_prompts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    year_level integer NOT NULL,
    territory text NOT NULL,
    type text NOT NULL,
    text text NOT NULL,
    status public.content_status DEFAULT 'DRAFT'::public.content_status NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT writing_prompts_type_check CHECK ((type = ANY (ARRAY['narrative'::text, 'persuasive'::text]))),
    CONSTRAINT writing_prompts_year_level_check CHECK (((year_level >= 2) AND (year_level <= 9)))
);


--
-- Name: app_user_roles app_user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user_roles
    ADD CONSTRAINT app_user_roles_pkey PRIMARY KEY (user_id);


--
-- Name: assignments assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_pkey PRIMARY KEY (id);


--
-- Name: attempts attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attempts
    ADD CONSTRAINT attempts_pkey PRIMARY KEY (id);


--
-- Name: consent_records consent_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_pkey PRIMARY KEY (id);


--
-- Name: email_log email_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_log
    ADD CONSTRAINT email_log_pkey PRIMARY KEY (id);


--
-- Name: email_log email_log_unique_delivery; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_log
    ADD CONSTRAINT email_log_unique_delivery UNIQUE (user_id, template, dedupe_key);


--
-- Name: enquiries enquiries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enquiries
    ADD CONSTRAINT enquiries_pkey PRIMARY KEY (id);


--
-- Name: enquiry_contact_access_log enquiry_contact_access_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enquiry_contact_access_log
    ADD CONSTRAINT enquiry_contact_access_log_pkey PRIMARY KEY (log_id);


--
-- Name: enquiry_contacts enquiry_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enquiry_contacts
    ADD CONSTRAINT enquiry_contacts_pkey PRIMARY KEY (enquiry_id);


--
-- Name: enquiry_throttle enquiry_throttle_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enquiry_throttle
    ADD CONSTRAINT enquiry_throttle_pkey PRIMARY KEY (fp);


--
-- Name: entitlements entitlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entitlements
    ADD CONSTRAINT entitlements_pkey PRIMARY KEY (id);


--
-- Name: entitlements entitlements_user_id_test_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entitlements
    ADD CONSTRAINT entitlements_user_id_test_id_key UNIQUE (user_id, test_id);


--
-- Name: experiment_assignments experiment_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.experiment_assignments
    ADD CONSTRAINT experiment_assignments_pkey PRIMARY KEY (experiment_key, subject_key);


--
-- Name: experiment_exposures experiment_exposures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.experiment_exposures
    ADD CONSTRAINT experiment_exposures_pkey PRIMARY KEY (experiment_key, subject_key);


--
-- Name: experiments experiments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.experiments
    ADD CONSTRAINT experiments_pkey PRIMARY KEY (experiment_key);


--
-- Name: funnel_events funnel_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funnel_events
    ADD CONSTRAINT funnel_events_pkey PRIMARY KEY (id);


--
-- Name: funnel_state funnel_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funnel_state
    ADD CONSTRAINT funnel_state_pkey PRIMARY KEY (user_id);


--
-- Name: inbound_email_messages inbound_email_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbound_email_messages
    ADD CONSTRAINT inbound_email_messages_pkey PRIMARY KEY (id);


--
-- Name: inbound_email_messages inbound_email_messages_provider_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbound_email_messages
    ADD CONSTRAINT inbound_email_messages_provider_message_id_key UNIQUE (provider_message_id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: offers offers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_pkey PRIMARY KEY (id);


--
-- Name: offers offers_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_slug_key UNIQUE (slug);


--
-- Name: parent_student_links parent_student_links_parent_user_id_student_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parent_student_links
    ADD CONSTRAINT parent_student_links_parent_user_id_student_id_key UNIQUE (parent_user_id, student_id);


--
-- Name: parent_student_links parent_student_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parent_student_links
    ADD CONSTRAINT parent_student_links_pkey PRIMARY KEY (id);


--
-- Name: practice_rest_days practice_rest_days_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_rest_days
    ADD CONSTRAINT practice_rest_days_pkey PRIMARY KEY (id);


--
-- Name: practice_rest_days practice_rest_days_student_id_rest_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_rest_days
    ADD CONSTRAINT practice_rest_days_student_id_rest_date_key UNIQUE (student_id, rest_date);


--
-- Name: processed_jobs processed_jobs_job_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processed_jobs
    ADD CONSTRAINT processed_jobs_job_id_key UNIQUE (job_id);


--
-- Name: processed_jobs processed_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processed_jobs
    ADD CONSTRAINT processed_jobs_pkey PRIMARY KEY (id);


--
-- Name: processed_webhook_events processed_webhook_events_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processed_webhook_events
    ADD CONSTRAINT processed_webhook_events_event_id_key UNIQUE (event_id);


--
-- Name: processed_webhook_events processed_webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processed_webhook_events
    ADD CONSTRAINT processed_webhook_events_pkey PRIMARY KEY (id);


--
-- Name: product_tests product_tests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_tests
    ADD CONSTRAINT product_tests_pkey PRIMARY KEY (product_id, test_id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: products products_stripe_price_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_stripe_price_id_key UNIQUE (stripe_price_id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: purchases purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_pkey PRIMARY KEY (id);


--
-- Name: questions questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_pkey PRIMARY KEY (id);


--
-- Name: referral_codes referral_codes_one_per_owner; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_codes
    ADD CONSTRAINT referral_codes_one_per_owner UNIQUE (owner_user_id);


--
-- Name: referral_codes referral_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_codes
    ADD CONSTRAINT referral_codes_pkey PRIMARY KEY (code);


--
-- Name: referrals referrals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_pkey PRIMARY KEY (id);


--
-- Name: referrals referrals_referee_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_referee_user_id_key UNIQUE (referee_user_id);


--
-- Name: responses responses_attempt_id_question_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.responses
    ADD CONSTRAINT responses_attempt_id_question_id_key UNIQUE (attempt_id, question_id);


--
-- Name: responses responses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.responses
    ADD CONSTRAINT responses_pkey PRIMARY KEY (id);


--
-- Name: student_exam_targets student_exam_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_exam_targets
    ADD CONSTRAINT student_exam_targets_pkey PRIMARY KEY (student_id);


--
-- Name: student_profiles student_profiles_auth_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_profiles
    ADD CONSTRAINT student_profiles_auth_user_id_key UNIQUE (auth_user_id);


--
-- Name: student_profiles student_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_profiles
    ADD CONSTRAINT student_profiles_pkey PRIMARY KEY (id);


--
-- Name: student_profiles student_profiles_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_profiles
    ADD CONSTRAINT student_profiles_username_key UNIQUE (username);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: test_questions test_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_questions
    ADD CONSTRAINT test_questions_pkey PRIMARY KEY (id);


--
-- Name: test_questions test_questions_test_id_question_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_questions
    ADD CONSTRAINT test_questions_test_id_question_id_key UNIQUE (test_id, question_id);


--
-- Name: test_sections test_sections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_sections
    ADD CONSTRAINT test_sections_pkey PRIMARY KEY (id);


--
-- Name: test_sections test_sections_test_id_section_order_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_sections
    ADD CONSTRAINT test_sections_test_id_section_order_key UNIQUE (test_id, section_order);


--
-- Name: tests tests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tests
    ADD CONSTRAINT tests_pkey PRIMARY KEY (id);


--
-- Name: tutor_student_links tutor_student_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_student_links
    ADD CONSTRAINT tutor_student_links_pkey PRIMARY KEY (id);


--
-- Name: tutor_student_links tutor_student_links_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_student_links
    ADD CONSTRAINT tutor_student_links_unique UNIQUE (tutor_user_id, student_id);


--
-- Name: writing_evaluations writing_evaluations_attempt_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.writing_evaluations
    ADD CONSTRAINT writing_evaluations_attempt_id_key UNIQUE (attempt_id);


--
-- Name: writing_evaluations writing_evaluations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.writing_evaluations
    ADD CONSTRAINT writing_evaluations_pkey PRIMARY KEY (id);


--
-- Name: writing_practice_sessions writing_practice_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.writing_practice_sessions
    ADD CONSTRAINT writing_practice_sessions_pkey PRIMARY KEY (id);


--
-- Name: writing_prompts writing_prompts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.writing_prompts
    ADD CONSTRAINT writing_prompts_pkey PRIMARY KEY (id);


--
-- Name: attempts_one_in_progress_per_student_test; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX attempts_one_in_progress_per_student_test ON public.attempts USING btree (student_id, test_id) WHERE (status = 'IN_PROGRESS'::public.attempt_status);


--
-- Name: idx_assignments_assigned_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assignments_assigned_by ON public.assignments USING btree (assigned_by);


--
-- Name: idx_assignments_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assignments_student ON public.assignments USING btree (student_id);


--
-- Name: idx_assignments_test; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assignments_test ON public.assignments USING btree (test_id);


--
-- Name: idx_attempts_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attempts_student ON public.attempts USING btree (student_id);


--
-- Name: idx_attempts_student_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attempts_student_status ON public.attempts USING btree (student_id, status);


--
-- Name: idx_attempts_test; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attempts_test ON public.attempts USING btree (test_id);


--
-- Name: idx_consent_live; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consent_live ON public.consent_records USING btree (student_id, tutor_user_id) WHERE (revoked_at IS NULL);


--
-- Name: idx_consent_tutor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consent_tutor ON public.consent_records USING btree (tutor_user_id);


--
-- Name: idx_email_log_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_log_template ON public.email_log USING btree (template, created_at DESC);


--
-- Name: idx_email_log_user_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_log_user_time ON public.email_log USING btree (user_id, created_at DESC);


--
-- Name: idx_enquiries_assigned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enquiries_assigned ON public.enquiries USING btree (assigned_to, status) WHERE (assigned_to IS NOT NULL);


--
-- Name: idx_enquiries_ingest_source_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_enquiries_ingest_source_ref ON public.enquiries USING btree (channel, ingest_source_ref) WHERE (ingest_source_ref IS NOT NULL);


--
-- Name: idx_enquiries_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enquiries_parent ON public.enquiries USING btree (parent_user_id) WHERE (parent_user_id IS NOT NULL);


--
-- Name: idx_enquiries_sla_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enquiries_sla_open ON public.enquiries USING btree (received_at) WHERE ((first_response_at IS NULL) AND (status <> ALL (ARRAY['spam'::text, 'closed'::text])));


--
-- Name: idx_enquiries_status_received; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enquiries_status_received ON public.enquiries USING btree (status, received_at DESC);


--
-- Name: idx_enquiry_contact_log_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enquiry_contact_log_time ON public.enquiry_contact_access_log USING btree (accessed_at DESC);


--
-- Name: idx_enquiry_throttle_seen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enquiry_throttle_seen ON public.enquiry_throttle USING btree (last_seen_at);


--
-- Name: idx_entitlements_purchase; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entitlements_purchase ON public.entitlements USING btree (purchase_id);


--
-- Name: idx_entitlements_test; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entitlements_test ON public.entitlements USING btree (test_id);


--
-- Name: idx_entitlements_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entitlements_user ON public.entitlements USING btree (user_id);


--
-- Name: idx_experiment_exposures_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_experiment_exposures_variant ON public.experiment_exposures USING btree (experiment_key, variant, exposed_at);


--
-- Name: idx_funnel_events_anon; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_funnel_events_anon ON public.funnel_events USING btree (anonymous_id, created_at DESC) WHERE (anonymous_id IS NOT NULL);


--
-- Name: idx_funnel_events_event_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_funnel_events_event_time ON public.funnel_events USING btree (event, created_at DESC);


--
-- Name: idx_funnel_events_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_funnel_events_student ON public.funnel_events USING btree (student_id);


--
-- Name: idx_funnel_events_user_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_funnel_events_user_time ON public.funnel_events USING btree (user_id, created_at DESC) WHERE (user_id IS NOT NULL);


--
-- Name: idx_funnel_state_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_funnel_state_stage ON public.funnel_state USING btree (stage);


--
-- Name: idx_funnel_state_worker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_funnel_state_worker ON public.funnel_state USING btree (stage, diagnostic_completed_at) WHERE (email_suppressed = false);


--
-- Name: idx_notifications_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_created ON public.notifications USING btree (user_id, created_at DESC);


--
-- Name: idx_parent_student_links_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parent_student_links_parent ON public.parent_student_links USING btree (parent_user_id);


--
-- Name: idx_parent_student_links_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parent_student_links_student ON public.parent_student_links USING btree (student_id);


--
-- Name: idx_practice_rest_days_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_practice_rest_days_student ON public.practice_rest_days USING btree (student_id, rest_date);


--
-- Name: idx_profiles_stripe_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_profiles_stripe_customer ON public.profiles USING btree (stripe_customer_id) WHERE (stripe_customer_id IS NOT NULL);


--
-- Name: idx_purchases_payment_intent; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_purchases_payment_intent ON public.purchases USING btree (payment_intent) WHERE (payment_intent IS NOT NULL);


--
-- Name: idx_purchases_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchases_product ON public.purchases USING btree (product_id);


--
-- Name: idx_purchases_provider_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_purchases_provider_ref ON public.purchases USING btree (provider_ref);


--
-- Name: idx_purchases_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchases_user ON public.purchases USING btree (user_id);


--
-- Name: idx_purchases_user_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchases_user_product ON public.purchases USING btree (user_id, product_id) WHERE (product_id IS NOT NULL);


--
-- Name: idx_questions_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_questions_created_by ON public.questions USING btree (created_by);


--
-- Name: idx_questions_status_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_questions_status_type ON public.questions USING btree (status, type);


--
-- Name: idx_referral_codes_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_referral_codes_owner ON public.referral_codes USING btree (owner_user_id);


--
-- Name: idx_referrals_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_referrals_code ON public.referrals USING btree (code);


--
-- Name: idx_referrals_reward; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_referrals_reward ON public.referrals USING btree (reward_state) WHERE (reward_state = 'PENDING'::text);


--
-- Name: idx_responses_attempt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_responses_attempt ON public.responses USING btree (attempt_id);


--
-- Name: idx_responses_attempt_question; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_responses_attempt_question ON public.responses USING btree (attempt_id, question_id);


--
-- Name: idx_responses_question; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_responses_question ON public.responses USING btree (question_id);


--
-- Name: idx_student_exam_targets_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_student_exam_targets_date ON public.student_exam_targets USING btree (exam_date) WHERE (exam_date IS NOT NULL);


--
-- Name: idx_subscriptions_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_customer ON public.subscriptions USING btree (stripe_customer_id);


--
-- Name: idx_subscriptions_stripe_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_subscriptions_stripe_id ON public.subscriptions USING btree (stripe_subscription_id);


--
-- Name: idx_subscriptions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_user ON public.subscriptions USING btree (user_id);


--
-- Name: idx_subscriptions_user_live; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_user_live ON public.subscriptions USING btree (user_id) WHERE (status = ANY (ARRAY['trialing'::text, 'active'::text, 'past_due'::text]));


--
-- Name: idx_test_questions_question; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_test_questions_question ON public.test_questions USING btree (question_id);


--
-- Name: idx_test_questions_test_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_test_questions_test_order ON public.test_questions USING btree (test_id, question_order);


--
-- Name: idx_tests_approved_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tests_approved_by ON public.tests USING btree (approved_by);


--
-- Name: idx_tests_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tests_created_by ON public.tests USING btree (created_by);


--
-- Name: idx_tests_status_exam; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tests_status_exam ON public.tests USING btree (status, exam_type);


--
-- Name: idx_tutor_links_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_links_student ON public.tutor_student_links USING btree (student_id);


--
-- Name: idx_tutor_links_tutor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tutor_links_tutor ON public.tutor_student_links USING btree (tutor_user_id);


--
-- Name: ix_inbound_email_disposition; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_inbound_email_disposition ON public.inbound_email_messages USING btree (disposition, received_at);


--
-- Name: writing_practice_sessions_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX writing_practice_sessions_status_created_idx ON public.writing_practice_sessions USING btree (status, created_at);


--
-- Name: writing_practice_sessions_student_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX writing_practice_sessions_student_created_idx ON public.writing_practice_sessions USING btree (student_id, created_at DESC);


--
-- Name: writing_prompts_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX writing_prompts_created_by_idx ON public.writing_prompts USING btree (created_by);


--
-- Name: writing_prompts_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX writing_prompts_status_idx ON public.writing_prompts USING btree (status);


--
-- Name: writing_prompts_year_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX writing_prompts_year_type_idx ON public.writing_prompts USING btree (year_level, type);


--
-- Name: app_user_roles app_user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user_roles
    ADD CONSTRAINT app_user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: assignments assignments_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: assignments assignments_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student_profiles(id) ON DELETE CASCADE;


--
-- Name: assignments assignments_test_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_test_id_fkey FOREIGN KEY (test_id) REFERENCES public.tests(id) ON DELETE RESTRICT;


--
-- Name: attempts attempts_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attempts
    ADD CONSTRAINT attempts_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student_profiles(id) ON DELETE CASCADE;


--
-- Name: attempts attempts_test_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attempts
    ADD CONSTRAINT attempts_test_id_fkey FOREIGN KEY (test_id) REFERENCES public.tests(id) ON DELETE RESTRICT;


--
-- Name: consent_records consent_records_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES auth.users(id);


--
-- Name: consent_records consent_records_revoked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES auth.users(id);


--
-- Name: consent_records consent_records_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student_profiles(id) ON DELETE CASCADE;


--
-- Name: consent_records consent_records_tutor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_tutor_user_id_fkey FOREIGN KEY (tutor_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: email_log email_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_log
    ADD CONSTRAINT email_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: enquiries enquiries_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enquiries
    ADD CONSTRAINT enquiries_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: enquiries enquiries_converted_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enquiries
    ADD CONSTRAINT enquiries_converted_order_id_fkey FOREIGN KEY (converted_order_id) REFERENCES public.purchases(id) ON DELETE SET NULL;


--
-- Name: enquiries enquiries_parent_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enquiries
    ADD CONSTRAINT enquiries_parent_user_id_fkey FOREIGN KEY (parent_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: enquiry_contacts enquiry_contacts_enquiry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enquiry_contacts
    ADD CONSTRAINT enquiry_contacts_enquiry_id_fkey FOREIGN KEY (enquiry_id) REFERENCES public.enquiries(id) ON DELETE CASCADE;


--
-- Name: entitlements entitlements_purchase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entitlements
    ADD CONSTRAINT entitlements_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.purchases(id) ON DELETE CASCADE;


--
-- Name: entitlements entitlements_test_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entitlements
    ADD CONSTRAINT entitlements_test_id_fkey FOREIGN KEY (test_id) REFERENCES public.tests(id) ON DELETE RESTRICT;


--
-- Name: entitlements entitlements_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entitlements
    ADD CONSTRAINT entitlements_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: experiment_assignments experiment_assignments_experiment_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.experiment_assignments
    ADD CONSTRAINT experiment_assignments_experiment_key_fkey FOREIGN KEY (experiment_key) REFERENCES public.experiments(experiment_key) ON DELETE CASCADE;


--
-- Name: experiment_exposures experiment_exposures_experiment_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.experiment_exposures
    ADD CONSTRAINT experiment_exposures_experiment_key_fkey FOREIGN KEY (experiment_key) REFERENCES public.experiments(experiment_key) ON DELETE CASCADE;


--
-- Name: funnel_events funnel_events_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funnel_events
    ADD CONSTRAINT funnel_events_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student_profiles(id) ON DELETE SET NULL;


--
-- Name: funnel_events funnel_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funnel_events
    ADD CONSTRAINT funnel_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: funnel_state funnel_state_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funnel_state
    ADD CONSTRAINT funnel_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: inbound_email_messages inbound_email_messages_enquiry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbound_email_messages
    ADD CONSTRAINT inbound_email_messages_enquiry_id_fkey FOREIGN KEY (enquiry_id) REFERENCES public.enquiries(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: parent_student_links parent_student_links_parent_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parent_student_links
    ADD CONSTRAINT parent_student_links_parent_user_id_fkey FOREIGN KEY (parent_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: parent_student_links parent_student_links_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parent_student_links
    ADD CONSTRAINT parent_student_links_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student_profiles(id) ON DELETE CASCADE;


--
-- Name: practice_rest_days practice_rest_days_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_rest_days
    ADD CONSTRAINT practice_rest_days_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: practice_rest_days practice_rest_days_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_rest_days
    ADD CONSTRAINT practice_rest_days_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student_profiles(id) ON DELETE CASCADE;


--
-- Name: product_tests product_tests_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_tests
    ADD CONSTRAINT product_tests_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_tests product_tests_test_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_tests
    ADD CONSTRAINT product_tests_test_id_fkey FOREIGN KEY (test_id) REFERENCES public.tests(id) ON DELETE RESTRICT;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: purchases purchases_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: purchases purchases_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: questions questions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: referral_codes referral_codes_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_codes
    ADD CONSTRAINT referral_codes_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: referral_codes referral_codes_referee_offer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_codes
    ADD CONSTRAINT referral_codes_referee_offer_id_fkey FOREIGN KEY (referee_offer_id) REFERENCES public.offers(id) ON DELETE SET NULL;


--
-- Name: referrals referrals_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_code_fkey FOREIGN KEY (code) REFERENCES public.referral_codes(code) ON DELETE CASCADE;


--
-- Name: referrals referrals_referee_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_referee_user_id_fkey FOREIGN KEY (referee_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: responses responses_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.responses
    ADD CONSTRAINT responses_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES public.attempts(id) ON DELETE CASCADE;


--
-- Name: responses responses_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.responses
    ADD CONSTRAINT responses_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE RESTRICT;


--
-- Name: student_exam_targets student_exam_targets_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_exam_targets
    ADD CONSTRAINT student_exam_targets_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student_profiles(id) ON DELETE CASCADE;


--
-- Name: student_profiles student_profiles_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_profiles
    ADD CONSTRAINT student_profiles_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: test_questions test_questions_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_questions
    ADD CONSTRAINT test_questions_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE RESTRICT;


--
-- Name: test_questions test_questions_test_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_questions
    ADD CONSTRAINT test_questions_test_id_fkey FOREIGN KEY (test_id) REFERENCES public.tests(id) ON DELETE CASCADE;


--
-- Name: test_sections test_sections_test_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_sections
    ADD CONSTRAINT test_sections_test_id_fkey FOREIGN KEY (test_id) REFERENCES public.tests(id) ON DELETE CASCADE;


--
-- Name: tests tests_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tests
    ADD CONSTRAINT tests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: tests tests_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tests
    ADD CONSTRAINT tests_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: tutor_student_links tutor_student_links_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_student_links
    ADD CONSTRAINT tutor_student_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: tutor_student_links tutor_student_links_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_student_links
    ADD CONSTRAINT tutor_student_links_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student_profiles(id) ON DELETE CASCADE;


--
-- Name: tutor_student_links tutor_student_links_tutor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutor_student_links
    ADD CONSTRAINT tutor_student_links_tutor_user_id_fkey FOREIGN KEY (tutor_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: writing_evaluations writing_evaluations_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.writing_evaluations
    ADD CONSTRAINT writing_evaluations_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES public.attempts(id) ON DELETE CASCADE;


--
-- Name: writing_practice_sessions writing_practice_sessions_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.writing_practice_sessions
    ADD CONSTRAINT writing_practice_sessions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student_profiles(id) ON DELETE CASCADE;


--
-- Name: writing_prompts writing_prompts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.writing_prompts
    ADD CONSTRAINT writing_prompts_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: questions Admin can create any question; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can create any question" ON public.questions FOR INSERT WITH CHECK (public.has_role('ADMIN'::public.user_role));


--
-- Name: tests Admin can create any test; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can create any test" ON public.tests FOR INSERT WITH CHECK (public.has_role('ADMIN'::public.user_role));


--
-- Name: writing_prompts Admin can create writing prompts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can create writing prompts" ON public.writing_prompts FOR INSERT TO authenticated WITH CHECK (public.has_role('ADMIN'::public.user_role));


--
-- Name: questions Admin can delete any question; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can delete any question" ON public.questions FOR DELETE USING (public.has_role('ADMIN'::public.user_role));


--
-- Name: tests Admin can delete any test; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can delete any test" ON public.tests FOR DELETE USING (public.has_role('ADMIN'::public.user_role));


--
-- Name: writing_prompts Admin can delete writing prompts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can delete writing prompts" ON public.writing_prompts FOR DELETE TO authenticated USING (public.has_role('ADMIN'::public.user_role));


--
-- Name: assignments Admin can insert assignments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can insert assignments" ON public.assignments FOR INSERT WITH CHECK (public.has_role('ADMIN'::public.user_role));


--
-- Name: student_profiles Admin can insert profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can insert profile" ON public.student_profiles FOR INSERT WITH CHECK (public.has_role('ADMIN'::public.user_role));


--
-- Name: enquiries Admin can manage all enquiries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can manage all enquiries" ON public.enquiries USING (public.has_role('ADMIN'::public.user_role)) WITH CHECK (public.has_role('ADMIN'::public.user_role));


--
-- Name: student_exam_targets Admin can manage all exam targets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can manage all exam targets" ON public.student_exam_targets USING (public.has_role('ADMIN'::public.user_role)) WITH CHECK (public.has_role('ADMIN'::public.user_role));


--
-- Name: parent_student_links Admin can manage all links; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can manage all links" ON public.parent_student_links USING (public.has_role('ADMIN'::public.user_role)) WITH CHECK (public.has_role('ADMIN'::public.user_role));


--
-- Name: practice_rest_days Admin can manage all rest days; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can manage all rest days" ON public.practice_rest_days USING (public.has_role('ADMIN'::public.user_role)) WITH CHECK (public.has_role('ADMIN'::public.user_role));


--
-- Name: offers Admin can manage offers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can manage offers" ON public.offers USING (public.has_role('ADMIN'::public.user_role)) WITH CHECK (public.has_role('ADMIN'::public.user_role));


--
-- Name: profiles Admin can manage profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can manage profiles" ON public.profiles USING (public.has_role('ADMIN'::public.user_role)) WITH CHECK (public.has_role('ADMIN'::public.user_role));


--
-- Name: student_profiles Admin can read all profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can read all profiles" ON public.student_profiles FOR SELECT USING (public.has_role('ADMIN'::public.user_role));


--
-- Name: app_user_roles Admin can read all roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can read all roles" ON public.app_user_roles FOR SELECT USING (public.has_role('ADMIN'::public.user_role));


--
-- Name: enquiry_contact_access_log Admin can read contact access log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can read contact access log" ON public.enquiry_contact_access_log FOR SELECT USING (public.has_role('ADMIN'::public.user_role));


--
-- Name: questions Admin can update any question; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can update any question" ON public.questions FOR UPDATE USING (public.has_role('ADMIN'::public.user_role)) WITH CHECK (public.has_role('ADMIN'::public.user_role));


--
-- Name: tests Admin can update any test; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can update any test" ON public.tests FOR UPDATE USING (public.has_role('ADMIN'::public.user_role)) WITH CHECK (public.has_role('ADMIN'::public.user_role));


--
-- Name: student_profiles Admin can update profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can update profile" ON public.student_profiles FOR UPDATE USING (public.has_role('ADMIN'::public.user_role)) WITH CHECK (public.has_role('ADMIN'::public.user_role));


--
-- Name: writing_prompts Admin can update writing prompts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can update writing prompts" ON public.writing_prompts FOR UPDATE TO authenticated USING (public.has_role('ADMIN'::public.user_role)) WITH CHECK (public.has_role('ADMIN'::public.user_role));


--
-- Name: assignments Admin can view all assignments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can view all assignments" ON public.assignments FOR SELECT USING (public.has_role('ADMIN'::public.user_role));


--
-- Name: attempts Admin can view all attempts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can view all attempts" ON public.attempts FOR SELECT TO authenticated USING ((public.may_read_results() AND public.has_role('ADMIN'::public.user_role)));


--
-- Name: entitlements Admin can view all entitlements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can view all entitlements" ON public.entitlements FOR SELECT USING (public.has_role('ADMIN'::public.user_role));


--
-- Name: writing_evaluations Admin can view all evals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can view all evals" ON public.writing_evaluations FOR SELECT TO authenticated USING ((public.may_read_results() AND public.has_role('ADMIN'::public.user_role)));


--
-- Name: test_questions Admin can view all mapping; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can view all mapping" ON public.test_questions FOR SELECT USING (public.has_role('ADMIN'::public.user_role));


--
-- Name: notifications Admin can view all notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can view all notifications" ON public.notifications FOR SELECT USING (public.has_role('ADMIN'::public.user_role));


--
-- Name: purchases Admin can view all purchases; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can view all purchases" ON public.purchases FOR SELECT USING (public.has_role('ADMIN'::public.user_role));


--
-- Name: questions Admin can view all questions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can view all questions" ON public.questions FOR SELECT USING (public.has_role('ADMIN'::public.user_role));


--
-- Name: responses Admin can view all responses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can view all responses" ON public.responses FOR SELECT TO authenticated USING ((public.may_read_results() AND public.has_role('ADMIN'::public.user_role)));


--
-- Name: subscriptions Admin can view all subscriptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can view all subscriptions" ON public.subscriptions FOR SELECT USING (public.has_role('ADMIN'::public.user_role));


--
-- Name: test_sections Admin can view all test sections; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can view all test sections" ON public.test_sections FOR SELECT USING (public.has_role('ADMIN'::public.user_role));


--
-- Name: tests Admin can view all tests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can view all tests" ON public.tests FOR SELECT USING (public.has_role('ADMIN'::public.user_role));


--
-- Name: writing_practice_sessions Admin can view all writing practice; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can view all writing practice" ON public.writing_practice_sessions FOR SELECT TO authenticated USING ((public.may_read_results() AND public.has_role('ADMIN'::public.user_role)));


--
-- Name: writing_prompts Admin can view all writing prompts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can view all writing prompts" ON public.writing_prompts FOR SELECT TO authenticated USING (public.has_role('ADMIN'::public.user_role));


--
-- Name: processed_webhook_events Admin can view processed events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can view processed events" ON public.processed_webhook_events FOR SELECT USING (public.has_role('ADMIN'::public.user_role));


--
-- Name: processed_jobs Admin can view processed jobs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can view processed jobs" ON public.processed_jobs FOR SELECT USING (public.has_role('ADMIN'::public.user_role));


--
-- Name: attempts Admin can write attempts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can write attempts" ON public.attempts USING (public.has_role('ADMIN'::public.user_role)) WITH CHECK (public.has_role('ADMIN'::public.user_role));


--
-- Name: writing_evaluations Admin can write evals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can write evals" ON public.writing_evaluations USING (public.has_role('ADMIN'::public.user_role)) WITH CHECK (public.has_role('ADMIN'::public.user_role));


--
-- Name: test_questions Admin can write mapping; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can write mapping" ON public.test_questions USING (public.has_role('ADMIN'::public.user_role)) WITH CHECK (public.has_role('ADMIN'::public.user_role));


--
-- Name: product_tests Admin can write product mapping; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can write product mapping" ON public.product_tests USING (public.has_role('ADMIN'::public.user_role)) WITH CHECK (public.has_role('ADMIN'::public.user_role));


--
-- Name: products Admin can write products; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can write products" ON public.products USING (public.has_role('ADMIN'::public.user_role)) WITH CHECK (public.has_role('ADMIN'::public.user_role));


--
-- Name: responses Admin can write responses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can write responses" ON public.responses USING (public.has_role('ADMIN'::public.user_role)) WITH CHECK (public.has_role('ADMIN'::public.user_role));


--
-- Name: app_user_roles Admin can write roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can write roles" ON public.app_user_roles USING (public.has_role('ADMIN'::public.user_role)) WITH CHECK (public.has_role('ADMIN'::public.user_role));


--
-- Name: test_sections Admin can write test sections; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can write test sections" ON public.test_sections USING (public.has_role('ADMIN'::public.user_role)) WITH CHECK (public.has_role('ADMIN'::public.user_role));


--
-- Name: writing_practice_sessions Admin can write writing practice; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can write writing practice" ON public.writing_practice_sessions TO authenticated USING (public.has_role('ADMIN'::public.user_role)) WITH CHECK (public.has_role('ADMIN'::public.user_role));


--
-- Name: consent_records Admin manages all consent; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin manages all consent" ON public.consent_records USING (public.has_role('ADMIN'::public.user_role)) WITH CHECK (public.has_role('ADMIN'::public.user_role));


--
-- Name: tutor_student_links Admin manages all tutor links; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin manages all tutor links" ON public.tutor_student_links USING (public.has_role('ADMIN'::public.user_role)) WITH CHECK (public.has_role('ADMIN'::public.user_role));


--
-- Name: writing_prompts Creator can create writing prompts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Creator can create writing prompts" ON public.writing_prompts FOR INSERT TO authenticated WITH CHECK (((created_by = auth.uid()) AND public.has_role('TEST_CREATOR'::public.user_role)));


--
-- Name: writing_prompts Creator can delete own writing prompts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Creator can delete own writing prompts" ON public.writing_prompts FOR DELETE TO authenticated USING (((created_by = auth.uid()) AND public.has_role('TEST_CREATOR'::public.user_role)));


--
-- Name: writing_prompts Creator can update own writing prompts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Creator can update own writing prompts" ON public.writing_prompts FOR UPDATE TO authenticated USING (((created_by = auth.uid()) AND public.has_role('TEST_CREATOR'::public.user_role))) WITH CHECK (((created_by = auth.uid()) AND public.has_role('TEST_CREATOR'::public.user_role)));


--
-- Name: writing_prompts Creator can view own writing prompts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Creator can view own writing prompts" ON public.writing_prompts FOR SELECT TO authenticated USING (((created_by = auth.uid()) AND public.has_role('TEST_CREATOR'::public.user_role)));


--
-- Name: product_tests Logged in users can view product mapping; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Logged in users can view product mapping" ON public.product_tests FOR SELECT USING ((auth.uid() IS NOT NULL));


--
-- Name: products Logged in users can view products; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Logged in users can view products" ON public.products FOR SELECT USING ((auth.uid() IS NOT NULL));


--
-- Name: assignments Parent can insert assignments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Parent can insert assignments" ON public.assignments FOR INSERT WITH CHECK ((public.is_parent_of(student_id) AND (assigned_by = auth.uid())));


--
-- Name: student_profiles Parent can insert child profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Parent can insert child profile" ON public.student_profiles FOR INSERT WITH CHECK (public.has_role('PARENT'::public.user_role));


--
-- Name: practice_rest_days Parent can manage linked child rest days; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Parent can manage linked child rest days" ON public.practice_rest_days USING (public.is_parent_of(student_id)) WITH CHECK (public.is_parent_of(student_id));


--
-- Name: parent_student_links Parent can manage own links; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Parent can manage own links" ON public.parent_student_links USING ((parent_user_id = auth.uid())) WITH CHECK ((parent_user_id = auth.uid()));


--
-- Name: student_exam_targets Parent can read linked child exam targets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Parent can read linked child exam targets" ON public.student_exam_targets FOR SELECT USING (public.is_parent_of(student_id));


--
-- Name: practice_rest_days Parent can read linked child rest days; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Parent can read linked child rest days" ON public.practice_rest_days FOR SELECT USING (public.is_parent_of(student_id));


--
-- Name: student_profiles Parent can read linked students; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Parent can read linked students" ON public.student_profiles FOR SELECT USING (public.is_parent_of(id));


--
-- Name: student_profiles Parent can update linked child profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Parent can update linked child profile" ON public.student_profiles FOR UPDATE USING (public.is_parent_of(id)) WITH CHECK (public.is_parent_of(id));


--
-- Name: enquiries Parent can view own enquiries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Parent can view own enquiries" ON public.enquiries FOR SELECT USING ((parent_user_id = auth.uid()));


--
-- Name: assignments Parent can view student assignments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Parent can view student assignments" ON public.assignments FOR SELECT USING (public.is_parent_of(student_id));


--
-- Name: attempts Parent can view student attempts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Parent can view student attempts" ON public.attempts FOR SELECT TO authenticated USING ((public.may_read_results() AND public.is_parent_of(student_id)));


--
-- Name: writing_evaluations Parent can view student evals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Parent can view student evals" ON public.writing_evaluations FOR SELECT TO authenticated USING ((public.may_read_results() AND public.is_attempt_parent(attempt_id)));


--
-- Name: responses Parent can view student responses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Parent can view student responses" ON public.responses FOR SELECT TO authenticated USING ((public.may_read_results() AND public.is_attempt_parent(attempt_id)));


--
-- Name: writing_practice_sessions Parent can view student writing practice; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Parent can view student writing practice" ON public.writing_practice_sessions FOR SELECT TO authenticated USING ((public.may_read_results() AND public.is_parent_of(student_id)));


--
-- Name: student_exam_targets Parent can write linked child exam targets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Parent can write linked child exam targets" ON public.student_exam_targets USING (public.is_parent_of(student_id)) WITH CHECK (public.is_parent_of(student_id));


--
-- Name: consent_records Parent grants consent for own children; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Parent grants consent for own children" ON public.consent_records FOR INSERT WITH CHECK ((public.is_parent_of(student_id) AND (granted_by = auth.uid())));


--
-- Name: tutor_student_links Parent manages links for own children; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Parent manages links for own children" ON public.tutor_student_links USING (public.is_parent_of(student_id)) WITH CHECK (public.is_parent_of(student_id));


--
-- Name: consent_records Parent reads consent for own children; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Parent reads consent for own children" ON public.consent_records FOR SELECT USING (public.is_parent_of(student_id));


--
-- Name: consent_records Parent revokes consent for own children; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Parent revokes consent for own children" ON public.consent_records FOR UPDATE USING (public.is_parent_of(student_id)) WITH CHECK (public.is_parent_of(student_id));


--
-- Name: writing_prompts Signed-in users can view published writing prompts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Signed-in users can view published writing prompts" ON public.writing_prompts FOR SELECT TO authenticated USING (((auth.uid() IS NOT NULL) AND (status = 'PUBLISHED'::public.content_status)));


--
-- Name: writing_practice_sessions Student can create own writing practice; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Student can create own writing practice" ON public.writing_practice_sessions FOR INSERT TO authenticated WITH CHECK (public.is_student_self(student_id));


--
-- Name: attempts Student can insert own attempts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Student can insert own attempts" ON public.attempts FOR INSERT TO authenticated WITH CHECK (public.is_student_self(student_id));


--
-- Name: responses Student can insert own responses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Student can insert own responses" ON public.responses FOR INSERT TO authenticated WITH CHECK (public.is_attempt_owner(attempt_id));


--
-- Name: student_profiles Student can read own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Student can read own profile" ON public.student_profiles FOR SELECT USING ((auth_user_id = auth.uid()));


--
-- Name: attempts Student can update own attempts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Student can update own attempts" ON public.attempts FOR UPDATE TO authenticated USING (public.is_student_self(student_id)) WITH CHECK (public.is_student_self(student_id));


--
-- Name: responses Student can update own responses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Student can update own responses" ON public.responses FOR UPDATE TO authenticated USING (public.is_attempt_owner(attempt_id)) WITH CHECK (public.is_attempt_owner(attempt_id));


--
-- Name: assignments Student can view own assignments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Student can view own assignments" ON public.assignments FOR SELECT USING (public.is_student_self(student_id));


--
-- Name: tests Test Creator can create drafts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Test Creator can create drafts" ON public.tests FOR INSERT WITH CHECK (((created_by = auth.uid()) AND public.has_role('TEST_CREATOR'::public.user_role)));


--
-- Name: questions Test Creator can create questions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Test Creator can create questions" ON public.questions FOR INSERT WITH CHECK (((created_by = auth.uid()) AND public.has_role('TEST_CREATOR'::public.user_role)));


--
-- Name: questions Test Creator can delete own drafts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Test Creator can delete own drafts" ON public.questions FOR DELETE USING (((created_by = auth.uid()) AND (status = ANY (ARRAY['DRAFT'::public.content_status, 'PENDING_APPROVAL'::public.content_status])) AND public.has_role('TEST_CREATOR'::public.user_role)));


--
-- Name: tests Test Creator can delete own drafts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Test Creator can delete own drafts" ON public.tests FOR DELETE USING (((created_by = auth.uid()) AND (status = ANY (ARRAY['DRAFT'::public.content_status, 'PENDING_APPROVAL'::public.content_status])) AND public.has_role('TEST_CREATOR'::public.user_role)));


--
-- Name: questions Test Creator can update own drafts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Test Creator can update own drafts" ON public.questions FOR UPDATE USING (((created_by = auth.uid()) AND (status = ANY (ARRAY['DRAFT'::public.content_status, 'PENDING_APPROVAL'::public.content_status])) AND public.has_role('TEST_CREATOR'::public.user_role))) WITH CHECK (((created_by = auth.uid()) AND (status = ANY (ARRAY['DRAFT'::public.content_status, 'PENDING_APPROVAL'::public.content_status])) AND public.has_role('TEST_CREATOR'::public.user_role)));


--
-- Name: tests Test Creator can update own drafts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Test Creator can update own drafts" ON public.tests FOR UPDATE USING (((created_by = auth.uid()) AND (status = ANY (ARRAY['DRAFT'::public.content_status, 'PENDING_APPROVAL'::public.content_status])) AND public.has_role('TEST_CREATOR'::public.user_role))) WITH CHECK (((created_by = auth.uid()) AND (status = ANY (ARRAY['DRAFT'::public.content_status, 'PENDING_APPROVAL'::public.content_status])) AND public.has_role('TEST_CREATOR'::public.user_role)));


--
-- Name: questions Test Creator can view own drafts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Test Creator can view own drafts" ON public.questions FOR SELECT USING (((created_by = auth.uid()) AND public.has_role('TEST_CREATOR'::public.user_role)));


--
-- Name: tests Test Creator can view own drafts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Test Creator can view own drafts" ON public.tests FOR SELECT USING (((created_by = auth.uid()) AND public.has_role('TEST_CREATOR'::public.user_role)));


--
-- Name: test_questions Test Creator can view own test mapping; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Test Creator can view own test mapping" ON public.test_questions FOR SELECT USING (((EXISTS ( SELECT 1
   FROM public.tests t
  WHERE ((t.id = test_questions.test_id) AND (t.created_by = auth.uid())))) AND public.has_role('TEST_CREATOR'::public.user_role)));


--
-- Name: test_sections Test Creator can view own test sections; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Test Creator can view own test sections" ON public.test_sections FOR SELECT USING (((EXISTS ( SELECT 1
   FROM public.tests t
  WHERE ((t.id = test_sections.test_id) AND (t.created_by = auth.uid())))) AND public.has_role('TEST_CREATOR'::public.user_role)));


--
-- Name: test_questions Test Creator can write own test mapping; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Test Creator can write own test mapping" ON public.test_questions USING (((EXISTS ( SELECT 1
   FROM public.tests t
  WHERE ((t.id = test_questions.test_id) AND (t.created_by = auth.uid()) AND (t.status = ANY (ARRAY['DRAFT'::public.content_status, 'PENDING_APPROVAL'::public.content_status]))))) AND public.has_role('TEST_CREATOR'::public.user_role))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.tests t
  WHERE ((t.id = test_questions.test_id) AND (t.created_by = auth.uid()) AND (t.status = ANY (ARRAY['DRAFT'::public.content_status, 'PENDING_APPROVAL'::public.content_status]))))) AND public.has_role('TEST_CREATOR'::public.user_role)));


--
-- Name: test_sections Test Creator can write own test sections; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Test Creator can write own test sections" ON public.test_sections USING (((EXISTS ( SELECT 1
   FROM public.tests t
  WHERE ((t.id = test_sections.test_id) AND (t.created_by = auth.uid()) AND (t.status = ANY (ARRAY['DRAFT'::public.content_status, 'PENDING_APPROVAL'::public.content_status]))))) AND public.has_role('TEST_CREATOR'::public.user_role))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.tests t
  WHERE ((t.id = test_sections.test_id) AND (t.created_by = auth.uid()) AND (t.status = ANY (ARRAY['DRAFT'::public.content_status, 'PENDING_APPROVAL'::public.content_status]))))) AND public.has_role('TEST_CREATOR'::public.user_role)));


--
-- Name: consent_records Tutor reads own consent state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tutor reads own consent state" ON public.consent_records FOR SELECT USING ((tutor_user_id = auth.uid()));


--
-- Name: tutor_student_links Tutor reads own links; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tutor reads own links" ON public.tutor_student_links FOR SELECT USING ((tutor_user_id = auth.uid()));


--
-- Name: notifications User can read/update own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "User can read/update own notifications" ON public.notifications USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: entitlements User can view own entitlements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "User can view own entitlements" ON public.entitlements FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: purchases User can view own purchases; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "User can view own purchases" ON public.purchases FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: app_user_roles Users can read own role; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own role" ON public.app_user_roles FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: offers Users can view live offers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view live offers" ON public.offers FOR SELECT USING (((auth.uid() IS NOT NULL) AND (active = true) AND ((starts_at IS NULL) OR (starts_at <= now())) AND ((ends_at IS NULL) OR (ends_at > now()))));


--
-- Name: funnel_state Users can view own funnel state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own funnel state" ON public.funnel_state FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: profiles Users can view own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (((id = auth.uid()) OR public.has_role('ADMIN'::public.user_role)));


--
-- Name: referrals Users can view own referral activity; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own referral activity" ON public.referrals FOR SELECT USING (((referee_user_id = auth.uid()) OR public.has_role('ADMIN'::public.user_role) OR (EXISTS ( SELECT 1
   FROM public.referral_codes rc
  WHERE ((rc.code = referrals.code) AND (rc.owner_user_id = auth.uid()))))));


--
-- Name: referral_codes Users can view own referral code; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own referral code" ON public.referral_codes FOR SELECT USING (((owner_user_id = auth.uid()) OR public.has_role('ADMIN'::public.user_role)));


--
-- Name: subscriptions Users can view own subscription; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own subscription" ON public.subscriptions FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: test_questions Users can view published mapping; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view published mapping" ON public.test_questions FOR SELECT USING (public.can_access_published_test(test_id));


--
-- Name: questions Users can view published questions if accessible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view published questions if accessible" ON public.questions FOR SELECT USING (((auth.uid() IS NOT NULL) AND (status = 'PUBLISHED'::public.content_status) AND (EXISTS ( SELECT 1
   FROM public.test_questions tq
  WHERE ((tq.question_id = questions.id) AND public.can_access_published_test(tq.test_id))))));


--
-- Name: test_sections Users can view published test sections; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view published test sections" ON public.test_sections FOR SELECT USING (public.can_access_published_test(test_id));


--
-- Name: tests Users can view published tests if accessible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view published tests if accessible" ON public.tests FOR SELECT USING (public.can_access_published_test(id));


--
-- Name: app_user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_user_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: attempts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attempts ENABLE ROW LEVEL SECURITY;

--
-- Name: consent_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consent_records ENABLE ROW LEVEL SECURITY;

--
-- Name: email_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;

--
-- Name: enquiries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.enquiries ENABLE ROW LEVEL SECURITY;

--
-- Name: enquiry_contact_access_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.enquiry_contact_access_log ENABLE ROW LEVEL SECURITY;

--
-- Name: enquiry_contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.enquiry_contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: enquiry_throttle; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.enquiry_throttle ENABLE ROW LEVEL SECURITY;

--
-- Name: entitlements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.entitlements ENABLE ROW LEVEL SECURITY;

--
-- Name: experiment_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.experiment_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: experiment_exposures; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.experiment_exposures ENABLE ROW LEVEL SECURITY;

--
-- Name: experiments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.experiments ENABLE ROW LEVEL SECURITY;

--
-- Name: funnel_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.funnel_events ENABLE ROW LEVEL SECURITY;

--
-- Name: funnel_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.funnel_state ENABLE ROW LEVEL SECURITY;

--
-- Name: inbound_email_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inbound_email_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: offers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;

--
-- Name: parent_student_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.parent_student_links ENABLE ROW LEVEL SECURITY;

--
-- Name: practice_rest_days; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.practice_rest_days ENABLE ROW LEVEL SECURITY;

--
-- Name: processed_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.processed_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: processed_webhook_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.processed_webhook_events ENABLE ROW LEVEL SECURITY;

--
-- Name: product_tests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_tests ENABLE ROW LEVEL SECURITY;

--
-- Name: products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: purchases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;

--
-- Name: questions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;

--
-- Name: referral_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: referrals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

--
-- Name: responses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.responses ENABLE ROW LEVEL SECURITY;

--
-- Name: student_exam_targets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.student_exam_targets ENABLE ROW LEVEL SECURITY;

--
-- Name: student_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.student_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: test_questions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.test_questions ENABLE ROW LEVEL SECURITY;

--
-- Name: test_sections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.test_sections ENABLE ROW LEVEL SECURITY;

--
-- Name: tests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tests ENABLE ROW LEVEL SECURITY;

--
-- Name: tutor_student_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tutor_student_links ENABLE ROW LEVEL SECURITY;

--
-- Name: writing_evaluations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.writing_evaluations ENABLE ROW LEVEL SECURITY;

--
-- Name: writing_practice_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.writing_practice_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: writing_prompts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.writing_prompts ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION admin_coverage_gaps(p_exam_type text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_coverage_gaps(p_exam_type text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_coverage_gaps(p_exam_type text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_coverage_gaps(p_exam_type text) TO service_role;


--
-- Name: FUNCTION admin_data_quality(p_from_date integer, p_to_date integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_data_quality(p_from_date integer, p_to_date integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_data_quality(p_from_date integer, p_to_date integer) TO authenticated;
GRANT ALL ON FUNCTION public.admin_data_quality(p_from_date integer, p_to_date integer) TO service_role;


--
-- Name: FUNCTION admin_enquiry_counts(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_enquiry_counts() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_enquiry_counts() TO service_role;
GRANT ALL ON FUNCTION public.admin_enquiry_counts() TO authenticated;


--
-- Name: FUNCTION admin_enquiry_queue(p_status text, p_type text, p_unanswered boolean, p_limit integer, p_offset integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_enquiry_queue(p_status text, p_type text, p_unanswered boolean, p_limit integer, p_offset integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_enquiry_queue(p_status text, p_type text, p_unanswered boolean, p_limit integer, p_offset integer) TO service_role;
GRANT ALL ON FUNCTION public.admin_enquiry_queue(p_status text, p_type text, p_unanswered boolean, p_limit integer, p_offset integer) TO authenticated;


--
-- Name: FUNCTION admin_enquiry_series(p_days integer, p_channel text, p_type text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_enquiry_series(p_days integer, p_channel text, p_type text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_enquiry_series(p_days integer, p_channel text, p_type text) TO service_role;
GRANT ALL ON FUNCTION public.admin_enquiry_series(p_days integer, p_channel text, p_type text) TO authenticated;


--
-- Name: FUNCTION admin_enquiry_summary(p_days integer, p_channel text, p_type text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_enquiry_summary(p_days integer, p_channel text, p_type text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_enquiry_summary(p_days integer, p_channel text, p_type text) TO service_role;
GRANT ALL ON FUNCTION public.admin_enquiry_summary(p_days integer, p_channel text, p_type text) TO authenticated;


--
-- Name: FUNCTION admin_enquiry_transition(p_enquiry_id uuid, p_action text, p_outcome text, p_assignee uuid, p_convert_ref text, p_convert_kind text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_enquiry_transition(p_enquiry_id uuid, p_action text, p_outcome text, p_assignee uuid, p_convert_ref text, p_convert_kind text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_enquiry_transition(p_enquiry_id uuid, p_action text, p_outcome text, p_assignee uuid, p_convert_ref text, p_convert_kind text) TO service_role;
GRANT ALL ON FUNCTION public.admin_enquiry_transition(p_enquiry_id uuid, p_action text, p_outcome text, p_assignee uuid, p_convert_ref text, p_convert_kind text) TO authenticated;


--
-- Name: FUNCTION admin_experiment_results(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_experiment_results() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_experiment_results() TO authenticated;
GRANT ALL ON FUNCTION public.admin_experiment_results() TO service_role;


--
-- Name: FUNCTION admin_funnel_by_stage(p_from_date integer, p_to_date integer, p_segment_by text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_funnel_by_stage(p_from_date integer, p_to_date integer, p_segment_by text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_funnel_by_stage(p_from_date integer, p_to_date integer, p_segment_by text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_funnel_by_stage(p_from_date integer, p_to_date integer, p_segment_by text) TO service_role;


--
-- Name: FUNCTION admin_funnel_outcomes(p_from_date integer, p_to_date integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_funnel_outcomes(p_from_date integer, p_to_date integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_funnel_outcomes(p_from_date integer, p_to_date integer) TO authenticated;
GRANT ALL ON FUNCTION public.admin_funnel_outcomes(p_from_date integer, p_to_date integer) TO service_role;


--
-- Name: FUNCTION admin_item_statistics(p_test_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_item_statistics(p_test_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_item_statistics(p_test_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_item_statistics(p_test_id uuid) TO service_role;


--
-- Name: FUNCTION admin_item_thresholds(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_item_thresholds() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_item_thresholds() TO authenticated;
GRANT ALL ON FUNCTION public.admin_item_thresholds() TO service_role;


--
-- Name: FUNCTION admin_platform_health(p_from_date integer, p_to_date integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_platform_health(p_from_date integer, p_to_date integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_platform_health(p_from_date integer, p_to_date integer) TO authenticated;
GRANT ALL ON FUNCTION public.admin_platform_health(p_from_date integer, p_to_date integer) TO service_role;


--
-- Name: FUNCTION admin_set_year_level_cap(p_year_level smallint, p_max_tests smallint, p_max_questions smallint, p_recommended_tests smallint, p_recommended_questions smallint, p_daily_target_basis text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_year_level_cap(p_year_level smallint, p_max_tests smallint, p_max_questions smallint, p_recommended_tests smallint, p_recommended_questions smallint, p_daily_target_basis text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_year_level_cap(p_year_level smallint, p_max_tests smallint, p_max_questions smallint, p_recommended_tests smallint, p_recommended_questions smallint, p_daily_target_basis text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_set_year_level_cap(p_year_level smallint, p_max_tests smallint, p_max_questions smallint, p_recommended_tests smallint, p_recommended_questions smallint, p_daily_target_basis text) TO service_role;


--
-- Name: FUNCTION admin_year_level_caps(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_year_level_caps() TO anon;
GRANT ALL ON FUNCTION public.admin_year_level_caps() TO authenticated;
GRANT ALL ON FUNCTION public.admin_year_level_caps() TO service_role;


--
-- Name: FUNCTION advance_funnel_stage(target_user_id uuid, new_stage text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.advance_funnel_stage(target_user_id uuid, new_stage text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.advance_funnel_stage(target_user_id uuid, new_stage text) TO service_role;


--
-- Name: FUNCTION can_access_published_test(target_test_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.can_access_published_test(target_test_id uuid) TO anon;
GRANT ALL ON FUNCTION public.can_access_published_test(target_test_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.can_access_published_test(target_test_id uuid) TO service_role;


--
-- Name: FUNCTION child_attempt_history(p_student_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.child_attempt_history(p_student_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.child_attempt_history(p_student_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.child_attempt_history(p_student_id uuid) TO authenticated;


--
-- Name: FUNCTION creator_coverage_queue(p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.creator_coverage_queue(p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.creator_coverage_queue(p_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.creator_coverage_queue(p_limit integer) TO service_role;


--
-- Name: FUNCTION enquiry_id_for_source_ref(p_source_ref text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enquiry_id_for_source_ref(p_source_ref text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.enquiry_id_for_source_ref(p_source_ref text) TO service_role;


--
-- Name: FUNCTION enquiry_throttle_check(p_fp text, p_min_interval_seconds integer, p_daily_cap integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enquiry_throttle_check(p_fp text, p_min_interval_seconds integer, p_daily_cap integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.enquiry_throttle_check(p_fp text, p_min_interval_seconds integer, p_daily_cap integer) TO service_role;


--
-- Name: FUNCTION experiment_assign(p_experiment_key text, p_subject_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.experiment_assign(p_experiment_key text, p_subject_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.experiment_assign(p_experiment_key text, p_subject_key text) TO service_role;


--
-- Name: FUNCTION experiment_expose(p_experiment_key text, p_subject_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.experiment_expose(p_experiment_key text, p_subject_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.experiment_expose(p_experiment_key text, p_subject_key text) TO service_role;


--
-- Name: FUNCTION export_baseline_function_acls(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.export_baseline_function_acls() FROM PUBLIC;
GRANT ALL ON FUNCTION public.export_baseline_function_acls() TO service_role;


--
-- Name: FUNCTION export_baseline_parity(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.export_baseline_parity() FROM PUBLIC;
GRANT ALL ON FUNCTION public.export_baseline_parity() TO service_role;


--
-- Name: FUNCTION export_schema_baseline(p_part text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.export_schema_baseline(p_part text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.export_schema_baseline(p_part text) TO service_role;


--
-- Name: FUNCTION funnel_stage_rank(stage_name text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.funnel_stage_rank(stage_name text) TO anon;
GRANT ALL ON FUNCTION public.funnel_stage_rank(stage_name text) TO authenticated;
GRANT ALL ON FUNCTION public.funnel_stage_rank(stage_name text) TO service_role;


--
-- Name: FUNCTION handle_new_auth_user(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC;
GRANT ALL ON FUNCTION public.handle_new_auth_user() TO service_role;


--
-- Name: FUNCTION handle_new_user_profile(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.handle_new_user_profile() FROM PUBLIC;
GRANT ALL ON FUNCTION public.handle_new_user_profile() TO service_role;


--
-- Name: FUNCTION has_active_subscription(target_user_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.has_active_subscription(target_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.has_active_subscription(target_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.has_active_subscription(target_user_id uuid) TO service_role;


--
-- Name: FUNCTION has_entitlement(target_test_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.has_entitlement(target_test_id uuid) TO anon;
GRANT ALL ON FUNCTION public.has_entitlement(target_test_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.has_entitlement(target_test_id uuid) TO service_role;


--
-- Name: FUNCTION has_live_tutor_consent(target_student_id uuid, target_tutor_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.has_live_tutor_consent(target_student_id uuid, target_tutor_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.has_live_tutor_consent(target_student_id uuid, target_tutor_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.has_live_tutor_consent(target_student_id uuid, target_tutor_user_id uuid) TO service_role;


--
-- Name: FUNCTION has_role(target_role public.user_role); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.has_role(target_role public.user_role) TO anon;
GRANT ALL ON FUNCTION public.has_role(target_role public.user_role) TO authenticated;
GRANT ALL ON FUNCTION public.has_role(target_role public.user_role) TO service_role;


--
-- Name: FUNCTION ingest_enquiry(p_channel text, p_received_at timestamp with time zone, p_enquiry_type text, p_source_ref text, p_parent_user_id uuid, p_utm jsonb, p_contact jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ingest_enquiry(p_channel text, p_received_at timestamp with time zone, p_enquiry_type text, p_source_ref text, p_parent_user_id uuid, p_utm jsonb, p_contact jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ingest_enquiry(p_channel text, p_received_at timestamp with time zone, p_enquiry_type text, p_source_ref text, p_parent_user_id uuid, p_utm jsonb, p_contact jsonb) TO service_role;


--
-- Name: FUNCTION is_attempt_owner(target_attempt_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_attempt_owner(target_attempt_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_attempt_owner(target_attempt_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_attempt_owner(target_attempt_id uuid) TO service_role;


--
-- Name: FUNCTION is_attempt_parent(target_attempt_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_attempt_parent(target_attempt_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_attempt_parent(target_attempt_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_attempt_parent(target_attempt_id uuid) TO service_role;


--
-- Name: FUNCTION is_parent_of(target_student_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_parent_of(target_student_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_parent_of(target_student_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_parent_of(target_student_id uuid) TO service_role;


--
-- Name: FUNCTION is_student_self(target_student_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_student_self(target_student_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_student_self(target_student_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_student_self(target_student_id uuid) TO service_role;


--
-- Name: FUNCTION is_tutor_of(target_student_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_tutor_of(target_student_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_tutor_of(target_student_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_tutor_of(target_student_id uuid) TO service_role;


--
-- Name: FUNCTION may_read_results(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.may_read_results() FROM PUBLIC;
GRANT ALL ON FUNCTION public.may_read_results() TO service_role;
GRANT ALL ON FUNCTION public.may_read_results() TO authenticated;


--
-- Name: FUNCTION my_attempt_context(p_attempt_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_attempt_context(p_attempt_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_attempt_context(p_attempt_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.my_attempt_context(p_attempt_id uuid) TO service_role;


--
-- Name: FUNCTION my_attempt_status(p_attempt_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_attempt_status(p_attempt_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_attempt_status(p_attempt_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.my_attempt_status(p_attempt_id uuid) TO service_role;


--
-- Name: FUNCTION my_completed_attempt_count(p_student_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_completed_attempt_count(p_student_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_completed_attempt_count(p_student_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.my_completed_attempt_count(p_student_id uuid) TO service_role;


--
-- Name: FUNCTION parent_grant_tutor_consent(p_student_id uuid, p_tutor_user_id uuid, p_months integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.parent_grant_tutor_consent(p_student_id uuid, p_tutor_user_id uuid, p_months integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.parent_grant_tutor_consent(p_student_id uuid, p_tutor_user_id uuid, p_months integer) TO authenticated;
GRANT ALL ON FUNCTION public.parent_grant_tutor_consent(p_student_id uuid, p_tutor_user_id uuid, p_months integer) TO service_role;


--
-- Name: FUNCTION parent_grant_tutor_consent_by_email(p_student_id uuid, p_tutor_email text, p_months integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.parent_grant_tutor_consent_by_email(p_student_id uuid, p_tutor_email text, p_months integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.parent_grant_tutor_consent_by_email(p_student_id uuid, p_tutor_email text, p_months integer) TO authenticated;
GRANT ALL ON FUNCTION public.parent_grant_tutor_consent_by_email(p_student_id uuid, p_tutor_email text, p_months integer) TO service_role;


--
-- Name: FUNCTION parent_mastery(p_student_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.parent_mastery(p_student_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.parent_mastery(p_student_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.parent_mastery(p_student_id uuid) TO service_role;


--
-- Name: FUNCTION parent_percentile(p_student_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.parent_percentile(p_student_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.parent_percentile(p_student_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.parent_percentile(p_student_id uuid) TO authenticated;


--
-- Name: FUNCTION parent_plan_get(p_student_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.parent_plan_get(p_student_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.parent_plan_get(p_student_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.parent_plan_get(p_student_id uuid) TO service_role;


--
-- Name: FUNCTION parent_plan_set(p_student_id uuid, p_target_exam text, p_target_exam_type text, p_exam_date date, p_weekly_sessions_goal integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.parent_plan_set(p_student_id uuid, p_target_exam text, p_target_exam_type text, p_exam_date date, p_weekly_sessions_goal integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.parent_plan_set(p_student_id uuid, p_target_exam text, p_target_exam_type text, p_exam_date date, p_weekly_sessions_goal integer) TO authenticated;
GRANT ALL ON FUNCTION public.parent_plan_set(p_student_id uuid, p_target_exam text, p_target_exam_type text, p_exam_date date, p_weekly_sessions_goal integer) TO service_role;


--
-- Name: FUNCTION parent_progress_summary(p_student_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.parent_progress_summary(p_student_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.parent_progress_summary(p_student_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.parent_progress_summary(p_student_id uuid) TO service_role;


--
-- Name: FUNCTION parent_readiness_projection(p_student_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.parent_readiness_projection(p_student_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.parent_readiness_projection(p_student_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.parent_readiness_projection(p_student_id uuid) TO service_role;


--
-- Name: FUNCTION parent_recommendations(p_student_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.parent_recommendations(p_student_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.parent_recommendations(p_student_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.parent_recommendations(p_student_id uuid) TO service_role;


--
-- Name: FUNCTION parent_revoke_tutor_consent(p_student_id uuid, p_tutor_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.parent_revoke_tutor_consent(p_student_id uuid, p_tutor_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.parent_revoke_tutor_consent(p_student_id uuid, p_tutor_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.parent_revoke_tutor_consent(p_student_id uuid, p_tutor_user_id uuid) TO service_role;


--
-- Name: FUNCTION parent_study_behaviour(p_student_id uuid, p_weeks integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.parent_study_behaviour(p_student_id uuid, p_weeks integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.parent_study_behaviour(p_student_id uuid, p_weeks integer) TO authenticated;
GRANT ALL ON FUNCTION public.parent_study_behaviour(p_student_id uuid, p_weeks integer) TO service_role;


--
-- Name: FUNCTION parent_tutor_consents(p_student_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.parent_tutor_consents(p_student_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.parent_tutor_consents(p_student_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.parent_tutor_consents(p_student_id uuid) TO service_role;


--
-- Name: FUNCTION privilege_parity_checks(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.privilege_parity_checks() FROM PUBLIC;
GRANT ALL ON FUNCTION public.privilege_parity_checks() TO service_role;


--
-- Name: FUNCTION read_enquiry_contact(p_enquiry_id uuid, p_task_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.read_enquiry_contact(p_enquiry_id uuid, p_task_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_enquiry_contact(p_enquiry_id uuid, p_task_reason text) TO service_role;
GRANT ALL ON FUNCTION public.read_enquiry_contact(p_enquiry_id uuid, p_task_reason text) TO authenticated;


--
-- Name: FUNCTION readiness_skill_exam_map(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.readiness_skill_exam_map() FROM PUBLIC;
GRANT ALL ON FUNCTION public.readiness_skill_exam_map() TO authenticated;
GRANT ALL ON FUNCTION public.readiness_skill_exam_map() TO service_role;


--
-- Name: FUNCTION record_inbound_email(p_provider_message_id text, p_from_address text, p_to_address text, p_subject text, p_received_at timestamp with time zone, p_payload jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_inbound_email(p_provider_message_id text, p_from_address text, p_to_address text, p_subject text, p_received_at timestamp with time zone, p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_inbound_email(p_provider_message_id text, p_from_address text, p_to_address text, p_subject text, p_received_at timestamp with time zone, p_payload jsonb) TO service_role;


--
-- Name: FUNCTION reporting_refresh_lag(p_object text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reporting_refresh_lag(p_object text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reporting_refresh_lag(p_object text) TO authenticated;
GRANT ALL ON FUNCTION public.reporting_refresh_lag(p_object text) TO service_role;


--
-- Name: FUNCTION resume_attempt_answers(p_attempt_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.resume_attempt_answers(p_attempt_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resume_attempt_answers(p_attempt_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.resume_attempt_answers(p_attempt_id uuid) TO service_role;


--
-- Name: FUNCTION student_today(p_student_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.student_today(p_student_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.student_today(p_student_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.student_today(p_student_id uuid) TO service_role;


--
-- Name: FUNCTION tutor_assign_test(p_student_id uuid, p_test_id uuid, p_due_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.tutor_assign_test(p_student_id uuid, p_test_id uuid, p_due_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.tutor_assign_test(p_student_id uuid, p_test_id uuid, p_due_at timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.tutor_assign_test(p_student_id uuid, p_test_id uuid, p_due_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION tutor_assignable_tests(p_student_id uuid, p_subject text, p_topic text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.tutor_assignable_tests(p_student_id uuid, p_subject text, p_topic text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.tutor_assignable_tests(p_student_id uuid, p_subject text, p_topic text) TO authenticated;
GRANT ALL ON FUNCTION public.tutor_assignable_tests(p_student_id uuid, p_subject text, p_topic text) TO service_role;


--
-- Name: FUNCTION tutor_assignments(p_status text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.tutor_assignments(p_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.tutor_assignments(p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.tutor_assignments(p_status text) TO service_role;


--
-- Name: FUNCTION tutor_at_risk(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.tutor_at_risk() FROM PUBLIC;
GRANT ALL ON FUNCTION public.tutor_at_risk() TO authenticated;
GRANT ALL ON FUNCTION public.tutor_at_risk() TO service_role;


--
-- Name: FUNCTION tutor_item_analysis(p_test_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.tutor_item_analysis(p_test_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.tutor_item_analysis(p_test_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.tutor_item_analysis(p_test_id uuid) TO service_role;


--
-- Name: FUNCTION tutor_recommendations(p_student_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.tutor_recommendations(p_student_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.tutor_recommendations(p_student_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.tutor_recommendations(p_student_id uuid) TO service_role;


--
-- Name: FUNCTION tutor_remind(p_assignment_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.tutor_remind(p_assignment_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.tutor_remind(p_assignment_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.tutor_remind(p_assignment_id uuid) TO service_role;


--
-- Name: FUNCTION tutor_skill_gaps(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.tutor_skill_gaps() FROM PUBLIC;
GRANT ALL ON FUNCTION public.tutor_skill_gaps() TO authenticated;
GRANT ALL ON FUNCTION public.tutor_skill_gaps() TO service_role;


--
-- Name: FUNCTION tutor_student_overview(p_period_days integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.tutor_student_overview(p_period_days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.tutor_student_overview(p_period_days integer) TO authenticated;
GRANT ALL ON FUNCTION public.tutor_student_overview(p_period_days integer) TO service_role;


--
-- Name: TABLE app_user_roles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.app_user_roles TO anon;
GRANT ALL ON TABLE public.app_user_roles TO authenticated;
GRANT ALL ON TABLE public.app_user_roles TO service_role;


--
-- Name: TABLE assignments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.assignments TO anon;
GRANT ALL ON TABLE public.assignments TO authenticated;
GRANT ALL ON TABLE public.assignments TO service_role;


--
-- Name: TABLE attempts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.attempts TO anon;
GRANT ALL ON TABLE public.attempts TO authenticated;
GRANT ALL ON TABLE public.attempts TO service_role;


--
-- Name: TABLE consent_records; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.consent_records TO anon;
GRANT ALL ON TABLE public.consent_records TO authenticated;
GRANT ALL ON TABLE public.consent_records TO service_role;


--
-- Name: TABLE email_log; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.email_log TO anon;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.email_log TO authenticated;
GRANT ALL ON TABLE public.email_log TO service_role;


--
-- Name: TABLE enquiries; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,MAINTAIN ON TABLE public.enquiries TO anon;
GRANT SELECT,MAINTAIN ON TABLE public.enquiries TO authenticated;
GRANT ALL ON TABLE public.enquiries TO service_role;


--
-- Name: TABLE enquiry_contact_access_log; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.enquiry_contact_access_log TO service_role;


--
-- Name: SEQUENCE enquiry_contact_access_log_log_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.enquiry_contact_access_log_log_id_seq TO anon;
GRANT ALL ON SEQUENCE public.enquiry_contact_access_log_log_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.enquiry_contact_access_log_log_id_seq TO service_role;


--
-- Name: TABLE enquiry_contacts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.enquiry_contacts TO service_role;


--
-- Name: TABLE enquiry_throttle; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.enquiry_throttle TO service_role;


--
-- Name: TABLE entitlements; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.entitlements TO anon;
GRANT ALL ON TABLE public.entitlements TO authenticated;
GRANT ALL ON TABLE public.entitlements TO service_role;


--
-- Name: TABLE experiment_assignments; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.experiment_assignments TO anon;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.experiment_assignments TO authenticated;
GRANT ALL ON TABLE public.experiment_assignments TO service_role;


--
-- Name: TABLE experiment_exposures; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.experiment_exposures TO anon;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.experiment_exposures TO authenticated;
GRANT ALL ON TABLE public.experiment_exposures TO service_role;


--
-- Name: TABLE experiments; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.experiments TO anon;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.experiments TO authenticated;
GRANT ALL ON TABLE public.experiments TO service_role;


--
-- Name: TABLE funnel_state; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.funnel_state TO anon;
GRANT ALL ON TABLE public.funnel_state TO authenticated;
GRANT ALL ON TABLE public.funnel_state TO service_role;


--
-- Name: TABLE funnel_conversion; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.funnel_conversion TO anon;
GRANT ALL ON TABLE public.funnel_conversion TO authenticated;
GRANT ALL ON TABLE public.funnel_conversion TO service_role;


--
-- Name: TABLE funnel_events; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.funnel_events TO anon;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.funnel_events TO authenticated;
GRANT ALL ON TABLE public.funnel_events TO service_role;


--
-- Name: TABLE inbound_email_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.inbound_email_messages TO service_role;


--
-- Name: TABLE my_access; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.my_access TO anon;
GRANT ALL ON TABLE public.my_access TO authenticated;
GRANT ALL ON TABLE public.my_access TO service_role;


--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notifications TO anon;
GRANT ALL ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;


--
-- Name: TABLE offers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.offers TO anon;
GRANT ALL ON TABLE public.offers TO authenticated;
GRANT ALL ON TABLE public.offers TO service_role;


--
-- Name: TABLE parent_student_links; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.parent_student_links TO anon;
GRANT ALL ON TABLE public.parent_student_links TO authenticated;
GRANT ALL ON TABLE public.parent_student_links TO service_role;


--
-- Name: TABLE practice_rest_days; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.practice_rest_days TO anon;
GRANT ALL ON TABLE public.practice_rest_days TO authenticated;
GRANT ALL ON TABLE public.practice_rest_days TO service_role;


--
-- Name: TABLE processed_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.processed_jobs TO anon;
GRANT ALL ON TABLE public.processed_jobs TO authenticated;
GRANT ALL ON TABLE public.processed_jobs TO service_role;


--
-- Name: TABLE processed_webhook_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.processed_webhook_events TO anon;
GRANT ALL ON TABLE public.processed_webhook_events TO authenticated;
GRANT ALL ON TABLE public.processed_webhook_events TO service_role;


--
-- Name: TABLE product_tests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.product_tests TO anon;
GRANT ALL ON TABLE public.product_tests TO authenticated;
GRANT ALL ON TABLE public.product_tests TO service_role;


--
-- Name: TABLE products; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.products TO anon;
GRANT ALL ON TABLE public.products TO authenticated;
GRANT ALL ON TABLE public.products TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: TABLE purchases; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.purchases TO anon;
GRANT ALL ON TABLE public.purchases TO authenticated;
GRANT ALL ON TABLE public.purchases TO service_role;


--
-- Name: TABLE questions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.questions TO anon;
GRANT ALL ON TABLE public.questions TO authenticated;
GRANT ALL ON TABLE public.questions TO service_role;


--
-- Name: TABLE referral_codes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.referral_codes TO anon;
GRANT ALL ON TABLE public.referral_codes TO authenticated;
GRANT ALL ON TABLE public.referral_codes TO service_role;


--
-- Name: TABLE referrals; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.referrals TO anon;
GRANT ALL ON TABLE public.referrals TO authenticated;
GRANT ALL ON TABLE public.referrals TO service_role;


--
-- Name: TABLE responses; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.responses TO anon;
GRANT ALL ON TABLE public.responses TO authenticated;
GRANT ALL ON TABLE public.responses TO service_role;


--
-- Name: TABLE student_exam_targets; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.student_exam_targets TO anon;
GRANT ALL ON TABLE public.student_exam_targets TO authenticated;
GRANT ALL ON TABLE public.student_exam_targets TO service_role;


--
-- Name: TABLE student_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.student_profiles TO anon;
GRANT ALL ON TABLE public.student_profiles TO authenticated;
GRANT ALL ON TABLE public.student_profiles TO service_role;


--
-- Name: TABLE subscriptions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.subscriptions TO anon;
GRANT ALL ON TABLE public.subscriptions TO authenticated;
GRANT ALL ON TABLE public.subscriptions TO service_role;


--
-- Name: TABLE test_questions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.test_questions TO anon;
GRANT ALL ON TABLE public.test_questions TO authenticated;
GRANT ALL ON TABLE public.test_questions TO service_role;


--
-- Name: TABLE test_sections; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.test_sections TO anon;
GRANT ALL ON TABLE public.test_sections TO authenticated;
GRANT ALL ON TABLE public.test_sections TO service_role;


--
-- Name: TABLE tests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tests TO anon;
GRANT ALL ON TABLE public.tests TO authenticated;
GRANT ALL ON TABLE public.tests TO service_role;


--
-- Name: TABLE tutor_student_links; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.tutor_student_links TO anon;
GRANT ALL ON TABLE public.tutor_student_links TO authenticated;
GRANT ALL ON TABLE public.tutor_student_links TO service_role;


--
-- Name: TABLE writing_evaluations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.writing_evaluations TO anon;
GRANT ALL ON TABLE public.writing_evaluations TO authenticated;
GRANT ALL ON TABLE public.writing_evaluations TO service_role;


--
-- Name: TABLE writing_practice_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.writing_practice_sessions TO authenticated;
GRANT ALL ON TABLE public.writing_practice_sessions TO service_role;


--
-- Name: TABLE writing_prompts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.writing_prompts TO authenticated;
GRANT ALL ON TABLE public.writing_prompts TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict ole5dk7EtKu1pPuWRJKPxgO988Iuyh3AvFgy8XLzYykuW8T9jPGPdrfxPmzbfRc

