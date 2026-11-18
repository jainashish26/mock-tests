import type { SupabaseClient } from '@supabase/supabase-js'
import { stripe } from '@/lib/stripe/client'

/**
 * Pricing catalog.
 *
 * Single source of truth for what /pricing shows and what /api/checkout may
 * charge. Prices are read from Stripe rather than hardcoded so the displayed
 * amount cannot drift from the amount charged - that drift is exactly the bug
 * the previous inline `unit_amount: 1500` introduced.
 *
 * IMPORTANT - build safety: every function here degrades to `null`/`[]` instead
 * of throwing. /pricing is statically prerendered, and this repo deliberately
 * keeps `next build` green without Stripe credentials (see the lazy Proxy in
 * `src/lib/stripe/client.ts`). Throwing here would break the build for anyone
 * who has not configured keys yet.
 */

export type BillingInterval = 'monthly' | 'annual'

export interface PriceInfo {
  stripePriceId: string
  amountCents: number
  currency: string
}

export interface SubscriptionTier {
  id: 'unlimited'
  name: string
  tagline: string
  features: string[]
  prices: Record<BillingInterval, PriceInfo>
  /** Whole-number percentage saved by paying annually. Derived from real prices. */
  annualSavingsPercent: number
}

export interface ALaCarteProduct {
  id: string
  name: string
  description: string | null
  priceCents: number
  currency: string
  stripePriceId: string | null
}

/** Raw shape of the `products` row read below (snake_case, as stored). */
interface ProductRow {
  id: string
  name: string
  description: string | null
  price_cents: number
  currency: string | null
  stripe_price_id: string | null
}

/** Subscription Price IDs come from env so test/live never collide in source. */
const SUBSCRIPTION_PRICE_IDS: Record<BillingInterval, string | undefined> = {
  monthly: process.env.STRIPE_PRICE_UNLIMITED_MONTHLY,
  annual: process.env.STRIPE_PRICE_UNLIMITED_ANNUAL,
}

const UNLIMITED_FEATURES = [
  'Unlimited access to every premium test',
  'All year levels (3-8) and all exam types',
  'AI writing feedback on every attempt',
  'Parent progress reports for your children',
  'Cancel anytime from the billing portal',
]

/**
 * True when a usable Stripe secret key is present.
 *
 * Guards against placeholder values: `.env.local` currently ships two-character
 * stubs, and constructing a client with one fails later with a confusing auth
 * error. Checking the shape up front lets callers fall back cleanly instead of
 * surfacing a cryptic 500.
 */
export function isStripeConfigured(): boolean {
  const key = process.env.STRIPE_SECRET_KEY ?? ''
  return /^sk_(test|live)_[A-Za-z0-9]{16,}$/.test(key)
}

/** Resolve the Stripe Price ID for an interval, or null when unconfigured. */
export function subscriptionPriceId(interval: BillingInterval): string | null {
  const id = SUBSCRIPTION_PRICE_IDS[interval]
  return id && id.trim().length > 0 ? id.trim() : null
}

/** AUD-first formatting; drops decimals for whole-dollar amounts. */
export function formatMoney(cents: number, currency = 'AUD'): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

/** Per-month price of an annual plan, for "$X/month billed yearly". */
export function annualPerMonthCents(annualCents: number): number {
  return Math.round(annualCents / 12)
}

/**
 * Load the subscription tier with live amounts from Stripe.
 * Returns null when Stripe is not configured or the prices cannot be read.
 */
export async function getSubscriptionTier(): Promise<SubscriptionTier | null> {
  const monthlyId = subscriptionPriceId('monthly')
  const annualId = subscriptionPriceId('annual')
  if (!monthlyId || !annualId || !isStripeConfigured()) return null

  try {
    const [monthly, annual] = await Promise.all([
      stripe.prices.retrieve(monthlyId),
      stripe.prices.retrieve(annualId),
    ])

    // Only fixed-amount recurring prices can be quoted as a plan price.
    if (monthly.unit_amount == null || annual.unit_amount == null) return null

    // Fail closed on a misconfigured catalog: a "monthly" price that actually
    // recurs yearly would silently quote the wrong amount to parents.
    if (monthly.recurring?.interval !== 'month' || annual.recurring?.interval !== 'year') {
      console.error('[pricing] subscription price intervals are wrong', {
        monthly: monthly.recurring?.interval,
        annual: annual.recurring?.interval,
      })
      return null
    }

    const savings = monthly.unit_amount > 0
      ? Math.round((1 - annual.unit_amount / 12 / monthly.unit_amount) * 100)
      : 0

    return {
      id: 'unlimited',
      name: 'Unlimited',
      tagline: 'Every test, every year level, no per-test fees.',
      features: UNLIMITED_FEATURES,
      prices: {
        monthly: {
          stripePriceId: monthly.id,
          amountCents: monthly.unit_amount,
          currency: (monthly.currency || 'aud').toUpperCase(),
        },
        annual: {
          stripePriceId: annual.id,
          amountCents: annual.unit_amount,
          currency: (annual.currency || 'aud').toUpperCase(),
        },
      },
      annualSavingsPercent: Math.max(0, savings),
    }
  } catch (err) {
    console.error('[pricing] could not load subscription prices', err)
    return null
  }
}

/**
 * Load active one-time products from the `products` table.
 *
 * Takes the Supabase client from the caller so RLS behaviour stays explicit at
 * the call site. Only rows that actually have a Stripe Price are returned - a
 * product without `stripe_price_id` cannot be checked out, and showing it would
 * produce a button that always fails.
 */
export async function getALaCarteProducts(
  supabase: SupabaseClient
): Promise<ALaCarteProduct[]> {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, description, price_cents, currency, stripe_price_id')
      .eq('active', true)
      .not('stripe_price_id', 'is', null)
      .order('price_cents', { ascending: true })
      .limit(24)

    if (error) {
      console.error('[pricing] product query failed', error.message)
      return []
    }

    const rows = (data ?? []) as unknown as ProductRow[]

    return rows
      .filter((r) => typeof r.price_cents === 'number' && Boolean(r.stripe_price_id))
      .map((r) => ({
        id: String(r.id),
        name: String(r.name),
        description: r.description ? String(r.description) : null,
        priceCents: r.price_cents,
        currency: String(r.currency || 'AUD').toUpperCase(),
        stripePriceId: String(r.stripe_price_id),
      }))
  } catch (err) {
    console.error('[pricing] could not load products', err)
    return []
  }
}
