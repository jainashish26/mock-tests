-- ============================================================================
-- 114 - Inbound email capture, shipped dark (decision 3-A, question Q-12)
--
-- WHAT Q-12 ASKED
--   Enquiries have a channel CHECK that includes 'email', and A-8 says the
--   support address is placeholder-only with no domain behind it. So there is a
--   value nobody can produce: an email enquiry cannot exist because nothing
--   receives email. Decision 3-A builds the path and ships it switched off, so
--   that enabling the address is a configuration act rather than a project.
--
-- WHY THIS CAPTURES AND DOES NOT CONVERT
--   The instinct is "inbound email arrives, create the enquiry". That would mean
--   writing a parser for a provider payload whose exact shape this repository has
--   never verified against a real delivery - there is no domain, so there has
--   never been a message. Guessing at a wire format and then auto-creating
--   records from it is how a support queue fills with malformed rows attributed
--   to the wrong family.
--
--   So this migration stores what arrives, verbatim, behind an authenticated
--   endpoint, and creates nothing. The first real message can be looked at and
--   the contract confirmed from evidence, at which point conversion is an
--   additive change. Capture is the part that is safe to build before the domain
--   exists; conversion is not.
--
-- TWO SWITCHES, AND WHY BOTH
--   `RESEND_INBOUND_SIGNING_SECRET` must be set or the endpoint answers 503, and
--   `reporting.enquiry_thresholds.inbound_email_enabled` must be true or nothing
--   is stored even when the secret is present. They fail for different reasons -
--   one is deployment, one is a reviewable product decision - and folding them
--   together would mean rotating a secret silently changed whether enquiries
--   were being collected.
--
-- A NOTE ON WHAT IS STORED
--   `payload` is an inbound email from a member of the public. It contains
--   whatever they chose to write. This table is therefore PII-bearing by
--   construction, RLS-forced with no policy, and reachable only through the
--   service role. The retention and deletion story is the same one 12-...md
--   already owes enquiries generally, and shipping dark is not a reason to skip
--   it: the first stored message starts the clock.
--
-- Idempotent: safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.inbound_email_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Provider's own identifier. The uniqueness constraint is what makes a retried
  -- delivery a no-op rather than a second copy of the same complaint.
  provider_message_id text NOT NULL UNIQUE CHECK (btrim(provider_message_id) <> ''),
  from_address        text NOT NULL,
  to_address          text NOT NULL,
  subject             text,
  received_at         timestamptz NOT NULL DEFAULT now(),

  -- Verbatim, not normalised: the parser that turns this into an enquiry does not
  -- exist yet, and normalising now would bake an unverified assumption into
  -- storage where it looks like observed fact.
  payload             jsonb NOT NULL,

  disposition         text NOT NULL DEFAULT 'pending'
                      CHECK (disposition IN ('pending','converted','rejected','ignored')),
  -- Filled only once conversion exists. A NULL here with disposition='pending'
  -- is the honest state, and it is the state every row will be in until a real
  -- message is used to build the parser.
  enquiry_id          uuid REFERENCES public.enquiries(id) ON DELETE SET NULL,
  note                text,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.inbound_email_messages IS
  'Inbound support email captured but NOT yet converted to enquiries (decision 3-A, shipped dark). PII-bearing. RLS enabled and forced with no policy: reachable only via record_inbound_email as service_role. Nothing reads disposition yet; conversion awaits a verified provider contract.';

-- An arbitrary size ceiling, because a webhook that accepts whatever a client
-- posts is a storage-denial primitive and this one is reachable from the internet
-- the moment a secret is configured.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid='public.inbound_email_messages'::regclass
                   AND conname='inbound_email_payload_bounded') THEN
    ALTER TABLE public.inbound_email_messages
      ADD CONSTRAINT inbound_email_payload_bounded
      CHECK (octet_length(payload::text) <= 262144);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid='public.inbound_email_messages'::regclass
                   AND conname='inbound_email_converted_has_enquiry') THEN
    -- The same class of guard as 110's conversion rules: a row may not claim to
    -- be converted without pointing at the enquiry it became.
    ALTER TABLE public.inbound_email_messages
      ADD CONSTRAINT inbound_email_converted_has_enquiry
      CHECK (disposition <> 'converted' OR enquiry_id IS NOT NULL);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid='public.inbound_email_messages'::regclass
                   AND conname='inbound_email_pending_has_no_enquiry') THEN
    ALTER TABLE public.inbound_email_messages
      ADD CONSTRAINT inbound_email_pending_has_no_enquiry
      CHECK (disposition <> 'pending' OR enquiry_id IS NULL);
  END IF;
END $$;

ALTER TABLE public.inbound_email_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_email_messages FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS ix_inbound_email_disposition
  ON public.inbound_email_messages (disposition, received_at);

-- ----------------------------------------------------------------------------
-- The product switch
-- ----------------------------------------------------------------------------
-- A column rather than only an environment variable, because "are we collecting
-- the public's email?" is a decision someone owns, and it belongs next to the
-- other enquiry promises rather than in a deployment setting nobody diffs. It
-- ships false.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='reporting' AND table_name='enquiry_thresholds'
                   AND column_name='inbound_email_enabled') THEN
    ALTER TABLE reporting.enquiry_thresholds
      ADD COLUMN inbound_email_enabled boolean NOT NULL DEFAULT false;
  END IF;
END $$;

COMMENT ON COLUMN reporting.enquiry_thresholds.inbound_email_enabled IS
  'Whether inbound support email is collected at all (decision 3-A). Ships false: the support address has no domain behind it, so no message can arrive. Read by public.record_inbound_email on every delivery. Deliberately separate from the signing-secret gate - that one is deployment, this one is intent.';

-- ----------------------------------------------------------------------------
-- The only writer
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_inbound_email(
  p_provider_message_id text,
  p_from_address        text,
  p_to_address          text,
  p_subject             text    DEFAULT NULL,
  p_received_at         timestamptz DEFAULT now(),
  p_payload             jsonb   DEFAULT '{}'::jsonb
)
RETURNS TABLE(id uuid, created boolean, accepted boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, reporting, pg_catalog
AS $r$
DECLARE
  v_row public.inbound_email_messages%ROWTYPE;
BEGIN
  -- Service-role only by grant, but checked again here: this will be called from
  -- a route handler, and a route that ever forwards a user JWT must not be able
  -- to inject rows into the capture table.
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'inbound email may only be recorded by the service role'
      USING ERRCODE = '42501';
  END IF;

  IF p_provider_message_id IS NULL OR btrim(p_provider_message_id) = '' THEN
    RAISE EXCEPTION 'a provider message id is required' USING ERRCODE = '22023';
  END IF;

  IF NOT (SELECT t.inbound_email_enabled FROM reporting.enquiry_thresholds t WHERE t.id = 1) THEN
    RETURN QUERY SELECT NULL::uuid, false, false, 'disabled'::text;
    RETURN;
  END IF;

  INSERT INTO public.inbound_email_messages
    (provider_message_id, from_address, to_address, subject, received_at, payload)
  VALUES
    (btrim(p_provider_message_id), lower(btrim(p_from_address)), lower(btrim(p_to_address)),
     nullif(btrim(coalesce(p_subject,'')), ''), p_received_at, coalesce(p_payload, '{}'::jsonb))
  ON CONFLICT (provider_message_id) DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    -- A retry, not an error: accepted so the provider stops redelivering,
    -- created=false so the log cannot claim a new message arrived.
    SELECT m.id INTO v_row.id
    FROM public.inbound_email_messages m
    WHERE m.provider_message_id = btrim(p_provider_message_id);
    RETURN QUERY SELECT v_row.id, false, true, 'duplicate'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT v_row.id, true, true, 'stored'::text;
END;
$r$;

REVOKE ALL ON FUNCTION public.record_inbound_email(text,text,text,text,timestamptz,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_inbound_email(text,text,text,text,timestamptz,jsonb)
  TO service_role;
REVOKE ALL ON public.inbound_email_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.inbound_email_messages TO service_role;

-- ----------------------------------------------------------------------------
-- Self-check
-- ----------------------------------------------------------------------------
-- The important property is the last one: after this migration runs, collection
-- is still OFF. A self-test that left the feature enabled would ship the opposite
-- of decision 3-A and report success doing it.
DO $$
DECLARE
  v_id  uuid;
  v_cnt integer;
  v_from text;
  v_r   record;
BEGIN
  -- 1. Disabled by default: nothing is stored, and the reason says why.
  SELECT * INTO v_r FROM public.record_inbound_email(
    'probe114-a','Family@example.invalid','support@example.invalid',
    'Question', now(), '{"text":"probe"}'::jsonb);
  IF v_r.accepted OR v_r.created OR v_r.reason <> 'disabled' THEN
    RAISE EXCEPTION '114 self-test: capture accepted mail while disabled (%/%/%)',
      v_r.id, v_r.created, v_r.reason USING ERRCODE = 'raise_exception';
  END IF;
  SELECT COUNT(*) INTO v_cnt FROM public.inbound_email_messages;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '114 self-test: % rows stored while disabled', v_cnt
      USING ERRCODE = 'raise_exception';
  END IF;

  -- 2. With the switch thrown, one delivery stores and a retry does not.
  UPDATE reporting.enquiry_thresholds SET inbound_email_enabled = true WHERE id = 1;

  SELECT * INTO v_r FROM public.record_inbound_email(
    'probe114-b','Family@Example.invalid','Support@Example.invalid',
    '  ', now(), '{"text":"probe"}'::jsonb);
  IF NOT v_r.created OR v_r.reason <> 'stored' THEN
    RAISE EXCEPTION '114 self-test: enabled capture did not store (reason %)', v_r.reason
      USING ERRCODE = 'raise_exception';
  END IF;
  v_id := v_r.id;

  SELECT * INTO v_r FROM public.record_inbound_email(
    'probe114-b','Family@Example.invalid','Support@Example.invalid',
    'Question', now(), '{"text":"probe"}'::jsonb);
  IF v_r.created OR NOT v_r.accepted OR v_r.reason <> 'duplicate' OR v_r.id <> v_id THEN
    RAISE EXCEPTION '114 self-test: retry was not recognised as a duplicate'
      USING ERRCODE = 'raise_exception';
  END IF;

  SELECT COUNT(*) INTO v_cnt FROM public.inbound_email_messages
  WHERE provider_message_id = 'probe114-b';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '114 self-test: duplicate delivery produced % rows', v_cnt
      USING ERRCODE = 'raise_exception';
  END IF;

  -- 3. Addresses normalised and a whitespace subject stored as absent, not as a
  --    row of spaces that a later sort will place somewhere meaningless.
  SELECT from_address INTO v_from FROM public.inbound_email_messages
  WHERE provider_message_id = 'probe114-b';
  IF v_from <> 'family@example.invalid' THEN
    RAISE EXCEPTION '114 self-test: from_address not normalised (%)', v_from
      USING ERRCODE = 'raise_exception';
  END IF;

  IF EXISTS (SELECT 1 FROM public.inbound_email_messages
             WHERE provider_message_id = 'probe114-b' AND subject IS NOT NULL) THEN
    RAISE EXCEPTION '114 self-test: a whitespace subject was stored literally'
      USING ERRCODE = 'raise_exception';
  END IF;

  DELETE FROM public.inbound_email_messages;

  -- 4. And back to dark.
  UPDATE reporting.enquiry_thresholds SET inbound_email_enabled = false WHERE id = 1;
  IF EXISTS (SELECT 1 FROM reporting.enquiry_thresholds
             WHERE id = 1 AND inbound_email_enabled) THEN
    RAISE EXCEPTION '114 self-test: left the capture enabled'
      USING ERRCODE = 'raise_exception';
  END IF;
END $$;
