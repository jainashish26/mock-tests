-- 105_funnel_abandon_window.sql
-- Decision 9-A: the checkout-abandonment window is 60 minutes, and it now means
-- something.
--
-- WHY THIS IS A CODE CHANGE AND NOT A CONFIG VALUE
--   The register recorded Q-9 as "unset - abandonment unmeasurable", and the
--   obvious fix is `UPDATE ... SET checkout_abandon_minutes = 60`. That would
--   have been a placebo. `checkout_abandon_minutes` is read by nothing: the only
--   column of `reporting.funnel_thresholds` that `funnel_outcomes` consults is
--   `min_segment_visitors`. Abandonment is derived as
--
--       started_at IS NOT NULL AND completed_at IS NULL
--
--   which has no time boundary at all. So a parent who opened checkout ninety
--   seconds ago is counted as abandoned, and one who started on the final day of
--   a reporting window and paid the following morning is counted as abandoned in
--   the old window and as `paying` in the new one. The metric answers "has this
--   person not paid yet?", which is not the question the report asks.
--
--   Setting the column without wiring it would leave a plausible-looking number
--   in the admin panel that no longer matched the config beside it - a worse
--   state than an honest NULL, because the NULL at least advertised itself.
--
-- WHAT "ABANDONED" NOW MEANS
--   Elapsed time from first CHECKOUT_STARTED until either completion or now,
--   exceeding the window:
--
--       COALESCE(completed_at, now()) - started_at > make_interval(mins => m)
--
--   One expression covers both cases and each reads correctly. Never completed:
--   abandoned once the window has passed, and never before. Completed late: they
--   did stall past the window, so the stall is counted even though they came
--   back - which is the whole reason the funnel exists, to find where people get
--   stuck, not merely where they fail.
--
--   `now()` is already implicit in the old definition (`completed_at IS NULL`),
--   so introducing it makes the clock-dependence explicit rather than adding it.
--
-- MEASURED AGAINST LIVE DATA BEFORE COMMITTING
--   Window 20260901-20261120: 4 checkout starts, 1 never completed, 3 completed
--   inside 60 minutes, 0 completed late. Abandoned = 1 under the old rule and 1
--   under the new one, so no historical figure in A11 changes. The fix is free
--   today and stops the metric lying once there is traffic mid-checkout on the
--   boundary of a window.
--
-- NOT NULL, DELIBERATELY
--   The column becomes NOT NULL with a default, so there is no state in which
--   the window is undefined and the report silently reverts to "not yet or
--   never". `min_segment_visitors` is left nullable and keeps that flaw: when it
--   is NULL, `suppressed` evaluates to NULL and reads as false, so suppression is
--   off. That is a separate decision and is left alone rather than half-changed
--   here.

-- --- 1. The window exists, and is always configured -------------------------
ALTER TABLE reporting.funnel_thresholds
  ALTER COLUMN checkout_abandon_minutes SET DEFAULT 60;

UPDATE reporting.funnel_thresholds
   SET checkout_abandon_minutes = 60,
       updated_at = now()
 WHERE id = 1
   AND checkout_abandon_minutes IS DISTINCT FROM 60;

ALTER TABLE reporting.funnel_thresholds
  ALTER COLUMN checkout_abandon_minutes SET NOT NULL;

COMMENT ON COLUMN reporting.funnel_thresholds.checkout_abandon_minutes IS
  'Minutes a started-but-unfinished checkout must sit before it counts as abandoned (decision 9-A, 2026-11-20). NOT NULL by design: with no window the derived count becomes "has this visitor not paid yet", which is a different question from the one A11 reports.';

-- --- 2. Wire it into the metric that was ignoring it ------------------------
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
$function$;

COMMENT ON FUNCTION reporting.funnel_outcomes(integer, integer) IS
  'A11 outcome metrics: free_to_paid_rate (denominator PAYWALL_TRIGGERED per 5.4, not signups), checkout_abandonment_rate (derived over visitors whose checkout stayed unfinished longer than reporting.funnel_thresholds.checkout_abandon_minutes, decision 9-A), and median time_to_first_value_hours from funnel_state. ADMIN only. All counts are DISTINCT VISITORS, not events. Raw counts are returned beside every rate so no percentage is ever shown without its denominator. `suppressed` is true when the smallest denominator is below min_segment_visitors. CAVEAT: median_hours_to_abandon covers only visitors with an explicit CHECKOUT_ABANDONED event and is therefore NOT the population behind checkout_abandoned - do not present the two as one sentence.';


