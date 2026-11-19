-- ============================================================================
-- 103 - Enquiry ingest support (backlog item 21, Phase A)
--
-- WHY THIS EXISTS: 012_enquiries.sql built the tables, the single write path and
-- the audited restricted read, but nothing was ever given a way to CALL it:
-- `enquiries` has 0 rows, `/contact` is mailto-only, and paying customers have no
-- support channel that produces a trackable record. This migration adds the two
-- things the new POST /api/enquiries route needs, and closes one privilege gap
-- found while inspecting the live database before writing it.
--
-- 1. PRIVILEGE FINDING ON public.enquiries (third instance of a known class)
--    Measured live on ekdjrvjgrhpqolthbznr before this migration:
--      anon:INSERT anon:SELECT anon:UPDATE anon:DELETE anon:TRUNCATE
--      anon:REFERENCES anon:TRIGGER  (same seven for authenticated)
--    047 revoked SELECT on funnel_events and 048 revoked it on email_log, both
--    for the same reason: confidentiality resting on the ABSENCE of a policy is
--    one ordinary "let users read their own rows" policy away from full exposure.
--
--    THIS FIX IS DELIBERATELY NARROWER THAN 047/048, and the difference is the
--    point. `enquiries` is not default-deny-by-accident: 012 shipped an explicit,
--    scoped "Parent can view own enquiries" SELECT policy, and 12-...md §7.5
--    designs it as a real parent-facing capability (it is what makes
--    waiting_on_customer actionable for the person it is waiting on). Revoking
--    SELECT would kill a designed feature to fix nothing.
--
--    What is actually wrong is the WRITE and DDL side, and it is worse here than
--    it was for funnel_events: a direct anon INSERT into `enquiries` succeeds
--    against the CHECK constraints, so a bot can create an enquiry whose contact
--    row does not exist - a support ticket nobody can answer. 012's central
--    design rule is that the two rows are written in ONE transaction inside
--    ingest_enquiry(), and today that invariant is held by convention rather than
--    by privilege. So: writes and DDL revoked, SELECT left to the RLS policy.
--
-- 2. THROTTLE
--    No rate limiting exists anywhere in this codebase, and a public unattended
--    form on a marketing page is the first place that needs it. It is in the
--    database rather than in function memory because Vercel runs many isolated
--    instances: an in-memory counter would reset per cold start and per region,
--    so it would not limit anything that matters. One row per visitor fingerprint
--    with SELECT ... FOR UPDATE gives it atomicity without a separate lock.
--
--    `fp` is a SHA-256 of the client IP under a server-side pepper, computed in
--    the route. The raw IP is never stored, so this table is not an address log.
--    The pepper is required: an unsalted IP hash is reversible by enumeration
--    (the whole IPv4 space is exhaustible), which would quietly make this table
--    personal data and defeat the reason for hashing it.
--
--    The counter advances ONLY for submissions that pass the route's spam
--    filters, so a bot that trips the honeypot cannot use the cap to lock a real
--    parent out of the support channel. That trade is deliberate: a spammer who
--    sends five genuinely well-formed enquiries can block that address for a day,
--    and the cost of that is an inconvenience already covered by the mailto
--    fallback that stays on the page.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Close the write/DDL privileges on the reportable table
-- ----------------------------------------------------------------------------
-- SELECT is intentionally retained: it is gated by 012's "Parent can view own
-- enquiries" policy, which is the designed parent surface. Every write must go
-- through public.ingest_enquiry(), which is already service-role-only.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.enquiries FROM PUBLIC, anon, authenticated;

-- Re-assert 012's restricted-table revocations. Costs nothing and protects the
-- invariant against a future migration re-granting them by accident.
REVOKE ALL ON public.enquiry_contacts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.enquiry_contact_access_log FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. enquiry_throttle
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.enquiry_throttle (
  fp            text PRIMARY KEY,
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  window_start  timestamptz NOT NULL DEFAULT now(),
  submissions   integer NOT NULL DEFAULT 0,

  -- A malformed key would otherwise accumulate rows that can never match a real
  -- visitor, silently inflating the table while limiting nobody.
  CONSTRAINT enquiry_throttle_fp_shape CHECK (fp ~ '^[0-9a-f]{64}$'),
  CONSTRAINT enquiry_throttle_count_shape CHECK (submissions >= 0)
);

-- Supports the opportunistic prune below.
CREATE INDEX IF NOT EXISTS idx_enquiry_throttle_seen
  ON public.enquiry_throttle (last_seen_at);

ALTER TABLE public.enquiry_throttle ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enquiry_throttle FORCE ROW LEVEL SECURITY;

-- No policy at all: deny by default for every app role, including ADMIN. This is
-- spam control, not data. An operator who wants to look at it is looking at the
-- wrong layer, and a table readable by `authenticated` is a table that reveals
-- which addresses have been submitting support forms.
REVOKE ALL ON public.enquiry_throttle FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. enquiry_throttle_check - decide, and record the decision, in one call
-- ----------------------------------------------------------------------------
-- RETURNS TABLE rather than a bare boolean because a refusal without a number is
-- unactionable: the route needs to tell a genuine user when to come back, and
-- inventing a retry figure in the handler would mean the policy lives in two
-- places. Both answers come from one statement so they cannot drift.
CREATE OR REPLACE FUNCTION public.enquiry_throttle_check(
  p_fp                   text,
  p_min_interval_seconds integer DEFAULT 60,
  p_daily_cap            integer DEFAULT 5
)
RETURNS TABLE(allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
-- SECURITY DEFINER: the caller is the route holding the service key, but the pin
-- matters for the ordinary reason - a caller-writable schema must not be able to
-- substitute an `enquiry_throttle` of its own definition.
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now     timestamptz := now();
  v_row     public.enquiry_throttle%ROWTYPE;
  v_elapsed integer;
  v_allowed boolean;
  v_retry   integer;
BEGIN
  IF p_fp IS NULL OR p_fp !~ '^[0-9a-f]{64}$' THEN
    -- An exception, not a refusal: a malformed fingerprint is a bug in the
    -- route, and answering it with "slow down" would hide it behind a 429.
    RAISE EXCEPTION 'invalid throttle fingerprint: expected 64 hex characters'
      USING ERRCODE = '22023';
  END IF;

  IF p_daily_cap IS NULL OR p_daily_cap < 1 THEN
    RAISE EXCEPTION 'p_daily_cap must be at least 1' USING ERRCODE = '22023';
  END IF;

  -- FOR UPDATE serialises concurrent submissions from the same address, so two
  -- simultaneous POSTs cannot both read submissions=1 and both pass a cap of 5.
  SELECT * INTO v_row
    FROM public.enquiry_throttle
   WHERE fp = p_fp
     FOR UPDATE;

  IF NOT FOUND THEN
    -- First sighting is recorded but not yet counted as a submission: the
    -- UPDATE below is the only place submissions ever becomes 1.
    INSERT INTO public.enquiry_throttle (fp, last_seen_at, window_start, submissions)
      VALUES (p_fp, v_now, v_now, 0);
    v_row.fp := p_fp;
    v_row.last_seen_at := v_now;
    v_row.window_start := v_now;
    v_row.submissions := 0;
  END IF;

  -- A rolling 24h window rather than a calendar day: a cap that resets at
  -- midnight lets a bot spend its whole allowance twice in one working day.
  IF v_now - v_row.window_start >= interval '24 hours' THEN
    v_row.window_start := v_now;
    v_row.submissions := 0;
  END IF;

  v_elapsed := EXTRACT(EPOCH FROM (v_now - v_row.last_seen_at))::integer;
  v_allowed := TRUE;
  v_retry   := 0;

  -- The interval applies only after a first accepted submission, so the interval
  -- and the cap cannot both refuse the same request and disagree about why.
  IF v_row.submissions > 0
     AND v_elapsed < greatest(coalesce(p_min_interval_seconds, 60), 0) THEN
    v_allowed := FALSE;
    v_retry := greatest(coalesce(p_min_interval_seconds, 60), 0) - v_elapsed;
  ELSIF v_row.submissions >= p_daily_cap THEN
    v_allowed := FALSE;
    v_retry := greatest(
      1,
      EXTRACT(EPOCH FROM (v_row.window_start + interval '24 hours' - v_now))::integer
    );
  END IF;

  IF v_allowed THEN
    UPDATE public.enquiry_throttle
       SET last_seen_at = v_now,
           window_start = v_row.window_start,
           submissions  = v_row.submissions + 1
     WHERE fp = p_fp;
  ELSE
    -- A refusal refreshes last_seen_at but NOT the counter: an already-blocked
    -- address must not extend its own lockout by hammering.
    UPDATE public.enquiry_throttle
       SET last_seen_at = v_now
     WHERE fp = p_fp;
  END IF;

  -- Opportunistic prune, only on the path that creates a row, so ordinary
  -- traffic against a settled table does not pay for a delete every call.
  IF v_row.submissions = 0 THEN
    DELETE FROM public.enquiry_throttle
      WHERE last_seen_at < v_now - interval '30 days';
  END IF;

  RETURN QUERY SELECT v_allowed, v_retry;
END;
$$;

-- Same rule the whole reporting layer follows: revoking from anon/authenticated
-- alone is not enough, Postgres grants EXECUTE to PUBLIC on a new function.
REVOKE ALL ON FUNCTION public.enquiry_throttle_check(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enquiry_throttle_check(text, integer, integer)
  TO service_role;

-- ----------------------------------------------------------------------------
-- 3b. enquiry_id_for_source_ref - is this submission already recorded?
-- ----------------------------------------------------------------------------
-- WHY THE ROUTE NEEDS A READ BEFORE THE THROTTLE
--   ingest_enquiry() is idempotent on (channel, ingest_source_ref), so a
--   double-clicked submit button or a network retry genuinely cannot create a
--   second enquiry. Answering that retry with a 429 - "you have sent several
--   messages already" - would be actively false: the parent's first message
--   arrived, and the wording tells them it did not. So the retry has to be
--   recognised as a retry, and recognised BEFORE the throttle is consulted,
--   because a retry is not a new submission and must not spend the visitor's
--   allowance.
--
--   Without this function the alternative is to let the throttle fire first and
--   return a confusing refusal, or to run the ingest and infer idempotency from
--   its return value - which means the throttle is either skipped for everyone
--   or wrong for retries. One narrow read is the cheap correct answer.
--
-- WHAT IT DOES NOT LEAK
--   It resolves only an exact server-generated reference, which is a 128-bit
--   random nonce from a signed token. Nothing enumerable, nothing about another
--   person: guessing a reference is guessing 2^128. It returns an id that grants
--   no access, because there is no read path for a non-admin.
CREATE OR REPLACE FUNCTION public.enquiry_id_for_source_ref(p_source_ref text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT e.id
    FROM public.enquiries e
   WHERE e.channel = 'web_form'
     AND e.ingest_source_ref = p_source_ref;
$$;

REVOKE ALL ON FUNCTION public.enquiry_id_for_source_ref(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enquiry_id_for_source_ref(text)
  TO service_role;


-- ----------------------------------------------------------------------------
-- 4. Comments
-- ----------------------------------------------------------------------------
COMMENT ON TABLE public.enquiry_throttle IS
  'Spam control for POST /api/enquiries. One row per visitor fingerprint (peppered SHA-256 of the client IP - the raw IP is never stored). Written and read only by public.enquiry_throttle_check(), which is service-role-only. Excluded from the reporting schema and given no RLS policy for any app role.';

COMMENT ON FUNCTION public.enquiry_id_for_source_ref(text) IS
  'Returns the enquiry already recorded under a web-form submission reference, so the route can answer a retry with the same reference instead of a rate-limit refusal. Service-role only; the reference is a 128-bit nonce from a signed token, so it is not enumerable.';

COMMENT ON FUNCTION public.enquiry_throttle_check(text, integer, integer) IS
  'Decide whether a fingerprint may submit an enquiry, and record the decision atomically (SELECT ... FOR UPDATE). A rolling 24h window plus a minimum interval between accepted submissions. The counter advances only for submissions the route already accepted as well-formed, so a filtered bot cannot use the cap to lock a real parent out of the support channel.';

COMMENT ON TABLE public.enquiries IS
  'Inbound enquiries across web_form, email and chat. Reportable: contains no free-text field and no contact detail, so reporting.fact_enquiry can be built from this table alone. Written only through public.ingest_enquiry() - INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER are revoked from anon and authenticated so that the two-table transaction inside that function is the only way an enquiry can come into existence.';

