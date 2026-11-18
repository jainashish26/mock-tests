-- ============================================================================
-- 011_funnel.sql
-- Free-to-paid funnel: instrumentation, lifecycle state, referrals, offers,
-- exam targets and the email delivery log.
--
-- WHY THIS MIGRATION EXISTS
--   The platform already had a strong acquisition surface (SEO, llms.txt, blog)
--   and a strong product surface (adaptive runner, AI writing marking, RLS-gated
--   reports). What sat *between* them - the conversion layer - was never built.
--   Specifically the funnel had no way to:
--     a) measure anything   -> no event store, so no stage conversion rate
--     b) email anything     -> no delivery log, no idempotency, no suppression
--     c) know where a user is in the journey -> no lifecycle state
--     d) attribute a signup to a referring parent -> no referral tables
--     e) run a time-boxed offer -> no offer table, no per-user expiry
--
-- DESIGN RULES (consistent with 010_subscriptions.sql)
--   1. Idempotent - every statement uses IF NOT EXISTS / DROP POLICY IF EXISTS,
--      so `supabase db reset` and a re-run against prod both succeed.
--   2. Deny-by-default RLS. Rows are written by the service-role client from
--      trusted server code (webhooks, lifecycle worker, API routes). Clients get
--      narrow SELECT-only policies where the UI genuinely needs to read.
--   3. Stage is `text` + CHECK, NOT a Postgres enum. Enums cannot have a member
--      added without `ALTER TYPE ... ADD VALUE`, which cannot run inside a
--      transaction block and makes migration replay painful.
--      `subscriptions.status` already set this precedent.
--   4. `funnel_events` is append-only: no UPDATE/DELETE policy exists for any
--      role. A mutable event log is not an event log.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. funnel_events - append-only instrumentation -----------------------------
-- ----------------------------------------------------------------------------
-- One row per meaningful product interaction. This is the denominator for every
-- conversion target in the funnel spec (80% signup, 70% first value, 20% offer,
-- 25% expand, 50% renew). Without it those numbers are opinions.
CREATE TABLE IF NOT EXISTS public.funnel_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NULL for pre-signup traffic; `anonymous_id` bridges that gap so the
  -- acquisition -> signup conversion can still be attributed.
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  anonymous_id text,

  -- Optional: which child the event concerns (e.g. DIAGNOSTIC_STARTED).
  student_id uuid REFERENCES public.student_profiles(id) ON DELETE SET NULL,

  event text NOT NULL,
  stage text,

  -- Free-form context: { examType, yearLevel, score, productId, ... }
  props jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Acquisition context, captured once at first touch and replayed here so a
  -- paying customer can be attributed back to the channel that produced them.
  utm jsonb,
  referrer text,
  path text,

  created_at timestamptz NOT NULL DEFAULT now(),

  -- A user must be identified by at least one of the two ids, otherwise the
  -- row can never be joined to anything and is pure noise.
  CONSTRAINT funnel_events_identity CHECK (user_id IS NOT NULL OR anonymous_id IS NOT NULL)
);

-- Stage funnel queries filter on (event, created_at) constantly; the admin
-- dashboard filters on (user_id, created_at).
CREATE INDEX IF NOT EXISTS idx_funnel_events_event_time
  ON public.funnel_events (event, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_funnel_events_user_time
  ON public.funnel_events (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_funnel_events_anon
  ON public.funnel_events (anonymous_id, created_at DESC)
  WHERE anonymous_id IS NOT NULL;

ALTER TABLE public.funnel_events ENABLE ROW LEVEL SECURITY;

-- Deliberately NO client policy on funnel_events. Browsers post through
-- /api/events, which writes with the service-role client after validating and
-- rate-limiting. Allowing a direct client INSERT would let anyone inflate or
-- forge conversion metrics by scripting rows into the table.

-- ----------------------------------------------------------------------------
-- 2. funnel_state - one row per parent, the lifecycle spine -------------------
-- ----------------------------------------------------------------------------
-- Denormalised on purpose. The alternative - deriving stage from funnel_events
-- at read time - means every page load replays the user's whole history, and
-- the lifecycle worker would have to scan the entire event table to find "who
-- is due an email". A single mutable row per user makes both O(1).
CREATE TABLE IF NOT EXISTS public.funnel_state (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Highest stage reached. Monotonic: `advance_funnel_stage` refuses to move
  -- backwards, so a late-arriving event can never regress a paying customer.
  stage text NOT NULL DEFAULT 'SIGNED_UP'
    CHECK (stage IN (
      'SIGNED_UP',          -- 2. account exists
      'STUDENT_ADDED',      -- 3a. at least one child profile
      'DIAGNOSTIC_STARTED', -- 3b. first benchmark attempt opened
      'FIRST_VALUE',        -- 3c. diagnostic COMPLETE (the activation moment)
      'REPORT_SENT',        -- 4. readiness report delivered
      'SECOND_OFFERED',     -- 5. surprise free mock granted
      'PAYWALL_READY',      -- 6. >= 2 completed tests, paywall unlocked
      'OFFER_MADE',         -- 7. $150 launch offer presented
      'CUSTOMER',           -- 7b. first payment captured
      'ONBOARDED',          -- 8. exam date + study plan set
      'EXPANDED',           -- 9. second product purchased
      'RENEWED'             -- 10. subscription renewed
    )),
  stage_updated_at timestamptz NOT NULL DEFAULT now(),

  -- Stage timestamps. Kept as explicit columns rather than derived from
  -- funnel_events because the lifecycle worker indexes on these directly.
  signed_up_at timestamptz,
  first_student_at timestamptz,
  diagnostic_started_at timestamptz,
  diagnostic_completed_at timestamptz,
  report_sent_at timestamptz,

  -- Step 5: the surprise mock is time-boxed to 7 days, which is the whole
  -- point of the mechanic - a deadline converts, an open-ended gift does not.
  second_session_offered_at timestamptz,
  second_session_expires_at timestamptz,
  second_session_completed_at timestamptz,

  -- Step 6 trigger: "send over email after 2 completed tests".
  completed_attempts int NOT NULL DEFAULT 0,

  -- Step 7: the offer is per-user and expiring, so it must be stored here.
  offer_id uuid,
  offer_made_at timestamptz,
  offer_expires_at timestamptz,
  offer_redeemed_at timestamptz,

  first_purchase_at timestamptz,
  first_purchase_amount_cents int,
  lifetime_value_cents int NOT NULL DEFAULT 0,
  products_purchased int NOT NULL DEFAULT 0,

  -- Step 8/9/10
  onboarded_at timestamptz,
  expanded_at timestamptz,
  renewed_at timestamptz,

  -- Step 1 attribution: which parent sent them.
  referred_by_code text,

  -- Contact preferences. `marketing_opt_in` mirrors the consent captured at
  -- signup; `email_suppressed` is the hard kill-switch honoured by every send.
  marketing_opt_in boolean NOT NULL DEFAULT false,
  email_suppressed boolean NOT NULL DEFAULT false,
  email text,

  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_funnel_state_stage
  ON public.funnel_state (stage);
-- The lifecycle worker's core query: "who is at stage X and due for a nudge?"
CREATE INDEX IF NOT EXISTS idx_funnel_state_worker
  ON public.funnel_state (stage, diagnostic_completed_at)
  WHERE email_suppressed = false;

ALTER TABLE public.funnel_state ENABLE ROW LEVEL SECURITY;

-- The /onboarding and /parent/refer pages read the user's own row.
DROP POLICY IF EXISTS "Users can view own funnel state" ON public.funnel_state;
CREATE POLICY "Users can view own funnel state"
  ON public.funnel_state FOR SELECT
  USING (user_id = auth.uid());

-- No client INSERT/UPDATE: stage advancement is server-only, so a tampered
-- browser request cannot mark itself CUSTOMER and unlock the paid tier.

-- ----------------------------------------------------------------------------
-- 3. Stage advancement helper ------------------------------------------------
-- ----------------------------------------------------------------------------
-- Stages have a natural order; `funnel_stage_rank` encodes it so advancement is
-- a single monotonic comparison instead of a hand-maintained IF-chain in app
-- code (which is how stages get out of sync with each other).
CREATE OR REPLACE FUNCTION public.funnel_stage_rank(stage_name text)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE stage_name
    WHEN 'SIGNED_UP'          THEN 1
    WHEN 'STUDENT_ADDED'      THEN 2
    WHEN 'DIAGNOSTIC_STARTED' THEN 3
    WHEN 'FIRST_VALUE'        THEN 4
    WHEN 'REPORT_SENT'        THEN 5
    WHEN 'SECOND_OFFERED'     THEN 6
    WHEN 'PAYWALL_READY'      THEN 7
    WHEN 'OFFER_MADE'         THEN 8
    WHEN 'CUSTOMER'           THEN 9
    WHEN 'ONBOARDED'          THEN 10
    WHEN 'EXPANDED'           THEN 11
    WHEN 'RENEWED'            THEN 12
    ELSE 0
  END;
$$;

-- SECURITY DEFINER: called from server code that may be acting on a parent's
-- behalf, and it must not be blocked by the SELECT-only RLS above.
CREATE OR REPLACE FUNCTION public.advance_funnel_stage(
  target_user_id uuid,
  new_stage text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.funnel_state (user_id, stage, stage_updated_at)
  VALUES (target_user_id, new_stage, now())
  ON CONFLICT (user_id) DO UPDATE
    SET stage = EXCLUDED.stage,
        stage_updated_at = now()
    -- Monotonic guard: never regress. A webhook that arrives out of order, or a
    -- replayed QStash job, must not demote a customer back to PAYWALL_READY.
    WHERE public.funnel_stage_rank(public.funnel_state.stage)
        < public.funnel_stage_rank(EXCLUDED.stage);
END;
$$;


-- ----------------------------------------------------------------------------
-- 4. student_exam_targets - step 8 countdown + study plan --------------------
-- ----------------------------------------------------------------------------
-- Per child rather than per parent: siblings sit different exams in different
-- years, and the sibling upsell (step 9) depends on knowing that.
CREATE TABLE IF NOT EXISTS public.student_exam_targets (
  student_id uuid PRIMARY KEY REFERENCES public.student_profiles(id) ON DELETE CASCADE,

  -- Free text rather than the `exam_type` enum: parents think in terms of
  -- "NSW Selective 2027" or "EduTest Scholarship", which is finer-grained than
  -- BENCHMARK/NAPLAN_STYLE/OLYMPIAD/SELECTIVE and must not require a migration
  -- to add a new value.
  target_exam text,
  target_exam_type public.exam_type,
  exam_date date,

  -- Step 8 target is "3 sessions a week"; store it so progress can be measured
  -- against the parent's own commitment rather than a hardcoded number.
  weekly_sessions_goal int NOT NULL DEFAULT 3 CHECK (weekly_sessions_goal BETWEEN 1 AND 14),

  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_exam_targets_date
  ON public.student_exam_targets (exam_date)
  WHERE exam_date IS NOT NULL;

ALTER TABLE public.student_exam_targets ENABLE ROW LEVEL SECURITY;

-- Reuses the existing `is_parent_of` helper from 004 rather than re-deriving
-- the link, so access rules cannot drift between the two tables.
DROP POLICY IF EXISTS "Parent can read linked child exam targets" ON public.student_exam_targets;
CREATE POLICY "Parent can read linked child exam targets"
  ON public.student_exam_targets FOR SELECT
  USING (public.is_parent_of(student_id));

DROP POLICY IF EXISTS "Parent can write linked child exam targets" ON public.student_exam_targets;
CREATE POLICY "Parent can write linked child exam targets"
  ON public.student_exam_targets FOR ALL
  USING (public.is_parent_of(student_id))
  WITH CHECK (public.is_parent_of(student_id));

DROP POLICY IF EXISTS "Admin can manage all exam targets" ON public.student_exam_targets;
CREATE POLICY "Admin can manage all exam targets"
  ON public.student_exam_targets FOR ALL
  USING (public.has_role('ADMIN'))
  WITH CHECK (public.has_role('ADMIN'));

-- ----------------------------------------------------------------------------
-- 5. offers - step 7 ($150 one-time) and step 9 (expand) ---------------------
-- ----------------------------------------------------------------------------
-- An offer is a *time-boxed, per-user-limitable* price, which is why it is not
-- just another row in `products`: `products` has no start/end, no original
-- price to anchor against, and no guarantee period.
CREATE TABLE IF NOT EXISTS public.offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,

  -- LAUNCH_ONE_TIME | EXAM_PACK | CORE_ANNUAL | SIBLING | WRITING_BOOSTER
  kind text NOT NULL,

  -- The price actually charged is always resolved from Stripe at checkout time
  -- (see src/lib/pricing/catalog.ts). This column is an *identifier*, never an
  -- amount the client can influence.
  stripe_price_id text,

  -- Anchoring pair. `original_amount_cents` is struck through in the UI; the
  -- discount percentage is derived, never typed in twice, so it cannot
  -- disagree with the two numbers it is calculated from.
  original_amount_cents int CHECK (original_amount_cents >= 0),
  offer_amount_cents int NOT NULL CHECK (offer_amount_cents >= 0),
  currency text NOT NULL DEFAULT 'AUD',

  active boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,

  -- Step 7 promises a 14-day money-back guarantee. Stored per offer so the
  -- checkout page, the receipt email and /terms all quote the same number.
  guarantee_days int NOT NULL DEFAULT 14 CHECK (guarantee_days >= 0),

  -- How long the offer stays live for one user once triggered, in hours.
  -- NULL = no per-user countdown.
  per_user_window_hours int CHECK (per_user_window_hours IS NULL OR per_user_window_hours > 0),
  per_user_limit int NOT NULL DEFAULT 1 CHECK (per_user_limit >= 1),

  -- Which stage must be reached before this offer may be shown. Enforced
  -- server-side so a launch price cannot be claimed by a brand-new visitor.
  eligible_from_stage text,

  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;

-- Any signed-in user may read a live offer (the paywall and pricing pages both
-- need it). Inactive and future-dated offers stay invisible so an unpublished
-- promotion cannot be discovered by guessing a slug.
DROP POLICY IF EXISTS "Users can view live offers" ON public.offers;
CREATE POLICY "Users can view live offers"
  ON public.offers FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND active = true
    AND (starts_at IS NULL OR starts_at <= now())
    AND (ends_at IS NULL OR ends_at > now())
  );

DROP POLICY IF EXISTS "Admin can manage offers" ON public.offers;
CREATE POLICY "Admin can manage offers"
  ON public.offers FOR ALL
  USING (public.has_role('ADMIN'))
  WITH CHECK (public.has_role('ADMIN'));


-- ----------------------------------------------------------------------------
-- 6. referral_codes + referrals - step 1 acquisition -------------------------
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.referral_codes (
  code text PRIMARY KEY,
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,

  -- PARENT = earned by a user; CAMPAIGN = created by an admin for a school
  -- community or partner. NULL owner means campaign.
  kind text NOT NULL DEFAULT 'PARENT' CHECK (kind IN ('PARENT', 'CAMPAIGN')),

  -- Reward granted to the referrer when the referee becomes a paying customer.
  reward_kind text NOT NULL DEFAULT 'CREDIT_CENTS'
    CHECK (reward_kind IN ('CREDIT_CENTS', 'FREE_MONTH', 'NONE')),
  reward_value int NOT NULL DEFAULT 0 CHECK (reward_value >= 0),

  -- What the referee gets for using the code. A two-sided reward converts
  -- materially better than a one-sided one, because it gives the referrer a
  -- socially acceptable reason to share ("you get $20 off" beats "I get $20").
  referee_offer_id uuid REFERENCES public.offers(id) ON DELETE SET NULL,

  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- A parent gets exactly one code. UNIQUE allows multiple NULLs (campaign
  -- codes have no owner), which is exactly the behaviour wanted here.
  CONSTRAINT referral_codes_one_per_owner UNIQUE (owner_user_id)
);

CREATE INDEX IF NOT EXISTS idx_referral_codes_owner
  ON public.referral_codes (owner_user_id);

CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL REFERENCES public.referral_codes(code) ON DELETE CASCADE,

  -- UNIQUE: one signup can only ever be attributed to one referrer. Without
  -- this a user who clicked two links would generate two rewards.
  referee_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,

  referred_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,   -- referee reached FIRST_VALUE
  converted_at timestamptz,   -- referee became a paying customer

  reward_state text NOT NULL DEFAULT 'PENDING'
    CHECK (reward_state IN ('PENDING', 'GRANTED', 'VOID')),
  reward_value int NOT NULL DEFAULT 0,
  rewarded_at timestamptz,

  -- UTM snapshot at the moment of referral, for channel reporting.
  utm jsonb
);

CREATE INDEX IF NOT EXISTS idx_referrals_code ON public.referrals (code);
CREATE INDEX IF NOT EXISTS idx_referrals_reward
  ON public.referrals (reward_state) WHERE reward_state = 'PENDING';

ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

-- A parent reads their own code to render the share widget.
DROP POLICY IF EXISTS "Users can view own referral code" ON public.referral_codes;
CREATE POLICY "Users can view own referral code"
  ON public.referral_codes FOR SELECT
  USING (owner_user_id = auth.uid() OR public.has_role('ADMIN'));

-- No client INSERT: codes are minted server-side so the reward value cannot be
-- set by the person receiving the reward.

-- Referrers see aggregate progress on their own referrals (who joined, who
-- converted) but never the referee's email or child data.
DROP POLICY IF EXISTS "Users can view own referral activity" ON public.referrals;
CREATE POLICY "Users can view own referral activity"
  ON public.referrals FOR SELECT
  USING (
    referee_user_id = auth.uid()
    OR public.has_role('ADMIN')
    OR EXISTS (
      SELECT 1 FROM public.referral_codes rc
      WHERE rc.code = referrals.code AND rc.owner_user_id = auth.uid()
    )
  );


-- ----------------------------------------------------------------------------
-- 7. email_log - steps 4, 5, 6, 9, 10 ---------------------------------------
-- ----------------------------------------------------------------------------
-- Serves three purposes at once: idempotency (never send the same template
-- twice), audit (a parent who complains "I never got it" can be answered with
-- evidence), and rate protection (the lifecycle worker checks this before
-- sending).
CREATE TABLE IF NOT EXISTS public.email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient text NOT NULL,

  -- Template key, e.g. 'readiness_report', 'second_session', 'paywall_offer'.
  template text NOT NULL,

  -- Optional discriminator so the same template can legitimately be sent more
  -- than once for different subjects (e.g. one readiness report per child).
  dedupe_key text NOT NULL DEFAULT '',

  provider text NOT NULL DEFAULT 'resend',
  provider_message_id text,
  status text NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED', 'SENT', 'FAILED', 'SKIPPED', 'BOUNCED')),
  error text,

  subject text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,

  -- The idempotency guarantee. A retried QStash job or a double-fired webhook
  -- hits this constraint instead of sending a duplicate email.
  CONSTRAINT email_log_unique_delivery UNIQUE (user_id, template, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_email_log_user_time
  ON public.email_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_template
  ON public.email_log (template, created_at DESC);

ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;
-- No client policy at all: transactional email history contains recipient
-- addresses and delivery errors, and nothing in the UI needs to read it.

-- ----------------------------------------------------------------------------
-- 8. Convenience view: funnel conversion by stage ----------------------------
-- ----------------------------------------------------------------------------
-- Powers the admin funnel dashboard without hand-writing the same aggregate in
-- several places. Views run as the querying user, so RLS on funnel_state still
-- applies and this resolves to admin-only in practice.
CREATE OR REPLACE VIEW public.funnel_conversion AS
SELECT
  s.stage,
  public.funnel_stage_rank(s.stage) AS stage_rank,
  count(*)                          AS users,
  count(*) FILTER (WHERE s.completed_attempts >= 1)       AS did_diagnostic,
  count(*) FILTER (WHERE s.completed_attempts >= 2)       AS reached_paywall,
  count(*) FILTER (WHERE s.first_purchase_at IS NOT NULL) AS became_customer,
  count(*) FILTER (WHERE s.expanded_at IS NOT NULL)       AS bought_second,
  count(*) FILTER (WHERE s.renewed_at IS NOT NULL)        AS renewed,
  round(avg(s.lifetime_value_cents))                      AS avg_ltv_cents
FROM public.funnel_state s
GROUP BY s.stage;

COMMENT ON TABLE public.funnel_events IS
  'Append-only product instrumentation. Written only by /api/events and trusted server code using the service-role client; no client RLS policy exists by design.';
COMMENT ON TABLE public.funnel_state IS
  'One row per parent: current funnel stage, stage timestamps, offer window and contact preferences. Server-written; clients may read their own row only.';
COMMENT ON TABLE public.email_log IS
  'Transactional email audit + idempotency ledger. UNIQUE(user_id, template, dedupe_key) makes every lifecycle send exactly-once.';

