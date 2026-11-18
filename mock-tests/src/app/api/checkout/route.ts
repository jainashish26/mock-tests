import { NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe/client'
import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/rbac/require-role'
import {
  isStripeConfigured,
  subscriptionPriceId,
  type BillingInterval,
} from '@/lib/pricing/catalog'
import { canClaimOffer } from '@/lib/pricing/launch-offer'
import { canClaimSiblingOffer, SIBLING_OFFER_SLUG } from '@/lib/pricing/sibling-offer'

/**
 * POST /api/checkout
 *
 * Creates a Stripe Checkout Session for either a one-time product or a
 * recurring subscription, then returns its URL.
 *
 * Design rules that fix defects in the previous version:
 *   - The client sends only an *identifier* (productId | interval), never an
 *     amount. Prices come from the Stripe catalog, so a tampered body cannot
 *     change what is charged and the UI price cannot drift from the real one.
 *   - `payment_method_types` is deliberately omitted. Hardcoding ['card']
 *     disables Link, wallets and Adaptive Pricing, which Stripe identifies as
 *     the highest-impact conversion lever.
 *   - `requireRole` signals "not authenticated" by throwing a redirect. That
 *     throw must be rethrown, not caught - catching it turned every logged-out
 *     request into a 500 instead of a login redirect.
 *   - Internal error detail is logged, never returned to the caller.
 */

/** Next.js control-flow errors that must propagate rather than become 500s. */
function isControlFlowError(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest
  if (typeof digest !== 'string') return false
  return (
    digest.startsWith('NEXT_REDIRECT') ||
    digest.startsWith('NEXT_NOT_FOUND') ||
    digest.startsWith('NEXT_HTTP_ERROR_FALLBACK')
  )
}

/** Prefer the configured public URL; fall back to the request origin. */
function resolveOrigin(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (configured) return configured.replace(/\/+$/, '')
  return new URL(req.url).origin
}

function parseInterval(value: unknown): BillingInterval | null {
  return value === 'monthly' || value === 'annual' ? value : null
}

export async function POST(req: Request) {
  let user: { id: string; email?: string | null }
  try {
    ({ user } = await requireRole(['PARENT', 'ADMIN']))
  } catch (err) {
    if (isControlFlowError(err)) throw err
    console.error('[checkout] auth failed', err)
    return NextResponse.json({ error: 'Authentication failed.' }, { status: 401 })
  }

  if (!isStripeConfigured()) {
    console.error('[checkout] Stripe is not configured')
    return NextResponse.json(
      { error: 'Payments are not available yet. Please try again later.' },
      { status: 503 }
    )
  }

  const body = await req.json().catch(() => null)
  const mode = body?.mode === 'subscription' ? 'subscription' : 'payment'
  const origin = resolveOrigin(req)
  // When present, checkout resolves the price from the `offers` row instead of
  // from `products`. The client still only sends an identifier, never an amount.
  const offerSlug = typeof body?.offerSlug === 'string' ? body.offerSlug.trim() : ''

  try {
    const supabase = await createClient()
    let priceId: string
    let metadata: Record<string, string> = { userId: user.id, mode }

    if (mode === 'subscription') {
      const interval = parseInterval(body?.interval)
      if (!interval) {
        return NextResponse.json({ error: 'A billing interval is required.' }, { status: 400 })
      }
      const resolved = subscriptionPriceId(interval)
      if (!resolved) {
        return NextResponse.json(
          { error: 'Subscription pricing is not configured.' },
          { status: 503 }
        )
      }
      priceId = resolved
      metadata = { ...metadata, interval }
    } else if (offerSlug) {
      // ---- Steps 7 and 9: offer prices -------------------------------------
      // Eligibility is re-checked here rather than trusted from the page that
      // rendered the button. Without this a parent could bookmark the offer URL,
      // wait for the window to close, and still check out at the launch price -
      // which would make the countdown decorative and the "one-time" claim false.
      // The sibling offer (N-5/N-8) has NO window; its gates are CUSTOMER stage,
      // a second child, and the per-user redemption limit.
      const offer =
        offerSlug === SIBLING_OFFER_SLUG
          ? await canClaimSiblingOffer(user.id)
          : await canClaimOffer(user.id)
      if (!offer || offer.slug !== offerSlug) {
        return NextResponse.json(
          { error: 'That offer is no longer available.' },
          { status: 410 }
        )
      }

      priceId = offer.stripePriceId as string
      metadata = {
        ...metadata,
        offerSlug: offer.slug,
        offerId: offer.id,
        // Server-sourced: the receipt text must not be settable by the client.
        productName: offer.name,
        // Fulfilment mapping: the webhook grants the product's bundle. Without
        // this an offer purchase recorded revenue and granted NOTHING - the
        // one-time webhook path requires productId. Both offer kinds carry it.
        ...(offer.fulfilmentProductId ? { productId: offer.fulfilmentProductId } : {}),
      }
    } else {
      const productId = typeof body?.productId === 'string' ? body.productId.trim() : ''
      if (!productId) {
        return NextResponse.json({ error: 'A product id is required.' }, { status: 400 })
      }

      const { data: product, error } = await supabase
        .from('products')
        .select('id, name, stripe_price_id, active')
        .eq('id', productId)
        .maybeSingle()

      if (error) {
        console.error('[checkout] product lookup failed', error.message)
        return NextResponse.json({ error: 'Could not load that product.' }, { status: 500 })
      }
      if (!product || product.active !== true || !product.stripe_price_id) {
        return NextResponse.json({ error: 'That product is not available.' }, { status: 404 })
      }

      // Block repeat purchase of something already owned. `entitlements` is
      // per-test and a product can bundle several tests via `product_tests`, so
      // "owned" means every test in the bundle is already active for this user.
      const { data: bundle } = await supabase
        .from('product_tests')
        .select('test_id')
        .eq('product_id', productId)

      const bundleIds = ((bundle ?? []) as unknown as { test_id: string }[])
        .map((r) => r.test_id)
        .filter(Boolean)

      if (bundleIds.length === 0) {
        // A product with no linked tests would take money and grant nothing.
        console.error('[checkout] product has no linked tests', productId)
        return NextResponse.json({ error: 'That product is not available.' }, { status: 404 })
      }

      const { data: ownedRows } = await supabase
        .from('entitlements')
        .select('test_id')
        .eq('user_id', user.id)
        .eq('active', true)
        .in('test_id', bundleIds)

      const ownedCount = new Set(
        ((ownedRows ?? []) as unknown as { test_id: string }[]).map((r) => r.test_id)
      ).size
      if (ownedCount >= bundleIds.length) {
        return NextResponse.json(
          { error: 'You already have access to this test.', owned: true },
          { status: 409 }
        )
      }

      priceId = product.stripe_price_id
      // Server-sourced name; the previous version let the client set the text
      // that appears on the customer's receipt.
      metadata = { ...metadata, productId, productName: String(product.name) }
    }

    // Reuse an existing Stripe Customer when we have one, so a parent does not
    // accumulate duplicate customer records across purchases. Defensive because
    // the column only exists once migration 010 has been applied; a Supabase
    // error surfaces as `error` (not a throw) and simply leaves this undefined.
    let customerId: string | undefined
    try {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('stripe_customer_id')
        .eq('id', user.id)
        .maybeSingle()

      if (profileError) {
        console.warn('[checkout] could not read stripe_customer_id', profileError.message)
      } else {
        customerId =
          (profile as { stripe_customer_id?: string | null } | null)?.stripe_customer_id ?? undefined
      }
    } catch (err) {
      console.warn('[checkout] stripe_customer_id lookup threw', err)
    }

    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: user.id,
      ...(customerId
        ? { customer: customerId }
        : { customer_email: user.email ?? undefined, customer_creation: 'always' as const }),
      success_url:
        process.env.STRIPE_SUCCESS_URL?.trim() ||
        origin + '/parent/store?checkout=success&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: process.env.STRIPE_CANCEL_URL?.trim() || origin + '/pricing?checkout=cancelled',
      allow_promotion_codes: true,
      metadata,
      ...(mode === 'subscription'
        ? {
            subscription_data: { metadata: { userId: user.id } },
            // Monthly <-> annual switching and cancellation are handled by the
            // hosted portal, so we do not need to build that UI.
          }
        : {}),
      // GST handling. Off unless explicitly enabled, because automatic tax
      // errors when the account has no tax registration configured.
      ...(process.env.STRIPE_AUTOMATIC_TAX === 'true'
        ? { automatic_tax: { enabled: true } }
        : {}),
    })

    if (!session.url) {
      console.error('[checkout] session created without a url', session.id)
      return NextResponse.json({ error: 'Checkout could not be started.' }, { status: 502 })
    }

    return NextResponse.json({ url: session.url, sessionId: session.id })
  } catch (err) {
    if (isControlFlowError(err)) throw err
    console.error('[checkout] session creation failed', err)
    return NextResponse.json({ error: 'Checkout could not be started.' }, { status: 500 })
  }
}