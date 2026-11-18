import { getSiblingOfferForUser, siblingOfferPayload } from '@/lib/pricing/sibling-offer'
import { SiblingOfferCard } from './SiblingOfferCard'

/**
 * N-8 - one-tap re-purchase on the parent dashboard.
 *
 * SERVER COMPONENT: eligibility is decided before anything renders, so an
 * ineligible family never sees the card (no flash, no client-side gate to
 * bypass). "One tap" is honest here: /api/checkout reuses the family's Stripe
 * customer, so Checkout opens with their saved details - one tap from this
 * card to a prefilled payment page. No card data ever touches this app.
 *
 * Renders nothing when ineligible - including when Stripe or the catalogue
 * is unconfigured. A button that always fails is worse than no button.
 */
export async function SiblingRepurchaseCard({ userId }: { userId: string }) {
  const view = await getSiblingOfferForUser(userId)
  if (!view.eligible || !view.offer) return null

  return (
    <section aria-label="Second Child Pack" style={{ marginTop: '1.5rem' }}>
      <SiblingOfferCard offer={siblingOfferPayload(view.offer)} surface="dashboard" />
    </section>
  )
}