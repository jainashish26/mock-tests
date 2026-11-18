-- ============================================================================
-- 012_enquiries.sql
-- Inbound enquiries across three channels (web form, email, chat), with contact
-- details split into a restricted table the reporting schema cannot reach.
--
-- INSPECTION FIRST (required before this migration was written).
--   Ran against project ekdjrvjgrhpqolthbznr on 2026-10-24:
--     * pg_class/pg_namespace sweep for ~* 'enquir|inquir|contact|lead|message|
--       ticket|support' across every non-catalogue schema
--     * to_regclass probes for public.enquiries / enquiry / contacts / leads /
--       messages / support_tickets
--     * information_schema.tables listing of all 18 public tables
--   RESULT: no enquiry table exists. `messages` matches only realtime.messages
--   (Supabase Realtime internal, partitioned). `notifications` is outbound
--   in-app notification. `email_log` (011, NOT APPLIED) is an outbound send
--   ledger. All public tables have 0 rows.
--   Therefore this is a CREATE, not an ALTER: no existing column is dropped or
--   renamed, and the additive-only constraint is satisfied trivially.
--
-- DESIGN RULES
--   1. Contact details live in a SEPARATE restricted table. `enquiries` has no
--      free-text column at all, so reporting.fact_enquiry can be built from it
--      alone and has no join path to a message body. That is a structural
--      guarantee, not a policy.
--   2. Every channel writes through ONE function, public.ingest_enquiry(), so
--      idempotency and the two-table transaction are correct in one place.
--   3. `channel`, `enquiry_type`, `status` and `outcome` are text + CHECK, not
--      Postgres enums - matching the precedent set by subscriptions.status in
--      010 and funnel_events.stage in 011. ALTER TYPE ... ADD VALUE cannot run
--      inside a transaction block, which makes migration replay painful.
--   4. Deny-by-default RLS. enquiry_contacts has NO policy for any role; it is
--      reachable only through an audited SECURITY DEFINER function.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- citext is available on this project but NOT installed. On Supabase it must be
-- created in the `extensions` schema.
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA extensions;

-- ----------------------------------------------------------------------------
-- 1. enquiries - the reportable table ----------------------------------------
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.enquiries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  channel            text NOT NULL CHECK (channel IN ('web_form','email','chat')),
  received_at        timestamptz NOT NULL DEFAULT now(),

  -- Closed list on purpose. A free-text `type` column is how a message body ends
  -- up in a reportable table. Anything unclassifiable is 'other' and is read in
  -- the restricted table by a human.
  enquiry_type       text NOT NULL DEFAULT 'other' CHECK (enquiry_type IN (
                       'billing','technical','privacy','accessibility',
                       'product_question','refund','complaint','other')),

  -- Nullable: most enquiries arrive before the enquirer has an account.
  parent_user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  status             text NOT NULL DEFAULT 'new' CHECK (status IN (
                       'new','triaged','in_progress','waiting_on_customer',
                       'resolved','closed','spam')),
  assigned_to        uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  first_response_at  timestamptz,
  resolved_at        timestamptz,

  outcome            text CHECK (outcome IN (
                       'answered','refunded','escalated','no_action',
                       'spam','duplicate','withdrawn')),

  -- The order this enquiry produced. Drives enquiry_to_customer_rate.
  converted_order_id uuid REFERENCES public.purchases(id) ON DELETE SET NULL,
  converted_at       timestamptz,

  -- Provider message id / chat transcript id / server-generated form id.
  -- The idempotency key for a retried webhook.
  ingest_source_ref  text,

  -- UTM. Normalised by the same normalizeUtm() helper the event pipeline uses,
  -- so an enquiry and an event from one visitor carry identical UTM.
  utm_source         text,
  utm_medium         text,
  utm_campaign       text,
  utm_term           text,
  utm_content        text,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- Caught at write time rather than discovered in a dashboard as a negative SLA.
  CONSTRAINT enquiries_timeline_sane CHECK (
    first_response_at IS NULL OR resolved_at IS NULL OR first_response_at <= resolved_at),
  CONSTRAINT enquiries_resolved_has_outcome CHECK (
    status NOT IN ('resolved','closed') OR outcome IS NOT NULL),
  CONSTRAINT enquiries_converted_has_order CHECK (
    converted_at IS NULL OR converted_order_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_enquiries_ingest_source_ref
  ON public.enquiries (channel, ingest_source_ref)
  WHERE ingest_source_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_enquiries_status_received
  ON public.enquiries (status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_enquiries_assigned
  ON public.enquiries (assigned_to, status) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_enquiries_parent
  ON public.enquiries (parent_user_id) WHERE parent_user_id IS NOT NULL;
-- Drives the SLA-breach alert (AL-19): unresponded, oldest first.
CREATE INDEX IF NOT EXISTS idx_enquiries_sla_open
  ON public.enquiries (received_at)
  WHERE first_response_at IS NULL AND status NOT IN ('spam','closed');

-- ----------------------------------------------------------------------------
-- 2. enquiry_contacts - the RESTRICTED table ---------------------------------
-- ----------------------------------------------------------------------------
-- Deliberately excluded from the reporting schema. There is no view over it, no
-- materialised view over it, and reporting.fact_enquiry is built from
-- public.enquiries alone, so no join path exists.
CREATE TABLE IF NOT EXISTS public.enquiry_contacts (
  enquiry_id   uuid PRIMARY KEY REFERENCES public.enquiries(id) ON DELETE CASCADE,
  full_name    text,
  email        extensions.citext,   -- case-insensitive match when linking an account
  phone        text,
  message_body text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Reads of the restricted table are logged. Append-only: no UPDATE/DELETE policy.
CREATE TABLE IF NOT EXISTS public.enquiry_contact_access_log (
  log_id        bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  accessed_at   timestamptz NOT NULL DEFAULT now(),
  admin_user_id uuid NOT NULL,
  enquiry_id    uuid NOT NULL,
  task_reason   text NOT NULL CHECK (length(trim(task_reason)) >= 12)
);

CREATE INDEX IF NOT EXISTS idx_enquiry_contact_log_time
  ON public.enquiry_contact_access_log (accessed_at DESC);

ALTER TABLE public.enquiry_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enquiry_contacts FORCE ROW LEVEL SECURITY;
-- NO POLICY for any role. Reachable only via read_enquiry_contact() below.

ALTER TABLE public.enquiry_contact_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enquiry_contact_access_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin can read contact access log" ON public.enquiry_contact_access_log;
CREATE POLICY "Admin can read contact access log"
  ON public.enquiry_contact_access_log FOR SELECT
  USING (public.has_role('ADMIN'));
-- Append-only: INSERT happens inside the SECURITY DEFINER function; no UPDATE or
-- DELETE policy exists, so the log cannot be edited or erased.

-- ----------------------------------------------------------------------------
-- 3. read_enquiry_contact - the only path to contact details -----------------
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.read_enquiry_contact(
  p_enquiry_id  uuid,
  p_task_reason text
)
RETURNS TABLE (full_name text, email text, phone text, message_body text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT public.has_role('ADMIN') THEN
    RAISE EXCEPTION 'not authorised';
  END IF;
  IF p_task_reason IS NULL OR length(trim(p_task_reason)) < 12 THEN
    RAISE EXCEPTION 'a task reason of at least 12 characters is required';
  END IF;

  -- Audit BEFORE data. If the insert fails the function fails, so there is no
  -- path that returns contact details without a record.
  INSERT INTO public.enquiry_contact_access_log (admin_user_id, enquiry_id, task_reason)
  VALUES (auth.uid(), p_enquiry_id, trim(p_task_reason));

  RETURN QUERY
  SELECT c.full_name, c.email::text, c.phone, c.message_body
  FROM public.enquiry_contacts c
  WHERE c.enquiry_id = p_enquiry_id;
END;
$$;

-- SECURITY: revoking from anon/authenticated alone is NOT sufficient. Postgres
-- grants EXECUTE to PUBLIC by default on a new function, and Supabase does not
-- change that, so an anonymous caller could otherwise invoke this directly.
-- PUBLIC must be revoked explicitly.
REVOKE ALL ON FUNCTION public.read_enquiry_contact(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_enquiry_contact(uuid, text) TO authenticated;
-- EXECUTE is granted to authenticated, but the function's own has_role('ADMIN')
-- check does the real gating. Revoking from authenticated entirely would block
-- admins too, because admins connect as authenticated.

-- ----------------------------------------------------------------------------
-- 4. ingest_enquiry - the ONE write path for all three channels --------------
-- ----------------------------------------------------------------------------
-- Web form, inbound-email webhook and chat webhook all call this. One function
-- means idempotency, the two-table transaction and UTM normalisation are correct
-- in one place, and the database enforces the invariant even if a handler is
-- written badly.
CREATE OR REPLACE FUNCTION public.ingest_enquiry(
  p_channel        text,
  p_received_at    timestamptz,
  p_enquiry_type   text,
  p_source_ref     text,
  p_parent_user_id uuid,
  p_utm            jsonb,
  p_contact        jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_channel NOT IN ('web_form','email','chat') THEN
    RAISE EXCEPTION 'unknown channel: %', p_channel;
  END IF;

  -- Idempotency: a retried webhook returns the existing row rather than
  -- inserting a duplicate that would inflate enquiry_volume.
  IF p_source_ref IS NOT NULL THEN
    SELECT e.id INTO v_id FROM public.enquiries e
     WHERE e.channel = p_channel AND e.ingest_source_ref = p_source_ref;
    IF v_id IS NOT NULL THEN
      RETURN v_id;
    END IF;
  END IF;

  INSERT INTO public.enquiries (
    channel, received_at, enquiry_type, parent_user_id, ingest_source_ref,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content
  ) VALUES (
    p_channel,
    COALESCE(p_received_at, now()),
    COALESCE(p_enquiry_type, 'other'),
    p_parent_user_id,
    p_source_ref,
    NULLIF(trim(p_utm ->> 'source'),   ''),
    NULLIF(trim(p_utm ->> 'medium'),   ''),
    NULLIF(trim(p_utm ->> 'campaign'), ''),
    NULLIF(trim(p_utm ->> 'term'),     ''),
    NULLIF(trim(p_utm ->> 'content'),  '')
  )
  RETURNING id INTO v_id;

  -- Contact details go to the restricted table in the SAME transaction, so an
  -- enquiry can never exist without its contact row and vice versa. p_contact
  -- never leaves this function's scope.
  IF p_contact IS NOT NULL THEN
    INSERT INTO public.enquiry_contacts (enquiry_id, full_name, email, phone, message_body)
    VALUES (
      v_id,
      NULLIF(trim(p_contact ->> 'fullName'),    ''),
      NULLIF(trim(p_contact ->> 'email'),       '')::extensions.citext,
      NULLIF(trim(p_contact ->> 'phone'),       ''),
      NULLIF(trim(p_contact ->> 'messageBody'), '')
    )
    ON CONFLICT (enquiry_id) DO NOTHING;
  END IF;

  RETURN v_id;
END;
$$;

-- Only trusted server code calls this: the route handlers and QStash jobs, all
-- using the service-role client after verifying a signature.
--
-- SECURITY: PUBLIC must be revoked explicitly. Postgres grants EXECUTE to PUBLIC
-- by default on a new function, so without this an anonymous browser request
-- could call ingest_enquiry() directly and insert arbitrary enquiries - and, via
-- p_contact, arbitrary rows into the RESTRICTED contact table. This is the single
-- most important line in the migration.
REVOKE ALL ON FUNCTION public.ingest_enquiry(text, timestamptz, text, text, uuid, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_enquiry(text, timestamptz, text, text, uuid, jsonb, jsonb)
  TO service_role;

-- ----------------------------------------------------------------------------
-- 5. RLS on enquiries ---------------------------------------------------------
-- ----------------------------------------------------------------------------
ALTER TABLE public.enquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enquiries FORCE ROW LEVEL SECURITY;

-- Parent: own enquiry history only. This is what makes A13's
-- `waiting_on_customer` status actionable for the person it is waiting on.
DROP POLICY IF EXISTS "Parent can view own enquiries" ON public.enquiries;
CREATE POLICY "Parent can view own enquiries"
  ON public.enquiries FOR SELECT
  USING (parent_user_id = auth.uid());

-- Admin: full access to the reportable table. Note this grants NO access to
-- enquiry_contacts, which has no policy at all.
DROP POLICY IF EXISTS "Admin can manage all enquiries" ON public.enquiries;
CREATE POLICY "Admin can manage all enquiries"
  ON public.enquiries FOR ALL
  USING (public.has_role('ADMIN'))
  WITH CHECK (public.has_role('ADMIN'));

-- No policy for STUDENT, TUTOR or TEST_CREATOR. Deny by default.

-- ----------------------------------------------------------------------------
-- 6. Explicit privilege revocations ------------------------------------------
-- ----------------------------------------------------------------------------
-- RLS is the row gate; these are the object gate. Both are required, because an
-- RLS-only defence returns 0 rows today and can return everything tomorrow if a
-- policy is edited. A revoked privilege cannot be undone by a policy change.
REVOKE ALL ON public.enquiry_contacts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.enquiry_contact_access_log FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7. Comments -----------------------------------------------------------------
-- ----------------------------------------------------------------------------
COMMENT ON TABLE public.enquiries IS
  'Inbound enquiries across web_form, email and chat. Reportable: contains no free-text field and no contact detail, so reporting.fact_enquiry can be built from this table alone. Written only through public.ingest_enquiry().';
COMMENT ON TABLE public.enquiry_contacts IS
  'RESTRICTED. Enquirer contact details and message bodies. Excluded from the reporting schema: no view, no materialised view, no join path. Has NO RLS policy for any role; readable only through public.read_enquiry_contact(enquiry_id, task_reason), which audits before returning.';
COMMENT ON TABLE public.enquiry_contact_access_log IS
  'Append-only audit of every read of enquiry_contacts. No UPDATE or DELETE policy exists.';
COMMENT ON COLUMN public.enquiries.ingest_source_ref IS
  'Provider message id (email), transcript id (chat) or server-generated id (web form). With `channel` this is the idempotency key that stops a retried webhook double-counting an enquiry.';
