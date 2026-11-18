import { logger } from '@/lib/logging/logger'
import { trackEventOnce } from './track'

/**
 * Funnel step 3 instrumentation: ONBOARDING_STARTED / ONBOARDING_COMPLETED.
 *
 * WHY THESE WERE MISSING
 *   Both events were declared in the catalogue but never emitted, so the
 *   `first_value` stage had no entry or exit marker. A11 could see that a parent
 *   added a child (STUDENT_ADDED) and eventually completed a diagnostic
 *   (DIAGNOSTIC_COMPLETED), but not whether they ever reached the guided
 *   onboarding flow at all - which is the difference between "parents skip
 *   onboarding" and "parents start it and stall". Those two call for opposite
 *   fixes, and without these events the funnel cannot tell them apart.
 *
 * WHY COMPLETION IS DERIVED RATHER THAN POSTED
 *   There is no "Finish" button to instrument: onboarding is three independent
 *   forms, and a parent can complete them in any order across several sittings.
 *   Completion is therefore computed from the same three facts the page's
 *   progress rail already renders - a child exists, an exam target is set, and
 *   the diagnostic is done. Deriving it from the rail's own inputs means the
 *   event and the visible tick-mark cannot disagree.
 *
 * A KNOWN LIMITATION, STATED
 *   Completion is observed when /onboarding renders. A parent who sets up,
 *   never returns to the page, and whose child completes the diagnostic later
 *   will not fire ONBOARDING_COMPLETED from here. The daily worker
 *   (`src/lib/funnel/daily-target.ts`) sweeps the same condition across the
 *   whole base, so the event still lands - at most a day late. Chosen over
 *   hooking every write path because those paths do not know about each other:
 *   the exam-target form cannot see the diagnostic, and the attempt scorer
 *   cannot see the target.
 */

export interface OnboardingProgress {
  userId: string
  /** Step 1: at least one child profile exists. */
  hasChild: boolean
  /** Step 2: at least one child has a target exam set. */
  hasExamTarget: boolean
  /** Step 3: the diagnostic has been completed. */
  diagnosticCompleted: boolean
}

export interface OnboardingTrackResult {
  started: boolean
  completed: boolean
}

/** All three steps done. Kept in one place so the sweep and the page agree. */
export function isOnboardingComplete(p: OnboardingProgress): boolean {
  return p.hasChild && p.hasExamTarget && p.diagnosticCompleted
}

/**
 * Record onboarding progress for one parent. Idempotent per event.
 *
 * Never throws. This runs inside a server component render; an instrumentation
 * failure must not blank the page a parent is using to set up their family.
 */
export async function trackOnboardingProgress(
  p: OnboardingProgress
): Promise<OnboardingTrackResult> {
  const result: OnboardingTrackResult = { started: false, completed: false }
  if (!p.userId) return result

  try {
    // Arrival at the guided flow. Fired for every parent who reaches the page,
    // including those who complete nothing - that is the denominator the
    // completion rate is measured against.
    result.started = await trackEventOnce({
      event: 'ONBOARDING_STARTED',
      userId: p.userId,
      path: '/onboarding',
      props: {
        hasChild: p.hasChild,
        hasExamTarget: p.hasExamTarget,
        diagnosticCompleted: p.diagnosticCompleted,
      },
    })

    if (isOnboardingComplete(p)) {
      result.completed = await trackEventOnce({
        event: 'ONBOARDING_COMPLETED',
        userId: p.userId,
        path: '/onboarding',
        props: { channel: 'page' },
      })
    }

    return result
  } catch (err) {
    logger.error('FUNNEL_ONBOARDING', '[funnel] onboarding tracking failed', err)
    return result
  }
}
