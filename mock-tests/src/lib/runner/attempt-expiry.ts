import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Shared deadline maths for in-progress attempts.
 *
 * An attempt whose `started_at + time_limit_mins` is already in the past must
 * never be handed to the runner: its countdown starts at zero, the expired
 * timer branch auto-submits within ~1s of mounting and the student watches the
 * exam "end" seconds after opening it. Callers finalise such attempts
 * server-side and send the student straight to the report instead.
 */

export const DEFAULT_TIME_LIMIT_MINS = 60

/**
 * Clock-skew grace. A student submitting at exactly 0:00 on a device whose
 * clock trails the server must not have the attempt finalised underneath them,
 * so the server only treats an attempt as expired a full minute past the wire.
 * The runner still auto-submits at 0:00 for attempts that expire mid-session.
 */
const EXPIRY_GRACE_MS = 60_000

function limitMinsOf(timeLimitMins: number | null | undefined): number {
  const mins = Number(timeLimitMins)
  return Number.isFinite(mins) && mins > 0 ? mins : DEFAULT_TIME_LIMIT_MINS
}

/** Epoch ms at which the attempt's time is up, or null when `started_at` is unusable. */
export function attemptDeadlineMs(
  startedAt: string | null | undefined,
  timeLimitMins: number | null | undefined
): number | null {
  const startMs = startedAt ? new Date(startedAt).getTime() : NaN
  if (!Number.isFinite(startMs)) return null
  return startMs + limitMinsOf(timeLimitMins) * 60_000
}

export function attemptDeadlineIso(
  startedAt: string | null | undefined,
  timeLimitMins: number | null | undefined
): string | null {
  const ms = attemptDeadlineMs(startedAt, timeLimitMins)
  return ms === null ? null : new Date(ms).toISOString()
}

/** True when the attempt ran out of time (plus skew grace) and cannot be resumed. */
export function isAttemptExpired(
  startedAt: string | null | undefined,
  timeLimitMins: number | null | undefined,
  nowMs: number = Date.now()
): boolean {
  const deadline = attemptDeadlineMs(startedAt, timeLimitMins)
  // Unknown start time: don't declare it expired here - the runner derives the
  // countdown from mount time as a fallback.
  if (deadline === null) return false
  return nowMs > deadline + EXPIRY_GRACE_MS
}

/**
 * Close an expired attempt the same way the submit endpoint would: mark it
 * SUBMITTED, then score whatever responses were saved.
 *
 * `submitted_at` is backdated to the deadline so the elapsed time recorded by
 * scoring equals the exam duration instead of the wall-clock time since the
 * student abandoned it. Returns false when the row could not be updated (e.g.
 * it was already finalised by a concurrent request), which callers treat as
 * "already handled".
 */
export async function finalizeExpiredAttempt(
  supabase: SupabaseClient,
  attemptId: string,
  startedAt: string | null | undefined,
  timeLimitMins: number | null | undefined
): Promise<boolean> {
  const submittedAt = attemptDeadlineIso(startedAt, timeLimitMins) ?? new Date().toISOString()

  const { data: updated, error } = await supabase
    .from('attempts')
    .update({ status: 'SUBMITTED', submitted_at: submittedAt })
    .eq('id', attemptId)
    .eq('status', 'IN_PROGRESS')
    .select('id')

  if (error) {
    console.error('[attempt-expiry] failed to finalise expired attempt', { attemptId, error })
    return false
  }
  if (!updated || updated.length === 0) return false

  // Scoring must not block the redirect: the attempt is already SUBMITTED and
  // the report page shows the pending state if grading failed.
  try {
    const { scoreAttempt } = await import('@/lib/scoring/score-attempt')
    await scoreAttempt(attemptId)
  } catch (err) {
    console.error('[attempt-expiry] scoring failed after expiry finalisation', { attemptId, err })
  }
  return true
}
