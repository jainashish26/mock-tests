'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { BillingInterval } from '@/lib/pricing/catalog'

/**
 * Resolves the visitor's auth + subscription state in the browser.
 *
 * This exists so `/pricing` can stay a *static* route. Pricing content is the
 * same for every visitor, so prerendering it is both faster and better for
 * indexing; only the personalisation (are you signed in? do you already
 * subscribe?) is resolved after hydration as progressive enhancement.
 *
 * Reading `subscriptions` directly relies on RLS rather than a bespoke API
 * route - the migration grants users SELECT on their own rows only.
 *
 * Fails soft: if the `subscriptions` table does not exist yet (migration not
 * applied) the query errors and we report no active plan instead of crashing.
 */

interface PricingSession {
  isAuthenticated: boolean
  activeInterval: BillingInterval | null
  isLoading: boolean
}

const ANONYMOUS: PricingSession = { isAuthenticated: false, activeInterval: null, isLoading: true }

/** Map the DB interval (Stripe's vocabulary) to the UI interval. */
function toBillingInterval(raw: unknown): BillingInterval | null {
  if (raw === 'year') return 'annual'
  if (raw === 'month') return 'monthly'
  return null
}

export function usePricingSession(): PricingSession {
  const [session, setSession] = useState<PricingSession>(ANONYMOUS)

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()

    const resolve = async (userId: string | null) => {
      if (cancelled) return
      if (!userId) {
        setSession({ isAuthenticated: false, activeInterval: null, isLoading: false })
        return
      }
      try {
        const { data } = await supabase
          .from('subscriptions')
          .select('interval, status')
          .eq('user_id', userId)
          .in('status', ['trialing', 'active', 'past_due'])
          .maybeSingle()

        if (cancelled) return
        setSession({
          isAuthenticated: true,
          activeInterval: toBillingInterval(data?.interval),
          isLoading: false,
        })
      } catch {
        // Table missing, RLS denial or network error: signed in, plan unknown.
        if (!cancelled) setSession({ isAuthenticated: true, activeInterval: null, isLoading: false })
      }
    }

    supabase.auth
      .getUser()
      .then(({ data }) => resolve(data.user?.id ?? null))
      .catch(() => {
        if (!cancelled) setSession({ isAuthenticated: false, activeInterval: null, isLoading: false })
      })

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, next) => {
      void resolve(next?.user?.id ?? null)
    })

    return () => {
      cancelled = true
      authListener.subscription.unsubscribe()
    }
  }, [])

  return session
}