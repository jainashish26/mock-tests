-- Generated baseline: rls
-- Source: live database via export_schema_baseline (migrations 051/052).
-- Do not hand-edit; regenerate with scripts/rebaseline_schema.py.
-- See supabase/migrations/README.md for apply order and caveats.

ALTER TABLE reporting.at_risk_thresholds ENABLE ROW LEVEL SECURITY; ALTER TABLE reporting.at_risk_thresholds FORCE ROW LEVEL SECURITY;
ALTER TABLE reporting.coverage_thresholds ENABLE ROW LEVEL SECURITY; ALTER TABLE reporting.coverage_thresholds FORCE ROW LEVEL SECURITY;
ALTER TABLE reporting.data_quality_history ENABLE ROW LEVEL SECURITY; ALTER TABLE reporting.data_quality_history FORCE ROW LEVEL SECURITY;
ALTER TABLE reporting.dim_date ENABLE ROW LEVEL SECURITY; ALTER TABLE reporting.dim_date FORCE ROW LEVEL SECURITY;
ALTER TABLE reporting.dim_item ENABLE ROW LEVEL SECURITY; ALTER TABLE reporting.dim_item FORCE ROW LEVEL SECURITY;
ALTER TABLE reporting.dim_practice_plan ENABLE ROW LEVEL SECURITY; ALTER TABLE reporting.dim_practice_plan FORCE ROW LEVEL SECURITY;
ALTER TABLE reporting.dim_public_holiday_vic ENABLE ROW LEVEL SECURITY; ALTER TABLE reporting.dim_public_holiday_vic FORCE ROW LEVEL SECURITY;
ALTER TABLE reporting.dim_skill_area ENABLE ROW LEVEL SECURITY; ALTER TABLE reporting.dim_skill_area FORCE ROW LEVEL SECURITY;
ALTER TABLE reporting.dim_student ENABLE ROW LEVEL SECURITY; ALTER TABLE reporting.dim_student FORCE ROW LEVEL SECURITY;
ALTER TABLE reporting.dim_test ENABLE ROW LEVEL SECURITY; ALTER TABLE reporting.dim_test FORCE ROW LEVEL SECURITY;
ALTER TABLE reporting.dim_test_family ENABLE ROW LEVEL SECURITY; ALTER TABLE reporting.dim_test_family FORCE ROW LEVEL SECURITY;
ALTER TABLE reporting.dim_year_level_cap ENABLE ROW LEVEL SECURITY; ALTER TABLE reporting.dim_year_level_cap FORCE ROW LEVEL SECURITY;
ALTER TABLE reporting.enquiry_thresholds ENABLE ROW LEVEL SECURITY; ALTER TABLE reporting.enquiry_thresholds FORCE ROW LEVEL SECURITY;
ALTER TABLE reporting.etl_watermark ENABLE ROW LEVEL SECURITY; ALTER TABLE reporting.etl_watermark FORCE ROW LEVEL SECURITY;
ALTER TABLE reporting.experiment_thresholds ENABLE ROW LEVEL SECURITY; ALTER TABLE reporting.experiment_thresholds FORCE ROW LEVEL SECURITY;
ALTER TABLE reporting.fact_event ENABLE ROW LEVEL SECURITY; ALTER TABLE reporting.fact_event FORCE ROW LEVEL SECURITY;
ALTER TABLE reporting.fact_item_response ENABLE ROW LEVEL SECURITY; ALTER TABLE reporting.fact_item_response FORCE ROW LEVEL SECURITY;
ALTER TABLE reporting.fact_test_attempt ENABLE ROW LEVEL SECURITY; ALTER TABLE reporting.fact_test_attempt FORCE ROW LEVEL SECURITY;
ALTER TABLE reporting.funnel_thresholds ENABLE ROW LEVEL SECURITY; ALTER TABLE reporting.funnel_thresholds FORCE ROW LEVEL SECURITY;
ALTER TABLE reporting.item_thresholds ENABLE ROW LEVEL SECURITY; ALTER TABLE reporting.item_thresholds FORCE ROW LEVEL SECURITY;
ALTER TABLE reporting.percentile_thresholds ENABLE ROW LEVEL SECURITY; ALTER TABLE reporting.percentile_thresholds FORCE ROW LEVEL SECURITY;
ALTER TABLE reporting.platform_capacity ENABLE ROW LEVEL SECURITY; ALTER TABLE reporting.platform_capacity FORCE ROW LEVEL SECURITY;
ALTER TABLE reporting.product_tax_treatment ENABLE ROW LEVEL SECURITY; ALTER TABLE reporting.product_tax_treatment FORCE ROW LEVEL SECURITY;
ALTER TABLE reporting.refresh_blackout ENABLE ROW LEVEL SECURITY; ALTER TABLE reporting.refresh_blackout FORCE ROW LEVEL SECURITY;
ALTER TABLE reporting.refresh_blackout_exempt ENABLE ROW LEVEL SECURITY; ALTER TABLE reporting.refresh_blackout_exempt FORCE ROW LEVEL SECURITY;
ALTER TABLE reporting.refresh_log ENABLE ROW LEVEL SECURITY; ALTER TABLE reporting.refresh_log FORCE ROW LEVEL SECURITY;