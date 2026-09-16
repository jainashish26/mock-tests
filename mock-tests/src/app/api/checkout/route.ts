import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/client'

export async function POST(req: Request) {
  try {
    const { user } = await requireRole(['PARENT'])
    const { testId, testTitle } = await req.json()

    if (!testId) return NextResponse.json({ error: 'Missing testId' }, { status: 400 })

    const supabase = await createClient()

    // Assuming we price all individual tests at $15 for this MVP
    // If using Stripe Price IDs, we'd fetch product_tests -> products
    const amountCents = 1500

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'aud',
            product_data: {
              name: testTitle || 'Mock Test',
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/parent/store?success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/parent/store?canceled=true`,
      metadata: {
        userId: user.id,
        testId: testId,
      },
    })

    return NextResponse.json({ url: session.url })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
