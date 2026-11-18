-- ============================================================================
-- seed/funnel_offers.sql
-- Seeds the funnel step-7 launch offer and the step-9 expansion offers.
--
-- WHY THIS IS A SEED FILE AND NOT A MIGRATION
--   `offers` holds commercial decisions (price, window, guarantee, copy) that
--   change without a schema change. Putting them in a migration means every price
--   tweak is a migration and a deploy; putting them in a seed file means an admin
--   can change them in the database and the code follows, because
--   `src/lib/pricing/launch-offer.ts` reads the row rather than hardcoding it.
--
-- IMPORTANT - THE STRIPE PRICE ID
--   `stripe_price_id` is left NULL here on purpose. It must be filled in with a
--   real one-time Price created in the Stripe dashboard at the offer amount, in
--   AUD. Until it is set, `canClaimOffer` returns null and the checkout refuses
--   the offer rather than charging a guessed amount - which is the correct
--   failure mode, and the same rule `src/lib/pricing/catalog.ts` applies to
--   subscription prices.
--
--   Create it with:
--     stripe prices create --unit-amount=15000 --currency=aud \
--       --product="Exam Pack - Launch Offer"
--   then:
--     update public.offers set stripe_price_id = '<price_...>' where slug = 'launch-150';
--
-- Idempotent: safe to re-run. Amounts are only written on first insert so an
-- admin's later edits are not silently reverted by a re-seed.
-- ============================================================================

-- Step 7: the one-time $150 launch offer.
INSERT INTO public.offers (
  slug, name, description, kind,
  stripe_price_id,
  original_amount_cents, offer_amount_cents, currency,
  active, guarantee_days, per_user_window_hours, per_user_limit,
  eligible_from_stage, config
)
VALUES (
  'launch-150',
  'Complete Exam Pack',
  'Everything your family needs from diagnosis to exam day: six full papers, unlimited AI writing marks, the deeper analytics and an adaptive weekly study plan.',
  'LAUNCH_ONE_TIME',
  NULL,
  -- Anchor. $297 is the sum of the pack bought as individual tests, which is a
  -- real number the parent could verify rather than an invented "was" price.
  -- Inventing an anchor is misleading conduct under the Australian Consumer Law.
  29700,
  15000,
  'AUD',
  true,
  14,
  72,
  1,
  'PAYWALL_READY',
  '{
    "includes": [
      "6 full-length exam papers across NAPLAN, Selective, Scholarship and Olympiad",
      "Unlimited AI writing marks with criterion-level feedback",
      "Time-per-question diagnostics and full question-level review",
      "Progress trend across every attempt",
      "An adaptive weekly study plan sized to your exam date",
      "A 14-day money-back guarantee"
    ]
  }'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- Step 9: the writing booster, cross-sold after the writing section shows up as
-- the weakest area in a report.
INSERT INTO public.offers (
  slug, name, description, kind,
  stripe_price_id,
  original_amount_cents, offer_amount_cents, currency,
  active, guarantee_days, per_user_window_hours, per_user_limit,
  eligible_from_stage, config
)
VALUES (
  'writing-booster',
  'Writing Booster',
  'Twelve additional AI-marked writing tasks with criterion-level feedback against the official rubric, plus a model answer for each.',
  'WRITING_BOOSTER',
  NULL,
  9900,
  6900,
  'AUD',
  true,
  14,
  NULL,
  1,
  'CUSTOMER',
  '{
    "includes": [
      "12 additional AI-marked writing tasks",
      "Criterion-level feedback against the official rubric",
      "A model answer and an improvement plan for each task",
      "A 14-day money-back guarantee"
    ]
  }'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- Step 9: the sibling offer. Priced as "the same, for the second child" rather
-- than as a discount, because the consistency argument is stronger than the
-- saving - the parent has already decided the approach works.
INSERT INTO public.offers (
  slug, name, description, kind,
  stripe_price_id,
  original_amount_cents, offer_amount_cents, currency,
  active, guarantee_days, per_user_window_hours, per_user_limit,
  eligible_from_stage, config
)
VALUES (
  'sibling-pack',
  'Second Child Pack',
  'The same complete pack for another child, with their own readiness report, gap list and adaptive study plan.',
  'SIBLING',
  NULL,
  15000,
  9900,
  'AUD',
  true,
  14,
  NULL,
  3,
  'CUSTOMER',
  '{
    "includes": [
      "Everything in the Complete Exam Pack, for one more child",
      "Their own readiness report and topic gap list",
      "Their own adaptive weekly study plan",
      "A 14-day money-back guarantee"
    ]
  }'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- Verify what was seeded.
-- select slug, name, offer_amount_cents, original_amount_cents,
--        guarantee_days, per_user_window_hours, eligible_from_stage,
--        stripe_price_id is not null as has_price
-- from public.offers order by eligible_from_stage, slug;
