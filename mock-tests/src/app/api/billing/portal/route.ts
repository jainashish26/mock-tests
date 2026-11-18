import { NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/rbac/require-role'
import { isStripeConfigured } from '@/lib/pricing/catalog'

/**
 * GET /api/billing/portal
 *
 * Redirects the signed-in parent into the Stripe Customer Portal, where they can
 * cancel, switch between monthly and annual (with automatic proration), update
 * their card and download invoices.
 *
 * Using the hosted portal is deliberate: it removes the need to build and secure
 * subscription-management UI, and Stripe keeps it in sync with the subscription
 * lifecycle so the DB never drifts from what the customer actually did.
 *
 * `requireRole` is intentionally called outside try/catch - it signals "not
 * signed in" by throwing a redirect, which must reach Next.js untouched.
 */
export async function GET(req: Request) {
  const { user } = await requireRole(['PARENT', 'ADMIN'])

  const origin = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, '') || new URL(req.url).origin
  const pricingUrl = origin + '/pricing'

  if (!isStripeConfigured()) {
    console.error('[billing-portal] Stripe is not configured')
    return NextResponse.redirect(pricingUrl + '?billing=unavailable')
  }

  try {
    const supabase = createAdminClient()

    // Prefer the customer id persisted on the profile; fall back to the most
    // recent subscription row for accounts created before that column existed.
    let customerId: string | null = null

    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .maybeSingle()

    customerId = (profile as { stripe_customer_id?: string | null } | null)?.stripe_customer_id ?? null

    if (!customerId) {
      const { data: sub } = await supabase
        .from('subscriptions')
        .select('stripe_customer_id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      customerId = (sub as { stripe_customer_id?: string | null } | null)?.stripe_customer_id ?? null
    }

    if (!customerId) {
      // Nothing to manage - send them back to pricing rather than erroring.
      return NextResponse.redirect(pricingUrl + '?billing=no-subscription')
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: origin + '/parent/store?billing=updated',
    })

    if (!session.url) {
      console.error('[billing-portal] portal session had no url', session.id)
      return NextResponse.redirect(pricingUrl + '?billing=error')
    }

    return NextResponse.redirect(session.url)
  } catch (err) {
    console.error('[billing-portal] failed to create portal session', err)
    return NextResponse.redirect(pricingUrl + '?billing=error')
  }
}