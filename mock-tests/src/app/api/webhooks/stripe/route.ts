import { NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe/client'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: Request) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature') as string

  let event

  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err: any) {
    console.error(`Webhook Error: ${err.message}`)
    return new NextResponse(`Webhook Error: ${err.message}`, { status: 400 })
  }

  const admin = createAdminClient()

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as any

    const userId = session.metadata?.userId
    const testId = session.metadata?.testId

    if (userId && testId) {
      // Idempotency check via processed_webhook_events
      const { data: existing } = await admin.from('processed_webhook_events').select('id').eq('event_id', event.id).single()
      
      if (!existing) {
        // Insert purchase record
        const { data: purchase } = await admin.from('purchases').insert({
          user_id: userId,
          provider: 'Stripe',
          provider_ref: session.id,
          total_amount_cents: session.amount_total,
          currency: session.currency,
          status: 'COMPLETED'
        }).select('id').single()

        if (purchase) {
          // Grant entitlement
          await admin.from('entitlements').upsert({
            user_id: userId,
            purchase_id: purchase.id,
            test_id: testId,
            active: true
          }, { onConflict: 'user_id, test_id' })

          // Mark event as processed
          await admin.from('processed_webhook_events').insert({
            provider: 'Stripe',
            event_id: event.id
          })
        }
      }
    }
  }

  return NextResponse.json({ received: true })
}
