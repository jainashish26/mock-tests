/**
 * Sibling-offer eligibility rules (N-5 / N-8) - PURE, no IO.
 *
 * WHY A SEPARATE MODULE
 *   The decision "may this family see/buy the Second Child Pack right now"
 *   is a commercial rule, and commercial rules that live inside IO code are
 *   rules nobody can test without a database. Same pattern as
 *   reporting/format.ts and experiment_decision(): the rule is extracted so
 *   every branch is provable in Node, and the IO shell (sibling-offer.ts)
 *   only fetches the inputs.
 *
 * THE RULES, EACH TRACEABLE
 *   - offer live + priced: an offer without a Stripe price must never render
 *     a button that always fails (catalog.ts convention), and checkout
 *     refuses it anyway.
 *   - CUSTOMER stage: offers.eligible_from_stage = 'CUSTOMER'. The sibling
 *     pitch is for parents who already decided the approach works - pitching
 *     a second pack to someone who never bought the first is nonsense.
 *   - >= 2 children: the pack is "for another child". A single-child family
 *     has nobody to buy it for; showing the card would be inventing a need.
 *   - redemptions < per_user_limit: the seeded limit is 3 (a four-child
 *     family buys at most three sibling packs). Counted from real
 *     SECOND_PRODUCT_PURCHASED events, not from a counter that can drift.
 *
 * NO COUNTDOWN. The sibling offer has per_user_window_hours = NULL. There is
 * no expiry to enforce and none is invented - 15-...md §1.2(b) forbids
 * fabricated scarcity, and a permanent honest price needs no timer.
 */

export interface SiblingEligibilityInput {
  /** The offers row exists, is active, and is inside its start/end dates. */
  offerLive: boolean
  /** The offer carries a Stripe price id (checkout can actually charge it). */
  hasStripePrice: boolean
  /** funnel_state.first_purchase_at is set - the family is a CUSTOMER. */
  hasFirstPurchase: boolean
  /** Current parent_student_links count. */
  childCount: number
  /** Completed sibling-pack purchases already made by this parent. */
  redemptions: number
  /** offers.per_user_limit. */
  perUserLimit: number
}

export type SiblingIneligibilityReason =
  | 'no_offer'
  | 'no_price'
  | 'not_customer'
  | 'single_child'
  | 'limit_reached'

export interface SiblingEligibilityResult {
  eligible: boolean
  /** Null when eligible. For logs and the API; never shown as copy to parents. */
  reason: SiblingIneligibilityReason | null
}

/**
 * Decide eligibility. Order matters: catalogue problems first (they are
 * operator faults), then family state. The first failing rule is the reason,
 * so a misconfigured catalogue is never misreported as "not a customer".
 */
export function siblingEligibility(input: SiblingEligibilityInput): SiblingEligibilityResult {
  if (!input.offerLive) return { eligible: false, reason: 'no_offer' }
  if (!input.hasStripePrice) return { eligible: false, reason: 'no_price' }
  if (!input.hasFirstPurchase) return { eligible: false, reason: 'not_customer' }
  if (input.childCount < 2) return { eligible: false, reason: 'single_child' }
  if (input.redemptions >= input.perUserLimit) return { eligible: false, reason: 'limit_reached' }
  return { eligible: true, reason: null }
}

/**
 * The wire shape both surfaces render (add-child card and dashboard card).
 * Labels are formatted SERVER-side from the offers row so the two surfaces
 * can never quote different prices, and the client never receives an amount
 * it could influence - only display strings derived from the catalogue.
 */
export interface SiblingOfferPayload {
  slug: string
  name: string
  description: string | null
  /** e.g. "$99" - the amount actually charged, from the offers row. */
  priceLabel: string
  /** e.g. "$150" - the anchor, struck through. */
  originalLabel: string
  /** e.g. "$51" - derived saving as a NUMBER, never a typed-in percentage. */
  savingLabel: string
  guaranteeDays: number
  includes: string[]
}