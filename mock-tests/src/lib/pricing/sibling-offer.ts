import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logging/logger'
import { getFunnelState } from '@/lib/funnel/state'
import { getLiveOffer, type ResolvedOffer } from './launch-offer'
import { formatMoney, isStripeConfigured } from './catalog'
import {
  siblingEligibility,
  type SiblingIneligibilityReason,
  type SiblingOfferPayload,
} from './sibling-rules'

/**
 * The step-9 sibling offer (N-5 at add-child, N-8 on the dashboard).
 *
 * IO SHELL ONLY - the decision rules live in sibling-rules.ts so every branch
 * is testable in Node without a database. This module fetches the inputs:
 *
 *   - the live offers row (getLiveOffer, same authority the launch offer uses)
 *   - funnel_state.first_purchase_at  -> the CUSTOMER stage gate
 *   - parent_student_links count      -> "is there another child to buy for"
 *   - SECOND_PRODUCT_PURCHASED events with props.offerSlug = 'sibling-pack'
 *     -> redemptions against per_user_limit. Counted from the event store
 *     rather than a counter column, because the events are the same source
 *     A11 reads: one definition of "a second purchase happened".
 *
 * FAIL CLOSED. Any lookup error yields eligible=false. Selling on unknown
 * state is how a family exceeds its limit or a non-customer sees a pitch;
 * showing nothing is always safe.
 *
 * NO COUNTDOWN. The sibling offer has no per-user window. expiresAt stays
 * null and no urgency is invented (15-...md §1.2(b)).
 */

export const SIBLING_OFFER_SLUG = 'sibling-pack'

export interface SiblingOfferView {
  eligible: boolean
  reason: SiblingIneligibilityReason | 'error' | null
  childCount: number
  offer: ResolvedOffer | null
}

/** The sibling offer as this parent should see it right now. Never throws. */
export async function getSiblingOfferForUser(userId: string): Promise<SiblingOfferView> {
  const fail = (reason: SiblingOfferView['reason']): SiblingOfferView => ({
    eligible: false,
    reason,
    childCount: 0,
    offer: null,
  })

  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !isStripeConfigured()) return fail('no_offer')

    const offer = await getLiveOffer(SIBLING_OFFER_SLUG)
    if (!offer) return fail('no_offer')

    const admin = createAdminClient()
    const [state, links, redemptions] = await Promise.all([
      getFunnelState(userId),
      admin
        .from('parent_student_links')
        .select('*', { count: 'exact', head: true })
        .eq('parent_user_id', userId),
      admin
        .from('funnel_events')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('event', 'SECOND_PRODUCT_PURCHASED')
        .filter('props->>offerSlug', 'eq', SIBLING_OFFER_SLUG),
    ])

    if (links.error || redemptions.error) {
      logger.warn('[sibling] eligibility lookup failed', {
        links: links.error?.message,
        redemptions: redemptions.error?.message,
      })
      return fail('error')
    }

    const childCount = links.count ?? 0
    const decision = siblingEligibility({
      offerLive: true,
      hasStripePrice: Boolean(offer.stripePriceId),
      hasFirstPurchase: Boolean(state?.first_purchase_at),
      childCount,
      redemptions: redemptions.count ?? 0,
      perUserLimit: offer.perUserLimit,
    })

    return { eligible: decision.eligible, reason: decision.reason, childCount, offer }
  } catch (err) {
    logger.warn('[sibling] getSiblingOfferForUser threw', err)
    return fail('error')
  }
}

/**
 * Server-side checkout authority for the sibling price - the same re-check
 * pattern canClaimOffer applies to the launch offer. The page that rendered
 * the button is never trusted.
 */
export async function canClaimSiblingOffer(userId: string): Promise<ResolvedOffer | null> {
  const view = await getSiblingOfferForUser(userId)
  if (!view.eligible || !view.offer?.stripePriceId || !view.offer.fulfilmentProductId) return null
  return view.offer
}

/**
 * Display strings derived SERVER-side from the offers row, so the add-child
 * card and the dashboard card can never quote different prices and the
 * client never receives an amount it could influence.
 */
export function siblingOfferPayload(offer: ResolvedOffer): SiblingOfferPayload {
  const saving = Math.max(0, offer.originalAmountCents - offer.offerAmountCents)
  return {
    slug: offer.slug,
    name: offer.name,
    description: offer.description,
    priceLabel: formatMoney(offer.offerAmountCents, offer.currency),
    originalLabel: formatMoney(offer.originalAmountCents, offer.currency),
    savingLabel: formatMoney(saving, offer.currency),
    guaranteeDays: offer.guaranteeDays,
    includes: offer.includes,
  }
}