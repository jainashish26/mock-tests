import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logging/logger'
import { isFunnelConfigured } from './track'
import { isLockedInsight } from '@/lib/pricing/offer-personalisation'

/**
 * The read side of `PAYWALL_LOCK_CLICKED` (lever N-7).
 *
 * Until now this event was write-only. Its own component header calls it "the
 * most valuable single datum in the funnel" because it records what a parent
 * actually asked to see, rather than what a feature matrix assumes they want -
 * and nothing consumed it.
 *
 * WHY THE SERVICE CLIENT
 *   `funnel_events` has no client SELECT policy by design (migration 011), and
 *   migration 047 revoked SELECT from `authenticated` outright so that
 *   confidentiality does not rest on the absence of policies. A user-scoped read
 *   would therefore return zero rows and silently disable personalisation. This
 *   is the same reason every other funnel read goes through the service client.
 *
 *   The function returns only an insight TITLE - never a score, band or topic -
 *   so it cannot leak a child's results into the offer page.
 *
 * FAILS OPEN
 *   Any failure returns null and the offer renders its normal benefit order.
 *   Personalisation is an optimisation; an offer page that fails to load because
 *   an analytics lookup errored would cost far more than it could ever gain.
 */

/** Recent clicks examined. Bounded so a heavy clicker cannot make this expensive. */
const LOOKBACK = 50

/**
 * The insight this parent clicked most, or null.
 *
 * Ties break toward the MOST RECENT click: a parent who clicked "Progress trend"
 * three times last week and "Time per question" once just now is telling you
 * their interest has moved, and the latest signal is the better guess.
 */
export async function topLockedInsight(userId: string): Promise<string | null> {
  if (!isFunnelConfigured() || !userId) return null

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('funnel_events')
      .select('props, created_at')
      .eq('user_id', userId)
      .eq('event', 'PAYWALL_LOCK_CLICKED')
      .order('created_at', { ascending: false })
      .limit(LOOKBACK)

    if (error || !data || data.length === 0) return null

    const counts = new Map<string, number>()
    // Rows arrive newest-first, so insertion order IS recency order. Keeping the
    // first-seen index lets ties resolve to the most recent without a second pass
    // over timestamps.
    const firstSeen = new Map<string, number>()

    for (const row of data) {
      const insight = (row.props as Record<string, unknown> | null)?.insight
      // Only known titles count. An unrecognised value is ignored rather than
      // promoted, so a malformed or injected props value cannot drive copy.
      if (!isLockedInsight(insight)) continue

      counts.set(insight, (counts.get(insight) ?? 0) + 1)
      if (!firstSeen.has(insight)) firstSeen.set(insight, firstSeen.size)
    }

    if (counts.size === 0) return null

    let best: string | null = null
    let bestCount = -1
    let bestRecency = Number.POSITIVE_INFINITY

    for (const [insight, count] of counts) {
      const recency = firstSeen.get(insight) ?? Number.POSITIVE_INFINITY
      if (count > bestCount || (count === bestCount && recency < bestRecency)) {
        best = insight
        bestCount = count
        bestRecency = recency
      }
    }

    return best
  } catch (err) {
    logger.warn('[funnel] topLockedInsight failed, offer will render unpersonalised', { err })
    return null
  }
}
