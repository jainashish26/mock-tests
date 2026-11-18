import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/rbac/require-role'
import { logger } from '@/lib/logging/logger'
import { patchFunnelState } from '@/lib/funnel/state'
import { advanceStage, trackEvent } from '@/lib/funnel/track'
import {
  DEFAULT_WEEKLY_SESSIONS,
  daysUntil,
  examTypeFor,
  parseExamDate,
} from '@/lib/funnel/exam-target'

/**
 * POST /api/funnel/exam-target - records the target exam and date for a child.
 *
 * This is funnel step 8, and it is worth more than it looks. An exam date is what
 * turns "practise more" into "74 days, three sessions a week, roughly 32 sessions
 * left". Goal-gradient effect: effort rises as a deadline approaches, but only if
 * the deadline is explicit and visible. Without this field there is no countdown
 * to render and the study plan has no horizon.
 *
 * It also drives the readiness report's Selective eligibility (Year 7+) and the
 * sibling cross-sell, so it is read from several places and written only here.
 *
 * The vocabulary, the date bounds and the enum mapping all live in
 * `@/lib/funnel/exam-target` so the route that validates and the page that
 * renders the choices cannot drift apart.
 */

export async function POST(req: Request) {
  let userId: string
  try {
    const auth = await requireRole(['PARENT'])
    userId = auth.user.id
  } catch (err) {
    // requireRole signals "not authenticated" by throwing a redirect. Rethrowing
    // preserves it; swallowing it would turn a logged-out request into a 500.
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    const parsed = await req.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('body must be an object')
    }
    body = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const studentId = typeof body.studentId === 'string' ? body.studentId.trim() : ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(studentId)) {
    return NextResponse.json({ error: 'A valid child profile is required.' }, { status: 400 })
  }

  const targetExam = typeof body.targetExam === 'string' ? body.targetExam.trim().slice(0, 120) : ''
  const examDate = parseExamDate(body.examDate)
  const rawGoal = Number(body.weeklySessionsGoal)
  const weeklySessionsGoal =
    Number.isFinite(rawGoal) && rawGoal >= 1 && rawGoal <= 14
      ? Math.round(rawGoal)
      : DEFAULT_WEEKLY_SESSIONS

  if (!targetExam && !examDate) {
    return NextResponse.json(
      { error: 'Choose a target exam or an exam date.' },
      { status: 400 }
    )
  }

  const supabase = await createClient()

  // Confirm the child belongs to this parent before writing. RLS would reject it
  // anyway, but an explicit check returns a meaningful 404 instead of a policy
  // error and avoids revealing whether an arbitrary id exists.
  const { data: link } = await supabase
    .from('parent_student_links')
    .select('student_id')
    .eq('parent_user_id', userId)
    .eq('student_id', studentId)
    .maybeSingle()

  if (!link) {
    return NextResponse.json({ error: 'That child profile is not on your account.' }, { status: 404 })
  }

  const { error } = await supabase.from('student_exam_targets').upsert(
    {
      student_id: studentId,
      target_exam: targetExam || null,
      target_exam_type: targetExam ? examTypeFor(targetExam) : null,
      exam_date: examDate,
      weekly_sessions_goal: weeklySessionsGoal,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'student_id' }
  )

  if (error) {
    logger.error('EXAM_TARGET', '[onboarding] could not save the exam target', error.message)
    return NextResponse.json({ error: 'Could not save that. Please try again.' }, { status: 500 })
  }

  // Step 8 is only complete once an exam date exists: without one there is
  // nothing to count down to and the study plan has no horizon.
  if (examDate) {
    await patchFunnelState(userId, { onboarded_at: new Date().toISOString() })
    await advanceStage(userId, 'ONBOARDED')
  }

  await trackEvent({
    event: examDate ? 'STUDY_PLAN_CREATED' : 'EXAM_TARGET_SET',
    userId,
    studentId,
    props: {
      targetExam: targetExam || null,
      examDate,
      weeklySessionsGoal,
      daysToExam: daysUntil(examDate),
    },
  })

  return NextResponse.json({ ok: true, examDate, targetExam, weeklySessionsGoal })
}

