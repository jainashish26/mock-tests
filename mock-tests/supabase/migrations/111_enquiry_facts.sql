-- ============================================================================
-- 111 - Enquiry facts and the A13 daily rollup (backlog item 21, Phase C)
--
-- WHAT THIS IS FOR
--   A13 asks two questions: are enquiries answered in time, and do they convert?
--   104 made the first answerable by giving enquiries a middle and an end, 109
--   gave the first question a clock, and 110 gave the second one a column that
--   subscriptions can actually use. This is the layer that turns those into the
--   numbers the brief specifies, at the grain it specifies:
--   day x channel x enquiry type x status, refreshed hourly.
--
-- WHY A FULL REBUILD AND NOT THE HOUSE WATERMARK
--   Every other loader here (load_attempt_facts, load_event_facts, ...) narrows
--   on a timestamp column, and for those that is right because the fact IS the
--   event. An enquiry is not an event, it is a mutable record: triage, reply,
--   resolve and convert all change it long after the day it arrived. Keying a
--   watermark on received_at would load each enquiry once and then freeze it -
--   every row would sit at status='new' with no response forever, and the report
--   would claim a 100% breach rate for history while the admin screens showed
--   those same enquiries resolved. Keying on updated_at would work only for as
--   long as the set_updated_at trigger keeps firing, which is an assumption about
--   a trigger rather than a property of the data.
--
--   So this loader rebuilds the table each run. Enquiries is a support queue, not
--   an event stream, and it is the smallest table in the reporting schema by a
--   wide margin; correctness here is worth more than the milliseconds an
--   incremental pass would save. Orphans disappear with their source rows through
--   ON DELETE CASCADE, so an enquiry removed upstream (privacy request, withdrawn
--   data) cannot survive in the warehouse as a row nobody can account for. If
--   this ever grows large enough to hurt, the fix is an updated_at watermark plus a
--   periodic full pass - not a received_at one, which is quietly wrong.
--
-- WHAT IS DELIBERATELY NOT STORED
--   sla_state. It is a function of the deadline AND the current moment, and a row
--   loaded at 03:00 as 'within' would still claim to be within at 15:00. The
--   deadline is stored; the verdict is derived at read time against the refresh
--   timestamp, which is at most an hour old and is labelled as such. Storing the
--   verdict would have been the same mistake as storing a child's age instead of
--   their birthday.
--
--   due_at, by contrast, IS stored, and that is a decision rather than an
--   oversight: it is computed from the config in force at load time, and no
--   history of SLA config changes is kept. If the promise is ever widened from one
--   business day to two, every stored deadline restates on the next load and the
--   trend shifts without any event having happened. That is the unavoidable cost
--   of running one clock, and it is written here because a report whose history
--   moves when a setting changes needs to say so somewhere a human will read it.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The fact table - one row per enquiry
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reporting.fact_enquiry (
  enquiry_id             uuid PRIMARY KEY,
  date_key               integer NOT NULL,      -- receipt day, Australia/Melbourne
  received_at            timestamptz NOT NULL,
  channel                text NOT NULL,
  enquiry_type           text NOT NULL,
  status                 text NOT NULL,
  outcome                text,
  parent_user_id         uuid,
  utm_source             text,

  first_response_at      timestamptz,
  resolved_at            timestamptz,
  converted_at           timestamptz,
  converted_ref_kind     text,

  -- Receipt to first response, NULL when no response was ever recorded. NULL
  -- rather than zero is the whole point: 104 section 2 refuses to invent a
  -- middle for an enquiry closed without one, and a zero here would drag the
  -- median toward "we answer instantly".
  first_response_minutes integer,
  resolution_minutes     integer,

  -- Kept separate from first_response_minutes because the distinction IS the
  -- report: an unrecorded response is not a fast one and not a slow one.
  response_recorded      boolean NOT NULL DEFAULT false,
  converted              boolean NOT NULL DEFAULT false,

  due_at                 timestamptz,           -- NULL => not measurable
  sla_measurable         boolean NOT NULL DEFAULT false,

  etl_loaded_at          timestamptz NOT NULL DEFAULT now(),

  CHECK (date_key > 0)
);

COMMENT ON TABLE reporting.fact_enquiry IS
  'Warehouse copy of public.enquiries, one row per enquiry, fully rebuilt by load_enquiry_facts. No PII: no contact columns and no message body, the same rule admin_enquiry_queue follows, so a reporting read can never become a way around the audited contact reveal.';

-- An enquiry deleted upstream (privacy request, withdrawn data) must not outlive
-- itself in the warehouse.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid='reporting.fact_enquiry'::regclass
                   AND conname='fact_enquiry_enquiry_id_fkey') THEN
    ALTER TABLE reporting.fact_enquiry
      ADD CONSTRAINT fact_enquiry_enquiry_id_fkey
      FOREIGN KEY (enquiry_id) REFERENCES public.enquiries(id) ON DELETE CASCADE;
  END IF;
END $$;

-- RLS enabled AND forced, matching every other reporting base table (PR-07).
ALTER TABLE reporting.fact_enquiry ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.fact_enquiry FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS ix_fact_enquiry_date_key
  ON reporting.fact_enquiry (date_key);
CREATE INDEX IF NOT EXISTS ix_fact_enquiry_received
  ON reporting.fact_enquiry (received_at);

GRANT SELECT ON reporting.fact_enquiry TO reporting_ro;

-- ----------------------------------------------------------------------------
-- 2. The loader
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reporting.load_enquiry_facts(p_full boolean DEFAULT true)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'reporting', 'public'
AS $fn$
DECLARE
  v_rows integer;
BEGIN
  -- The argument exists for symmetry with the other loaders and is honoured as a
  -- no-op on purpose: there is no cheaper correct plan than the full pass, so an
  -- incremental call must not silently do something different. See the header.
  IF NOT p_full THEN
    RAISE NOTICE 'load_enquiry_facts: no incremental path exists; rebuilding in full, which is the only correct option for a mutable record';
  END IF;

  -- Truncate rather than delete-and-upsert: the table is rebuilt from
  -- public.enquiries in the same statement, so any row not in the source is gone
  -- by construction rather than by a NOT IN that has to be remembered. It also
  -- means the etl_loaded_at stamp is uniform across the table, so a reader can
  -- tell how old the whole snapshot is instead of reasoning about 20,000
  -- individual load times.
  TRUNCATE TABLE reporting.fact_enquiry;

  INSERT INTO reporting.fact_enquiry (
    enquiry_id, date_key, received_at, channel, enquiry_type, status, outcome,
    parent_user_id, utm_source, first_response_at, resolved_at, converted_at,
    converted_ref_kind, first_response_minutes, resolution_minutes,
    response_recorded, converted, due_at, sla_measurable, etl_loaded_at)
  SELECT
    e.id,
    to_char(e.received_at AT TIME ZONE 'Australia/Melbourne', 'YYYYMMDD')::int,
    e.received_at, e.channel, e.enquiry_type, e.status, e.outcome,
    e.parent_user_id, e.utm_source,
    e.first_response_at, e.resolved_at, e.converted_at, e.converted_ref_kind,
    -- EXTRACT(EPOCH ...) is SECONDS; the /60 is what makes the column name true.
    -- This exact unit error corrupted three *_minutes columns in Phase B and was
    -- caught only by hand-computing a fixture, so it is written once here.
    CASE WHEN e.first_response_at IS NULL THEN NULL
         ELSE (EXTRACT(EPOCH FROM (e.first_response_at - e.received_at)) / 60)::int END,
    -- Same rule as the queue: a resolution with no recorded response has an
    -- unknown middle, and inventing one from the two ends would fill the single
    -- most interesting gap in the report with the admin's click time.
    CASE WHEN e.resolved_at IS NULL OR e.first_response_at IS NULL THEN NULL
         ELSE (EXTRACT(EPOCH FROM (e.resolved_at - e.received_at)) / 60)::int END,
    (e.first_response_at IS NOT NULL),
    (e.converted_order_id IS NOT NULL OR e.converted_ref IS NOT NULL),
    d.due_at,
    (d.due_at IS NOT NULL),
    now()
  FROM public.enquiries e
  CROSS JOIN reporting.enquiry_thresholds th
  CROSS JOIN LATERAL (
    SELECT CASE
             WHEN th.sla_basis = 'business'
               THEN reporting.business_day_deadline(e.received_at)
             ELSE e.received_at + make_interval(mins => th.first_response_sla_minutes)
           END AS due_at
  ) d
  WHERE th.id = 1;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- Recorded so DA-15 (refresh lag) can see this object the same way it sees the
  -- materialised views; a fact table nobody refreshes is a silent lie too.
  INSERT INTO reporting.etl_watermark (object_name, high_water)
  VALUES ('fact_enquiry', now())
  ON CONFLICT (object_name) DO UPDATE
    SET high_water = EXCLUDED.high_water, updated_at = now();

  RETURN v_rows;
END;
$fn$;

REVOKE ALL ON FUNCTION reporting.load_enquiry_facts(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reporting.load_enquiry_facts(boolean) TO reporting_ro;

-- ----------------------------------------------------------------------------
-- 3. The daily rollup - day x channel x enquiry type x status (brief S5.8 grain)
-- ----------------------------------------------------------------------------
-- Every count here is a count of enquiries, not of people: one parent emailing
-- twice is two enquiries, which is what the brief specifies and what a staffing
-- decision actually needs.
--
-- The breach verdict is computed at refresh time rather than stored, because for
-- an enquiry nobody has answered yet, "breached" only becomes true as time passes
-- - a stored value would freeze whichever side of the deadline the load happened
-- to fall on. The consequence is stated plainly in the panel: these figures are
-- as at etl_loaded_at, not as at read time.
-- A materialised view cannot be redefined in place, and `CREATE OR REPLACE VIEW`
-- silently produces a PLAIN view when the name does not exist yet - which is what
-- the first draft of this migration did, leaving an object that looked right,
-- answered queries correctly, and would have made safe_refresh() fail on its
-- first scheduled run with "is not a materialized view". Both cases are therefore
-- dropped before the real thing is created, so re-applying this file actually
-- changes the definition instead of quietly keeping the old one.
DO $drop$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'reporting' AND c.relname = 'mv_enquiry_daily'
               AND c.relkind IN ('v','m')) THEN
    EXECUTE 'DROP MATERIALIZED VIEW IF EXISTS reporting.mv_enquiry_daily';
    EXECUTE 'DROP VIEW IF EXISTS reporting.mv_enquiry_daily';
  END IF;
END $drop$;

CREATE MATERIALIZED VIEW reporting.mv_enquiry_daily AS
WITH rated AS (
  SELECT
    f.*,
    CASE
      WHEN NOT f.sla_measurable THEN 'unmeasurable'
      -- Mirrors admin_enquiry_queue exactly. Diverging here would mean the
      -- operator's queue and the board's chart disagree about the same row, and
      -- the argument about which is right would never be settled by data.
      WHEN f.status IN ('resolved','closed') AND NOT f.response_recorded
        THEN 'unrecorded'
      WHEN f.response_recorded
        THEN CASE WHEN f.first_response_at <= f.due_at THEN 'met' ELSE 'breached' END
      WHEN now() > f.due_at THEN 'breached'
      WHEN now() > f.received_at + ((f.due_at - f.received_at) * 0.75) THEN 'at_risk'
      ELSE 'within'
    END AS sla_state
  FROM reporting.fact_enquiry f
)
SELECT
  r.date_key,
  d.the_date,
  r.channel,
  r.enquiry_type,
  r.status,
  COUNT(*)::int                                          AS enquiries,
  COUNT(*) FILTER (WHERE r.sla_state = 'met')::int       AS sla_met,
  COUNT(*) FILTER (WHERE r.sla_state = 'breached')::int  AS sla_breached,
  COUNT(*) FILTER (WHERE r.sla_state = 'at_risk')::int   AS sla_at_risk,
  COUNT(*) FILTER (WHERE r.sla_state = 'within')::int    AS sla_within,
  COUNT(*) FILTER (WHERE r.sla_state = 'unmeasurable')::int AS sla_unmeasurable,
  -- Reported apart from breached on purpose: an enquiry closed with no reply is a
  -- hole in the record, not a slow answer, and folding it into either number
  -- changes the meaning of the promise.
  COUNT(*) FILTER (WHERE r.sla_state = 'unrecorded')::int AS response_unrecorded,
  COUNT(*) FILTER (WHERE r.response_recorded)::int        AS response_recorded,
  -- Median, not mean (S5.8): one enquiry answered eleven days later is a staffing
  -- fact, not a reason to report that the average reply took two days.
  -- The ::numeric is load-bearing, not cosmetic - percentile_cont returns double
  -- precision and round(x, s) is only defined for numeric, so the obvious
  -- expression fails to create the view at all.
  ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY r.first_response_minutes))::numeric / 60, 2)
    AS first_response_hours_median,
  ROUND((percentile_cont(0.9) WITHIN GROUP (ORDER BY r.first_response_minutes))::numeric / 60, 2)
    AS first_response_hours_p90,
  ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY r.resolution_minutes))::numeric / 60, 2)
    AS resolution_hours_median,
  COUNT(*) FILTER (WHERE r.converted)::int               AS converted,
  MAX(r.etl_loaded_at)                                   AS etl_loaded_at
FROM rated r
-- LEFT JOIN, and this one is load-bearing rather than defensive. dim_date is
-- pre-generated 2024-01-01..2030-12-31; an inner join would drop every enquiry
-- received outside that range from the chart while the headline, which reads the
-- fact table directly, still counted it. The summary and the series would then
-- disagree by exactly the rows nobody can see, and 112's own cross-check is what
-- makes that impossible to ship.
LEFT JOIN reporting.dim_date d ON d.date_key = r.date_key
GROUP BY r.date_key, d.the_date, r.channel, r.enquiry_type, r.status;

COMMENT ON MATERIALIZED VIEW reporting.mv_enquiry_daily IS
  'A13 daily rollup: day x channel x enquiry type x status. Breach verdicts are evaluated at refresh time, so the figures are as at etl_loaded_at rather than at read time. Medians ignore enquiries with no recorded response, which are counted separately in response_unrecorded.';

-- Required for REFRESH CONCURRENTLY, and it also documents the grain: this is
-- exactly the tuple that identifies a row.
CREATE UNIQUE INDEX IF NOT EXISTS ux_mv_enquiry_daily
  ON reporting.mv_enquiry_daily (date_key, channel, enquiry_type, status);

CREATE INDEX IF NOT EXISTS ix_mv_enquiry_daily_date
  ON reporting.mv_enquiry_daily (date_key);

GRANT SELECT ON reporting.mv_enquiry_daily TO reporting_ro;

-- ----------------------------------------------------------------------------
-- 4. Schedule
-- ----------------------------------------------------------------------------
-- Hourly, per the brief's refresh column for A13, at minute 10 to stay clear of
-- the */15 platform-health job and the */30 event loader. cron.schedule takes
-- UTC and the blackout guard in safe_refresh makes a DST-drifted schedule skip
-- rather than pile on, which is the same reasoning 013 recorded.
-- Re-running cron.schedule with an existing job name updates it in place, so
-- this stays idempotent.
SELECT cron.schedule(
  'rpt-enquiry-daily',
  '10 * * * *',
  $$SELECT reporting.load_enquiry_facts(true),
           reporting.safe_refresh('reporting.mv_enquiry_daily', true)$$
);

-- ----------------------------------------------------------------------------
-- 5. First load and a structural self-check
-- ----------------------------------------------------------------------------
-- The view cannot be refreshed here if the fact table is empty, and an empty
-- rollup is indistinguishable from a broken one, so the loader runs at apply time
-- and the view is refreshed immediately. The checks that follow are the cheap
-- version of "did the grain come out the way the GROUP BY intends" - a duplicate
-- grain would make the unique index fail, which is exactly why the index is
-- created before the first refresh rather than after.
SELECT reporting.load_enquiry_facts(true);
REFRESH MATERIALIZED VIEW reporting.mv_enquiry_daily;

DO $$
DECLARE
  v_facts  bigint;
  v_source bigint;
  v_grain  bigint;
  v_keys   bigint;
BEGIN
  SELECT COUNT(*) INTO v_facts FROM reporting.fact_enquiry;
  SELECT COUNT(*) INTO v_source FROM public.enquiries;

  IF v_facts <> v_source THEN
    RAISE EXCEPTION
      '111 self-test: fact_enquiry holds % rows but public.enquiries holds %',
      v_facts, v_source
      USING ERRCODE = 'raise_exception';
  END IF;

  SELECT COUNT(*) INTO v_grain FROM reporting.mv_enquiry_daily;
  SELECT COUNT(*) INTO v_keys FROM (
    SELECT DISTINCT date_key, channel, enquiry_type, status
      FROM reporting.mv_enquiry_daily) x;

  -- The unique index already guarantees this, but a mismatch here would mean the
  -- index is absent, and REFRESH CONCURRENTLY would then fail on the next
  -- scheduled run rather than now. Failing at apply time is the whole point.
  IF v_grain <> v_keys THEN
    RAISE EXCEPTION
      '111 self-test: mv_enquiry_daily grain is not unique (% rows, % distinct keys)',
      v_grain, v_keys
      USING ERRCODE = 'raise_exception';
  END IF;
END $$;
