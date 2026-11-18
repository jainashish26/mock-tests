import { callReportingFunction } from './connection'
import { asAtFor } from './lag'
import type { FunnelOutcomes, FunnelSegment, FunnelStageRow } from './types'

/**
 * Report A11 - Conversion Funnel. "Where are we losing people?"
 *
 * THE MEASUREMENT LOOP
 *   `15-conversion-and-ux-resolution.md` §2.2 identifies this as the real answer
 *   to "maximum conversion": the mechanics are built and good, but nothing read
 *   them. The funnel was fully instrumented and entirely unread - every conversion
 *   decision, including the ones argued in that document, was a guess.
 *
 *   Worse, the SQL that did exist had never worked. `mv_funnel_stage` ranked
 *   stages with `funnel_stage_rank_upper()`, which matches the lower-case funnel
 *   STEP vocabulary ('signup', 'first_value') against the upper-case STAGE values
 *   actually stored in `fact_event.funnel_step` ('SIGNED_UP', 'FIRST_VALUE'). Every
 *   row fell to `ELSE 0`, and `funnel_by_stage` filters `WHERE stage_rank > 0`, so
 *   it returned ZERO ROWS for any date range. Migration 054 fixed it by using the
 *   canonical `funnel_stage_rank()` that `state.ts` already mirrors.
 *
 * WHAT THIS ADDS ON TOP OF THE EXISTING SQL
 *   * `p_segment_by`, defaulting to the unsegmented headline funnel. The old
 *     signature always grouped by channel x campaign x device, which fragmented a
 *     58-signup funnel into a dozen 4-7 visitor cells (055).
 *   * Gap-tolerant chaining, so an empty stage no longer blanks everything below
 *     it, and `prev_stage` says what each rate was measured against (056).
 *   * The three outcome metrics §5.4 requires and that did not exist at all:
 *     free_to_paid_rate, checkout_abandonment_rate, time_to_first_value (057).
 *
 * C9 (DEVICE SPLIT) - NOW MET
 *   It was previously unmet for a subtle reason: `/api/events` already derived a
 *   device and wrote `props.device`, but the events the beacon sends have no
 *   EVENT_STAGE entry, so they never reach `mv_funnel_stage`. Every event that
 *   DOES carry a stage is written server-side by `trackEvent()`, which had no
 *   access to the classifier. Device was therefore captured only on the events
 *   that do not participate in the funnel.
 *
 *   Fixed by extracting `classifyDevice` into src/lib/funnel/device.ts (one
 *   definition, shared), letting `TrackEventInput` carry a device, and having
 *   `trackEvent` inherit the visitor's last known device when the call site has no
 *   Request - which is the normal case for the lifecycle worker and cron. The
 *   lookup tries user_id then anonymous_id, so it survives the signup transition
 *   where a brand-new user_id has no history but the mt_aid cookie does.
 */

export type { FunnelOutcomes, FunnelSegment, FunnelStageRow } from './types'

export interface AdminFunnelResult {
  stages: FunnelStageRow[]
  outcomes: FunnelOutcomes | null
  asAt: string | null
  error: boolean
  code?: string
}

/** Load A11. ADMIN only, enforced in SQL by both functions. */
export async function loadFunnel(
  fromDate: number,
  toDate: number,
  segmentBy: FunnelSegment = 'none'
): Promise<AdminFunnelResult> {
  const [stagesRes, outcomesRes, asAt] = await Promise.all([
    callReportingFunction<FunnelStageRow>('admin_funnel_by_stage', {
      p_from_date: fromDate,
      p_to_date: toDate,
      p_segment_by: segmentBy,
    }),
    callReportingFunction<FunnelOutcomes>('admin_funnel_outcomes', {
      p_from_date: fromDate,
      p_to_date: toDate,
    }),
    asAtFor('mv_funnel_stage'),
  ])

  if (stagesRes.error || outcomesRes.error) {
    return {
      stages: [],
      outcomes: null,
      asAt,
      error: true,
      code: stagesRes.code ?? outcomesRes.code,
    }
  }

  return {
    stages: stagesRes.rows,
    // The outcomes function always returns exactly one row, even for an empty
    // window, because every figure is an aggregate. Absence means a real failure,
    // not "no data".
    outcomes: outcomesRes.rows[0] ?? null,
    asAt,
    error: false,
  }
}
