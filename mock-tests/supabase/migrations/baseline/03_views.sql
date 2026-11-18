-- Generated baseline: views
-- Source: live database via export_schema_baseline (migrations 051/052).
-- Do not hand-edit; regenerate with scripts/rebaseline_schema.py.
-- See supabase/migrations/README.md for apply order and caveats.

CREATE OR REPLACE VIEW reporting.v_student_today AS
 SELECT ds.student_id,
    c.exam_label,
    c.exam_date,
    c.days_to_exam,
    c.exam_passed,
    t.daily_target_units,
    t.unit_kind
   FROM dim_student ds
     LEFT JOIN mv_student_countdown c ON c.student_key = ds.student_key
     LEFT JOIN mv_student_daily_target t ON t.student_key = ds.student_key
  WHERE ds.is_current AND is_student_self(ds.student_id);;

CREATE MATERIALIZED VIEW reporting.mv_assignment_progress AS
 WITH attempt_owner AS (
         SELECT at.id AS attempt_id,
            at.status,
            at.created_at,
            at.started_at,
            at.submitted_at,
            ( SELECT a2.id
                   FROM assignments a2
                  WHERE a2.student_id = at.student_id AND a2.test_id = at.test_id AND COALESCE(a2.assigned_at, '-infinity'::timestamp with time zone) <= at.created_at
                  ORDER BY (COALESCE(a2.assigned_at, '-infinity'::timestamp with time zone)) DESC, a2.id DESC
                 LIMIT 1) AS assignment_id
           FROM attempts at
        )
 SELECT asg.id AS assignment_id,
    asg.student_id,
    asg.test_id,
    asg.assigned_by,
    count(ao.attempt_id)::integer AS attempts_n,
    COALESCE(bool_or(ao.status = ANY (ARRAY['SUBMITTED'::attempt_status, 'COMPLETE'::attempt_status, 'WRITING_PENDING'::attempt_status])), false) AS is_finished,
    COALESCE(bool_or(ao.status = 'IN_PROGRESS'::attempt_status), false) AS is_started,
        CASE
            WHEN COALESCE(bool_or(ao.status = 'COMPLETE'::attempt_status), false) THEN 'COMPLETE'::text
            WHEN COALESCE(bool_or(ao.status = 'SUBMITTED'::attempt_status), false) THEN 'SUBMITTED'::text
            WHEN COALESCE(bool_or(ao.status = 'WRITING_PENDING'::attempt_status), false) THEN 'WRITING_PENDING'::text
            WHEN COALESCE(bool_or(ao.status = 'IN_PROGRESS'::attempt_status), false) THEN 'IN_PROGRESS'::text
            ELSE NULL::text
        END AS attempt_status,
    max(GREATEST(ao.created_at, COALESCE(ao.submitted_at, ao.started_at))) AS last_activity_at,
    now() AS as_at
   FROM assignments asg
     LEFT JOIN attempt_owner ao ON ao.assignment_id = asg.id
  GROUP BY asg.id, asg.student_id, asg.test_id, asg.assigned_by;;

CREATE MATERIALIZED VIEW reporting.mv_attempt_history AS
 SELECT f.attempt_id,
    f.student_id,
    f.date_key,
    f.status,
    f.score,
    f.section_scores,
    f.started_at,
    f.submitted_at,
    t.test_id,
    t.title,
    t.exam_type,
    t.is_free,
    tf.family_group,
    tf.family_group_label,
    ds.year_level,
    ds.pseudonym,
    row_number() OVER (PARTITION BY f.student_id, tf.family_group ORDER BY f.started_at) AS attempt_ordinal,
    f.score - lag(f.score) OVER (PARTITION BY f.student_id, tf.family_group ORDER BY f.started_at) AS personal_progress_delta
   FROM fact_test_attempt f
     JOIN dim_test t ON t.test_id = f.test_id AND t.is_current
     JOIN dim_test_family tf ON tf.exam_type = t.exam_type
     JOIN dim_student ds ON ds.student_id = f.student_id AND ds.is_current
  WHERE f.status = ANY (ARRAY['SUBMITTED'::text, 'COMPLETE'::text]);;

CREATE MATERIALIZED VIEW reporting.mv_data_quality AS
 WITH checks AS (
         SELECT 'untagged_items'::text AS check_name,
            'public.questions'::text AS object_name,
            count(*) AS metric_value,
            0::bigint AS threshold,
            'Items with no subject or topic. Invisible to P8, P3 and to coverage reporting.'::text AS detail
           FROM questions q
          WHERE COALESCE(NULLIF(TRIM(BOTH FROM q.subject), ''::text), NULL::text) IS NULL OR COALESCE(NULLIF(TRIM(BOTH FROM q.topic), ''::text), NULL::text) IS NULL
        UNION ALL
         SELECT 'orphan_responses'::text AS text,
            'public.responses'::text AS text,
            count(*) AS count,
            0::bigint AS int8,
            'Responses with no matching attempt row.'::text AS text
           FROM responses r
          WHERE NOT (EXISTS ( SELECT 1
                   FROM attempts a
                  WHERE a.id = r.attempt_id))
        UNION ALL
         SELECT 'orphan_attempts'::text AS text,
            'public.attempts'::text AS text,
            count(*) AS count,
            0::bigint AS int8,
            'Attempts with no matching student profile.'::text AS text
           FROM attempts a
          WHERE NOT (EXISTS ( SELECT 1
                   FROM student_profiles s
                  WHERE s.id = a.student_id))
        UNION ALL
         SELECT 'failed_events'::text AS text,
            'public.funnel_events'::text AS text,
            count(*) AS count,
            10::bigint AS int8,
            'ERROR_OCCURRED events in the last 24 hours.'::text AS text
           FROM funnel_events f
          WHERE f.event = 'ERROR_OCCURRED'::text AND f.created_at >= (now() - '24:00:00'::interval)
        UNION ALL
         SELECT 'unconfigured_threshold'::text AS text,
            'reporting.coverage_thresholds'::text AS text,
                CASE
                    WHEN ct.min_items_per_subtopic IS NULL THEN 1
                    ELSE 0
                END AS "case",
            0::bigint AS int8,
                CASE
                    WHEN ct.min_items_per_subtopic IS NULL THEN 'min_items_per_subtopic IS NULL, so coverage_status can never return TOO_FEW. Marked [config] in 11-bi-reporting-design.md 5.4. Do not trust A3 "ADEQUATE" verdicts until this is set.'::text
                    ELSE format('min_items_per_subtopic = %s. TOO_FEW detection is active.'::text, ct.min_items_per_subtopic)
                END AS format
           FROM coverage_thresholds ct
          WHERE ct.id = 1
        UNION ALL
         SELECT 'anon_executable_rpc'::text AS text,
            'public (SECURITY DEFINER)'::text AS text,
            count(*) AS count,
            0::bigint AS int8,
                CASE
                    WHEN count(*) = 0 THEN 'No SECURITY DEFINER function outside the RLS-helper allowlist is callable by anon.'::text
                    ELSE ('Callable by anon with no credentials via /rest/v1/rpc/: '::text || string_agg(p.proname::text, ', '::text ORDER BY (p.proname::text))) || '. Route-level role checks do NOT protect these - revoke anon EXECUTE.'::text
                END AS "case"
           FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'::name AND p.prosecdef AND has_function_privilege('anon'::name, p.oid, 'EXECUTE'::text) AND (p.proname <> ALL (ARRAY['can_access_published_test'::name, 'has_active_subscription'::name, 'has_entitlement'::name, 'has_role'::name, 'is_attempt_owner'::name, 'is_attempt_parent'::name, 'is_parent_of'::name, 'is_student_self'::name]))
        UNION ALL
         SELECT 'rls_no_policy_but_granted'::text AS text,
            'public (tables)'::text AS text,
            count(*) AS count,
            0::bigint AS int8,
                CASE
                    WHEN count(*) = 0 THEN 'No RLS-enabled table lacks policies while still granting SELECT to authenticated/anon.'::text
                    ELSE ('RLS enabled, ZERO policies, but SELECT granted to authenticated/anon: '::text || string_agg(c_1.relname::text, ', '::text ORDER BY (c_1.relname::text))) || '. Default-deny holds today, but adding any permissive policy would expose these tables. Revoke the SELECT grant.'::text
                END AS "case"
           FROM pg_class c_1
             JOIN pg_namespace n ON n.oid = c_1.relnamespace
          WHERE n.nspname = 'public'::name AND c_1.relkind = 'r'::"char" AND c_1.relrowsecurity AND NOT (EXISTS ( SELECT 1
                   FROM pg_policies pol
                  WHERE pol.schemaname = 'public'::name AND pol.tablename = c_1.relname)) AND (has_table_privilege('authenticated'::name, c_1.oid, 'SELECT'::text) OR has_table_privilege('anon'::name, c_1.oid, 'SELECT'::text))
        UNION ALL
         SELECT 'marking_key_disagreement'::text AS text,
            'public.responses'::text AS text,
            k.disagreeing,
            0::bigint AS int8,
                CASE
                    WHEN k.disagreeing = 0 THEN format('All %s letter-keyed responses agree with questions.correct_answer.'::text, k.total)
                    ELSE format('%s of %s letter-keyed responses (%s%%) carry an is_correct verdict that contradicts questions.correct_answer, so marking is independent of the answer given. Every accuracy-derived metric reads this column - A1 p_value, P3 mastery, T1 levels, T2 gaps, T3 at-risk, T7/P8 recommendations - and all currently count marks rather than right answers. The cause is the SAMPLE DATA GENERATOR (supabase/seeds/001_sample_dataset.sql section 4), which drew the answer and the verdict from separate md5 seeds and never compared them; production marking in src/lib/scoring/score-attempt.ts is correct, so do not go auditing it. Do not recalibrate item thresholds to make A1 look clean either - re-seed. Not auto-corrected here because is_correct is the system of record and overwriting it would destroy the evidence.'::text, k.disagreeing, k.total, round(100.0 * k.disagreeing::numeric / NULLIF(k.total, 0)::numeric, 1))
                END AS format
           FROM marking_disagreement() k(disagreeing, total)
        UNION ALL
         SELECT 'stripe_reconciliation'::text AS text,
            '(not yet ingested)'::text AS text,
            NULL::bigint AS int8,
            0::bigint AS int8,
            'NOT_IMPLEMENTED: Stripe ingestion is scheduled for Phase 3. No reconciliation has run.'::text AS text
        UNION ALL
         SELECT 'mv_refresh_lag_minutes'::text AS text,
            'reporting.'::text || m.matviewname::text,
                CASE
                    WHEN last.finished_at IS NULL THEN NULL::bigint
                    ELSE GREATEST(EXTRACT(epoch FROM now() - last.finished_at) / 60.0, 0::numeric)::bigint
                END AS "greatest",
            1440::bigint AS int8,
                CASE
                    WHEN last.finished_at IS NULL THEN 'Never refreshed successfully.'::text
                    ELSE format('Minutes since the last successful refresh (last: %s).'::text, to_char(last.finished_at, 'YYYY-MM-DD HH24:MI TZ'::text))
                END AS format
           FROM pg_matviews m
             LEFT JOIN LATERAL ( SELECT max(r.finished_at) AS finished_at
                   FROM refresh_log r
                  WHERE r.object_name = m.matviewname AND r.status = 'ok'::text AND r.finished_at IS NOT NULL) last ON true
          WHERE m.schemaname = 'reporting'::name
        )
 SELECT CURRENT_DATE AS check_date,
    check_name,
    object_name,
    metric_value,
    threshold,
        CASE
            WHEN metric_value IS NULL THEN 'NOT_IMPLEMENTED'::text
            WHEN check_name = 'mv_refresh_lag_minutes'::text THEN
            CASE
                WHEN metric_value IS NULL THEN 'FAIL'::text
                WHEN metric_value > 2880 THEN 'FAIL'::text
                WHEN metric_value > threshold THEN 'WARN'::text
                ELSE 'OK'::text
            END
            WHEN metric_value > (threshold * 5) THEN 'FAIL'::text
            WHEN metric_value > threshold THEN 'WARN'::text
            ELSE 'OK'::text
        END AS status,
    detail,
    now() AS as_at
   FROM checks c;;

CREATE MATERIALIZED VIEW reporting.mv_funnel_stage AS
 WITH ev AS (
         SELECT f.date_key,
            f.funnel_step,
            COALESCE(f.user_id::text, 'anon:'::text || f.anonymous_id) AS visitor_key,
            COALESCE(f.utm_source, '(none)'::text) AS channel,
            COALESCE(f.utm_campaign, '(none)'::text) AS campaign,
            f.device_class
           FROM fact_event f
          WHERE f.funnel_step IS NOT NULL
        )
 SELECT date_key,
    funnel_step AS stage,
    funnel_stage_rank(funnel_step) AS stage_rank,
    channel,
    campaign,
    device_class,
    count(DISTINCT visitor_key) AS visitors,
    count(*) AS events
   FROM ev
  GROUP BY date_key, funnel_step, channel, campaign, device_class;;

CREATE MATERIALIZED VIEW reporting.mv_item_statistics AS
 SELECT period_label,
    test_id,
    item_id,
    subject,
    topic,
    responses,
    students,
    enough_evidence,
    p_value,
    point_biserial,
    median_time_seconds,
    skip_rate_pct,
    skip_rate_reliable,
    marking_reliable,
    item_flag_rate_pct,
    key_option,
    distractors,
    dead_distractors,
    defect_reasons,
    is_defective
   FROM item_statistics(NULL::uuid, NULL::uuid[]) item_statistics(period_label, test_id, item_id, subject, topic, responses, students, enough_evidence, p_value, point_biserial, median_time_seconds, skip_rate_pct, skip_rate_reliable, marking_reliable, item_flag_rate_pct, key_option, distractors, dead_distractors, defect_reasons, is_defective);;

CREATE MATERIALIZED VIEW reporting.mv_percentile_cohort AS
 WITH latest AS (
         SELECT DISTINCT ON (f.student_id, tf.family_group, ds.year_level) f.student_id,
            tf.family_group,
            tf.family_group_label,
            ds.year_level,
            f.score AS latest_score,
            f.attempt_id AS latest_attempt_id,
            f.submitted_at AS latest_submitted_at
           FROM fact_test_attempt f
             JOIN dim_test t ON t.test_id = f.test_id AND t.is_current
             JOIN dim_test_family tf ON tf.exam_type = t.exam_type
             JOIN dim_student ds ON ds.student_id = f.student_id AND ds.is_current
             CROSS JOIN percentile_thresholds th_1
          WHERE th_1.id = 1 AND f.status = 'COMPLETE'::text AND f.score IS NOT NULL AND f.submitted_at >= (((now() AT TIME ZONE 'Australia/Melbourne'::text)::date - make_interval(months => th_1.cohort_window_months)) AT TIME ZONE 'Australia/Melbourne'::text)
          ORDER BY f.student_id, tf.family_group, ds.year_level, f.submitted_at DESC
        ), cohorts AS (
         SELECT z.family_group,
            z.year_level,
            count(*) AS cohort_size,
            array_agg(z.score) AS scores
           FROM ( SELECT latest.family_group,
                    latest.year_level,
                    latest.latest_score AS score
                   FROM latest) z
          GROUP BY z.family_group, z.year_level
        ), joined AS (
         SELECT l.student_id,
            l.family_group,
            l.family_group_label,
            l.year_level,
            l.latest_score,
            l.latest_attempt_id,
            l.latest_submitted_at,
            c.cohort_size,
            percentile_from_scores(l.latest_score, c.scores) AS pct
           FROM latest l
             JOIN cohorts c ON c.family_group = l.family_group AND c.year_level = l.year_level
        )
 SELECT j.student_id,
    j.family_group,
    j.family_group_label,
    j.year_level,
    j.latest_score,
    j.latest_attempt_id,
    j.latest_submitted_at,
    j.cohort_size,
        CASE
            WHEN j.cohort_size >= th.min_cohort_for_point THEN round(j.pct)::integer
            ELSE NULL::integer
        END AS percentile_rank,
        CASE
            WHEN j.cohort_size >= th.min_cohort_students AND j.cohort_size < th.min_cohort_for_point THEN LEAST(4, width_bucket(j.pct, 0::numeric, 100::numeric, 4))
            ELSE NULL::integer
        END AS percentile_band,
    j.cohort_size < th.min_cohort_students AS suppressed,
    th.cohort_window_months,
    'platform cohort'::text AS cohort_definition,
    ((now() AT TIME ZONE 'Australia/Melbourne'::text)::date - make_interval(months => th.cohort_window_months))::date AS window_start,
    (now() AT TIME ZONE 'Australia/Melbourne'::text)::date AS window_end,
    now() AS as_at
   FROM joined j
     CROSS JOIN percentile_thresholds th
  WHERE th.id = 1;;

CREATE MATERIALIZED VIEW reporting.mv_platform_health AS
 WITH buckets AS (
         SELECT date_trunc('hour'::text, a.started_at) AS hour_start
           FROM fact_test_attempt a
          WHERE a.started_at IS NOT NULL
        UNION
         SELECT date_trunc('hour'::text, e.occurred_at) AS date_trunc
           FROM fact_event e
          WHERE e.occurred_at IS NOT NULL
        ), usage AS (
         SELECT b.hour_start,
            count(DISTINCT COALESCE(e.user_id::text, e.anonymous_id)) AS active_users,
            count(*) FILTER (WHERE e.event_name = 'TEST_STARTED'::text) AS tests_started,
            count(*) FILTER (WHERE e.event_name = 'TEST_SUBMITTED'::text) AS tests_submitted,
            count(*) FILTER (WHERE e.event_name = 'ERROR_OCCURRED'::text) AS errors,
            count(*) FILTER (WHERE e.event_name = 'ERROR_OCCURRED'::text AND ((e.props ->> 'errorType'::text) = ANY (ARRAY['submit_failed'::text, 'submit_sync_failed'::text]))) AS submit_errors
           FROM buckets b
             LEFT JOIN fact_event e ON date_trunc('hour'::text, e.occurred_at) = b.hour_start
          GROUP BY b.hour_start
        ), concurrency AS (
         SELECT b.hour_start,
            count(DISTINCT a.attempt_id) AS in_flight_attempts
           FROM buckets b
             JOIN fact_test_attempt a ON a.started_at < (b.hour_start + '01:00:00'::interval) AND (a.submitted_at IS NULL OR a.submitted_at >= b.hour_start)
          GROUP BY b.hour_start
        )
 SELECT u.hour_start,
    to_char((u.hour_start AT TIME ZONE 'Australia/Melbourne'::text), 'YYYYMMDD'::text)::integer AS date_key,
    EXTRACT(hour FROM (u.hour_start AT TIME ZONE 'Australia/Melbourne'::text))::smallint AS hour_of_day,
    u.active_users,
    COALESCE(c.in_flight_attempts, 0::bigint) AS peak_concurrency,
    round(COALESCE(c.in_flight_attempts, 0::bigint)::numeric / NULLIF(cap.peak_concurrency_cap, 0)::numeric, 3) AS concurrency_vs_cap,
    cap.peak_concurrency_cap,
    cap.is_measured AS cap_is_measured,
    u.tests_started,
    u.tests_submitted,
    u.errors,
    round(u.errors::numeric / NULLIF(u.tests_started + u.tests_submitted, 0)::numeric * 100::numeric, 2) AS test_error_rate,
    u.submit_errors,
    round(u.submit_errors::numeric / NULLIF(u.tests_submitted + u.submit_errors, 0)::numeric * 100::numeric, 2) AS failed_submission_rate,
    now() AS as_at
   FROM usage u
     LEFT JOIN concurrency c ON c.hour_start = u.hour_start
     CROSS JOIN platform_capacity cap
  WHERE cap.id = 1;;

CREATE MATERIALIZED VIEW reporting.mv_skill_gap AS
 SELECT r.student_id,
    COALESCE(NULLIF(di.subject, ''::text), '(untagged)'::text) AS subject,
    COALESCE(NULLIF(di.topic, ''::text), '(untagged)'::text) AS topic,
    count(*) AS items_answered,
    count(*) FILTER (WHERE r.is_correct) AS items_correct,
    round(count(*) FILTER (WHERE r.is_correct)::numeric / NULLIF(count(*), 0)::numeric * 100::numeric, 1) AS accuracy_pct,
    sum(COALESCE(r.time_spent_seconds, 0)) AS time_on_task_seconds,
    max(r.date_key) AS last_practised_date_key,
    now() AS as_at
   FROM fact_item_response r
     LEFT JOIN LATERAL ( SELECT d.subject,
            d.topic
           FROM dim_item d
          WHERE d.item_id = r.item_id
          ORDER BY d.etl_loaded_at DESC NULLS LAST, d.item_key DESC
         LIMIT 1) di ON true
  GROUP BY r.student_id, (COALESCE(NULLIF(di.subject, ''::text), '(untagged)'::text)), (COALESCE(NULLIF(di.topic, ''::text), '(untagged)'::text));;

CREATE MATERIALIZED VIEW reporting.mv_student_countdown AS
 SELECT ds.student_key,
    ds.student_id,
    ds.pseudonym,
    dp.target_exam AS exam_label,
    dp.exam_date,
    GREATEST(0, dp.exam_date - (now() AT TIME ZONE 'Australia/Melbourne'::text)::date) AS days_to_exam,
    dp.exam_date < (now() AT TIME ZONE 'Australia/Melbourne'::text)::date AS exam_passed
   FROM dim_practice_plan dp
     JOIN dim_student ds ON ds.student_key = dp.student_key AND ds.is_current
  WHERE dp.is_current AND dp.exam_date IS NOT NULL;;

CREATE MATERIALIZED VIEW reporting.mv_student_daily_target AS
 WITH done AS (
         SELECT ds.student_key,
            count(*) AS units_completed
           FROM funnel_events fe
             JOIN dim_student ds ON ds.student_id = fe.student_id AND ds.is_current
          WHERE fe.event = ANY (ARRAY['TEST_SUBMITTED'::text, 'DIAGNOSTIC_COMPLETED'::text, 'SECOND_SESSION_COMPLETED'::text])
          GROUP BY ds.student_key
        ), rest AS (
         SELECT ds.student_key,
            count(*) AS rest_days_remaining
           FROM practice_rest_days r
             JOIN dim_student ds ON ds.student_id = r.student_id AND ds.is_current
          WHERE r.rest_date > (now() AT TIME ZONE 'Australia/Melbourne'::text)::date
          GROUP BY ds.student_key
        ), calc AS (
         SELECT dp.plan_key,
            dp.student_key,
            dp.unit_kind,
            dp.weekly_sessions_goal,
            GREATEST(0::bigint, dp.total_planned_units - COALESCE(d.units_completed, 0::bigint)) AS remaining_units,
            GREATEST(0::bigint, dp.exam_date - (now() AT TIME ZONE 'Australia/Melbourne'::text)::date - COALESCE(r.rest_days_remaining, 0::bigint)) AS remaining_days
           FROM dim_practice_plan dp
             LEFT JOIN done d ON d.student_key = dp.student_key
             LEFT JOIN rest r ON r.student_key = dp.student_key
          WHERE dp.is_current AND dp.exam_date IS NOT NULL
        ), capped AS (
         SELECT c.plan_key,
            c.student_key,
            c.unit_kind,
            c.remaining_units,
            c.remaining_days,
                CASE
                    WHEN c.remaining_days <= 0 THEN 0::numeric
                    ELSE ceil(c.remaining_units::numeric / c.remaining_days::numeric)
                END AS required_daily,
            COALESCE(
                CASE
                    WHEN c.unit_kind = 'tests'::text THEN cap.max_tests_per_day
                    WHEN c.unit_kind = 'questions'::text THEN cap.max_questions_per_day
                    ELSE NULL::smallint
                END::numeric, 2::numeric * ceil(c.weekly_sessions_goal::numeric / 7::numeric))::integer AS effective_cap
           FROM calc c
             JOIN dim_student ds ON ds.student_key = c.student_key AND ds.is_current
             LEFT JOIN dim_year_level_cap cap ON cap.year_level = ds.year_level
        )
 SELECT plan_key,
    student_key,
    unit_kind,
    remaining_units,
    remaining_days,
    required_daily,
    effective_cap,
    LEAST(required_daily, effective_cap::numeric) AS daily_target_units,
    remaining_days > 0 AND required_daily > effective_cap::numeric AS plan_overload_flag
   FROM capped;;

CREATE MATERIALIZED VIEW reporting.mv_study_behaviour AS
 WITH resp AS (
         SELECT r.student_id,
            date_trunc('week'::text, to_date(r.date_key::text, 'YYYYMMDD'::text)::timestamp with time zone)::date AS week_start,
            r.attempt_id,
            r.is_correct,
            COALESCE(r.is_skipped, false) AS is_skipped,
            r.time_spent_seconds
           FROM fact_item_response r
        ), child AS (
         SELECT resp.student_id,
            resp.week_start,
            count(DISTINCT resp.attempt_id) AS sessions,
            count(*) AS items_answered,
            sum(COALESCE(resp.time_spent_seconds, 0)) AS time_on_task_seconds,
            count(*) FILTER (WHERE resp.is_skipped) AS skipped_items,
            count(*) FILTER (WHERE NOT resp.is_skipped) AS attempted_items,
            count(*) FILTER (WHERE NOT resp.is_skipped AND resp.is_correct IS FALSE AND COALESCE(resp.time_spent_seconds, 0) <= 10) AS rapid_wrong_items,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (resp.time_spent_seconds::double precision)) FILTER (WHERE NOT resp.is_skipped AND resp.time_spent_seconds IS NOT NULL) AS median_seconds_per_item
           FROM resp
          GROUP BY resp.student_id, resp.week_start
        ), peer AS (
         SELECT ds_1.year_level,
            c_1.week_start,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY c_1.median_seconds_per_item) AS peer_median_seconds
           FROM child c_1
             JOIN dim_student ds_1 ON ds_1.student_id = c_1.student_id AND ds_1.is_current
          WHERE c_1.median_seconds_per_item IS NOT NULL
          GROUP BY ds_1.year_level, c_1.week_start
        ), plan AS (
         SELECT DISTINCT ON (p.student_id) p.student_id,
            p.weekly_sessions_goal
           FROM dim_practice_plan p
          WHERE p.is_current
          ORDER BY p.student_id, p.valid_from DESC
        )
 SELECT c.student_id,
    ds.student_key,
    ds.year_level,
    c.week_start,
    c.week_start + 6 AS week_end,
    c.sessions,
    pl.weekly_sessions_goal,
        CASE
            WHEN pl.weekly_sessions_goal IS NULL OR pl.weekly_sessions_goal <= 0 THEN NULL::numeric
            ELSE round(LEAST(c.sessions::numeric / pl.weekly_sessions_goal::numeric, 1.0), 2)
        END AS target_adherence,
    c.items_answered,
    c.time_on_task_seconds,
    round(c.median_seconds_per_item::numeric, 1) AS median_seconds_per_item,
    round(pe.peer_median_seconds::numeric, 1) AS peer_median_seconds,
        CASE
            WHEN pe.peer_median_seconds IS NULL OR pe.peer_median_seconds = 0::double precision THEN NULL::numeric
            ELSE round((c.median_seconds_per_item / pe.peer_median_seconds)::numeric, 2)
        END AS pace_vs_expected,
    round(c.skipped_items::numeric / NULLIF(c.items_answered, 0)::numeric * 100::numeric, 1) AS skip_rate,
    round(c.rapid_wrong_items::numeric / NULLIF(c.attempted_items, 0)::numeric * 100::numeric, 1) AS guess_rate,
    now() AS as_at
   FROM child c
     JOIN dim_student ds ON ds.student_id = c.student_id AND ds.is_current
     LEFT JOIN peer pe ON pe.year_level = ds.year_level AND pe.week_start = c.week_start
     LEFT JOIN plan pl ON pl.student_id = c.student_id;;

CREATE MATERIALIZED VIEW reporting.mv_topic_coverage AS
 SELECT sa.skill_area_key,
    sa.subject,
    sa.topic,
    sa.sub_topic,
    di.exam_type,
    count(*) AS item_count,
    count(*) FILTER (WHERE di.content_status = 'PUBLISHED'::text) AS published_count,
    count(*) FILTER (WHERE di.content_status = 'DRAFT'::text) AS draft_count,
    round(avg(di.authored_difficulty), 2) AS avg_authored_difficulty,
    round(avg(di.difficulty_dynamic), 4) AS avg_observed_difficulty,
        CASE
            WHEN count(*) FILTER (WHERE di.content_status = 'PUBLISHED'::text) = 0 THEN 'NONE_PUBLISHED'::text
            WHEN t.min_items_per_subtopic IS NOT NULL AND count(*) FILTER (WHERE di.content_status = 'PUBLISHED'::text) < t.min_items_per_subtopic THEN 'TOO_FEW'::text
            ELSE 'ADEQUATE'::text
        END AS coverage_status
   FROM dim_skill_area sa
     JOIN dim_item di ON di.subject = sa.subject AND di.topic = sa.topic AND COALESCE(NULLIF(di.sub_topic, ''::text), '(unspecified)'::text) = sa.sub_topic
     CROSS JOIN coverage_thresholds t
  WHERE t.id = 1
  GROUP BY sa.skill_area_key, sa.subject, sa.topic, sa.sub_topic, di.exam_type, t.min_items_per_subtopic;;

