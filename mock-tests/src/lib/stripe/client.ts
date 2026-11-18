import Stripe from 'stripe'

let client: Stripe | null = null

function getStripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY is missing.')
    }
    client = new Stripe(key, {
      apiVersion: '2025-02-24.acacia',
      typescript: true,
    })
  }
  return client
}

/**
 * Lazy Stripe singleton.
 *
 * The real client — and therefore STRIPE_SECRET_KEY — is only required when a
 * payments code path actually runs. This keeps `next build` passing in
 * environments without the key (module evaluation no longer throws) while the
 * `stripe.<resource>` usage in /api/checkout and /api/webhooks/stripe stays
 * unchanged.
 */
export const stripe: Stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    const value = Reflect.get(getStripe(), prop)
    return typeof value === 'function' ? value.bind(getStripe()) : value
  },
})
