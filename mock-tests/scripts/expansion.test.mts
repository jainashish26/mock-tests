/**
 * Expansion eligibility tests (N-5 sibling offer / N-8 re-purchase).
 *
 * WHY THESE PARTICULAR ASSERTIONS
 *   siblingEligibility() is the commercial gate between a family and a
 *   charge. Every branch fails SILENTLY if it breaks: a wrongly-eligible
 *   family sees a pitch they cannot redeem (or worse, redeem past the limit),
 *   and a wrongly-ineligible family is revenue the funnel never shows. The
 *   rule is extracted into a pure module precisely so each branch is provable
 *   here without a database - the same pattern as experiment_decision().
 *
 *   The IO shell (sibling-offer.ts) only fetches inputs; checkout re-checks
 *   via canClaimSiblingOffer, so a bug here is caught twice - but the rule
 *   itself must be right first.
 *
 * Run with:
 *   npm run test:expansion
 *
 * Dependency-free, matching scripts/reporting.test.mts.
 */
import {
  siblingEligibility,
  type SiblingEligibilityInput,
} from '@/lib/pricing/sibling-rules';

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean) => {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label); }
};
const eq = (label: string, actual: unknown, expected: unknown) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + '\n          actual   ' + a + '\n          expected ' + e); }
};

/** An eligible baseline; each test overrides exactly one input. */
const base = (o: Partial<SiblingEligibilityInput> = {}): SiblingEligibilityInput => ({
  offerLive: true,
  hasStripePrice: true,
  hasFirstPurchase: true,
  childCount: 2,
  redemptions: 0,
  perUserLimit: 3,
  ...o,
});

console.log('\n=== catalogue gates (operator faults, checked first) ===');
eq('no live offer -> no_offer', siblingEligibility(base({ offerLive: false })), { eligible: false, reason: 'no_offer' });
eq('offer without a Stripe price -> no_price', siblingEligibility(base({ hasStripePrice: false })), { eligible: false, reason: 'no_price' });
eq(
  'catalogue fault outranks family state (never misreported as not_customer)',
  siblingEligibility(base({ offerLive: false, hasFirstPurchase: false, childCount: 1 })).reason,
  'no_offer'
);

console.log('\n=== family gates ===');
eq('never purchased -> not_customer', siblingEligibility(base({ hasFirstPurchase: false })), { eligible: false, reason: 'not_customer' });
eq('single child -> single_child', siblingEligibility(base({ childCount: 1 })), { eligible: false, reason: 'single_child' });
eq(
  'stage gate outranks child count',
  siblingEligibility(base({ hasFirstPurchase: false, childCount: 1 })).reason,
  'not_customer'
);

console.log('\n=== the eligible case and the redemption limit ===');
eq('customer + 2 children + 0 of 3 redeemed -> eligible', siblingEligibility(base()), { eligible: true, reason: null });
eq('2 of 3 redeemed -> still eligible', siblingEligibility(base({ redemptions: 2 })).eligible, true);
eq('3 of 3 redeemed -> limit_reached', siblingEligibility(base({ redemptions: 3 })), { eligible: false, reason: 'limit_reached' });
eq(
  'four children does not bypass the purchase limit',
  siblingEligibility(base({ childCount: 4, redemptions: 3 })).reason,
  'limit_reached'
);
eq(
  'a zero limit refuses even with no redemptions (defensive)',
  siblingEligibility(base({ perUserLimit: 0 })).reason,
  'limit_reached'
);
ok(
  'eligible result carries no reason',
  siblingEligibility(base()).reason === null
);

console.log(`\n${'-'.repeat(58)}`);
console.log(`PASSED: ${pass}   FAILED: ${fail}`);
console.log(`${'-'.repeat(58)}\n`);
if (fail > 0) process.exit(1);