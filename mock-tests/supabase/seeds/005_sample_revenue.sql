-- ============================================================================
-- seeds/005_sample_revenue.sql
--
-- WHAT THIS UNBLOCKS
--   Two pending areas read purchase history, and both were dead against zero rows:
--
--   * N-5 sibling offer / N-8 one-tap re-purchase. `siblingEligibility()` requires
--     a FIRST PURCHASE before it will offer a sibling pack, so with no purchases
--     every family is `not_customer` and the whole expand step is unreachable - no
--     matter how correct the rule is. This seed gives a subset of families a first
--     purchase so the eligible path can actually be exercised.
--   * The entitlement path (`has_entitlement`, bundle fulfilment via product_tests).
--     A purchase with no entitlements is a receipt for nothing.
--
--   It does NOT make A8/A9/A10 render. Those read `fact_order` / `fact_subscription`,
--   which belong to backlog items 14-15 and do not exist yet; seeding revenue
--   tables cannot substitute for an ingestion pipeline. What it does is give those
--   items an app-side history to reconcile against once the loader exists.
--
-- provider = 'sample', NOT 'Stripe'
--   Deliberate. These are not Stripe objects and must never be mistaken for
--   ingested ones: item 15 exists to compare app-side `purchases` with Stripe
--   charges, and a fixture that impersonated the provider would corrupt that
--   comparison the first time it ran.
--
-- WHAT IS NOT FAKE HERE
--   Products are the REAL catalogue rows (`Complete Exam Pack`, created by
--   `seed/expansion_catalog.sql`, with its real bundle in `product_tests`).
--   Entitlements are derived from `product_tests`, so a purchase grants exactly what
--   the real webhook would grant - not a hand-written list that could drift.
--
-- Deterministic. Reserved prefixes:
--   54000000-… purchases   55000000-… entitlements   56000000-… subscriptions
-- Idempotent: guarded by ON CONFLICT on primary keys.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Purchases, spread across ten months
-- ----------------------------------------------------------------------------
INSERT INTO public.purchases
  (id, user_id, provider, provider_ref, total_amount_cents, currency, status,
   created_at, stripe_customer_id, product_id, payment_intent)
SELECT
  ('54000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
  ('5b000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
  'sample',
  'pi_sample_' || lpad(n::text, 4, '0'),
  15000,
  'AUD',
  'COMPLETED',
  now() - make_interval(days => 12 + ((n * 17) % 290)),
  'cus_sample_' || lpad(n::text, 4, '0'),
  (SELECT p.id FROM public.products p WHERE p.name = 'Complete Exam Pack' LIMIT 1),
  'pi_sample_' || lpad(n::text, 4, '0')
FROM generate_series(1, 24) AS n
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. Entitlements, derived from the bundle the pack actually contains
-- ----------------------------------------------------------------------------
-- This is exactly what the Stripe webhook grants for a bundle purchase, so
-- `has_entitlement` answers the same way here as it would after a real payment.
INSERT INTO public.entitlements (id, user_id, purchase_id, test_id, active, created_at)
SELECT
  ('55000000-0000-4000-8000-'
     || lpad(to_hex(row_number() OVER (ORDER BY pu.id, pt.test_id)), 12, '0'))::uuid,
  pu.user_id,
  pu.id,
  pt.test_id,
  true,
  pu.created_at
FROM public.purchases pu
JOIN public.product_tests pt ON pt.product_id = pu.product_id
WHERE pu.id::text LIKE '54000000-%'
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. Subscriptions - five live, three cancelled
-- ----------------------------------------------------------------------------
-- A8's mrr/churn/renewal metrics are conditional on subscriptions existing. They
-- are not "revenue" in the fact_order sense (a subscription creates no `purchases`
-- row, which is exactly what decision 2-A recorded), so they are seeded apart from
-- the one-off purchases above and must never be netted into them.
INSERT INTO public.subscriptions
  (id, user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id,
   status, interval, current_period_end, cancel_at_period_end, trial_end,
   ended_at, created_at, updated_at)
SELECT
  ('56000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
  ('5b000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
  'cus_sample_' || lpad(n::text, 4, '0'),
  'sub_sample_' || lpad(n::text, 4, '0'),
  'price_sample_monthly',
  CASE WHEN n <= 5 THEN 'active' ELSE 'canceled' END,
  'month',
  CASE WHEN n <= 5
       THEN now() + make_interval(days => 5 + n)
       ELSE now() - make_interval(days => 10 + n) END,
  false,
  NULL,
  CASE WHEN n <= 5 THEN NULL ELSE now() - make_interval(days => 10 + n) END,
  now() - make_interval(days => 40 + n * 9),
  now()
FROM generate_series(1, 8) AS n
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 4. Print the shape - and the two things that would make this fixture wrong
-- ----------------------------------------------------------------------------
SELECT
  (SELECT COUNT(*) FROM public.purchases     WHERE id::text LIKE '54000000-%')  AS sample_purchases,
  (SELECT COUNT(*) FROM public.entitlements  WHERE id::text LIKE '55000000-%')  AS sample_entitlements,
  (SELECT COUNT(*) FROM public.subscriptions WHERE id::text LIKE '56000000-%')  AS sample_subscriptions,
  (SELECT COUNT(*) FROM public.purchases
    WHERE id::text LIKE '54000000-%' AND product_id IS NULL)                    AS purchases_without_product,
  (SELECT COUNT(*) FROM public.entitlements e
    WHERE e.id::text LIKE '55000000-%'
      AND NOT EXISTS (
        SELECT 1 FROM public.product_tests pt
         WHERE pt.test_id = e.test_id
           AND pt.product_id = (SELECT p.id FROM public.products p
                                 WHERE p.name = 'Complete Exam Pack' LIMIT 1)))
                                                                                AS entitlements_outside_bundle;
