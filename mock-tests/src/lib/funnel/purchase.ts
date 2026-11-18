import { logger } from '@/lib/logging/logger'
import { advanceStage, trackEvent } from './track'
import { getFunnelState, patchFunnelState } from './state'
import { redeemOffer } from '@/lib/pricing/launch-offer'
import { markReferralConverted } from './referral'

/**
 * Funnel bookkeeping for payments.
 *
 * Kept out of the Stripe webhook for two reasons:
 *
 * 1. The webhook must fail loudly so Stripe retries - that is correct for
 *    entitlements, because losing one means a parent paid and got nothing.
 *    Funnel bookkeeping is the opposite: losing it costs a metric, and throwing
 *    over it would make Stripe retry a payment that already succeeded. So every
 *    function here swallows its own errors.
 *
 * 2. The same three facts (a purchase happened, which offer it redeemed, whose
 *    referral it satisfied) need recording from both the one-time and the
 *    subscription paths. Duplicating that across two webhook branches is how one
 *    of them gets forgotten.
 */

/** True when the funnel tables are reachable. */
function isConfigured(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
}

/**
 * Record a completed payment against the funnel.
 *
 * Handles first purchase, repeat purchase (step 9 expansion) and offer
 * redemption in one pass, because the webhook cannot tell them apart and should
 * not have to.
 *
 * @param kind 'one_time' for a product purchase, 'subscription' for a plan.
 */
export async function recordPurchase(params: {
  userId: string
  amountCents: number
  currency?: string
  kind: 'one_time' | 'subscription'
  interval?: 'month' | 'year' | null
  /** Stripe session or subscription id, for the event props. */
  reference?: string | null
  productId?: string | null
  /** Set when the checkout carried a launch-offer price. */
  offerSlug?: string | null
}): Promise<void> {
  if (!isConfigured() || !params.userId) return

  try {
    const state = await getFunnelState(params.userId)

    const previousLtv = state?.lifetime_value_cents ?? 0
    const previousProducts = state?.products_purchased ?? 0
    const isFirstPurchase = !state?.first_purchase_at

    const patch: Record<string, unknown> = {
      lifetime_value_cents: previousLtv + Math.max(0, params.amountCents),
      products_purchased: previousProducts + 1,
      updated_at: new Date().toISOString(),
    }

    if (isFirstPurchase) {
      patch.first_purchase_at = new Date().toISOString()
      patch.first_purchase_amount_cents = Math.max(0, params.amountCents)
    } else {
      // Step 9: a second product from an existing payer.
      patch.expanded_at = new Date().toISOString()
    }

    await patchFunnelState(params.userId, patch)

    if (isFirstPurchase) {
      await advanceStage(params.userId, 'CUSTOMER')
      // Close out the offer window so the countdown cannot keep running for a
      // parent who has already paid.
      if (state?.offer_made_at && !state.offer_redeemed_at) {
        await redeemOffer(params.userId, params.amountCents)
      }
      // Step 1: the referring parent earns their reward only now, on a real
      // payment. Never on signup, which is free to fake.
      await markReferralConverted(params.userId, params.amountCents)
    } else {
      await advanceStage(params.userId, 'EXPANDED')
    }

    await trackEvent({
      event: isFirstPurchase ? 'CHECKOUT_COMPLETED' : 'SECOND_PRODUCT_PURCHASED',
      userId: params.userId,
      props: {
        amountCents: params.amountCents,
        currency: params.currency ?? 'AUD',
        kind: params.kind,
        interval: params.interval ?? null,
        reference: params.reference ?? null,
        productId: params.productId ?? null,
        offerSlug: params.offerSlug ?? null,
        lifetimeValueCents: previousLtv + Math.max(0, params.amountCents),
        productsPurchased: previousProducts + 1,
      },
    })

    logger.info('[funnel] purchase recorded', {
      userId: params.userId,
      amountCents: params.amountCents,
      isFirstPurchase,
      kind: params.kind,
    })
  } catch (err) {
    // Swallowed on purpose - see the module comment.
    logger.error('FUNNEL_PURCHASE', '[funnel] could not record purchase', err)
  }
}

/**
 * Record a subscription renewal (step 10).
 *
 * Distinct from `recordPurchase` because a renewal is not expansion revenue - it
 * must move the stage to RENEWED and must not increment `products_purchased`, or
 * the step-9 "25% of payers buy a second product" target would be silently
 * inflated by renewals that bought nothing new.
 */
export async function recordRenewal(params: {
  userId: string
  amountCents: number
  interval?: 'month' | 'year' | null
  periodEnd?: string | null
  subscriptionId?: string | null
}): Promise<void> {
  if (!isConfigured() || !params.userId) return

  try {
    const state = await getFunnelState(params.userId)
    const previousLtv = state?.lifetime_value_cents ?? 0

    await patchFunnelState(params.userId, {
      renewed_at: new Date().toISOString(),
      // products_purchased is deliberately NOT incremented - see the comment.
      lifetime_value_cents: previousLtv + Math.max(0, params.amountCents),
      updated_at: new Date().toISOString(),
    })

    await advanceStage(params.userId, 'RENEWED')
    await trackEvent({
      event: 'RENEWAL_COMPLETED',
      userId: params.userId,
      props: {
        amountCents: params.amountCents,
        interval: params.interval ?? null,
        periodEnd: params.periodEnd ?? null,
        subscriptionId: params.subscriptionId ?? null,
      },
    })
  } catch (err) {
    logger.error('FUNNEL_RENEWAL', '[funnel] could not record renewal', err)
  }
}

/**
 * Record a cancellation, pause or churn (step 10).
 *
 * Pauses are tracked separately from cancellations because they are different
 * outcomes: a pause is a retained customer on hold, a cancellation is churn.
 * Lumping them together makes the renewal rate unreadable and hides the fact
 * that the pause option is working.
 */
export async function recordSubscriptionEnd(params: {
  userId: string
  reason: 'paused' | 'cancelled' | 'churned'
  subscriptionId?: string | null
}): Promise<void> {
  if (!isConfigured() || !params.userId) return

  try {
    const event =
      params.reason === 'paused'
        ? 'SUBSCRIPTION_PAUSED'
        : params.reason === 'cancelled'
          ? 'SUBSCRIPTION_CANCELLED'
          : 'CHURNED'

    await trackEvent({
      event,
      userId: params.userId,
      props: { reason: params.reason, subscriptionId: params.subscriptionId ?? null },
    })
  } catch (err) {
    logger.error('FUNNEL_SUB_END', '[funnel] could not record subscription end', err)
  }
}

/**
 * Update email preferences from account settings.
 *
 * Upserts, because a parent may reach settings before any lifecycle write has
 * created their funnel row, and their preference must still be stored.
 */
export async function setEmailPreference(
  userId: string,
  preference: { marketingOptIn?: boolean; suppressed?: boolean }
): Promise<boolean> {
  if (!isConfigured() || !userId) return false

  try {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (preference.marketingOptIn !== undefined) patch.marketing_opt_in = preference.marketingOptIn
    if (preference.suppressed !== undefined) patch.email_suppressed = preference.suppressed

    const ok = await patchFunnelState(userId, patch)
    if (!ok) logger.error('FUNNEL_PREFS', '[funnel] preference update failed', undefined)
    return ok
  } catch (err) {
    logger.error('FUNNEL_PREFS', '[funnel] preference update threw', err)
    return false
  }
}

