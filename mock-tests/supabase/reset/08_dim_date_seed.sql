-- ============================================================================
-- reset/08_dim_date_seed.sql - populate reporting.dim_date (2024-2030).
--
-- The TABLE is created by baseline/01_tables.sql, but its rows are neither in
-- the baseline (ETL-style data is deliberately excluded) nor derivable at
-- runtime: date_key filters across the fact tables assume the conformed
-- calendar exists. This is the exact generator from migration 013 (Melbourne
-- conventions, ON CONFLICT DO NOTHING), reproduced so a reset does not need
-- the superseded 013 file.
--
-- Apply AFTER baseline/01_tables.sql. Idempotent.
-- ============================================================================

INSERT INTO reporting.dim_date
  (date_key, the_date, year, quarter, month, week_of_year, day_of_week,
   is_weekend, month_start, month_end)
SELECT to_char(d,'YYYYMMDD')::int, d,
       EXTRACT(YEAR FROM d)::smallint, EXTRACT(QUARTER FROM d)::smallint,
       EXTRACT(MONTH FROM d)::smallint, EXTRACT(WEEK FROM d)::smallint,
       EXTRACT(ISODOW FROM d)::smallint, EXTRACT(ISODOW FROM d) >= 6,
       date_trunc('month', d)::date,
       (date_trunc('month', d) + interval '1 month - 1 day')::date
FROM generate_series(DATE '2024-01-01', DATE '2030-12-31', interval '1 day') AS d
ON CONFLICT (date_key) DO NOTHING;