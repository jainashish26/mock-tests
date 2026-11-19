import { NextResponse } from 'next/server'
import { verifySignatureAppRouter } from '@upstash/qstash/dist/nextjs'
import { gradePracticeSession } from '@/lib/writing/grade-writing'

/**
 * POST /api/jobs/writing-practice - QStash-triggered grading for the AI Practice
 * Lab. Thin by design: the grading logic lives in
 * src/lib/writing/grade-writing.ts (gradePracticeSession), shared with the cron
 * sweeper so the two paths cannot drift.
 */
export const maxDuration = 120

async function handler(req: Request) {
  try {
    const { sessionId } = await req.json()
    if (!sessionId) throw new Error('Missing sessionId')

    const result = await gradePracticeSession(String(sessionId))

    if (result.status === 'not_configured') {
      return NextResponse.json(
        { success: false, error: 'Writing evaluation is not configured' },
        { status: 200 }
      )
    }

    return NextResponse.json({ success: true, status: result.status, writingAverage: result.writingAverage, model: result.model })
  } catch (err: unknown) {
    console.error('[writing-practice] job error', err)
    const message = err instanceof Error ? err.message : 'Job failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

let verifiedHandler: ReturnType<typeof verifySignatureAppRouter> | null = null

export async function POST(req: Request) {
  try {
    if (!verifiedHandler) verifiedHandler = verifySignatureAppRouter(handler)
    return await verifiedHandler(req)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[writing-practice] request could not be processed', message)
    return NextResponse.json({ error: 'Writing practice endpoint is not available' }, { status: 503 })
  }
}