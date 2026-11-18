'use client'

import { useEffect } from 'react'
import { trackView } from './track-client'

/**
 * Records the step-7 offer impression.
 *
 * An impression event is what makes the offer's conversion rate measurable at
 * all: "40% of users who reach step 5" is only computable if the denominator is
 * the number of parents who actually *saw* the offer, not the number who were
 * eligible for it. Eligible-but-never-rendered is a different failure and needs
 * a different fix.
 *
 * A separate component because a server component cannot run effects, and the
 * surrounding offer markup is deliberately server-rendered.
 */
export function OfferViewTracker({
  offerSlug,
  priceCents,
}: {
  offerSlug: string
  priceCents: number
}) {
  useEffect(() => {
    trackView('OFFER_VIEWED', { offerSlug, priceCents, surface: 'page' })
  }, [offerSlug, priceCents])

  return null
}
