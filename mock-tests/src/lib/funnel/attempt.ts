import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logging/logger'
import { recordAttemptCompleted, recordDiagnosticStarted } from './state'

/**
 * Bridge between a completed student attempt and the parent's funnel lifecycle.
 *
 * WHY THIS EXISTS AS A SEPARATE MODULE
 *   The runner submits as the STUDENT, but every funnel stage lives on the
 *   PARENT's row - the parent is the buyer, and the emails go to them. Resolving
 *   that link needs the service-role client, because RLS on
 *   `parent_student_links` is scoped to the parent's own session and a student
 *   session cannot read it (correctly: a child should not be able to enumerate
 *   who their guardian is).
 *
 *   Keeping the lookup here rather than in the submit route means the route does
 *   not need the admin client, and the "which parent owns this attempt" question
 *   is answered in exactly one place.
 *
 * Never throws. A student's submission must not fail because funnel bookkeeping
 * could not resolve their parent.
 */
export async function recordAttemptForFunnel(params: {
  studentProfileId: string
  attemptId: string
  // `score` was removed from this signature on purpose. It used to be threaded
  // through to recordAttemptCompleted and written into the DIAGNOSTIC_COMPLETED
  // / SECOND_SESSION_COMPLETED event props. Those events are emitted from a
  // submission the STUDENT triggered, so carrying a result in them breaches the
  // analytics boundary the catalogue documents for ITEM_ANSWERED and that
  // runner/submit honours for TEST_SUBMITTED ("No score in props"). Scores
  // already live in fact_test_attempt, which is where the parent reads them.
  // Deleting the parameter - rather than only the emit - means the value cannot
  // be passed back in without a signature change that shows up in review.
  examType?: string | null
  testId?: string | null
}): Promise<{ parentUserId: string | null; paywallOpened: boolean }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !params.studentProfileId) {
    return { parentUserId: null, paywallOpened: false }
  }

  try {
    const admin = createAdminClient()

    // A student can be linked to more than one parent in principle; the funnel
    // advances the first, since that is the account that created the profile.
    const { data: link, error } = await admin
      .from('parent_student_links')
      .select('parent_user_id')
      .eq('student_id', params.studentProfileId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (error) {
      logger.warn('[funnel] could not resolve parent for attempt', {
        message: error.message,
        attemptId: params.attemptId,
      })
      return { parentUserId: null, paywallOpened: false }
    }

    const parentUserId = (link as { parent_user_id?: string } | null)?.parent_user_id ?? null
    if (!parentUserId) return { parentUserId: null, paywallOpened: false }

    const result = await recordAttemptCompleted(parentUserId, params.studentProfileId, {
      testId: params.testId ?? undefined,
      examType: params.examType ?? undefined,
    })

    return { parentUserId, paywallOpened: result.paywallOpened }
  } catch (err) {
    logger.error('FUNNEL_ATTEMPT', '[funnel] attempt recording threw', err)
    return { parentUserId: null, paywallOpened: false }
  }
}

/** The `exam_type` value that identifies the free diagnostic. */
const DIAGNOSTIC_EXAM_TYPE = 'BENCHMARK'

/**
 * Bridge between a STARTED student attempt and the parent's funnel lifecycle.
 *
 * The mirror image of `recordAttemptForFunnel`, and it exists for the same
 * reason: the runner acts as the STUDENT, but every funnel stage lives on the
 * PARENT's row, and resolving that link needs the service-role client because
 * RLS on `parent_student_links` is scoped to the parent's own session. A child
 * cannot read who their guardian is - correctly - so the lookup has to happen
 * off their session.
 *
 * Same never-throws contract. A child must not be blocked from starting a test
 * because analytics bookkeeping failed; that is the one failure mode
 * instrumentation must never have.
 *
 * WHY ONLY THE DIAGNOSTIC
 *   Starting any test is already captured by TEST_STARTED in the runner route.
 *   What was missing is the step-3 marker that opens the 24-hour diagnostic
 *   window (`DIAGNOSTIC_WINDOW_HOURS`), and that window is only meaningful for
 *   the diagnostic itself - a parent who opens a practice paper three weeks
 *   later should not restart a "finish your diagnostic" countdown.
 */
export async function recordAttemptStartedForFunnel(params: {
  studentProfileId: string
  examType?: string | null
  testId?: string | null
}): Promise<void> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !params.studentProfileId) return
  if (params.examType !== DIAGNOSTIC_EXAM_TYPE) return

  try {
    const admin = createAdminClient()

    const { data: link, error } = await admin
      .from('parent_student_links')
      .select('parent_user_id')
      .eq('student_id', params.studentProfileId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (error) {
      logger.warn('[funnel] could not resolve parent for diagnostic start', {
        message: error.message,
      })
      return
    }

    const parentUserId = (link as { parent_user_id?: string } | null)?.parent_user_id ?? null
    if (!parentUserId) return

    await recordDiagnosticStarted(parentUserId, params.studentProfileId, {
      testId: params.testId ?? null,
    })
  } catch (err) {
    logger.error('FUNNEL_ATTEMPT_START', '[funnel] diagnostic-start recording threw', err)
  }
}

