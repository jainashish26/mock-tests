-- Generated baseline: public_wrappers
-- Source: live database via export_schema_baseline (migrations 051/052).
-- Do not hand-edit; regenerate with scripts/rebaseline_schema.py.
-- See supabase/migrations/README.md for apply order and caveats.

CREATE OR REPLACE FUNCTION public.admin_coverage_gaps(p_exam_type text DEFAULT NULL::text)
 RETURNS TABLE(subject text, topic text, sub_topic text, exam_type text, item_count bigint, published_count bigint, draft_count bigint, min_items_required integer, threshold_configured boolean, coverage_status text, avg_authored_difficulty numeric, avg_observed_difficulty numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.admin_data_quality(p_from_date integer, p_to_date integer)
 RETURNS TABLE(check_date date, check_name text, object_name text, metric_value bigint, threshold bigint, status text, detail text, as_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.admin_enquiry_counts()
 RETURNS TABLE(open_total bigint, breached bigint, at_risk bigint, unrecorded_open bigint, oldest_age_minutes integer, sla_minutes integer, sla_is_confirmed boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT
    COUNT(*) FILTER (WHERE q.status NOT IN ('resolved','closed','spam'))::bigint,
    COUNT(*) FILTER (WHERE q.status NOT IN ('resolved','closed','spam')
                       AND q.sla_state = 'breached')::bigint,
    COUNT(*) FILTER (WHERE q.status NOT IN ('resolved','closed','spam')
                       AND q.sla_state = 'at_risk')::bigint,
    -- Open, past the window, and no reply recorded yet: these become
    -- 'unrecorded' silently if nobody acts, so they are counted apart from a
    -- plain backlog.
    COUNT(*) FILTER (WHERE q.status NOT IN ('resolved','closed','spam')
                       AND q.first_response_at IS NULL
                       AND q.age_minutes > q.sla_minutes)::bigint,
    COALESCE(MAX(q.age_minutes) FILTER (
      WHERE q.status NOT IN ('resolved','closed','spam'))::integer, 0),
    MAX(q.sla_minutes),
    BOOL_AND(q.sla_is_confirmed)
  FROM public.admin_enquiry_queue(NULL, NULL, false, 200, 0) q;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_enquiry_queue(p_status text DEFAULT NULL::text, p_type text DEFAULT NULL::text, p_unanswered boolean DEFAULT false, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(enquiry_id uuid, channel text, enquiry_type text, status text, outcome text, received_at timestamp with time zone, first_response_at timestamp with time zone, resolved_at timestamp with time zone, assigned_to uuid, parent_user_id uuid, converted boolean, age_minutes integer, response_minutes integer, resolution_hours numeric, sla_minutes integer, sla_state text, sla_is_confirmed boolean, utm_source text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  -- Authorisation before the parameter validation below: a non-admin must not
  -- be able to learn the valid status names by observing which of two 400s
  -- comes back. Silent zero rows is the only answer for an unauthorised
  -- caller, and it is the same shape for every student and every id.
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
    e.id,
    e.channel,
    e.enquiry_type,
    e.status,
    e.outcome,
    e.received_at,
    e.first_response_at,
    e.resolved_at,
    e.assigned_to,
    e.parent_user_id,
    (e.converted_order_id IS NOT NULL),
    -- Ageing is measured against the clock the database owns, never a
    -- client-supplied now(), or the queue could be made to look fresh.
    -- UNITS MATTER, AND THIS LINE IS WHERE THEY WENT WRONG FIRST.
    -- EXTRACT(EPOCH FROM an interval) is SECONDS. Dividing by 60 is what makes
    -- a column called age_minutes mean minutes. The SLA comparisons below all
    -- divide by 60 inside the CASE, so sla_state stayed correct while these
    -- returned values sixty times too large - which is how the bug survived a
    -- passing queue and was caught only by hand-computing a fixture's age.
    -- It also corrupted admin_enquiry_counts(), whose unrecorded_open test
    -- compares this column against the SLA in minutes.
    (EXTRACT(EPOCH FROM (now() - e.received_at)) / 60)::int,
    (EXTRACT(EPOCH FROM (e.first_response_at - e.received_at)) / 60)::int,
    -- resolution_hours stays NULL without a recorded first response for the
    -- same reason the response clock does: an enquiry that was answered offline
    -- and then closed has an unknown middle, and inventing one from the two
    -- ends would silently fill the report's most interesting gap.
    CASE WHEN e.resolved_at IS NULL OR e.first_response_at IS NULL THEN NULL
         ELSE ROUND(EXTRACT(EPOCH FROM (e.resolved_at - e.received_at)) / 3600, 2) END,
    th.first_response_sla_minutes,
    -- Five states, and the reason each one exists:
    --   met        a reply is recorded and it was inside the window
    --   breached   replied late, OR still unanswered past the window. §5.8 is
    --              explicit that an unanswered enquiry counts as a breach NOW:
    --              waiting for it to be resolved is how the worst cases never
    --              appear on the screen meant to surface them.
    --   at_risk    still open, inside the window but past three quarters of it
    --   within     still open, comfortably inside the window
    --   unrecorded resolved or closed with no reply ever recorded. Not "met":
    --              calling it met is the fabrication section 2 refuses.
    CASE
      WHEN e.status IN ('resolved','closed') AND e.first_response_at IS NULL
        THEN 'unrecorded'
      WHEN e.first_response_at IS NOT NULL
        THEN CASE WHEN EXTRACT(EPOCH FROM (e.first_response_at - e.received_at)) / 60
                       <= th.first_response_sla_minutes THEN 'met' ELSE 'breached' END
      WHEN EXTRACT(EPOCH FROM (now() - e.received_at)) / 60
           > th.first_response_sla_minutes THEN 'breached'
      WHEN EXTRACT(EPOCH FROM (now() - e.received_at)) / 60
           > th.first_response_sla_minutes * 0.75 THEN 'at_risk'
      ELSE 'within'
    END,
    th.sla_is_confirmed,
    e.utm_source
  FROM public.enquiries e
  CROSS JOIN reporting.enquiry_thresholds th
  WHERE th.id = 1
    AND (p_status IS NULL OR e.status = p_status)
    -- The default view is the work queue, and spam is not work. Asking for
    -- status='spam' explicitly still returns it.
    AND (p_status IS NOT NULL OR e.status <> 'spam')
    AND (p_type IS NULL OR e.enquiry_type = p_type)
    AND (NOT p_unanswered OR e.first_response_at IS NULL)
  ORDER BY e.received_at ASC
  LIMIT p_limit OFFSET p_offset;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_enquiry_transition(p_enquiry_id uuid, p_action text, p_outcome text DEFAULT NULL::text, p_assignee uuid DEFAULT NULL::uuid)
 RETURNS TABLE(enquiry_id uuid, status text, outcome text, first_response_at timestamp with time zone, first_response_minutes integer, resolved_at timestamp with time zone, resolution_hours numeric, response_recorded boolean, response_was_missing boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_now     timestamptz := now();
  v_e       public.enquiries%ROWTYPE;
  v_target  text;
  v_new_fr  timestamptz;
  v_new_res timestamptz;
BEGIN
  IF NOT public.has_role('ADMIN') THEN
    RAISE EXCEPTION 'only an administrator can change an enquiry''s status'
      USING ERRCODE = '42501';
  END IF;

  IF p_action IS NULL OR p_action NOT IN
     ('triage','start','reply','resolve','close','reopen','assign','spam') THEN
    RAISE EXCEPTION 'unknown enquiry action: %', p_action USING ERRCODE = '22023';
  END IF;

  -- FOR UPDATE, so two admins clicking the same button at the same moment
  -- cannot both pass the "is this already resolved?" tests below and both stamp
  -- a clock. The second sees the row as the first left it.
  SELECT * INTO v_e FROM public.enquiries WHERE id = p_enquiry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such enquiry' USING ERRCODE = 'P0002';
  END IF;

  v_target  := v_e.status;
  v_new_fr  := v_e.first_response_at;
  v_new_res := v_e.resolved_at;

  -- Each action names the status it produces. The table is never handed a
  -- status it has to interpret.
  CASE p_action
    WHEN 'triage'  THEN v_target := 'triaged';
    WHEN 'start'   THEN v_target := 'in_progress';
    WHEN 'reply'   THEN v_target := 'waiting_on_customer';
    WHEN 'resolve' THEN v_target := 'resolved';
    WHEN 'close'   THEN v_target := 'closed';
    WHEN 'reopen'  THEN v_target := 'in_progress';
    WHEN 'spam'    THEN v_target := 'spam';
    WHEN 'assign'  THEN v_target := v_e.status;   -- assignment moves nothing
  END CASE;

  -- The reply clock. Only 'reply' stamps it, and only once: a second reply is
  -- an ordinary conversation, not a second first response.
  IF p_action = 'reply' THEN
    IF v_e.first_response_at IS NOT NULL THEN
      RAISE EXCEPTION 'the first response was already recorded at %',
        v_e.first_response_at USING ERRCODE = '22023';
    END IF;
    -- Refused after resolution rather than backfilled. A reply entered now
    -- would be timed from receipt to now, which is the admin's click time and
    -- not the moment anybody was answered - and it would also violate
    -- enquiries_timeline_sane. See the header, section 2.
    IF v_e.resolved_at IS NOT NULL OR v_e.status IN ('resolved','closed') THEN
      RAISE EXCEPTION
        'cannot record a first response after an enquiry is resolved or closed; '
        'the response was never recorded, and A13 reports it as such'
        USING ERRCODE = '22023';
    END IF;
    v_new_fr := v_now;
  END IF;

  -- The resolution clock, together with the outcome the CHECK demands.
  IF p_action IN ('resolve','close') THEN
    IF p_outcome IS NULL OR p_outcome NOT IN
       ('answered','refunded','escalated','no_action','spam','duplicate','withdrawn') THEN
      RAISE EXCEPTION 'resolving or closing requires a valid outcome'
        USING ERRCODE = '22023';
    END IF;
    -- COALESCE keeps the original timestamp if an enquiry is closed after
    -- being resolved, so resolution_hours does not drift every time somebody
    -- tidies the status.
    v_new_res := COALESCE(v_e.resolved_at, v_now);
  END IF;

  IF p_action = 'spam' THEN
    v_new_res := COALESCE(v_e.resolved_at, v_now);
  END IF;

  -- Reopening means it is not resolved any more. The clock is cleared rather
  -- than left behind, so resolution_hours cannot be computed against a moment
  -- that no longer describes the enquiry.
  IF p_action = 'reopen' THEN
    v_new_res := NULL;
  END IF;

  IF p_action = 'assign' AND p_assignee IS NULL THEN
    RAISE EXCEPTION 'the assign action needs an assignee' USING ERRCODE = '22023';
  END IF;

  UPDATE public.enquiries AS e
     SET status            = v_target,
         first_response_at = v_new_fr,
         resolved_at       = v_new_res,
         -- Every right-hand reference is table-qualified. RETURNS TABLE makes
         -- each output column a plpgsql variable named `status`, `outcome`,
         -- `resolved_at` and so on, so a bare `outcome` here is ambiguous
         -- between the OUT parameter and the column and Postgres refuses the
         -- statement outright (42702). The alias is not decoration: without it
         -- this function cannot be created at all.
         outcome           = COALESCE(p_outcome,
                            CASE WHEN p_action = 'spam' THEN 'spam' ELSE e.outcome END),
         assigned_to       = COALESCE(p_assignee, e.assigned_to),
         updated_at        = v_now
   WHERE e.id = p_enquiry_id;

  RETURN QUERY
  SELECT
    p_enquiry_id,
    v_target,
    COALESCE(p_outcome,
      CASE WHEN p_action = 'spam' THEN 'spam' ELSE v_e.outcome END),
    v_new_fr,
    -- Minutes, not seconds - see the units note in admin_enquiry_queue.
    CASE WHEN v_new_fr IS NULL THEN NULL
         ELSE (EXTRACT(EPOCH FROM (v_new_fr - v_e.received_at)) / 60)::int END,
    v_new_res,
    -- Same rule as the queue's column: an unknown middle stays unknown.
    CASE WHEN v_new_res IS NULL OR v_new_fr IS NULL THEN NULL
         ELSE ROUND(EXTRACT(EPOCH FROM (v_new_res - v_e.received_at)) / 3600, 2) END,
    -- True only when THIS call recorded the first response, which is the only
    -- case that should fire ENQUIRY_FIRST_RESPONDED.
    (p_action = 'reply' AND v_e.first_response_at IS NULL),
    -- The honesty flag for the UI: resolved or closed with no reply on record.
    -- Surfaced rather than smoothed, because it is the difference between "we
    -- answered in three hours" and "we do not know".
    (p_action IN ('resolve','close') AND v_e.first_response_at IS NULL);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_experiment_results()
 RETURNS TABLE(experiment_key text, experiment_name text, status text, variant text, is_control boolean, sample_size bigint, conversions bigint, variant_conversion_rate numeric, control_sample_size bigint, control_rate numeric, diff_pp numeric, ci_lower_pp numeric, ci_upper_pp numeric, p_value_experiment numeric, recommended_decision text, decision_reason text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public'
AS $function$
  SELECT * FROM reporting.experiment_results() WHERE public.has_role('ADMIN');
$function$
;

CREATE OR REPLACE FUNCTION public.admin_funnel_by_stage(p_from_date integer, p_to_date integer, p_segment_by text DEFAULT 'none'::text)
 RETURNS TABLE(stage text, stage_rank integer, channel text, campaign text, device_class text, visitors bigint, events bigint, prev_stage text, prev_stage_visitors bigint, stage_conversion_rate numeric, stage_dropoff_count bigint, suppressed boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public'
AS $function$
  SELECT * FROM reporting.funnel_by_stage(p_from_date, p_to_date, p_segment_by)
  WHERE public.has_role('ADMIN');
$function$
;

CREATE OR REPLACE FUNCTION public.admin_funnel_outcomes(p_from_date integer, p_to_date integer)
 RETURNS TABLE(reached_paywall bigint, paying bigint, free_to_paid_rate numeric, checkout_started bigint, checkout_completed bigint, checkout_abandoned bigint, checkout_abandonment_rate numeric, median_hours_to_abandon numeric, signup_cohort bigint, activated bigint, activation_rate numeric, median_hours_to_first_value numeric, suppressed boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public'
AS $function$
  SELECT * FROM reporting.funnel_outcomes(p_from_date, p_to_date)
  WHERE public.has_role('ADMIN');
$function$
;

CREATE OR REPLACE FUNCTION public.admin_item_statistics(p_test_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(period_label text, test_id uuid, item_id uuid, subject text, topic text, responses bigint, students bigint, enough_evidence boolean, p_value numeric, point_biserial numeric, median_time_seconds numeric, skip_rate_pct numeric, skip_rate_reliable boolean, marking_reliable boolean, item_flag_rate_pct numeric, key_option text, distractors jsonb, dead_distractors text[], defect_reasons text[], is_defective boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.admin_item_thresholds()
 RETURNS TABLE(min_responses_per_item integer, p_value_floor numeric, p_value_ceiling numeric, point_biserial_min numeric, median_time_max_seconds integer, skip_rate_max_pct numeric, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.admin_platform_health(p_from_date integer, p_to_date integer)
 RETURNS TABLE(hour_start timestamp with time zone, date_key integer, hour_of_day smallint, active_users bigint, peak_concurrency bigint, concurrency_vs_cap numeric, peak_concurrency_cap integer, cap_is_measured boolean, tests_started bigint, tests_submitted bigint, errors bigint, test_error_rate numeric, submit_errors bigint, failed_submission_rate numeric, as_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.admin_set_year_level_cap(p_year_level smallint, p_max_tests smallint, p_max_questions smallint, p_recommended_tests smallint, p_recommended_questions smallint)
 RETURNS TABLE(year_level smallint, max_tests_per_day smallint, max_questions_per_day smallint, recommended_tests_per_day smallint, recommended_questions_per_day smallint, updated_at timestamp with time zone)
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
$function$
;

CREATE OR REPLACE FUNCTION public.admin_year_level_caps()
 RETURNS TABLE(year_level smallint, max_tests_per_day smallint, max_questions_per_day smallint, recommended_tests_per_day smallint, recommended_questions_per_day smallint, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
  SELECT c.year_level, c.max_tests_per_day, c.max_questions_per_day,
         c.recommended_tests_per_day, c.recommended_questions_per_day, c.updated_at
  FROM reporting.dim_year_level_cap c
  WHERE public.has_role('ADMIN')
  ORDER BY c.year_level;
$function$
;

CREATE OR REPLACE FUNCTION public.advance_funnel_stage(target_user_id uuid, new_stage text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.funnel_state (user_id, stage, stage_updated_at)
  VALUES (target_user_id, new_stage, now())
  ON CONFLICT (user_id) DO UPDATE
    SET stage = EXCLUDED.stage, stage_updated_at = now()
    -- Monotonic: never regress on an out-of-order webhook or replayed job.
    WHERE public.funnel_stage_rank(public.funnel_state.stage)
        < public.funnel_stage_rank(EXCLUDED.stage);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.can_access_published_test(target_test_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.child_attempt_history(p_student_id uuid)
 RETURNS TABLE(attempt_id uuid, started_at timestamp with time zone, status text, score numeric, section_scores jsonb, test_id uuid, test_title text, exam_type text, family_group text, family_group_label text, year_level smallint, attempt_ordinal bigint, personal_progress_delta numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public'
AS $function$
  SELECT h.attempt_id, h.started_at, h.status, h.score, h.section_scores,
         h.test_id, h.title, h.exam_type, h.family_group, h.family_group_label,
         h.year_level, h.attempt_ordinal, h.personal_progress_delta
  FROM reporting.mv_attempt_history h
  WHERE h.student_id = p_student_id
    -- A student is rejected here even though they are the subject of the row.
    AND public.may_read_results()
    AND (public.is_parent_of(p_student_id) OR public.has_role('ADMIN'));
$function$
;

CREATE OR REPLACE FUNCTION public.creator_coverage_queue(p_limit integer DEFAULT 50)
 RETURNS TABLE(production_priority bigint, subject text, topic text, sub_topic text, exam_type text, published_count bigint, draft_count bigint, min_items_required integer, threshold_configured boolean, deficit bigint, oldest_draft_age_days integer, coverage_status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.enquiry_id_for_source_ref(p_source_ref text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT e.id
    FROM public.enquiries e
   WHERE e.channel = 'web_form'
     AND e.ingest_source_ref = p_source_ref;
$function$
;

CREATE OR REPLACE FUNCTION public.enquiry_throttle_check(p_fp text, p_min_interval_seconds integer DEFAULT 60, p_daily_cap integer DEFAULT 5)
 RETURNS TABLE(allowed boolean, retry_after_seconds integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.experiment_assign(p_experiment_key text, p_subject_key text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.experiment_expose(p_experiment_key text, p_subject_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id) VALUES (NEW.id) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $function$
;

CREATE OR REPLACE FUNCTION public.has_active_subscription(target_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.user_id = target_user_id
      -- past_due keeps access while Stripe retries a failed card. Cutting off a
      -- paying customer for one declined retry costs far more support load than
      -- the small window of free access.
      AND s.status IN ('trialing','active','past_due')
      AND (s.current_period_end IS NULL OR s.current_period_end > now())
  );
$function$
;

CREATE OR REPLACE FUNCTION public.has_entitlement(target_test_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.entitlements 
    WHERE user_id = auth.uid() AND test_id = target_test_id AND active = true
  );
$function$
;

CREATE OR REPLACE FUNCTION public.has_live_tutor_consent(target_student_id uuid, target_tutor_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.consent_records c
    WHERE c.student_id = target_student_id
      AND c.tutor_user_id = target_tutor_user_id
      AND c.purpose = 'TUTOR_REPORTING'
      AND c.revoked_at IS NULL
      AND c.expires_at > now()
  );
$function$
;

CREATE OR REPLACE FUNCTION public.has_role(target_role user_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.app_user_roles 
    WHERE user_id = auth.uid() AND role = target_role
  );
$function$
;

CREATE OR REPLACE FUNCTION public.ingest_enquiry(p_channel text, p_received_at timestamp with time zone, p_enquiry_type text, p_source_ref text, p_parent_user_id uuid, p_utm jsonb, p_contact jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
END; $function$
;

CREATE OR REPLACE FUNCTION public.is_attempt_owner(target_attempt_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.attempts a
    JOIN public.student_profiles s ON a.student_id = s.id
    WHERE a.id = target_attempt_id AND s.auth_user_id = auth.uid()
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_attempt_parent(target_attempt_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.attempts a
    JOIN public.parent_student_links psl ON psl.student_id = a.student_id
    WHERE a.id = target_attempt_id
      AND psl.parent_user_id = auth.uid()
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_parent_of(target_student_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.parent_student_links 
    WHERE parent_user_id = auth.uid() AND student_id = target_student_id
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_student_self(target_student_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.student_profiles 
    WHERE id = target_student_id AND auth_user_id = auth.uid()
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_tutor_of(target_student_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.tutor_student_links l
    WHERE l.tutor_user_id = auth.uid()
      AND l.student_id = target_student_id
      AND public.has_live_tutor_consent(target_student_id, auth.uid())
  );
$function$
;

CREATE OR REPLACE FUNCTION public.may_read_results()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.app_user_roles r
       WHERE r.user_id = auth.uid() AND r.role = 'STUDENT'
     );
$function$
;

CREATE OR REPLACE FUNCTION public.my_attempt_context(p_attempt_id uuid)
 RETURNS TABLE(id uuid, student_id uuid, test_id uuid, status attempt_status, exam_type exam_type, started_at timestamp with time zone, submitted_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT a.id, a.student_id, a.test_id, a.status, t.exam_type, a.started_at, a.submitted_at
  FROM public.attempts a
  LEFT JOIN public.tests t ON t.id = a.test_id
  WHERE a.id = p_attempt_id
    AND (public.is_attempt_owner(p_attempt_id) OR public.has_role('ADMIN'));
$function$
;

CREATE OR REPLACE FUNCTION public.my_attempt_status(p_attempt_id uuid)
 RETURNS TABLE(id uuid, test_id uuid, status attempt_status, started_at timestamp with time zone, submitted_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT a.id, a.test_id, a.status, a.started_at, a.submitted_at
  FROM public.attempts a
  WHERE a.id = p_attempt_id
    AND public.is_attempt_owner(p_attempt_id);
$function$
;

CREATE OR REPLACE FUNCTION public.my_completed_attempt_count(p_student_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COUNT(*)::integer
  FROM public.attempts a
  WHERE a.student_id = p_student_id
    AND a.status IN ('SUBMITTED', 'COMPLETE')
    -- Authorisation: only the student themself, a linked parent, or an admin.
    AND (public.is_student_self(p_student_id)
         OR public.is_parent_of(p_student_id)
         OR public.has_role('ADMIN'));
$function$
;

CREATE OR REPLACE FUNCTION public.parent_grant_tutor_consent(p_student_id uuid, p_tutor_user_id uuid, p_months integer DEFAULT 12)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.parent_grant_tutor_consent_by_email(p_student_id uuid, p_tutor_email text, p_months integer DEFAULT 12)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.parent_mastery(p_student_id uuid)
 RETURNS TABLE(subject text, topic text, items_answered bigint, items_correct bigint, accuracy_pct numeric, mastery_level text, mastery_label text, has_signal boolean, last_practised_date_key integer, as_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.parent_percentile(p_student_id uuid)
 RETURNS TABLE(family_group text, family_group_label text, year_level smallint, latest_score numeric, percentile_rank integer, percentile_band integer, suppressed boolean, cohort_size bigint, cohort_window_months integer, cohort_definition text, window_start date, window_end date, personal_progress_delta numeric, attempts_completed bigint, as_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.parent_plan_get(p_student_id uuid)
 RETURNS TABLE(student_id uuid, target_exam text, target_exam_type text, exam_date date, days_to_exam integer, weekly_sessions_goal integer, unit_kind text, daily_target_units numeric, required_daily numeric, effective_cap integer, plan_overload_flag boolean, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.parent_plan_set(p_student_id uuid, p_target_exam text, p_target_exam_type text, p_exam_date date, p_weekly_sessions_goal integer)
 RETURNS TABLE(student_id uuid, target_exam text, target_exam_type text, exam_date date, weekly_sessions_goal integer, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'reporting', 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.parent_progress_summary(p_student_id uuid)
 RETURNS TABLE(family_group text, family_group_label text, attempts_completed bigint, first_score numeric, latest_score numeric, overall_delta numeric, mean_delta numeric, sd_delta numeric, latest_attempt_id uuid, latest_started_at timestamp with time zone, trend text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.parent_readiness_projection(p_student_id uuid)
 RETURNS TABLE(eligible boolean, attempts_completed bigint, exam_date date, weeks_to_exam numeric, point_projection numeric, range_low numeric, range_high numeric, projected_band_low text, projected_band_high text, confidence text, reason text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.parent_recommendations(p_student_id uuid)
 RETURNS TABLE(recommendation_rank integer, subject text, topic text, items_answered bigint, accuracy_pct numeric, expected_impact_score numeric, reason text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
  SELECT r.recommendation_rank, r.subject, r.topic, r.items_answered,
         r.accuracy_pct, r.expected_impact_score, r.reason
  -- Authorise first; the scoring function is never reached otherwise.
  FROM (SELECT 1 AS ok
        WHERE public.may_read_results()
          AND (public.is_parent_of(p_student_id) OR public.has_role('ADMIN'))
       ) k
  CROSS JOIN LATERAL reporting.recommendations_scored(p_student_id) r;
$function$
;

CREATE OR REPLACE FUNCTION public.parent_revoke_tutor_consent(p_student_id uuid, p_tutor_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.parent_study_behaviour(p_student_id uuid, p_weeks integer DEFAULT 12)
 RETURNS TABLE(week_start date, week_end date, year_level smallint, sessions bigint, weekly_sessions_goal smallint, target_adherence numeric, items_answered bigint, time_on_task_seconds bigint, median_seconds_per_item numeric, peer_median_seconds numeric, pace_vs_expected numeric, skip_rate numeric, guess_rate numeric, as_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.parent_tutor_consents(p_student_id uuid)
 RETURNS TABLE(tutor_user_id uuid, tutor_email text, linked_at timestamp with time zone, consent_id uuid, granted_at timestamp with time zone, expires_at timestamp with time zone, revoked_at timestamp with time zone, is_current boolean, state text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.read_enquiry_contact(p_enquiry_id uuid, p_task_reason text)
 RETURNS TABLE(full_name text, email text, phone text, message_body text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
END; $function$
;

CREATE OR REPLACE FUNCTION public.reporting_refresh_lag(p_object text)
 RETURNS TABLE(object_name text, last_refreshed_at timestamp with time zone, lag_minutes bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.resume_attempt_answers(p_attempt_id uuid)
 RETURNS TABLE(question_id uuid, answer text, time_spent_seconds integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT r.question_id, r.answer, r.time_spent_seconds
  FROM public.responses r
  WHERE r.attempt_id = p_attempt_id
    AND public.is_attempt_owner(p_attempt_id);
$function$
;

CREATE OR REPLACE FUNCTION public.student_today(p_student_id uuid)
 RETURNS TABLE(student_id uuid, exam_label text, exam_date date, days_to_exam integer, exam_passed boolean, daily_target_units integer, unit_kind text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public'
AS $function$
  SELECT * FROM reporting.student_today(p_student_id);
$function$
;

CREATE OR REPLACE FUNCTION public.tutor_assign_test(p_student_id uuid, p_test_id uuid, p_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.tutor_assignable_tests(p_student_id uuid, p_subject text DEFAULT NULL::text, p_topic text DEFAULT NULL::text)
 RETURNS TABLE(test_id uuid, title text, exam_type text, year_level_min integer, year_level_max integer, time_limit_mins integer, matching_items bigint, total_items bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.tutor_assignments(p_status text DEFAULT NULL::text)
 RETURNS TABLE(assignment_id uuid, student_id uuid, student_name text, test_id uuid, test_title text, assigned_at timestamp with time zone, due_at timestamp with time zone, due_state text, assignment_status text, is_overdue boolean, attempt_status text, attempts_n integer, last_activity_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.tutor_at_risk()
 RETURNS TABLE(student_id uuid, student_name text, at_risk_rule text, at_risk_severity text, rule_detail text, thresholds_validated boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.tutor_item_analysis(p_test_id uuid)
 RETURNS TABLE(period_label text, test_id uuid, item_id uuid, subject text, topic text, responses bigint, students bigint, enough_evidence boolean, p_value numeric, point_biserial numeric, median_time_seconds numeric, skip_rate_pct numeric, skip_rate_reliable boolean, marking_reliable boolean, item_flag_rate_pct numeric, key_option text, distractors jsonb, dead_distractors text[], defect_reasons text[], is_defective boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.tutor_recommendations(p_student_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(student_id uuid, student_name text, recommendation_rank integer, subject text, topic text, items_answered bigint, accuracy_pct numeric, expected_impact_score numeric, reason text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.tutor_remind(p_assignment_id uuid)
 RETURNS TABLE(queued integer, already_sent integer, unreachable integer, reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.tutor_skill_gaps()
 RETURNS TABLE(student_id uuid, student_name text, subject text, topic text, items_answered bigint, accuracy_pct numeric, mastery_level text, has_signal boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.tutor_student_overview(p_period_days integer DEFAULT 30)
 RETURNS TABLE(student_id uuid, student_name text, year_level integer, assigned_count bigint, completed_count bigint, completion_rate numeric, current_attempts bigint, current_score numeric, prior_attempts bigint, prior_score numeric, movement_pp numeric, consent_expires_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
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
$function$
;

