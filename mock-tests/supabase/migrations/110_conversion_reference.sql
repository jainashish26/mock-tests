-- ============================================================================
-- 110 - Conversion references (decision 2-A, question Q-13)
--
-- WHY THE OLD CHECK MADE A13'S SECOND QUESTION UNANSWERABLE
--   A13 asks "are enquiries answered in time, AND DO THEY CONVERT?" The second
--   half was not merely unmeasured, it was unreachable: 012's
--   enquiries_converted_has_order CHECK required converted_order_id whenever
--   converted_at was set, and that column is a foreign key to public.purchases.
--   Subscription payments - the primary product, and the one the support queue
--   exists to convert people into - do not write a purchases row. So recording
--   "this enquiry became a subscriber" was rejected by the database for the
--   majority of revenue, and any rate computed anyway was biased against the
--   product it was meant to measure.
--
--   This is why the attribution writer built during Phase B was removed rather
--   than shipped: a metric that can only ever fire on the minority purchase path
--   is worse than an absent one, because it reads as a measurement.
--
-- WHAT IS ADDED, AND WHY IT IS A REFERENCE RATHER THAN A FOREIGN KEY
--   converted_ref / converted_ref_kind let an enquiry point at any order-like
--   thing (a purchase, a subscription, an invoice) by its external identifier.
--   Deliberately NOT a FK: those identifiers live on three different tables and
--   partly outside Postgres entirely (Stripe ids), and inventing a polymorphic
--   FK would be the schema lying about its own referential integrity.
--
-- CONVERSIONS ARE RECORDED, NEVER INFERRED
--   An enquiry with a parent_user_id and a later subscription is a *plausible*
--   conversion, not an observed one, and that difference is the whole integrity
--   of the metric - the same rule that stopped first_response_at from ever being
--   back-filled in 104 section 2. So the only writer is an explicit `convert`
--   action by an admin, and `unconvert` exists because a record that cannot be
--   corrected is a record that will be entered carelessly.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Columns
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='enquiries'
                   AND column_name='converted_ref') THEN
    ALTER TABLE public.enquiries ADD COLUMN converted_ref text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='enquiries'
                   AND column_name='converted_ref_kind') THEN
    ALTER TABLE public.enquiries ADD COLUMN converted_ref_kind text;
  END IF;
END $$;

COMMENT ON COLUMN public.enquiries.converted_ref IS
  'External reference for the order this enquiry became when it is not a purchases row: a subscription id, an invoice id, or a purchase id. Recorded by an admin, never inferred.';

COMMENT ON COLUMN public.enquiries.converted_ref_kind IS
  'What converted_ref points at: purchase | subscription | invoice | other. Required whenever converted_ref is set, because a bare identifier with no stated type cannot be checked later by anyone, including whoever wrote it.';

-- ----------------------------------------------------------------------------
-- 2. Constraints - relaxed, but not loosened into meaninglessness
-- ----------------------------------------------------------------------------
-- The original CHECK is replaced under the SAME name so the baseline captures and
-- the assurance checks keep referring to one constraint instead of accumulating
-- near-identical variants.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.enquiries'::regclass
                                           AND conname='enquiries_converted_has_order') THEN
    ALTER TABLE public.enquiries DROP CONSTRAINT enquiries_converted_has_order;
  END IF;

  ALTER TABLE public.enquiries
    ADD CONSTRAINT enquiries_converted_has_order CHECK (
      converted_at IS NULL
      OR converted_order_id IS NOT NULL
      OR converted_ref IS NOT NULL
    );

  -- These three are dropped and re-added every time rather than guarded with
  -- IF NOT EXISTS. A constraint whose definition is being corrected would
  -- otherwise be silently skipped on any database where an earlier apply created
  -- the old version, leaving the file and the live schema disagreeing forever.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.enquiries'::regclass
                                           AND conname='enquiries_conversion_reference_sane') THEN
    ALTER TABLE public.enquiries DROP CONSTRAINT enquiries_conversion_reference_sane;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.enquiries'::regclass
                                           AND conname='enquiries_conversion_reference_needs_ref') THEN
    ALTER TABLE public.enquiries DROP CONSTRAINT enquiries_conversion_reference_needs_ref;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.enquiries'::regclass
                                           AND conname='enquiries_conversion_needs_when') THEN
    ALTER TABLE public.enquiries DROP CONSTRAINT enquiries_conversion_needs_when;
  END IF;

  -- NULL-safe by construction. `converted_ref_kind IN (...)` is NULL, not false,
  -- when the kind is NULL, and a CHECK accepts NULL - so the obvious wording of
  -- this rule silently passed the exact row it exists to refuse. The apply-time
  -- self-test below is what caught it, and it is asserted with an explicit
  -- IS NOT NULL rather than relying on the IN list to fail closed.
  ALTER TABLE public.enquiries
    ADD CONSTRAINT enquiries_conversion_reference_sane CHECK (
      converted_ref IS NULL
      OR (
        converted_ref_kind IS NOT NULL
        AND converted_ref_kind IN ('purchase','subscription','invoice','other')
        -- A reference of only spaces is not a reference; it is a future
        -- "we could not find it" enquiry about a support enquiry.
        AND length(btrim(converted_ref)) BETWEEN 1 AND 200
      )
    );
  ALTER TABLE public.enquiries
    ADD CONSTRAINT enquiries_conversion_reference_needs_ref CHECK (
      converted_ref_kind IS NULL OR converted_ref IS NOT NULL
    );

  -- A conversion without a moment is not a conversion, it is a note. The
  -- original CHECK could only say "if there is a when there must be a what",
  -- never the converse.
  ALTER TABLE public.enquiries
    ADD CONSTRAINT enquiries_conversion_needs_when CHECK (
      (converted_order_id IS NULL AND converted_ref IS NULL)
      OR converted_at IS NOT NULL
    );
END $$;

-- A relaxation is only real if the previously-impossible row now lands, and the
-- guards still guard. Proven at apply time against the live table rather than
-- asserted in a comment.
--
-- Each refusal is matched by CONSTRAINT NAME, not merely by "some check
-- fired". Without that, an unrelated constraint rejecting the row - and there are
-- five on this table - would be counted as the guard working, and the test would
-- pass while proving nothing. Every probe therefore carries a valid outcome so
-- the only constraint able to fire is the one under test.
DO $$
DECLARE
  v_id      uuid;
  v_ok      boolean := false;
  v_wrong   integer := 0;
  v_expected text;
  v_got text;
  v_probe text;
BEGIN
  -- 1. The subscription conversion that 012 made impossible.
  INSERT INTO public.enquiries
    (channel, enquiry_type, status, outcome, converted_at, converted_ref, converted_ref_kind)
  VALUES ('web_form','product_question','closed','answered', now(), 'sub_selftest_110','subscription')
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    v_ok := true;
  END IF;
  DELETE FROM public.enquiries WHERE id = v_id;

  -- 2..5: each must be refused by the NAMED constraint.
  FOREACH v_probe IN ARRAY ARRAY[
    'no_kind', 'no_when', 'blank_ref', 'when_without_what'
  ] LOOP
    BEGIN
      IF v_probe = 'no_kind' THEN
        v_expected := 'enquiries_conversion_reference_sane';
        INSERT INTO public.enquiries (channel,enquiry_type,status,outcome,converted_at,converted_ref,converted_ref_kind)
        VALUES ('web_form','other','closed','answered', now(), 'sub_nokind', NULL);
      ELSIF v_probe = 'no_when' THEN
        v_expected := 'enquiries_conversion_needs_when';
        INSERT INTO public.enquiries (channel,enquiry_type,status,outcome,converted_ref,converted_ref_kind)
        VALUES ('web_form','other','closed','answered', 'sub_nowhen','subscription');
      ELSIF v_probe = 'blank_ref' THEN
        v_expected := 'enquiries_conversion_reference_sane';
        INSERT INTO public.enquiries (channel,enquiry_type,status,outcome,converted_at,converted_ref,converted_ref_kind)
        VALUES ('web_form','other','closed','answered', now(), '   ','invoice');
      ELSE
        v_expected := 'enquiries_converted_has_order';
        INSERT INTO public.enquiries (channel,enquiry_type,status,outcome,converted_at)
        VALUES ('web_form','other','closed','answered', now());
      END IF;
      -- Reached only if nothing refused the row.
      v_wrong := v_wrong + 1;
      RAISE NOTICE '110 self-test: probe % was accepted but should not be', v_probe;
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_got = CONSTRAINT_NAME;
      IF v_got IS DISTINCT FROM v_expected THEN
        v_wrong := v_wrong + 1;
        RAISE NOTICE '110 self-test: probe % rejected by % instead of %',
          v_probe, v_got, v_expected;
      END IF;
    END;
  END LOOP;

  IF NOT v_ok OR v_wrong <> 0 THEN
    RAISE EXCEPTION
      '110 self-test failed: widened path accepted=% wrongly-handled probes=%',
      v_ok, v_wrong
      USING ERRCODE = 'raise_exception';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. The convert / unconvert actions
-- ----------------------------------------------------------------------------
-- DROP before CREATE: the return type gains columns and Postgres refuses to
-- change the return type of an existing function (42P13). Dependencies were
-- re-measured against the live catalog before this was written, exactly as 104
-- did for its own drop: dependent views/materialised views 0, other function
-- bodies calling it 0, cron jobs mentioning it 0. The REVOKE/GRANT pair below
-- re-applies the lock-down in the same migration, and no table rows are rewritten.
--
-- Conversion deliberately does not change the enquiry's status. A family can
-- subscribe while a question is still open, so forcing an admin to resolve first
-- would make the timestamp measure the paperwork rather than the decision.
DROP FUNCTION IF EXISTS public.admin_enquiry_transition(uuid, text, text, uuid);

CREATE OR REPLACE FUNCTION public.admin_enquiry_transition(
  p_enquiry_id   uuid,
  p_action       text,
  p_outcome      text   DEFAULT NULL,
  p_assignee     uuid   DEFAULT NULL,
  p_convert_ref  text   DEFAULT NULL,
  p_convert_kind text   DEFAULT NULL
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
  response_was_missing boolean,
  converted_at         timestamptz,
  converted_ref        text,
  converted_ref_kind   text,
  conversion_recorded  boolean,
  conversion_withdrawn boolean
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $t$
DECLARE
  v_now      timestamptz := now();
  v_e        public.enquiries%ROWTYPE;
  v_target   text;
  v_new_fr   timestamptz;
  v_new_res  timestamptz;
  v_new_conv timestamptz;
  v_new_ref  text;
  v_new_kind text;
BEGIN
  IF NOT public.has_role('ADMIN') THEN
    RAISE EXCEPTION 'only an administrator can change an enquiry''s status'
      USING ERRCODE = '42501';
  END IF;

  IF p_action IS NULL OR p_action NOT IN
     ('triage','start','reply','resolve','close','reopen','assign','spam',
      'convert','unconvert') THEN
    RAISE EXCEPTION 'unknown enquiry action: %', p_action USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_e FROM public.enquiries WHERE id = p_enquiry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such enquiry' USING ERRCODE = 'P0002';
  END IF;

  v_target   := v_e.status;
  v_new_fr   := v_e.first_response_at;
  v_new_res  := v_e.resolved_at;
  -- Carried forward so an unrelated action preserves a conversion recorded
  -- weeks ago instead of silently blanking it.
  v_new_conv := v_e.converted_at;
  v_new_ref  := v_e.converted_ref;
  v_new_kind := v_e.converted_ref_kind;

  CASE p_action
    WHEN 'triage'  THEN v_target := 'triaged';
    WHEN 'start'   THEN v_target := 'in_progress';
    WHEN 'reply'   THEN v_target := 'waiting_on_customer';
    WHEN 'resolve' THEN v_target := 'resolved';
    WHEN 'close'   THEN v_target := 'closed';
    WHEN 'reopen'  THEN v_target := 'in_progress';
    WHEN 'spam'    THEN v_target := 'spam';
    -- Assignment and conversion move the record without moving the queue.
    WHEN 'assign'    THEN v_target := v_e.status;
    WHEN 'convert'   THEN v_target := v_e.status;
    WHEN 'unconvert' THEN v_target := v_e.status;
  END CASE;

  IF p_action = 'reply' THEN
    IF v_e.first_response_at IS NOT NULL THEN
      RAISE EXCEPTION 'the first response was already recorded at %',
        v_e.first_response_at USING ERRCODE = '22023';
    END IF;
    IF v_e.resolved_at IS NOT NULL OR v_e.status IN ('resolved','closed') THEN
      RAISE EXCEPTION
        'cannot record a first response after an enquiry is resolved or closed; '
        'the response was never recorded, and A13 reports it as such'
        USING ERRCODE = '22023';
    END IF;
    v_new_fr := v_now;
  END IF;

  IF p_action IN ('resolve','close') THEN
    IF p_outcome IS NULL OR p_outcome NOT IN
       ('answered','refunded','escalated','no_action','spam','duplicate','withdrawn') THEN
      RAISE EXCEPTION 'resolving or closing requires a valid outcome'
        USING ERRCODE = '22023';
    END IF;
    v_new_res := COALESCE(v_e.resolved_at, v_now);
  END IF;

  IF p_action = 'spam' THEN
    v_new_res := COALESCE(v_e.resolved_at, v_now);
  END IF;

  IF p_action = 'reopen' THEN
    v_new_res := NULL;
  END IF;

  IF p_action = 'assign' AND p_assignee IS NULL THEN
    RAISE EXCEPTION 'the assign action needs an assignee' USING ERRCODE = '22023';
  END IF;

  IF p_action = 'convert' THEN
    -- Refused rather than rounded: a spam row that "converted" is the metric
    -- being fed by the queue's own rubbish, and nobody would ever notice.
    IF v_e.status = 'spam' THEN
      RAISE EXCEPTION 'a spam enquiry cannot be recorded as a conversion'
        USING ERRCODE = '22023';
    END IF;
    IF p_convert_ref IS NULL OR length(btrim(p_convert_ref)) = 0 THEN
      RAISE EXCEPTION 'the convert action needs the order reference it points at'
        USING ERRCODE = '22023';
    END IF;
    IF p_convert_kind IS NULL OR p_convert_kind NOT IN
       ('purchase','subscription','invoice','other') THEN
      RAISE EXCEPTION
        'the convert action needs a reference kind of purchase, subscription, invoice or other'
        USING ERRCODE = '22023';
    END IF;
    -- First conversion wins on the timestamp: re-recording corrects what it
    -- points at, it does not move when the family actually decided.
    v_new_conv := COALESCE(v_e.converted_at, v_now);
    v_new_ref  := btrim(p_convert_ref);
    v_new_kind := p_convert_kind;
  END IF;

  IF p_action = 'unconvert' THEN
    v_new_conv := NULL;
    v_new_ref  := NULL;
    v_new_kind := NULL;
  END IF;

  -- Every right-hand reference is table-qualified: RETURNS TABLE turns each
  -- output column into a plpgsql variable, so a bare `converted_at` here would be
  -- ambiguous between the OUT parameter and the column (42702).
  UPDATE public.enquiries AS e
     SET status             = v_target,
         first_response_at  = v_new_fr,
         resolved_at        = v_new_res,
         outcome            = COALESCE(p_outcome,
                            CASE WHEN p_action = 'spam' THEN 'spam' ELSE e.outcome END),
         assigned_to        = COALESCE(p_assignee, e.assigned_to),
         converted_at       = v_new_conv,
         converted_ref      = v_new_ref,
         converted_ref_kind = v_new_kind,
         updated_at         = v_now
   WHERE e.id = p_enquiry_id;

  RETURN QUERY
  SELECT
    p_enquiry_id,
    v_target,
    COALESCE(p_outcome,
      CASE WHEN p_action = 'spam' THEN 'spam' ELSE v_e.outcome END),
    v_new_fr,
    -- Minutes, not seconds (see the units note in admin_enquiry_queue).
    CASE WHEN v_new_fr IS NULL THEN NULL
         ELSE (EXTRACT(EPOCH FROM (v_new_fr - v_e.received_at)) / 60)::int END,
    v_new_res,
    CASE WHEN v_new_res IS NULL OR v_new_fr IS NULL THEN NULL
         ELSE ROUND(EXTRACT(EPOCH FROM (v_new_res - v_e.received_at)) / 3600, 2) END,
    (p_action = 'reply' AND v_e.first_response_at IS NULL),
    (p_action IN ('resolve','close') AND v_e.first_response_at IS NULL),
    v_new_conv,
    v_new_ref,
    v_new_kind,
    -- Only this call recording a first-ever conversion should fire the event.
    (p_action = 'convert' AND v_e.converted_at IS NULL),
    (p_action = 'unconvert' AND v_e.converted_at IS NOT NULL);
END;
$t$;

REVOKE ALL ON FUNCTION public.admin_enquiry_transition(uuid, text, text, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_enquiry_transition(uuid, text, text, uuid, text, text)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. The queue's converted flag
-- ----------------------------------------------------------------------------
-- admin_enquiry_queue reported `converted` as converted_order_id IS NOT NULL.
-- With the reference path now open, that expression would keep returning false
-- for exactly the subscription conversions this migration exists to allow - the
-- card would show nothing while the row carried a recorded conversion.
--
-- Body-only change plus two new output columns, so this is a DROP rather than a
-- CREATE OR REPLACE: Postgres refuses to change the return type of an existing
-- function (42P13), and the columns are needed because asking an operator to
-- withdraw a conversion they cannot see - what it points at, when - is a
-- destructive button with no context behind it.
DROP FUNCTION IF EXISTS public.admin_enquiry_queue(text, text, boolean, integer, integer);

CREATE FUNCTION public.admin_enquiry_queue(
  p_status     text    DEFAULT NULL,
  p_type       text    DEFAULT NULL,
  p_unanswered boolean DEFAULT false,
  p_limit      integer DEFAULT 50,
  p_offset     integer DEFAULT 0
)
RETURNS TABLE(
  enquiry_id uuid, channel text, enquiry_type text, status text, outcome text,
  received_at timestamptz, first_response_at timestamptz, resolved_at timestamptz,
  assigned_to uuid, parent_user_id uuid, converted boolean,
  age_minutes integer, response_minutes integer, resolution_hours numeric,
  sla_minutes integer, sla_state text, sla_is_confirmed boolean, utm_source text,
  due_at timestamptz, sla_basis text, sla_business_days integer,
  converted_ref text, converted_ref_kind text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $q$
BEGIN
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
    e.id, e.channel, e.enquiry_type, e.status, e.outcome,
    e.received_at, e.first_response_at, e.resolved_at,
    e.assigned_to, e.parent_user_id,
    -- Either path counts. An enquiry that points at a subscription is converted
    -- as fully as one that points at a purchases row.
    (e.converted_order_id IS NOT NULL OR e.converted_ref IS NOT NULL),
    (EXTRACT(EPOCH FROM (now() - e.received_at)) / 60)::int,
    (EXTRACT(EPOCH FROM (e.first_response_at - e.received_at)) / 60)::int,
    CASE WHEN e.resolved_at IS NULL OR e.first_response_at IS NULL THEN NULL
         ELSE ROUND(EXTRACT(EPOCH FROM (e.resolved_at - e.received_at)) / 3600, 2) END,
    CASE WHEN th.sla_basis = 'calendar' THEN th.first_response_sla_minutes END,
    CASE
      WHEN e.status IN ('resolved','closed') AND e.first_response_at IS NULL
        THEN 'unrecorded'
      WHEN d.due_at IS NULL
        THEN 'unknown_calendar'
      WHEN e.first_response_at IS NOT NULL
        THEN CASE WHEN e.first_response_at <= d.due_at THEN 'met' ELSE 'breached' END
      WHEN now() > d.due_at THEN 'breached'
      WHEN now() > e.received_at + ((d.due_at - e.received_at) * 0.75) THEN 'at_risk'
      ELSE 'within'
    END,
    th.sla_is_confirmed,
    e.utm_source,
    d.due_at,
    th.sla_basis,
    CASE WHEN th.sla_basis = 'business' THEN th.first_response_sla_business_days END,
    -- Table-qualified: RETURNS TABLE turns converted_ref into an OUT variable, so
    -- a bare reference here is ambiguous with the column (42702).
    e.converted_ref,
    e.converted_ref_kind
  FROM public.enquiries e
  CROSS JOIN reporting.enquiry_thresholds th
  CROSS JOIN LATERAL (
    SELECT CASE
             WHEN th.sla_basis = 'business'
               THEN reporting.business_day_deadline(e.received_at)
             ELSE e.received_at + make_interval(mins => th.first_response_sla_minutes)
           END AS due_at
  ) d
  WHERE th.id = 1
    AND (p_status IS NULL OR e.status = p_status)
    AND (p_status IS NOT NULL OR e.status <> 'spam')
    AND (p_type IS NULL OR e.enquiry_type = p_type)
    AND (NOT p_unanswered OR e.first_response_at IS NULL)
  ORDER BY e.received_at ASC
  LIMIT p_limit OFFSET p_offset;
END;
$q$;

REVOKE ALL ON FUNCTION public.admin_enquiry_queue(text, text, boolean, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_enquiry_queue(text, text, boolean, integer, integer)
  TO authenticated, service_role;
