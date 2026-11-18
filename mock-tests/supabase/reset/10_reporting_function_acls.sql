-- Generated from the LIVE database: pg_get_functiondef does NOT capture ACLs,
-- so the reporting baseline restores every function with PUBLIC EXECUTE -
-- a privilege-escalation gap found by the scratch reset proof. This file
-- replicates the live pattern: revoke from PUBLIC/anon/authenticated, and
-- re-grant service_role exactly where live holds it. Apply AFTER all
-- reporting function files. Idempotent.
--
-- export_baseline / export_baseline_config are deliberately ABSENT: they are
-- the rebaseline tooling, live-only by design (excluded from the baseline
-- function count) and therefore absent from any reset target.

REVOKE ALL ON FUNCTION reporting.evaluate_daily_targets(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reporting.experiment_decision(bigint,bigint,bigint,bigint,integer,numeric,numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reporting.experiment_results() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reporting.funnel_by_stage(integer,integer,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reporting.funnel_outcomes(integer,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reporting.in_blackout() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reporting.item_statistics(uuid,uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reporting.load_attempt_facts(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reporting.load_attempt_facts(boolean) TO service_role;
REVOKE ALL ON FUNCTION reporting.load_event_facts(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reporting.load_event_facts(boolean) TO service_role;
REVOKE ALL ON FUNCTION reporting.load_response_facts(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reporting.load_response_facts(boolean) TO service_role;
REVOKE ALL ON FUNCTION reporting.load_skill_areas() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reporting.load_skill_areas() TO service_role;
REVOKE ALL ON FUNCTION reporting.load_student_dims() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reporting.load_student_dims() TO service_role;
REVOKE ALL ON FUNCTION reporting.marking_disagreement() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reporting.net_ex_gst(bigint,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reporting.newcombe_diff_bounds(bigint,bigint,bigint,bigint,numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reporting.normal_cdf(numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reporting.percentile_from_scores(numeric,numeric[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reporting.recommendations_scored(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reporting.recommendations_scored(uuid) TO service_role;
REVOKE ALL ON FUNCTION reporting.refresh_student_now() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reporting.refresh_student_now() TO service_role;
REVOKE ALL ON FUNCTION reporting.safe_refresh(regclass,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reporting.safe_refresh(regclass,boolean) TO service_role;
REVOKE ALL ON FUNCTION reporting.snapshot_data_quality() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reporting.student_today(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reporting.two_proportion_p_value(bigint,bigint,bigint,bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reporting.wilson_bounds(bigint,bigint,numeric) FROM PUBLIC, anon, authenticated;
