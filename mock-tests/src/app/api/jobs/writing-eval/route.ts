import { NextResponse } from 'next/server'
import { verifySignatureAppRouter } from '@upstash/qstash/dist/nextjs'
import { gradeWritingForAttempt } from '@/lib/writing/grade-writing'

/**
 * Live-measured DeepSeek round trips for a full-rubric essay grade run 18-58s.
 * Vercel's default function duration would cut the call mid-flight (and QStash
 * would then retry into the same wall), so the limit is raised explicitly.
 */
export const maxDuration = 120

/**
 * POST /api/jobs/writing-eval - the QStash-triggered writing-marking job.
 *
 * THIN BY DESIGN: all grading logic lives in src/lib/writing/grade-writing.ts,
 * shared with the /api/cron/writing-backlog sweeper, so the two paths cannot
 * drift (one rubric, one contract, one storage shape). This file keeps only
 * the two things specific to the QStash path: signature verification and the
 * not-configured policy ('complete' the attempt rather than strand a student
 * in WRITING_PENDING because an env var is missing - the essay can be
 * re-queued; the sweeper deliberately uses the opposite policy).
 *
 * A historical bug worth remembering: this handler once selected
 * `questions(stem, explanation)` but filtered on `questions.type` - a column
 * never fetched - so the filter was always empty and every essay attempt sat
 * in WRITING_PENDING forever while the job reported success. The filter and
 * the select now live together in the shared core.
 */
async function handler(req: Request) {
  try {
    const { attemptId } = await req.json()
    if (!attemptId) throw new Error('Missing attemptId')

    const result = await gradeWritingForAttempt(String(attemptId), {
      onNotConfigured: 'complete',
    })

    if (result.status === 'not_configured') {
      // 200, not 5xx: QStash would retry a configured-away job forever. The
      // attempt was released to COMPLETE; the sweeper can re-grade later.
      return NextResponse.json(
        { success: false, error: 'Writing evaluation is not configured' },
        { status: 200 }
      )
    }

    return NextResponse.json({
      success: true,
      status: result.status,
      graded: result.graded,
      writingAverage: result.writingAverage,
      model: result.model,
    })
  } catch (err: any) {
    console.error('[writing-eval] job error', err)
    // Non-2xx makes QStash retry with backoff - correct here, because every
    // failure mode (API timeout, unparseable reply, DB write error) is
    // transient or worth another attempt, and grading is idempotent.
    return NextResponse.json({ error: err?.message ?? 'Job failed' }, { status: 500 })
  }
}

/**
 * `verifySignatureAppRouter` constructs a QStash `Receiver`, which throws when
 * QSTASH_CURRENT_SIGNING_KEY / QSTASH_NEXT_SIGNING_KEY are absent. Doing that at
 * module scope killed `next build` during page-data collection, so the verifier
 * is built on first request and cached (matching the previous single-instance
 * behaviour, including signing-key rotation).
 */
let verifiedHandler: ReturnType<typeof verifySignatureAppRouter> | null = null

export async function POST(req: Request) {
  try {
    if (!verifiedHandler) verifiedHandler = verifySignatureAppRouter(handler)
    return await verifiedHandler(req)
  } catch (err: any) {
    console.error('[writing-eval] request could not be processed', err?.message ?? err)
    return NextResponse.json(
      { error: 'Writing evaluation endpoint is not available' },
      { status: 503 }
    )
  }
}