import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'
import { trackEvent } from '@/lib/funnel/track'

export async function POST(req: Request) {
  try {
    const { user } = await requireRole(['STUDENT'])

    let attemptId: string | undefined
    try {
      const body = await req.json()
      attemptId = body?.attemptId
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    if (!attemptId) {
      return NextResponse.json({ error: 'Missing attemptId' }, { status: 400 })
    }

    const supabase = await createClient()

    const { data: profile } = await supabase
      .from('student_profiles')
      .select('id')
      .eq('auth_user_id', user.id)
      .single()

    if (!profile) return NextResponse.json({ error: 'Student profile not found' }, { status: 404 })

    // Was `.from('attempts').select('id, student_id, status, test_id,
    // tests(exam_type)')`. Migration 015 removed the student SELECT policy on
    // `attempts`, so that query returned null and every submission 404'd.
    //
    // The runner now reads through `my_attempt_context()`, a SECURITY DEFINER
    // function whose RETURNS clause holds only id, student_id, test_id, status,
    // exam_type, started_at and submitted_at. There is no score, accuracy or
    // correctness column in the signature, so a student still cannot read a result
    // through this path - the rule from 015 holds, and submitting works again.
    const { data: attemptRow } = await supabase.rpc('my_attempt_context', {
      p_attempt_id: attemptId,
    })
    const attemptRecord = Array.isArray(attemptRow) ? attemptRow[0] : attemptRow
    // Reshape to the previous nested form so downstream `attempt.tests.exam_type`
    // reads keep working unchanged.
    const attempt = attemptRecord
      ? { ...attemptRecord, tests: { exam_type: attemptRecord.exam_type } }
      : null

    if (!attempt || attempt.student_id !== profile.id) {
      return NextResponse.json({ error: 'Attempt not found' }, { status: 404 })
    }

    // Idempotent: an auto-submit on timer expiry can race a manual submit, and a
    // network retry must not be reported to the student as a failure.
    if (attempt.status !== 'IN_PROGRESS') {
      return NextResponse.json({ success: true, alreadySubmitted: true, attemptId })
    }

    const { error } = await supabase
      .from('attempts')
      .update({ status: 'SUBMITTED', submitted_at: new Date().toISOString() })
      .eq('id', attemptId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // TEST_SUBMITTED. Fired server-side after the status write commits, never
    // before: an event that fires ahead of the commit would report a submission
    // that then failed, inflating completion rate (A4) and hiding exactly the
    // failure A14's `failed_submission_rate` exists to catch.
    //
    // `submitOutcome` is what makes that metric possible. A child finishing a paper
    // and losing the result is the worst failure in the product, and without an
    // explicit outcome on the event it is invisible - the attempt simply never
    // reaches SUBMITTED and nothing distinguishes that from a child who closed the
    // tab.
    //
    // No score in props. This event is written from a student's own session, and
    // putting a result into an analytics payload would breach the boundary
    // migration 015 exists to hold.
    await trackEvent({
      event: 'TEST_SUBMITTED',
      userId: user.id,
      studentId: attempt.student_id,
      props: {
        attemptId,
        testId: attempt.test_id,
        examType: attempt.exam_type,
        submitOutcome: 'ok',
      },
    })

    // The attempt is already SUBMITTED, so a scoring failure must not make the
    // student think their submission was lost - hand back the attempt id and let
    // the report page show the pending state.
    try {
      const { scoreAttempt } = await import('@/lib/scoring/score-attempt')
      const result = await scoreAttempt(attemptId)

      // Funnel steps 3 and 6: this is the event that activates the family and,
      // on the second completed attempt, opens the natural paywall. Awaited
      // rather than fire-and-forget because the response tells the client
      // whether to show the paywall, and `recordAttemptForFunnel` swallows its
      // own errors so it cannot fail the submission.
      const { recordAttemptForFunnel } = await import('@/lib/funnel/attempt')
      const funnel = await recordAttemptForFunnel({
        studentProfileId: String(profile.id),
        attemptId,
        testId: attempt.test_id ? String(attempt.test_id) : null,
        examType: (attempt.tests as { exam_type?: string } | null)?.exam_type ?? null,
      })

      return NextResponse.json({
        success: true,
        attemptId,
        ...result,
        // Lets the student's result screen congratulate them without a second
        // round trip, and lets the parent dashboard show the paywall on load.
        paywallOpened: funnel.paywallOpened,
      })
    } catch (scoreErr: any) {
      console.error('[runner/submit] scoring failed', { attemptId, err: scoreErr })
      return NextResponse.json(
        { success: true, attemptId, scoringError: scoreErr?.message ?? 'Scoring failed' },
        { status: 200 }
      )
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unexpected error' }, { status: 403 })
  }
}

