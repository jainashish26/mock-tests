-- Generated baseline: config
-- Source: live database via export_schema_baseline (migrations 051/052).
-- Do not hand-edit; regenerate with scripts/rebaseline_schema.py.
-- See supabase/migrations/README.md for apply order and caveats.

-- Hand-maintained reporting configuration (052/064/071/086).
-- A schema dump does not carry these, and their absence silently
-- disables features rather than raising an error.

-- at_risk_thresholds
INSERT INTO reporting.at_risk_thresholds SELECT * FROM jsonb_populate_record(NULL::reporting.at_risk_thresholds, '{"id": 1, "updated_at": "2026-11-16T12:56:09.200278+00:00", "declining_drop_pp": 10, "low_engagement_days": 14, "declining_min_attempts": 3, "misconception_max_accuracy": 50, "misconception_min_attempts": 2}') ON CONFLICT DO NOTHING;

-- coverage_thresholds
INSERT INTO reporting.coverage_thresholds SELECT * FROM jsonb_populate_record(NULL::reporting.coverage_thresholds, '{"id": 1, "updated_at": "2026-11-15T03:57:24.327171+00:00", "min_items_per_subtopic": 10}') ON CONFLICT DO NOTHING;

-- dim_year_level_cap
INSERT INTO reporting.dim_year_level_cap SELECT * FROM jsonb_populate_record(NULL::reporting.dim_year_level_cap, '{"updated_at": "2026-10-24T04:50:03.849739+00:00", "year_level": 2, "max_tests_per_day": null, "max_questions_per_day": null}') ON CONFLICT DO NOTHING;
INSERT INTO reporting.dim_year_level_cap SELECT * FROM jsonb_populate_record(NULL::reporting.dim_year_level_cap, '{"updated_at": "2026-10-24T04:50:03.849739+00:00", "year_level": 3, "max_tests_per_day": null, "max_questions_per_day": null}') ON CONFLICT DO NOTHING;
INSERT INTO reporting.dim_year_level_cap SELECT * FROM jsonb_populate_record(NULL::reporting.dim_year_level_cap, '{"updated_at": "2026-10-24T04:50:03.849739+00:00", "year_level": 4, "max_tests_per_day": null, "max_questions_per_day": null}') ON CONFLICT DO NOTHING;
INSERT INTO reporting.dim_year_level_cap SELECT * FROM jsonb_populate_record(NULL::reporting.dim_year_level_cap, '{"updated_at": "2026-10-24T04:50:03.849739+00:00", "year_level": 5, "max_tests_per_day": null, "max_questions_per_day": null}') ON CONFLICT DO NOTHING;
INSERT INTO reporting.dim_year_level_cap SELECT * FROM jsonb_populate_record(NULL::reporting.dim_year_level_cap, '{"updated_at": "2026-10-24T04:50:03.849739+00:00", "year_level": 6, "max_tests_per_day": null, "max_questions_per_day": null}') ON CONFLICT DO NOTHING;
INSERT INTO reporting.dim_year_level_cap SELECT * FROM jsonb_populate_record(NULL::reporting.dim_year_level_cap, '{"updated_at": "2026-10-24T04:50:03.849739+00:00", "year_level": 7, "max_tests_per_day": null, "max_questions_per_day": null}') ON CONFLICT DO NOTHING;
INSERT INTO reporting.dim_year_level_cap SELECT * FROM jsonb_populate_record(NULL::reporting.dim_year_level_cap, '{"updated_at": "2026-10-24T04:50:03.849739+00:00", "year_level": 8, "max_tests_per_day": null, "max_questions_per_day": null}') ON CONFLICT DO NOTHING;
INSERT INTO reporting.dim_year_level_cap SELECT * FROM jsonb_populate_record(NULL::reporting.dim_year_level_cap, '{"updated_at": "2026-11-19T05:49:10.849216+00:00", "year_level": 9, "max_tests_per_day": null, "max_questions_per_day": null}') ON CONFLICT DO NOTHING;

-- enquiry_thresholds
INSERT INTO reporting.enquiry_thresholds SELECT * FROM jsonb_populate_record(NULL::reporting.enquiry_thresholds, '{"id": 1, "sla_basis": "calendar", "updated_at": "2026-11-19T10:59:11.70409+00:00", "sla_is_confirmed": false, "resolution_sla_hours": 48, "min_enquiries_for_rate": 20, "first_response_sla_minutes": 1440, "conversion_attribution_days": 30}') ON CONFLICT DO NOTHING;

-- experiment_thresholds
INSERT INTO reporting.experiment_thresholds SELECT * FROM jsonb_populate_record(NULL::reporting.experiment_thresholds, '{"id": 1, "alpha": 0.05, "updated_at": "2026-11-16T06:24:07.718637+00:00", "min_sample_size": 200, "min_meaningful_lift_pp": 2.0}') ON CONFLICT DO NOTHING;

-- funnel_thresholds
INSERT INTO reporting.funnel_thresholds SELECT * FROM jsonb_populate_record(NULL::reporting.funnel_thresholds, '{"id": 1, "updated_at": "2026-11-19T21:21:32.787433+00:00", "min_segment_visitors": 20, "checkout_abandon_minutes": 60}') ON CONFLICT DO NOTHING;

-- item_thresholds
INSERT INTO reporting.item_thresholds SELECT * FROM jsonb_populate_record(NULL::reporting.item_thresholds, '{"id": 1, "updated_at": "2026-11-17T12:02:37.537307+00:00", "p_value_floor": 0.200, "p_value_ceiling": 0.900, "skip_rate_max_pct": 10.00, "point_biserial_min": 0.200, "min_responses_per_item": 20, "median_time_max_seconds": 180}') ON CONFLICT DO NOTHING;

-- percentile_thresholds
INSERT INTO reporting.percentile_thresholds SELECT * FROM jsonb_populate_record(NULL::reporting.percentile_thresholds, '{"id": 1, "updated_at": "2026-11-18T12:05:03.006016+00:00", "min_cohort_students": 20, "cohort_window_months": 12, "min_cohort_for_point": 50}') ON CONFLICT DO NOTHING;

-- platform_capacity
INSERT INTO reporting.platform_capacity SELECT * FROM jsonb_populate_record(NULL::reporting.platform_capacity, '{"id": 1, "note": "Assumption A-13: 200 is the peak figure stated in the project brief and treated as a capacity target. It is not a measured value - nothing in the repository or database corroborates it. Set is_measured = true once a real peak has been observed.", "updated_at": "2026-10-25T08:35:19.422079+00:00", "is_measured": false, "peak_concurrency_cap": 200}') ON CONFLICT DO NOTHING;

-- product_tax_treatment
INSERT INTO reporting.product_tax_treatment SELECT * FROM jsonb_populate_record(NULL::reporting.product_tax_treatment, '{"notes": "Matches STRIPE_PRICE_UNLIMITED_MONTHLY. GST-inclusive per Terms.", "updated_at": "2026-11-15T03:57:24.327171+00:00", "product_key": "unlimited_monthly", "display_name": "Unlimited practice - monthly", "tax_treatment": "inclusive", "gst_rate_percent": 10.00}') ON CONFLICT DO NOTHING;
INSERT INTO reporting.product_tax_treatment SELECT * FROM jsonb_populate_record(NULL::reporting.product_tax_treatment, '{"notes": "Matches STRIPE_PRICE_UNLIMITED_ANNUAL. GST-inclusive per Terms.", "updated_at": "2026-11-15T03:57:24.327171+00:00", "product_key": "unlimited_annual", "display_name": "Unlimited practice - annual", "tax_treatment": "inclusive", "gst_rate_percent": 10.00}') ON CONFLICT DO NOTHING;
INSERT INTO reporting.product_tax_treatment SELECT * FROM jsonb_populate_record(NULL::reporting.product_tax_treatment, '{"notes": "Discounted unlimited access; same supply, same treatment.", "updated_at": "2026-11-15T03:57:24.327171+00:00", "product_key": "launch_offer", "display_name": "Launch offer", "tax_treatment": "inclusive", "gst_rate_percent": 10.00}') ON CONFLICT DO NOTHING;
INSERT INTO reporting.product_tax_treatment SELECT * FROM jsonb_populate_record(NULL::reporting.product_tax_treatment, '{"notes": "Not yet sold. Declared so the row exists before the first charge.", "updated_at": "2026-11-15T03:57:24.327171+00:00", "product_key": "writing_booster", "display_name": "Writing booster", "tax_treatment": "inclusive", "gst_rate_percent": 10.00}') ON CONFLICT DO NOTHING;

-- refresh_blackout
INSERT INTO reporting.refresh_blackout SELECT * FROM jsonb_populate_record(NULL::reporting.refresh_blackout, '{"reason": "Assumed weekday evening practice peak", "to_time": "21:00:00", "valid_to": null, "from_time": "16:00:00", "is_active": true, "valid_from": null, "blackout_id": 1, "days_of_week": [1, 2, 3, 4, 5]}') ON CONFLICT DO NOTHING;
INSERT INTO reporting.refresh_blackout SELECT * FROM jsonb_populate_record(NULL::reporting.refresh_blackout, '{"reason": "Assumed weekend morning practice peak", "to_time": "13:00:00", "valid_to": null, "from_time": "09:00:00", "is_active": true, "valid_from": null, "blackout_id": 2, "days_of_week": [6, 7]}') ON CONFLICT DO NOTHING;

-- refresh_blackout_exempt
INSERT INTO reporting.refresh_blackout_exempt SELECT * FROM jsonb_populate_record(NULL::reporting.refresh_blackout_exempt, E'{"reason": "A14 answers \\"is the platform coping now\\" and its value peaks inside the blackout windows. Hourly-grain aggregate, refreshed CONCURRENTLY (non-blocking), bounded by lock_timeout 30s. Decision D-D, migration 046.", "created_at": "2026-11-15T03:57:24.327171+00:00", "object_name": "mv_platform_health"}') ON CONFLICT DO NOTHING;

