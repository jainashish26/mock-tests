import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordPurchase, recordRenewal, recordSubscriptionEnd } from '@/lib/funnel/purchase'

/**
 * POST /api/webhooks/stripe
 *
 * Stripe is the source of truth for payment state. This handler translates
 * Stripe events into local `purchases` / `entitlements` / `subscriptions` rows.
 *
 * Three properties matter more than anything else here:
 *
 * 1. VERIFY. `constructEvent` validates the `stripe-signature` header against
 *    STRIPE_WEBHOOK_SECRET. Without it anyone who knows the URL could POST a
 *    forged `checkout.session.completed` and grant themselves unlimited access.
 *
 * 2. CLAIM BEFORE WORK. The event id is inserted into `processed_webhook_events`
 *    *first*, using its UNIQUE constraint as the lock. The previous version did
 *    check-then-act and wrote the marker last, so two concurrent deliveries both
 *    passed the check, and a partial failure left the event unmarked - causing a
 *    duplicate `purchases` row on retry.
 *
 * 3. FAIL LOUDLY. Any DB failure returns 5xx and releases the claim, so Stripe
 *    retries. Returning 200 on failure tells Stripe the delivery succeeded and
 *    the entitlement is lost forever.
 */

type Admin = ReturnType<typeof createAdminClient>

/** Stripe subscription statuses we persist verbatim. */
const LIVE_STATUSES = ['trialing', 'active', 'past_due'] as const

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Stripe sometimes expands objects, sometimes returns bare ids. */
function idOf(value: unknown): string | null {
  if (typeof value === 'string') return value.length > 0 ? value : null
  if (value && typeof value === 'object' && 'id' in value) {
    return asString((value as { id?: unknown }).id)
  }
  return null
}

/**
 * Resolve the Supabase user id for a Checkout Session.
 *
 * `client_reference_id` is set server-side by /api/checkout and cannot be
 * altered by the buyer, so it is preferred over metadata.
 */
function userIdFromSession(session: Stripe.Checkout.Session): string | null {
  return asString(session.client_reference_id) ?? asString(session.metadata?.userId)
}

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    // Fail closed: never process unverified events just because config is absent.
    console.error('[webhook] STRIPE_WEBHOOK_SECRET is not configured')
    return new NextResponse('Webhook not configured', { status: 500 })
  }

  const signature = req.headers.get('stripe-signature')
  if (!signature) {
    return new NextResponse('Missing signature', { status: 400 })
  }

  // Must be the raw body - re-serialising parsed JSON breaks the signature.
  const payload = await req.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(payload, signature, secret)
  } catch (err) {
    // Deliberately generic: do not echo verification detail back to the caller.
    console.error('[webhook] signature verification failed', err)
    return new NextResponse('Invalid signature', { status: 400 })
  }

  const admin = createAdminClient()

  // ---- Claim the event (idempotency lock) ---------------------------------
  const { error: claimError } = await admin
    .from('processed_webhook_events')
    .insert({ provider: 'Stripe', event_id: event.id })

  if (claimError) {
    // 23505 = unique violation = we already handled (or are handling) this event.
    if ((claimError as { code?: string }).code === '23505') {
      return NextResponse.json({ received: true, duplicate: true })
    }
    console.error('[webhook] could not claim event', claimError.message)
    return new NextResponse('Database unavailable', { status: 500 })
  }

  try {
    await handleEvent(admin, event)
    return NextResponse.json({ received: true })
  } catch (err) {
    // Release the claim so Stripe's retry gets another chance instead of being
    // discarded as a duplicate.
    await admin.from('processed_webhook_events').delete().eq('event_id', event.id)
    console.error('[webhook] handler failed for ' + event.type, err)
    return new NextResponse('Handler failed', { status: 500 })
  }
}
// ============================================================================
// Dispatcher
// ============================================================================

async function handleEvent(admin: Admin, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
      await onCheckoutCompleted(admin, event.data.object)
      break
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await onSubscriptionSync(admin, event.data.object)
      break
    case 'customer.subscription.deleted':
      await onSubscriptionDeleted(admin, event.data.object)
      break
    case 'invoice.paid':
      await onInvoicePaid(admin, event.data.object)
      break
    case 'charge.refunded':
      await onChargeRefunded(admin, event.data.object)
      break
    case 'charge.dispute.created':
      // Disputes are handled manually, but they must be visible in logs: a lost
      // dispute means the access already granted should be revoked.
      console.warn('[webhook] dispute opened', {
        dispute: event.data.object?.id,
        charge: idOf(event.data.object?.charge),
        reason: event.data.object?.reason,
      })
      break
    default:
      // Unknown/ignored types are acknowledged with 200. Returning an error would
      // make Stripe retry events we intentionally do not act on.
      break
  }
}

// ============================================================================
// checkout.session.completed
// ============================================================================

async function onCheckoutCompleted(admin: Admin, session: Stripe.Checkout.Session): Promise<void> {
  // THE critical guard. `completed` means the customer finished the flow, NOT
  // that funds were captured - async methods (bank transfer, some wallets)
  // complete while still unpaid. The previous handler granted access here
  // unconditionally, which was free access for anyone using such a method.
  if (session.payment_status !== 'paid') {
    console.warn('[webhook] session not paid yet', {
      session: session.id,
      paymentStatus: session.payment_status,
    })
    return
  }

  const userId = userIdFromSession(session)
  if (!userId) {
    // Cannot attribute the payment. Loud, but not thrown: throwing would make
    // Stripe retry forever on an event that can never succeed.
    console.error('[webhook] paid session with no user reference', session.id)
    return
  }

  await persistCustomerId(admin, userId, idOf(session.customer))

  if (session.mode === 'subscription') {
    const subscriptionId = idOf(session.subscription)
    if (!subscriptionId) {
      console.error('[webhook] subscription session had no subscription', session.id)
      return
    }
    // Retrieve rather than trust the session payload: the session does not carry
    // status, interval or period end, which is what we actually persist.
    const subscription = await stripe.subscriptions.retrieve(subscriptionId)
    await upsertSubscription(admin, userId, subscription)

    // Funnel bookkeeping. Deliberately after the entitlement is written and
    // never throwing: a lost metric must not cause Stripe to retry a payment
    // that has already been fulfilled.
    await recordPurchase({
      userId,
      amountCents: session.amount_total ?? 0,
      currency: String(session.currency ?? 'aud').toUpperCase(),
      kind: 'subscription',
      interval: asInterval(subscription.items?.data?.[0]?.price?.recurring?.interval),
      reference: subscriptionId,
      offerSlug: asString(session.metadata?.offerSlug),
    })
    return
  }

  let productId = asString(session.metadata?.productId)
  if (!productId) {
    // Defence in depth: offer sessions created before checkout carried the
    // fulfilment mapping still resolve it server-side from offers.config,
    // rather than recording revenue and granting nothing.
    const offerSlug = asString(session.metadata?.offerSlug)
    if (offerSlug) productId = await productForOffer(admin, offerSlug)
  }
  if (!productId) {
    console.error('[webhook] paid one-time session with no productId or offer mapping', session.id)
    return
  }
  await grantOneTimePurchase(admin, userId, session, productId)

  await recordPurchase({
    userId,
    amountCents: session.amount_total ?? 0,
    currency: String(session.currency ?? 'aud').toUpperCase(),
    kind: 'one_time',
    reference: session.id,
    productId,
    offerSlug: asString(session.metadata?.offerSlug),
  })
}

/** Stripe's interval strings narrowed to the two this platform sells. */
function asInterval(value: unknown): 'month' | 'year' | null {
  return value === 'month' || value === 'year' ? value : null
}

/**
 * Resolve an offer's fulfilment product from offers.config.productId.
 * Server-side only: the mapping is commercial configuration, never client input.
 */
async function productForOffer(admin: Admin, slug: string): Promise<string | null> {
  const { data, error } = await admin
    .from('offers')
    .select('config')
    .eq('slug', slug)
    .maybeSingle()
  if (error || !data) return null
  const pid = (data.config as Record<string, unknown> | null)?.productId
  return typeof pid === 'string' && pid.length > 0 ? pid : null
}

/**
 * Record a completed one-time purchase and grant access to EVERY test in the
 * product bundle.
 *
 * The previous implementation granted a single entitlement from
 * `metadata.testId`, so any product linked to more than one test via
 * `product_tests` silently under-delivered: the parent paid for a bundle and
 * received one test.
 */
async function grantOneTimePurchase(
  admin: Admin,
  userId: string,
  session: Stripe.Checkout.Session,
  productId: string
): Promise<void> {
  // Upsert on provider_ref so a duplicate delivery cannot create a second
  // purchase row for the same payment.
  const { data: purchase, error } = await admin
    .from('purchases')
    .upsert(
      {
        user_id: userId,
        provider: 'Stripe',
        provider_ref: session.id,
        product_id: productId,
        payment_intent: idOf(session.payment_intent),
        stripe_customer_id: idOf(session.customer),
        total_amount_cents: session.amount_total ?? 0,
        currency: String(session.currency ?? 'aud').toUpperCase(),
        status: 'COMPLETED',
      },
      { onConflict: 'provider_ref' }
    )
    .select('id')
    .single()

  if (error || !purchase) {
    throw new Error('purchase upsert failed: ' + (error?.message ?? 'no row returned'))
  }

  const { data: bundle, error: bundleError } = await admin
    .from('product_tests')
    .select('test_id')
    .eq('product_id', productId)

  if (bundleError) throw new Error('product_tests lookup failed: ' + bundleError.message)

  const testIds = ((bundle ?? []) as unknown as { test_id: string }[])
    .map((r) => r.test_id)
    .filter(Boolean)
  if (testIds.length === 0) {
    // Money taken, nothing to grant. This is a catalog configuration error and
    // must be visible rather than silently succeeding.
    console.error('[webhook] product has no linked tests', { productId, session: session.id })
    return
  }

  const { error: entitlementError } = await admin.from('entitlements').upsert(
    testIds.map((testId: string) => ({
      user_id: userId,
      purchase_id: purchase.id,
      test_id: testId,
      active: true,
    })),
    { onConflict: 'user_id,test_id' }
  )

  if (entitlementError) throw new Error('entitlement grant failed: ' + entitlementError.message)
}

/** Persist the Stripe Customer link so the portal and future checkouts reuse it. */
async function persistCustomerId(admin: Admin, userId: string, customerId: string | null): Promise<void> {
  if (!customerId) return
  const { error } = await admin
    .from('profiles')
    .update({ stripe_customer_id: customerId })
    .eq('id', userId)
    .is('stripe_customer_id', null)

  // A missing column (migration not yet applied) must not fail the whole event.
  if (error) console.warn('[webhook] could not persist customer id', error.message)
}
// ============================================================================
// Subscription lifecycle
// ============================================================================

/** Unix seconds -> ISO, or null. Stripe timestamps are seconds, not millis. */
function toIso(seconds: unknown): string | null {
  return typeof seconds === 'number' && seconds > 0
    ? new Date(seconds * 1000).toISOString()
    : null
}

/**
 * Find the local user for a subscription.
 *
 * `checkout.session.completed` gives us the user directly, but later lifecycle
 * events (`customer.subscription.updated`, `invoice.paid`) arrive from Stripe
 * with only the subscription. Metadata set at checkout is tried first, then the
 * customer link we persisted earlier.
 */
async function resolveSubscriptionUser(admin: Admin, sub: Stripe.Subscription): Promise<string | null> {
  const fromMetadata = asString(sub.metadata?.userId)
  if (fromMetadata) return fromMetadata

  const customerId = idOf(sub.customer)
  if (!customerId) return null

  const { data: existing } = await admin
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing?.user_id) return existing.user_id

  const { data: profile } = await admin
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()

  return (profile as { id?: string } | null)?.id ?? null
}

/** Mirror a Stripe subscription into the local `subscriptions` row. */
async function upsertSubscription(
  admin: Admin,
  userId: string,
  sub: Stripe.Subscription
): Promise<void> {
  const customerId = idOf(sub.customer)
  if (!customerId) throw new Error('subscription ' + sub.id + ' has no customer')

  const item = sub.items?.data?.[0]
  const price = item?.price
  const priceId = asString(price?.id)
  const interval = price?.recurring?.interval

  if (!priceId) throw new Error('subscription ' + sub.id + ' has no price')
  // Anything other than month/year (e.g. a multi-year plan) needs a deliberate
  // decision about how access is granted, so refuse rather than guess.
  if (interval !== 'month' && interval !== 'year') {
    throw new Error('unsupported subscription interval: ' + String(interval))
  }

  // `current_period_end` and `cancel_at_period_end` moved from the subscription
  // onto each item in later Stripe API versions. Reading both shapes keeps this
  // correct whichever version the account is pinned to.
  type PeriodShape = { current_period_end?: number; cancel_at_period_end?: boolean }
  const subShape = sub as unknown as PeriodShape
  const itemShape = item as unknown as PeriodShape | undefined

  const periodEnd = toIso(itemShape?.current_period_end ?? subShape.current_period_end)
  const cancelAtPeriodEnd =
    itemShape?.cancel_at_period_end === true || subShape.cancel_at_period_end === true
  const status = asString(sub.status) ?? 'incomplete'

  const { error } = await admin
    .from('subscriptions')
    .upsert(
      {
        user_id: userId,
        stripe_customer_id: customerId,
        stripe_subscription_id: sub.id,
        stripe_price_id: priceId,
        status,
        interval,
        current_period_end: periodEnd,
        cancel_at_period_end: cancelAtPeriodEnd,
        trial_end: toIso(sub.trial_end),
        ended_at: toIso(sub.ended_at),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'stripe_subscription_id' }
    )

  if (error) throw new Error('subscription upsert failed: ' + error.message)

  await persistCustomerId(admin, userId, customerId)

  if (!(LIVE_STATUSES as readonly string[]).includes(status)) {
    console.warn('[webhook] subscription not live', { subscription: sub.id, status })
  }
}

async function onSubscriptionSync(admin: Admin, sub: Stripe.Subscription): Promise<void> {
  const userId = await resolveSubscriptionUser(admin, sub)
  if (!userId) {
    console.error('[webhook] could not attribute subscription', sub?.id)
    return
  }
  await upsertSubscription(admin, userId, sub)
}

/**
 * Cancellation. The row is kept and marked canceled rather than deleted:
 * `has_active_subscription` derives access from status, so marking is enough to
 * revoke it, and the history stays available for support and revenue reporting.
 */
async function onSubscriptionDeleted(admin: Admin, sub: Stripe.Subscription): Promise<void> {
  const subscriptionId = asString(sub.id)
  if (!subscriptionId) return

  const { error } = await admin
    .from('subscriptions')
    .update({
      status: 'canceled',
      ended_at: toIso(sub.ended_at) ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', subscriptionId)

  if (error) throw new Error('subscription cancel failed: ' + error.message)

  // Step 10 churn tracking. Recorded after the entitlement is revoked and never
  // thrown: the funnel must not be able to make Stripe retry a cancellation that
  // has already been applied, or the parent keeps access they asked to lose.
  const userId = await resolveSubscriptionUser(admin, sub)
  if (userId) {
    await recordSubscriptionEnd({
      userId,
      // A subscription that ended after payment failure is churn; one the parent
      // cancelled themselves is a cancellation. The distinction matters because
      // the two have completely different win-back economics.
      reason: sub.cancel_at_period_end ? 'cancelled' : 'churned',
      subscriptionId,
    })
  }
}

/** A paid invoice renews the period; re-sync so access extends correctly. */
async function onInvoicePaid(admin: Admin, invoice: Stripe.Invoice): Promise<void> {
  if (invoice.status !== 'paid' && invoice.paid !== true) return

  const subscriptionId = idOf(invoice.subscription)
  // No subscription means a one-off invoice, which checkout already fulfilled.
  if (!subscriptionId) return

  const sub = await stripe.subscriptions.retrieve(subscriptionId)
  const userId = await resolveSubscriptionUser(admin, sub)
  if (!userId) {
    console.error('[webhook] could not attribute renewed subscription', subscriptionId)
    return
  }
  await upsertSubscription(admin, userId, sub)

  // `subscription_create` is the first invoice, already counted by the checkout
  // handler. Only a cycle invoice is a genuine step-10 renewal - recording the
  // first one here too would double-count revenue and inflate the renewal rate.
  if (invoice.billing_reason === 'subscription_cycle') {
    await recordRenewal({
      userId,
      amountCents: invoice.amount_paid ?? invoice.amount_due ?? 0,
      interval: asInterval(sub.items?.data?.[0]?.price?.recurring?.interval),
      periodEnd: toIso(sub.current_period_end),
      subscriptionId,
    })
  }
}

// ============================================================================
// Refunds
// ============================================================================

/**
 * Revoke access on a full refund.
 *
 * Without this a refunded parent keeps unlimited access or their purchased tests
 * indefinitely. Partial refunds are logged only - revoking everything for a
 * partial refund would be wrong.
 */
async function onChargeRefunded(admin: Admin, charge: Stripe.Charge): Promise<void> {
  const fullyRefunded = charge.refunded === true
  if (!fullyRefunded) {
    console.warn('[webhook] partial refund, access left unchanged', {
      charge: charge.id,
      amount: charge.amount,
      refunded: charge.amount_refunded,
    })
    return
  }

  // Subscription invoice refund -> revoke unlimited access.
  const invoiceId = idOf(charge.invoice)
  if (invoiceId) {
    const invoice = await stripe.invoices.retrieve(invoiceId)
    const subscriptionId = idOf(invoice.subscription)
    if (subscriptionId) {
      const { error } = await admin
        .from('subscriptions')
        .update({
          status: 'canceled',
          ended_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('stripe_subscription_id', subscriptionId)

      if (error) throw new Error('refund revoke failed: ' + error.message)
      return
    }
  }

  // One-time purchase refund -> deactivate the entitlements it granted.
  const paymentIntent = idOf(charge.payment_intent)
  if (!paymentIntent) {
    console.warn('[webhook] refund with no payment intent', charge?.id)
    return
  }

  const { data: purchase, error } = await admin
    .from('purchases')
    .select('id')
    .eq('payment_intent', paymentIntent)
    .maybeSingle()

  if (error) throw new Error('refund purchase lookup failed: ' + error.message)
  if (!purchase) {
    console.warn('[webhook] refund for unrecognised charge', { charge: charge?.id, paymentIntent })
    return
  }

  const { error: revokeError } = await admin
    .from('entitlements')
    .update({ active: false })
    .eq('purchase_id', purchase.id)

  if (revokeError) throw new Error('entitlement revoke failed: ' + revokeError.message)
}