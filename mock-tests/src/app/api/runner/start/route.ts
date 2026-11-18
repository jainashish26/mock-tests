import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'
import { finalizeExpiredAttempt, isAttemptExpired } from '@/lib/runner/attempt-expiry'
import { trackEvent } from '@/lib/funnel/track'
import { recordAttemptStartedForFunnel } from '@/lib/funnel/attempt'


/**
 * Starts an attempt for an assignment, or RESUMES the existing in-progress one.
 *
 * Creating a fresh attempt on every call was the original behaviour: a single
 * browser refresh spawned a duplicate attempt, reset the countdown timer and
 * orphaned every answer already saved against the first attempt id.
 */
export async function POST(req: Request) {
  try {
    const { user } = await requireRole(['STUDENT'])

    let assignmentId: string | undefined
    try {
      const body = await req.json()
      assignmentId = body?.assignmentId
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    if (!assignmentId) {
      return NextResponse.json({ error: 'Missing assignmentId' }, { status: 400 })
    }

    const supabase = await createClient()

    const { data: profile } = await supabase
      .from('student_profiles')
      .select('id, year_level')
      .eq('auth_user_id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Student profile not found' }, { status: 404 })
    }

    const { data: assignment, error: assignmentErr } = await supabase
      .from('assignments')
      .select('id, student_id, test_id, due_at, tests(id, time_limit_mins, status, exam_type)')
      .eq('id', assignmentId)
      .single()

    if (assignmentErr || !assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })
    }

    // RLS should already hide other students' assignments; assert it so a
    // misconfigured policy cannot let someone start another student's test.
    if (assignment.student_id !== profile.id) {
      return NextResponse.json({ error: 'Not authorised for this assignment' }, { status: 403 })
    }

    // `tests(...)` comes back as a one-element array from PostgREST.
    const test = assignment.tests as unknown as
      | { id: string; time_limit_mins: number | null; exam_type?: string }
      | null
    if (!test) {
      return NextResponse.json({ error: 'Assigned test is unavailable' }, { status: 404 })
    }

    if (assignment.due_at && new Date(assignment.due_at).getTime() < Date.now()) {
      return NextResponse.json({ error: 'This assignment is past its due date' }, { status: 409 })
    }

    const inProgressQuery = () =>
      supabase
        .from('attempts')
        .select('id, started_at')
        .eq('student_id', profile.id)
        .eq('test_id', test.id)
        .eq('status', 'IN_PROGRESS')
        .order('started_at', { ascending: true })

    // Resume the oldest in-progress attempt if one already exists.
    const { data: existing, error: existingErr } = await inProgressQuery()
    if (existingErr) {
      return NextResponse.json({ error: existingErr.message }, { status: 500 })
    }

    if (existing && existing.length > 0) {
      const open = existing[0]
      if (!isAttemptExpired(open.started_at, test.time_limit_mins)) {
        return NextResponse.json({
          success: true,
          attemptId: open.id,
          resumed: true,
          startedAt: open.started_at,
          timeLimitMins: test.time_limit_mins,
        })
      }
      // The deadline passed while the attempt sat open (the student never came
      // back). Resuming it would mount the runner with the countdown already at
      // zero: it auto-submits ~1s later and the student watches the exam "end"
      // seconds after starting. Finalise it here instead - the finished-attempt
      // check below then returns `alreadySubmitted` and the client goes
      // straight to the report.
      await finalizeExpiredAttempt(supabase, open.id, open.started_at, test.time_limit_mins)
    }

    // A finished attempt must not be silently replaced by a fresh one: that let a
    // student retake the same assignment unlimited times and orphaned the report.
    const { data: finished } = await supabase
      .from('attempts')
      .select('id, status')
      .eq('student_id', profile.id)
      .eq('test_id', test.id)
      .in('status', ['COMPLETE', 'WRITING_PENDING', 'SUBMITTED'])
      .order('submitted_at', { ascending: false })
      .limit(1)

    if (finished && finished.length > 0) {
      return NextResponse.json(
        {
          error: 'You have already submitted this test',
          alreadySubmitted: true,
          attemptId: finished[0].id,
          status: finished[0].status,
        },
        { status: 409 }
      )
    }

    const { data: created, error: createErr } = await supabase
      .from('attempts')
      .insert({ student_id: profile.id, test_id: test.id, status: 'IN_PROGRESS' })
      .select('id, started_at')
      .single()

    if (createErr) {
      // Two tabs can both pass the check above; the partial unique index
      // (one IN_PROGRESS attempt per student+test) rejects the loser. Resume
      // the winner instead of surfacing a database error to the student.
      if (createErr.code === '23505') {
        const { data: winner } = await inProgressQuery()
        if (winner && winner.length > 0) {
          return NextResponse.json({
            success: true,
            attemptId: winner[0].id,
            resumed: true,
            startedAt: winner[0].started_at,
            timeLimitMins: test.time_limit_mins,
          })
        }
      }
      return NextResponse.json({ error: createErr.message ?? 'Failed to start attempt' }, { status: 500 })
    }

    if (!created) {
      return NextResponse.json({ error: 'Failed to start attempt' }, { status: 500 })
    }

    // TEST_STARTED. Fired AFTER the attempt row commits so it counts only
    // attempts that actually exist. A pre-commit fire would report an attempt
    // that the database rejected (unique-violation race, FK failure), inflating
    // test_completion_rate in A4 and test_error_rate in A14.
    //
    // No score, no correctness, no time spent - this event records a START, not
    // a finish. A student's own session writes it; the boundary 015 enforces
    // (no result in any student-originating analytics payload) is trivially
    // satisfied by not including any result-bearing field.
    await trackEvent({
      event: 'TEST_STARTED',
      userId: user.id,
      studentId: profile.id,
      props: {
        attemptId: created.id,
        testId: test.id,
        examType: test.exam_type,
        yearLevel: profile.year_level,
        isAdaptive: false,
      },
    })

    // Funnel step 3: if this is the free diagnostic, mark it STARTED on the
    // PARENT's lifecycle row. That is what opens the 24-hour window the
    // lifecycle worker's nudge is measured against (`DIAGNOSTIC_WINDOW_HOURS`).
    //
    // Runs after the attempt row commits, for the same reason TEST_STARTED
    // does: a start the database rejected must not open a window.
    //
    // The parent is resolved through the service client inside attempt.ts,
    // because this request carries the STUDENT's session and RLS correctly
    // prevents a child from reading who their guardian is.
    await recordAttemptStartedForFunnel({
      studentProfileId: profile.id,
      examType: test.exam_type,
      testId: test.id,
    })


    return NextResponse.json({
      success: true,
      attemptId: created.id,
      resumed: false,
      startedAt: created.started_at,
      timeLimitMins: test.time_limit_mins,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unexpected error' }, { status: 403 })
  }
}

