-- ============================================================================
-- 104 - Enquiry triage (backlog item 21, Phase B)
--
-- WHY THIS IS NOT OPTIONAL FOR A13
--   103 gave enquiries a beginning. Nothing in the product gave them a middle or
--   an end: first_response_at, resolved_at, status and outcome still had no
--   writer at all, so A13 would have been a volume counter that could never
--   report a breach - the exact "mechanics without measurement" failure
--   16-delivery-backlog.md criticises, and the thing 11-...md §5.8 defines this
--   report around. The queue, the actions and the audit below are what make
--   A13's SLA numbers mean anything.
--
-- 1. THE SLA IS DECLARED, NOT ASSUMED (following the D-C precedent)
--   The contact page publishes "one business day". Nothing in the repo or the
--   database states whether that is calendar or business hours, and A-15 logs
--   the gap. Rather than pick silently, the value is a config singleton with an
--   explicit `sla_basis` and `sla_is_confirmed`: today it is 1440 CALENDAR
--   minutes and NOT confirmed, and A13 renders "provisional" beside the breach
--   rate because of those two columns. Confirming it is an UPDATE, not a
--   migration.
--
-- 2. A FIRST RESPONSE IS NEVER INFERRED
--   The tempting shortcut - stamp first_response_at when someone marks an
--   enquiry resolved - would record the moment an admin clicked, not the moment
--   the parent was answered. Those can be days apart, and the shortcut makes
--   every historical response look instant. 12-...md §62 warns about exactly
--   this: an SLA measured from "a timestamp column that can be backfilled". So:
--     * `reply` is the only action that stamps it, and it stamps it once;
--     * resolving or closing with no recorded reply leaves the column NULL and
--       the queue says so in terms;
--     * `reply` is REFUSED after an enquiry has been resolved or closed,
--       because a reply added after the fact would both violate
--       enquiries_timeline_sane and invent a history nobody observed.
--   A13 then reports unrecorded responses as their own count instead of quietly
--   excluding them from a rate that would look better for the gap.
--
-- 3. ACTIONS, NOT STATUSES
--   The function takes an action verb and derives the status rather than
--   accepting a status. Accepting a status means `SET status = 'resolved'` from
--   anywhere, with no way to know the clock columns were touched in the right
--   order. Deriving it puts the state machine in one place, so the table cannot
--   be put in a state the workflow does not mean.
--
-- 4. THE RESTRICTED TABLE STAYS RESTRICTED
--   admin_enquiry_queue() returns no contact column at all. Reading an
--   enquirer's email or message body still goes through
--   read_enquiry_contact(id, task_reason), which audits before returning.
--   Deliberate: a queue that carried message_body would make that audit
--   decorative, because nobody would ever need to call the audited function.
--   PR-02's principle, applied to the application surface rather than only the
--   reporting schema.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Configuration singleton
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reporting.enquiry_thresholds (
  id                     integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  -- The promise published on /contact, held as calendar minutes because that is
  -- the only basis this codebase can evaluate without a holiday calendar.
  first_response_sla_minutes integer NOT NULL DEFAULT 1440
    CHECK (first_response_sla_minutes > 0),

  -- 'calendar' is what the SQL below implements. 'business' would need working
  -- hours and a Victorian public-holiday set, neither of which exists here;
  -- recording the intent without the implementation would be worse than
  -- admitting which one is live.
  sla_basis              text NOT NULL DEFAULT 'calendar'
    CHECK (sla_basis IN ('calendar', 'business')),

  -- A-15 / Q-5. False means the figure above is a reading of published copy,
  -- not a business decision, and A13 must say so rather than present a
  -- confidently wrong breach rate.
  sla_is_confirmed       boolean NOT NULL DEFAULT false,

  -- Median, not mean (§5.8).
  resolution_sla_hours   integer NOT NULL DEFAULT 48
    CHECK (resolution_sla_hours > 0),

  -- enquiry_to_customer_rate. §5.8 is explicit that an order six months later
  -- is not an enquiry conversion, and an unbounded window would make every
  -- payer who ever emailed look like a support conversion.
  --
  -- NOT READ BY ANYTHING YET, and deliberately kept: there is no correct
  -- attribution writer until the converted_order_id / subscriptions question
  -- in section 4 is answered. The knob exists so that when the writer lands it
  -- has one home and cannot be invented with a magic number in a route.
  conversion_attribution_days integer NOT NULL DEFAULT 30
    CHECK (conversion_attribution_days BETWEEN 1 AND 365),

  -- X-4's floor, applied here too: a breach rate from four enquiries is noise,
  -- and worse than noise on a staffing screen, where it reads as a reason to
  -- hire.
  min_enquiries_for_rate integer NOT NULL DEFAULT 20
    CHECK (min_enquiries_for_rate >= 1),

  updated_at             timestamptz NOT NULL DEFAULT now()
);

INSERT INTO reporting.enquiry_thresholds (id) VALUES (1) ON CONFLICT DO NOTHING;

ALTER TABLE reporting.enquiry_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.enquiry_thresholds FORCE ROW LEVEL SECURITY;
REVOKE ALL ON reporting.enquiry_thresholds FROM PUBLIC, anon, authenticated;
GRANT SELECT ON reporting.enquiry_thresholds TO reporting_ro;

-- ----------------------------------------------------------------------------
-- 2. admin_enquiry_queue - the operator's list
-- ----------------------------------------------------------------------------
-- Oldest unanswered work first, because that is the only useful order for a
-- support queue. `sla_state` is computed here rather than in the page so a
-- dashboard and this queue cannot disagree about what "breached" means.
CREATE OR REPLACE FUNCTION public.admin_enquiry_queue(
  p_status      text    DEFAULT NULL,    -- NULL = every non-spam status
  p_type        text    DEFAULT NULL,
  p_unanswered  boolean DEFAULT false,   -- only enquiries with no recorded reply
  p_limit       integer DEFAULT 50,
  p_offset      integer DEFAULT 0
)
RETURNS TABLE(
  enquiry_id            uuid,
  channel               text,
  enquiry_type          text,
  status                text,
  outcome               text,
  received_at           timestamptz,
  first_response_at     timestamptz,
  resolved_at           timestamptz,
  assigned_to           uuid,
  parent_user_id        uuid,
  converted             boolean,
  age_minutes           integer,
  response_minutes      integer,
  resolution_hours      numeric,
  sla_minutes           integer,
  sla_state             text,
  sla_is_confirmed      boolean,
  utm_source            text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Authorisation before the parameter validation below: a non-admin must not
  -- be able to learn the valid status names by observing which of two 400s
  -- comes back. Silent zero rows is the only answer for an unauthorised
  -- caller, and it is the same shape for every student and every id.
  IF NOT public.has_role('ADMIN') THEN
    RETURN;
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 200' USING ERRCODE = '22023';
  END IF;
  IF p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'p_offset must be zero or greater' USING ERRCODE = '22023';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN (
       'new','triaged','in_progress','waiting_on_customer','resolved','closed','spam') THEN
    RAISE EXCEPTION 'unknown enquiry status: %', p_status USING ERRCODE = '22023';
  END IF;
  IF p_type IS NOT NULL AND p_type NOT IN (
       'billing','technical','privacy','accessibility','product_question',
       'refund','complaint','other') THEN
    RAISE EXCEPTION 'unknown enquiry type: %', p_type USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.channel,
    e.enquiry_type,
    e.status,
    e.outcome,
    e.received_at,
    e.first_response_at,
    e.resolved_at,
    e.assigned_to,
    e.parent_user_id,
    (e.converted_order_id IS NOT NULL),
    -- Ageing is measured against the clock the database owns, never a
    -- client-supplied now(), or the queue could be made to look fresh.
    -- UNITS MATTER, AND THIS LINE IS WHERE THEY WENT WRONG FIRST.
    -- EXTRACT(EPOCH FROM an interval) is SECONDS. Dividing by 60 is what makes
    -- a column called age_minutes mean minutes. The SLA comparisons below all
    -- divide by 60 inside the CASE, so sla_state stayed correct while these
    -- returned values sixty times too large - which is how the bug survived a
    -- passing queue and was caught only by hand-computing a fixture's age.
    -- It also corrupted admin_enquiry_counts(), whose unrecorded_open test
    -- compares this column against the SLA in minutes.
    (EXTRACT(EPOCH FROM (now() - e.received_at)) / 60)::int,
    (EXTRACT(EPOCH FROM (e.first_response_at - e.received_at)) / 60)::int,
    -- resolution_hours stays NULL without a recorded first response for the
    -- same reason the response clock does: an enquiry that was answered offline
    -- and then closed has an unknown middle, and inventing one from the two
    -- ends would silently fill the report's most interesting gap.
    CASE WHEN e.resolved_at IS NULL OR e.first_response_at IS NULL THEN NULL
         ELSE ROUND(EXTRACT(EPOCH FROM (e.resolved_at - e.received_at)) / 3600, 2) END,
    th.first_response_sla_minutes,
    -- Five states, and the reason each one exists:
    --   met        a reply is recorded and it was inside the window
    --   breached   replied late, OR still unanswered past the window. §5.8 is
    --              explicit that an unanswered enquiry counts as a breach NOW:
    --              waiting for it to be resolved is how the worst cases never
    --              appear on the screen meant to surface them.
    --   at_risk    still open, inside the window but past three quarters of it
    --   within     still open, comfortably inside the window
    --   unrecorded resolved or closed with no reply ever recorded. Not "met":
    --              calling it met is the fabrication section 2 refuses.
    CASE
      WHEN e.status IN ('resolved','closed') AND e.first_response_at IS NULL
        THEN 'unrecorded'
      WHEN e.first_response_at IS NOT NULL
        THEN CASE WHEN EXTRACT(EPOCH FROM (e.first_response_at - e.received_at)) / 60
                       <= th.first_response_sla_minutes THEN 'met' ELSE 'breached' END
      WHEN EXTRACT(EPOCH FROM (now() - e.received_at)) / 60
           > th.first_response_sla_minutes THEN 'breached'
      WHEN EXTRACT(EPOCH FROM (now() - e.received_at)) / 60
           > th.first_response_sla_minutes * 0.75 THEN 'at_risk'
      ELSE 'within'
    END,
    th.sla_is_confirmed,
    e.utm_source
  FROM public.enquiries e
  CROSS JOIN reporting.enquiry_thresholds th
  WHERE th.id = 1
    AND (p_status IS NULL OR e.status = p_status)
    -- The default view is the work queue, and spam is not work. Asking for
    -- status='spam' explicitly still returns it.
    AND (p_status IS NOT NULL OR e.status <> 'spam')
    AND (p_type IS NULL OR e.enquiry_type = p_type)
    AND (NOT p_unanswered OR e.first_response_at IS NULL)
  ORDER BY e.received_at ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_enquiry_queue(text, text, boolean, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_enquiry_queue(text, text, boolean, integer, integer)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. admin_enquiry_transition - the state machine, and the only writer of the
--    response and resolution clocks
-- ----------------------------------------------------------------------------
-- RETURNS TABLE rather than void because the caller has to emit
-- ENQUIRY_FIRST_RESPONDED with responseMinutes (12-...md §62 specifies that
-- prop), and the only trustworthy source for that number is the same
-- transaction that decided it. Returning it from the function means the event
-- cannot be computed from a stale read of the row.
-- DROP before CREATE, not CREATE OR REPLACE: Postgres refuses to change the
-- return type of an existing function ("cannot change return type of existing
-- function", 42P13), so adding an output column is a recreate - and it happened
-- here, when resolution_hours was added so the route stopped recomputing it.
-- A DROP in a migration deserves a reason and a check, so this one was measured
-- against the live catalog before it was written:
--   views/materialised views depending on it .. 0
--   triggers                                   .. 0
--   RLS policies referencing it                .. 0
--   bodies of other functions calling it       .. 0
--   cron.job commands mentioning it            .. 0
-- The only caller is POST /api/admin/enquiries/[id], the REVOKE/GRANT pair
-- below re-applies the lock-down immediately, and no table rows are touched.
-- If a caller is ever added, this comment is the thing that has to be re-run.
DROP FUNCTION IF EXISTS public.admin_enquiry_transition(uuid, text, text, uuid);

CREATE OR REPLACE FUNCTION public.admin_enquiry_transition(
  p_enquiry_id uuid,
  p_action     text,
  p_outcome    text   DEFAULT NULL,
  p_assignee   uuid   DEFAULT NULL
)
RETURNS TABLE(
  enquiry_id           uuid,
  status               text,
  outcome              text,
  first_response_at    timestamptz,
  first_response_minutes integer,
  resolved_at          timestamptz,
  resolution_hours     numeric,
  response_recorded    boolean,
  response_was_missing boolean
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now     timestamptz := now();
  v_e       public.enquiries%ROWTYPE;
  v_target  text;
  v_new_fr  timestamptz;
  v_new_res timestamptz;
BEGIN
  IF NOT public.has_role('ADMIN') THEN
    RAISE EXCEPTION 'only an administrator can change an enquiry''s status'
      USING ERRCODE = '42501';
  END IF;

  IF p_action IS NULL OR p_action NOT IN
     ('triage','start','reply','resolve','close','reopen','assign','spam') THEN
    RAISE EXCEPTION 'unknown enquiry action: %', p_action USING ERRCODE = '22023';
  END IF;

  -- FOR UPDATE, so two admins clicking the same button at the same moment
  -- cannot both pass the "is this already resolved?" tests below and both stamp
  -- a clock. The second sees the row as the first left it.
  SELECT * INTO v_e FROM public.enquiries WHERE id = p_enquiry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such enquiry' USING ERRCODE = 'P0002';
  END IF;

  v_target  := v_e.status;
  v_new_fr  := v_e.first_response_at;
  v_new_res := v_e.resolved_at;

  -- Each action names the status it produces. The table is never handed a
  -- status it has to interpret.
  CASE p_action
    WHEN 'triage'  THEN v_target := 'triaged';
    WHEN 'start'   THEN v_target := 'in_progress';
    WHEN 'reply'   THEN v_target := 'waiting_on_customer';
    WHEN 'resolve' THEN v_target := 'resolved';
    WHEN 'close'   THEN v_target := 'closed';
    WHEN 'reopen'  THEN v_target := 'in_progress';
    WHEN 'spam'    THEN v_target := 'spam';
    WHEN 'assign'  THEN v_target := v_e.status;   -- assignment moves nothing
  END CASE;

  -- The reply clock. Only 'reply' stamps it, and only once: a second reply is
  -- an ordinary conversation, not a second first response.
  IF p_action = 'reply' THEN
    IF v_e.first_response_at IS NOT NULL THEN
      RAISE EXCEPTION 'the first response was already recorded at %',
        v_e.first_response_at USING ERRCODE = '22023';
    END IF;
    -- Refused after resolution rather than backfilled. A reply entered now
    -- would be timed from receipt to now, which is the admin's click time and
    -- not the moment anybody was answered - and it would also violate
    -- enquiries_timeline_sane. See the header, section 2.
    IF v_e.resolved_at IS NOT NULL OR v_e.status IN ('resolved','closed') THEN
      RAISE EXCEPTION
        'cannot record a first response after an enquiry is resolved or closed; '
        'the response was never recorded, and A13 reports it as such'
        USING ERRCODE = '22023';
    END IF;
    v_new_fr := v_now;
  END IF;

  -- The resolution clock, together with the outcome the CHECK demands.
  IF p_action IN ('resolve','close') THEN
    IF p_outcome IS NULL OR p_outcome NOT IN
       ('answered','refunded','escalated','no_action','spam','duplicate','withdrawn') THEN
      RAISE EXCEPTION 'resolving or closing requires a valid outcome'
        USING ERRCODE = '22023';
    END IF;
    -- COALESCE keeps the original timestamp if an enquiry is closed after
    -- being resolved, so resolution_hours does not drift every time somebody
    -- tidies the status.
    v_new_res := COALESCE(v_e.resolved_at, v_now);
  END IF;

  IF p_action = 'spam' THEN
    v_new_res := COALESCE(v_e.resolved_at, v_now);
  END IF;

  -- Reopening means it is not resolved any more. The clock is cleared rather
  -- than left behind, so resolution_hours cannot be computed against a moment
  -- that no longer describes the enquiry.
  IF p_action = 'reopen' THEN
    v_new_res := NULL;
  END IF;

  IF p_action = 'assign' AND p_assignee IS NULL THEN
    RAISE EXCEPTION 'the assign action needs an assignee' USING ERRCODE = '22023';
  END IF;

  UPDATE public.enquiries AS e
     SET status            = v_target,
         first_response_at = v_new_fr,
         resolved_at       = v_new_res,
         -- Every right-hand reference is table-qualified. RETURNS TABLE makes
         -- each output column a plpgsql variable named `status`, `outcome`,
         -- `resolved_at` and so on, so a bare `outcome` here is ambiguous
         -- between the OUT parameter and the column and Postgres refuses the
         -- statement outright (42702). The alias is not decoration: without it
         -- this function cannot be created at all.
         outcome           = COALESCE(p_outcome,
                            CASE WHEN p_action = 'spam' THEN 'spam' ELSE e.outcome END),
         assigned_to       = COALESCE(p_assignee, e.assigned_to),
         updated_at        = v_now
   WHERE e.id = p_enquiry_id;

  RETURN QUERY
  SELECT
    p_enquiry_id,
    v_target,
    COALESCE(p_outcome,
      CASE WHEN p_action = 'spam' THEN 'spam' ELSE v_e.outcome END),
    v_new_fr,
    -- Minutes, not seconds - see the units note in admin_enquiry_queue.
    CASE WHEN v_new_fr IS NULL THEN NULL
         ELSE (EXTRACT(EPOCH FROM (v_new_fr - v_e.received_at)) / 60)::int END,
    v_new_res,
    -- Same rule as the queue's column: an unknown middle stays unknown.
    CASE WHEN v_new_res IS NULL OR v_new_fr IS NULL THEN NULL
         ELSE ROUND(EXTRACT(EPOCH FROM (v_new_res - v_e.received_at)) / 3600, 2) END,
    -- True only when THIS call recorded the first response, which is the only
    -- case that should fire ENQUIRY_FIRST_RESPONDED.
    (p_action = 'reply' AND v_e.first_response_at IS NULL),
    -- The honesty flag for the UI: resolved or closed with no reply on record.
    -- Surfaced rather than smoothed, because it is the difference between "we
    -- answered in three hours" and "we do not know".
    (p_action IN ('resolve','close') AND v_e.first_response_at IS NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_enquiry_transition(uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_enquiry_transition(uuid, text, text, uuid)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. NO ATTRIBUTION WRITER - deliberately, and it needs a decision first
-- ----------------------------------------------------------------------------
-- enquiry_to_customer_rate (§5.8) needs converted_order_id and converted_at
-- written when a payment follows an enquiry. 012 built those columns and
-- nothing has ever written them, so today the metric is a permanent zero -
-- which A13 must report as NOT_IMPLEMENTED, exactly the choice A15 already
-- makes for stripe_reconciliation, rather than as a 0% that reads as a finding.
--
-- The obvious writer (this migration, called from recordPurchase) was written,
-- measured against the live schema, and then removed. The reason is worth
-- keeping, because it is not obvious and it will come back:
--
--   enquiries.converted_order_id references public.purchases(id), and a
--   SUBSCRIPTION payment never creates a purchases row - it writes to
--   public.subscriptions. So attributing only where a purchases row exists
--   would credit one-time packs and systematically exclude the Unlimited
--   monthly and annual plans, which /pricing presents as the primary product.
--   The rate would then be a number that is not merely imprecise but biased
--   toward the smaller revenue path, and it would look like a measurement.
--
--   Making it correct needs one of:
--     a) a purchases row per subscription period (touches revenue bookkeeping,
--        and A8/A9 in P4 would have to agree to it);
--     b) a generalised converted_ref, which requires relaxing 012's
--        enquiries_converted_has_order CHECK - a change to a released
--        constraint, not an additive migration;
--     c) a second nullable converted_subscription_id, which splits the metric
--        in two and doubles the number of ways it can be quoted wrongly.
--
--   (b) is the smallest honest fix and is what Phase C should propose. It is
--   raised as a new open question rather than decided here because relaxing a
--   CHECK on a table holding customer complaints is a schema decision, not a
--   reporting one.
--
-- The function written during this session is dropped below so a replay
-- converges to the shipped state rather than leaving a half-correct attribution
-- routine that nothing calls and that would silently mis-credit subscriptions
-- if someone wired it up later.
DROP FUNCTION IF EXISTS public.attribute_enquiry_conversion(uuid, uuid);


-- (No attribution writer ships here. See the section header above.)


-- ----------------------------------------------------------------------------
-- 5. admin_enquiry_counts - the queue header, in one round trip
-- ----------------------------------------------------------------------------
-- The header decides whether an operator opens the queue today, so the numbers
-- behind that judgement come from the same definition the rows use. Two
-- formulas for "breached" on one screen is a report that argues with itself.
CREATE OR REPLACE FUNCTION public.admin_enquiry_counts()
RETURNS TABLE(
  open_total         bigint,
  breached           bigint,
  at_risk            bigint,
  unrecorded_open    bigint,
  oldest_age_minutes integer,
  sla_minutes        integer,
  sla_is_confirmed   boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT
    COUNT(*) FILTER (WHERE q.status NOT IN ('resolved','closed','spam'))::bigint,
    COUNT(*) FILTER (WHERE q.status NOT IN ('resolved','closed','spam')
                       AND q.sla_state = 'breached')::bigint,
    COUNT(*) FILTER (WHERE q.status NOT IN ('resolved','closed','spam')
                       AND q.sla_state = 'at_risk')::bigint,
    -- Open, past the window, and no reply recorded yet: these become
    -- 'unrecorded' silently if nobody acts, so they are counted apart from a
    -- plain backlog.
    COUNT(*) FILTER (WHERE q.status NOT IN ('resolved','closed','spam')
                       AND q.first_response_at IS NULL
                       AND q.age_minutes > q.sla_minutes)::bigint,
    COALESCE(MAX(q.age_minutes) FILTER (
      WHERE q.status NOT IN ('resolved','closed','spam'))::integer, 0),
    MAX(q.sla_minutes),
    BOOL_AND(q.sla_is_confirmed)
  FROM public.admin_enquiry_queue(NULL, NULL, false, 200, 0) q;
$$;

REVOKE ALL ON FUNCTION public.admin_enquiry_counts()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_enquiry_counts()
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. Comments
-- ----------------------------------------------------------------------------
COMMENT ON TABLE reporting.enquiry_thresholds IS
  'A13 configuration singleton, discovered by the *_thresholds convention in scripts/rebaseline_schema.py. sla_is_confirmed = false records the open question A-15/Q-5: the response promise is published on /contact, its basis is not yet a business decision, and the breach rate is provisional until it is.';

COMMENT ON FUNCTION public.admin_enquiry_queue(text, text, boolean, integer, integer) IS
  'Admin support queue. Returns no contact column: reading an enquirer email or message body goes through read_enquiry_contact(), which audits the access. sla_state is computed here so the queue and A13 cannot disagree about what breached means.';

COMMENT ON FUNCTION public.admin_enquiry_transition(uuid, text, text, uuid) IS
  'The only writer of enquiries.first_response_at and enquiries.resolved_at. Takes an action verb and derives the status, so the table cannot be placed in a state the workflow does not mean. A first response is recorded only by the reply action, never inferred from resolution and never back-filled after closure - see migration 104 header, section 2.';






