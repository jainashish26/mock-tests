-- Generated baseline: cron
-- Source: live database via export_schema_baseline (migrations 051/052).
-- Do not hand-edit; regenerate with scripts/rebaseline_schema.py.
-- See supabase/migrations/README.md for apply order and caveats.

SELECT cron.unschedule('rpt-assignment-progress') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rpt-assignment-progress');
SELECT cron.schedule('rpt-assignment-progress', '0 6-22 * * *', 'SELECT reporting.safe_refresh(''reporting.mv_assignment_progress'', true)');

SELECT cron.unschedule('rpt-daily-target-comparison') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rpt-daily-target-comparison');
SELECT cron.schedule('rpt-daily-target-comparison', '15 17 * * *', 'SELECT reporting.evaluate_daily_targets(NULL)');

SELECT cron.unschedule('rpt-data-quality') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rpt-data-quality');
SELECT cron.schedule('rpt-data-quality', '55 17 * * *', 'SELECT reporting.safe_refresh(''reporting.mv_data_quality'', true),
           reporting.snapshot_data_quality()');

SELECT cron.unschedule('rpt-enquiry-daily') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rpt-enquiry-daily');
SELECT cron.schedule('rpt-enquiry-daily', '10 * * * *', 'SELECT reporting.load_enquiry_facts(true),
           reporting.safe_refresh(''reporting.mv_enquiry_daily'', true)');

SELECT cron.unschedule('rpt-experiment-results') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rpt-experiment-results');
SELECT cron.schedule('rpt-experiment-results', '0 2 * * *', 'SELECT reporting.load_event_facts(false)');

SELECT cron.unschedule('rpt-funnel-stage') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rpt-funnel-stage');
SELECT cron.schedule('rpt-funnel-stage', '5 * * * *', 'SELECT reporting.load_event_facts(false),
           reporting.safe_refresh(''reporting.mv_funnel_stage'', true)');

SELECT cron.unschedule('rpt-item-statistics') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rpt-item-statistics');
SELECT cron.schedule('rpt-item-statistics', '30 1 * * *', 'SELECT reporting.safe_refresh(''reporting.mv_item_statistics'', true)');

SELECT cron.unschedule('rpt-load-attempt-facts') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rpt-load-attempt-facts');
SELECT cron.schedule('rpt-load-attempt-facts', '20 16 * * *', 'SELECT reporting.load_attempt_facts(false),
          reporting.safe_refresh(''reporting.mv_attempt_history'', true),
          reporting.safe_refresh(''reporting.mv_percentile_cohort'', true)');

SELECT cron.unschedule('rpt-load-event-facts') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rpt-load-event-facts');
SELECT cron.schedule('rpt-load-event-facts', '*/30 * * * *', 'SELECT reporting.load_event_facts(false)');

SELECT cron.unschedule('rpt-load-response-facts') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rpt-load-response-facts');
SELECT cron.schedule('rpt-load-response-facts', '25 16 * * *', 'SELECT reporting.load_response_facts(false)');

SELECT cron.unschedule('rpt-load-student-dims') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rpt-load-student-dims');
SELECT cron.schedule('rpt-load-student-dims', '45 17 * * *', 'SELECT reporting.load_student_dims()');

SELECT cron.unschedule('rpt-platform-health') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rpt-platform-health');
SELECT cron.schedule('rpt-platform-health', '*/15 * * * *', 'SELECT reporting.safe_refresh(''reporting.mv_platform_health'', true)');

SELECT cron.unschedule('rpt-served-facts') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rpt-served-facts');
SELECT cron.schedule('rpt-served-facts', '20 * * * *', 'SELECT reporting.load_served_facts()');

SELECT cron.unschedule('rpt-skill-coverage') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rpt-skill-coverage');
SELECT cron.schedule('rpt-skill-coverage', '35 16 * * *', 'SELECT reporting.load_skill_areas(),
           reporting.safe_refresh(''reporting.mv_topic_coverage'', true)');

SELECT cron.unschedule('rpt-student-daily') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rpt-student-daily');
SELECT cron.schedule('rpt-student-daily', '0 18 * * *', 'SELECT reporting.safe_refresh(''reporting.mv_student_countdown'', true),
           reporting.safe_refresh(''reporting.mv_student_daily_target'', true)');

SELECT cron.unschedule('rpt-study-behaviour') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rpt-study-behaviour');
SELECT cron.schedule('rpt-study-behaviour', '30 16 * * *', 'SELECT reporting.safe_refresh(''reporting.mv_study_behaviour'', true),
           reporting.safe_refresh(''reporting.mv_skill_gap'', true)');

