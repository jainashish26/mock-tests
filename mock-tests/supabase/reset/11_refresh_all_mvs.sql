-- Reset-time refresh of every reporting MV, plain (non-concurrent, no
-- blackout guard): this is a build step on an empty database, not live
-- maintenance. Run AFTER all seeds so facts are loaded. MVs read base
-- tables only, so order does not matter.

REFRESH MATERIALIZED VIEW reporting.mv_assignment_progress;
REFRESH MATERIALIZED VIEW reporting.mv_attempt_history;
REFRESH MATERIALIZED VIEW reporting.mv_data_quality;
REFRESH MATERIALIZED VIEW reporting.mv_funnel_stage;
REFRESH MATERIALIZED VIEW reporting.mv_item_statistics;
REFRESH MATERIALIZED VIEW reporting.mv_percentile_cohort;
REFRESH MATERIALIZED VIEW reporting.mv_platform_health;
REFRESH MATERIALIZED VIEW reporting.mv_skill_gap;
REFRESH MATERIALIZED VIEW reporting.mv_student_countdown;
REFRESH MATERIALIZED VIEW reporting.mv_student_daily_target;
REFRESH MATERIALIZED VIEW reporting.mv_study_behaviour;
REFRESH MATERIALIZED VIEW reporting.mv_topic_coverage;
