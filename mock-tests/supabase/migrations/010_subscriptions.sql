-- ============================================================================
-- 010_subscriptions.sql
-- Adds recurring-billing support (Stripe subscriptions) alongside the existing
-- one-time purchase model.
--
-- WHY A NEW TABLE RATHER THAN REUSING `purchases`/`entitlements`:
--   `entitlements` is per-test with a NOT NULL `purchase_id`, and `purchases`
--   models a single one-time payment. Neither can express "this parent has
--   unlimited access to everything until <date>". Forcing subscriptions into
--   that shape would mean inserting one entitlement row per test (and keeping
--   them in sync as the catalog grows), which is both wasteful and wrong.
--
--   Instead access is derived: an active subscription grants unlimited access
--   through the existing `can_access_published_test` gate (branch f/g below),
--   so per-test entitlements and subscriptions coexist cleanly.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- 0. FIX: create `public.profiles` before altering it. ------------------------
--
-- This migration originally opened with `ALTER TABLE public.profiles`, but
-- `public.profiles` has never existed in this database (to_regclass returns
-- NULL), so the migration aborted on its first statement and nothing below it
-- was ever applied. `IF NOT EXISTS` guards the COLUMN, not the TABLE.
--
-- The table is not an invention: three existing route handlers already depend
-- on it, all treating it as 1:1 with auth.users and keyed on `id`:
--   * src/app/api/billing/portal/route.ts  - reads  stripe_customer_id WHERE id = user.id
--   * src/app/api/checkout/route.ts        - reads  stripe_customer_id WHERE id = user.id
--   * src/app/api/webhooks/stripe/route.ts - UPDATE stripe_customer_id WHERE id = userId
--                                            and SELECT id WHERE stripe_customer_id = ...
--
-- A second, quieter bug is fixed here too. The webhook uses `.update()`, which
-- affects zero rows when no profile row exists - and nothing ever created one.
-- So stripe_customer_id would never have been stored, and the billing portal
-- would have permanently fallen through to its `subscriptions` fallback. The
-- trigger below creates the row when the auth user is created, which is what
-- makes the existing UPDATE actually land.
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- A user reads their own profile (the /pricing page uses it to decide between
-- "Manage subscription" and a buy button).
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (id = auth.uid() OR public.has_role('ADMIN'));

-- No client INSERT/UPDATE. The row is created by the trigger below and
-- stripe_customer_id is written only by the webhook via the service-role client,
-- which bypasses RLS. A client that could write its own stripe_customer_id could
-- point the billing portal at someone else's Stripe customer.
DROP POLICY IF EXISTS "Admin can manage profiles" ON public.profiles;
CREATE POLICY "Admin can manage profiles"
  ON public.profiles FOR ALL
  USING (public.has_role('ADMIN'))
  WITH CHECK (public.has_role('ADMIN'));

-- SECURITY DEFINER so the trigger, which fires in the context of whatever role
-- inserted the auth user, is not blocked by the RLS above.
CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user_profile() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_profile();

-- Backfill: any auth user created before this trigger existed still has no
-- profile row, and their webhook UPDATE would silently affect zero rows.
INSERT INTO public.profiles (id)
SELECT u.id FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;

-- 1. Link a Supabase auth user to their Stripe Customer.
--    Needed so the Customer Portal and webhooks can find the right account,
--    and so a parent does not accumulate duplicate Stripe customers.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_stripe_customer
  ON public.profiles (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

-- Record which product was bought. `purchases` previously had no product link,
-- so there was no way to answer "has this parent already bought this?" or to
-- re-grant access after a refund dispute without replaying Stripe metadata.
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_purchases_user_product
  ON public.purchases (user_id, product_id)
  WHERE product_id IS NOT NULL;

-- A purchase must be idempotent per Stripe session. Without this, a retried
-- webhook can insert a second row for the same completed payment.
--
-- Deliberately NOT a partial index: the webhook upserts with
-- `onConflict: 'provider_ref'`, and Postgres can only infer a target from a
-- partial index when the ON CONFLICT clause repeats its WHERE predicate. A plain
-- unique index infers cleanly and still permits unlimited NULLs, because NULLs
-- are distinct from one another in a unique index.
--
-- MIGRATION RISK: this fails if `purchases` already holds two rows with the same
-- non-null provider_ref. Check first with:
--   select provider_ref, count(*) from public.purchases
--   where provider_ref is not null group by 1 having count(*) > 1;
-- The catalog was empty until now so this table is expected to be empty.
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_provider_ref
  ON public.purchases (provider_ref);

-- Needed to action `charge.refunded`: the refund event carries a PaymentIntent,
-- not a Checkout Session id, so without this column a refund cannot be mapped
-- back to the entitlements it should revoke.
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS payment_intent text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_payment_intent
  ON public.purchases (payment_intent)
  WHERE payment_intent IS NOT NULL;

-- 2. Subscriptions -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  stripe_customer_id text NOT NULL,
  stripe_subscription_id text NOT NULL,
  stripe_price_id text NOT NULL,

  -- Stripe's own vocabulary, kept verbatim so the row always matches Stripe:
  -- trialing | active | past_due | unpaid | canceled | incomplete | incomplete_expired
  status text NOT NULL,

  -- 'month' or 'year' (Stripe recurring.interval), not 'monthly'/'annual'.
  -- Quoted because `interval` is also a Postgres type keyword; quoting removes
  -- any parse ambiguity inside the CHECK expression.
  interval text NOT NULL CHECK ("interval" IN ('month', 'year')),

  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  trial_end timestamptz,
  ended_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One Stripe subscription maps to exactly one row, even across cancel/resubscribe.
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_stripe_id
  ON public.subscriptions (stripe_subscription_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user
  ON public.subscriptions (user_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_customer
  ON public.subscriptions (stripe_customer_id);

-- Fast lookup for the access gate, which filters on user + live statuses.
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_live
  ON public.subscriptions (user_id)
  WHERE status IN ('trialing', 'active', 'past_due');

-- 3. Access helper ------------------------------------------------------------
-- SECURITY DEFINER is required: RLS on `subscriptions` must not let a student
-- read a parent's billing row, yet the gate still needs to evaluate it.
CREATE OR REPLACE FUNCTION public.has_active_subscription(target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.subscriptions s
    WHERE s.user_id = target_user_id
      -- `past_due` keeps access while Stripe retries a failed card. Cutting a
      -- paying customer off for one declined retry causes far more support load
      -- than the small window of free access.
      AND s.status IN ('trialing', 'active', 'past_due')
      AND (s.current_period_end IS NULL OR s.current_period_end > now())
  );
$$;

-- 4. RLS ----------------------------------------------------------------------
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Clients may read their own subscription (the /pricing page uses this to show
-- "Manage subscription" instead of a buy button).
DROP POLICY IF EXISTS "Users can view own subscription" ON public.subscriptions;
CREATE POLICY "Users can view own subscription"
  ON public.subscriptions FOR SELECT
  USING (user_id = auth.uid());

-- No INSERT/UPDATE/DELETE policies on purpose: subscriptions are written only by
-- the Stripe webhook via the service-role client, which bypasses RLS. Leaving
-- client writes impossible means a tampered browser request cannot grant itself
-- unlimited access.
-- 5. Extend the central access gate ------------------------------------------
-- Reproduces branches (a)-(e) from 007 verbatim and adds subscription branches.
-- Extending the existing gate (rather than adding a parallel check in app code)
-- means every policy that already uses it - questions, test_questions,
-- responses, writing_evaluations, parent reports - gains subscription support
-- at once, with no chance of one query forgetting the new rule.
CREATE OR REPLACE FUNCTION public.can_access_published_test(target_test_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.tests t
    WHERE t.id = target_test_id
      AND t.status = 'PUBLISHED'::public.content_status
      AND (
        -- a) genuinely free content
        t.is_free = true
        -- b) the signed-in user holds the entitlement themselves
        OR EXISTS (
          SELECT 1 FROM public.entitlements e
          WHERE e.test_id = t.id AND e.active = true AND e.user_id = auth.uid()
        )
        -- c) the signed-in student inherits a linked parent's entitlement
        OR EXISTS (
          SELECT 1
          FROM public.entitlements e
          JOIN public.parent_student_links psl ON psl.parent_user_id = e.user_id
          JOIN public.student_profiles sp        ON sp.id = psl.student_id
          WHERE e.test_id = t.id AND e.active = true AND sp.auth_user_id = auth.uid()
        )
        -- d) the signed-in student has been assigned this test
        OR EXISTS (
          SELECT 1
          FROM public.assignments a
          JOIN public.student_profiles sp ON sp.id = a.student_id
          WHERE a.test_id = t.id AND sp.auth_user_id = auth.uid()
        )
        -- e) the signed-in PARENT is linked to a child who can take this test
        OR EXISTS (
          SELECT 1
          FROM public.parent_student_links psl
          JOIN public.student_profiles sp ON sp.id = psl.student_id
          WHERE psl.parent_user_id = auth.uid()
            AND (
              EXISTS (
                SELECT 1 FROM public.assignments a
                WHERE a.test_id = t.id AND a.student_id = sp.id
              )
              OR EXISTS (
                SELECT 1 FROM public.entitlements e
                WHERE e.test_id = t.id AND e.active = true AND e.user_id = sp.auth_user_id
              )
            )
        )
        -- f) NEW: the signed-in user has an active subscription (unlimited)
        OR public.has_active_subscription(auth.uid())
        -- g) NEW: the signed-in student inherits a linked parent's subscription
        OR EXISTS (
          SELECT 1
          FROM public.parent_student_links psl
          JOIN public.student_profiles sp ON sp.id = psl.student_id
          WHERE sp.auth_user_id = auth.uid()
            AND public.has_active_subscription(psl.parent_user_id)
        )
      )
  );
$$;

-- 6. Convenience view for "am I unlimited?" checks in app code ----------------
CREATE OR REPLACE VIEW public.my_access AS
SELECT
  auth.uid() AS user_id,
  public.has_active_subscription(auth.uid()) AS is_unlimited;

COMMENT ON TABLE public.subscriptions IS
  'Mirrors Stripe subscription state. Written only by the Stripe webhook using the service-role client; RLS permits owners to read their own row.';