-- ============================================================================
-- 094 - T3 LOW_ENGAGEMENT: investigation result + fix
--
-- INVESTIGATION (16-delivery-backlog.md remaining item 6). The backlog
-- suspected a stale or mislabelled last_attempt input because tutor_at_risk()
-- returned zero LOW_ENGAGEMENT flags while 108 of 200 sample students had no
-- completed attempt in 14 days. Measured against the live database:
--
--   * fact_test_attempt and public.attempts agree EXACTLY on last completed
--     attempt for all six consented students (0 disagreements).
--   * All six completed an attempt TODAY. The rule correctly did not fire.
--     The "~1% by chance" argument assumed the consented six were a random
--     sample of the 200; they are the seed's first six students, who carry
--     recent activity. The data was never the problem.
--
-- But reading the rule against its spec (11-...md §4.5: "no session in >=14
-- days WHILE AN EXAM TARGET IS ACTIVE"; AL-17 repeats the target condition)
-- exposed three real defects, fixed here:
--
--   1. ZERO-ATTEMPT STUDENTS WERE INVISIBLE. The function was driven from
--      `scores` (GROUP BY over the fact table), so a student with no fact rows
--      never appeared at all - the `last_attempt IS NULL` branch could only
--      fire for students who had rows but no timestamp, which the loader
--      never produces. The most disengaged student possible was the one the
--      at-risk list could never show. Now driven from the consented set with
--      LEFT JOINs, so every consented student is evaluated by every rule.
--
--   2. THE EXAM-TARGET CONDITION WAS MISSING. The spec gates LOW_ENGAGEMENT
--      on an active (future-dated) exam target: disengagement is at-risk when
--      there is a deadline, and AL-17 forbids escalating it otherwise. Read
--      from public.student_exam_targets LIVE (not dim_practice_plan, which is
--      nightly) so a parent setting a target today changes the rule today.
--      NOTE: student_exam_targets currently has 0 rows, so this rule now
--      legitimately returns nothing on the sample data until targets exist.
--      That is the spec's behaviour, not a regression - and the pgtap suite
--      proves the rule fires under controlled fixtures rather than leaving
--      it untested because the sample happens not to trigger it.
--
--   3. "NO SESSION" MEANT "NO COMPLETED ATTEMPT". A child who starts tests
--      daily but never finishes was flagged as not practising. last_activity
--      now considers ANY attempt activity (started_at of IN_PROGRESS rows
--      included), while the score-based rules keep using completed attempts
--      only.
--
-- Detail strings name the condition in words a tutor can dispute (TU1), and
-- thresholds remain labelled unvalidated (A-12).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tutor_at_risk()
RETURNS TABLE(student_id uuid, student_name text, at_risk_rule text,
              at_risk_severity text, rule_detail text, thresholds_validated boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'reporting', 'public', 'pg_catalog'
AS $function$
  WITH mine AS (
    SELECT DISTINCT l.student_id
    FROM public.tutor_student_links l
    WHERE l.tutor_user_id = auth.uid() AND public.is_tutor_of(l.student_id)
  ),
  activity AS (
    -- ALL fact rows for session activity; completed-only for score rules.
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
    -- Active = future-dated, evaluated against the Melbourne date the rest
    -- of the reporting layer uses. Live table, not the nightly plan dim.
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
       -- Spec condition: an ACTIVE exam target must exist. Without one this
       -- rule never fires (AL-17), however long the silence.
       (g.student_id IS NOT NULL
        AND (a.last_activity IS NULL
             OR a.last_activity < now() - make_interval(days => t.low_engagement_days)))),
      ('REPEATED_MISCONCEPTION', 'high',
       format('%s topic(s) below 50%% across at least 5 responses each.', COALESCE(w.weak_topics,0)),
       (COALESCE(w.weak_topics,0) >= t.misconception_min_attempts))
  ) AS r(rule, severity, detail, fired)
  WHERE t.id = 1 AND r.fired
  ORDER BY CASE r.severity WHEN 'high' THEN 0 ELSE 1 END, sp.username;
$function$;