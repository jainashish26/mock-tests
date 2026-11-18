-- ============================================================================
-- seed/expansion_catalog.sql
-- The fulfilment catalogue for funnel steps 7 and 9 (N-5 / N-8).
--
-- WHY THIS EXISTS
--   `offers` carries the commercial promise; `products` + `product_tests`
--   carry what a purchase actually GRANTS. The Stripe webhook fulfils a
--   one-time payment by granting every test in the purchased product's
--   bundle, and an offer checkout had no product mapping at all - a paid
--   offer session would have recorded revenue and granted nothing.
--   `offers.config.productId` is that mapping, read server-side by
--   /api/checkout (into session metadata) and by the webhook as a fallback.
--
-- WHAT THE PACK CONTAINS IS DERIVED, NOT INVENTED
--   The bundle is every PUBLISHED premium (is_free = false) test that exists
--   at seed time. Today that is two papers; the offer copy's "six papers"
--   describes the catalogue as it grows, and new premium tests join the
--   bundle by re-running this seed. Nothing here hardcodes a test id.
--
-- ENTITLEMENT SEMANTICS (documented, not hidden)
--   Entitlements are per-PARENT (user_id, test_id). A sibling purchase
--   re-grants the same bundle idempotently; the second child's marginal
--   value is their own readiness report, gap list and study plan, which are
--   per-child by construction. The purchase row and the EXPANDED funnel
--   stage record the expansion revenue either way.
--
-- Idempotent: safe to re-run. The product's stripe_price_id stays NULL on
-- purpose - the pack is sold through OFFERS (launch-150, sibling-pack),
-- never à la carte, so it must not appear in getALaCarteProducts().
-- ============================================================================

INSERT INTO public.products (name, description, price_cents, currency, stripe_price_id, active)
SELECT 'Complete Exam Pack',
       'Every premium paper on the platform, with AI writing marks, full question review and an adaptive study plan for each child.',
       15000, 'AUD', NULL, true
WHERE NOT EXISTS (SELECT 1 FROM public.products WHERE name = 'Complete Exam Pack');

-- Bundle = every published premium test. ON CONFLICT keeps re-runs cheap.
INSERT INTO public.product_tests (product_id, test_id)
SELECT p.id, t.id
FROM public.products p
CROSS JOIN public.tests t
WHERE p.name = 'Complete Exam Pack'
  AND t.is_free = false
  AND t.status = 'PUBLISHED'
ON CONFLICT DO NOTHING;

-- Map the offers onto the pack. Only written when absent, so an admin's
-- later remapping is never silently reverted by a re-seed.
UPDATE public.offers o
   SET config = jsonb_set(o.config, '{productId}', to_jsonb(p.id::text)),
       updated_at = now()
FROM public.products p
WHERE p.name = 'Complete Exam Pack'
  AND o.slug IN ('launch-150', 'sibling-pack')
  AND (o.config->>'productId') IS NULL;