import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { gradeWritingForAttempt, gradePracticeSession, isWritingMarkingConfigured } from '@/lib/writing/grade-writing'
import { isAuthorizedCron } from '@/lib/cron/auth'

/**
 * Each grade is a live-measured 18-58s DeepSeek call and the sweeper runs them
 * sequentially; 300s covers the default batch of 10 on Vercel's function
 * limits (adjust if the batch size is raised).
 */
export const maxDuration = 300

/**
 * POST /api/cron/writing-backlog - the writing-marking sweeper.
 *
 * WHY THIS EXISTS ALONGSIDE THE QSTASH JOB
 *   The QStash path is the fast lane, but it only works where
 *   QSTASH_TOKEN + QSTASH_WRITING_EVAL_ENDPOINT + signing keys are all
 *   configured. When any is missing, scoreAttempt logs and moves on, and the
 *   attempt sits in WRITING_PENDING - a child stuck on "your writing report
 *   will be ready shortly" forever. This sweeper closes that gap: it picks up
 *   anything left pending and grades it through the SAME core
 *   (gradeWritingForAttempt), so there is one marking implementation, not two.
 *
 *   It is also the safety net for QStash delivery failures past their retry
 *   budget: whatever the reason an attempt is still WRITING_PENDING, the
 *   sweeper eventually finds it.
 *
 * COST CONTROL: bounded per run (default 10, max 50) and strictly oldest
 * first - each grade is a paid DeepSeek call, so a cron tick can never fan out
 * unbounded, and the oldest waiting family is served first.
 *
 * Policy difference from the QStash path: when DeepSeek is NOT configured this
 * route leaves attempts PENDING (it will be configured eventually; silently
 * completing would strand the essay ungraded forever).
 */
export async function POST(req: Request) {
  if (!isAuthorizedCron(req)) {
    // 401 with no detail, mirroring the lifecycle cron route.
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isWritingMarkingConfigured()) {
    return NextResponse.json({ ok: true, skipped: 'DEEPSEEK_API_KEY not configured' })
  }

  let limit = 10
  try {
    const requested = Number(new URL(req.url).searchParams.get('limit'))
    if (Number.isFinite(requested) && requested > 0) limit = Math.min(50, Math.round(requested))
  } catch {
    limit = 10
  }

  const admin = createAdminClient()
  const { data: pending, error } = await admin
    .from('attempts')
    .select('id')
    .eq('status', 'WRITING_PENDING')
    .order('submitted_at', { ascending: true, nullsFirst: false })
    .limit(limit)

  if (error) {
    console.error('[writing-backlog] could not list pending attempts', error.message)
    return NextResponse.json({ error: 'Database unavailable' }, { status: 500 })
  }

  const ids = ((pending ?? []) as { id: string }[]).map((r) => r.id).filter(Boolean)
  const summary = { scanned: ids.length, graded: 0, released: 0, failed: 0 }

  // Sequential on purpose: one paid API call at a time keeps DeepSeek rate
  // limits and the serverless execution window predictable.
  for (const id of ids) {
    try {
      const result = await gradeWritingForAttempt(id, {
        admin,
        onNotConfigured: 'leave-pending',
      })
      if (result.status === 'graded') summary.graded += 1
      else summary.released += 1 // no_writing / already_graded: attempt released to COMPLETE
    } catch (err) {
      summary.failed += 1
      console.error('[writing-backlog] grading failed', { attemptId: id, err })
      // Keep going: one poisoned attempt must not block the rest of the queue.
    }
  }

  // AI Practice Lab sessions use the same bounded, oldest-first, sequential
  // policy. They are graded by the same core (gradePracticeSession) so a
  // practice piece never sits PENDING just because the QStash path was absent.
  const practice = { scanned: 0, graded: 0, failed: 0 }
  const { data: pendingPractice, error: practiceErr } = await admin
    .from('writing_practice_sessions')
    .select('id')
    .eq('status', 'PENDING')
    .order('created_at', { ascending: true })
    .limit(limit)

  if (practiceErr) {
    console.error('[writing-backlog] could not list pending practice sessions', practiceErr.message)
  } else {
    for (const row of (pendingPractice ?? []) as { id: string }[]) {
      practice.scanned += 1
      try {
        const result = await gradePracticeSession(row.id, { admin })
        if (result.status === 'graded') practice.graded += 1
        // already_graded / not_configured / no_writing left as-is
      } catch (err) {
        practice.failed += 1
        console.error('[writing-backlog] practice grading failed', { sessionId: row.id, err })
      }
    }
  }

  return NextResponse.json({ ok: true, ...summary, practice })
}