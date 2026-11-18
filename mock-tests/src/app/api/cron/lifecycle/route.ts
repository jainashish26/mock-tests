import { NextResponse } from 'next/server'
import { logger } from '@/lib/logging/logger'
import { isLifecycleReady, runLifecycleWorker } from '@/lib/funnel/lifecycle'
import { isAuthorizedCron } from '@/lib/cron/auth'

/**
 * POST /api/cron/lifecycle - the scheduled funnel worker.
 *
 * Runs the step 3/4/5/6/7 email sequence over the whole active user base.
 * Intended to fire hourly: the tightest deadline in the funnel is the 24-hour
 * diagnostic window, so an hourly pass means a nudge lands within an hour of
 * becoming due rather than up to a day late.
 *
 * WIRING (either works, both are supported)
 *   Vercel Cron - add to vercel.json:
 *     { "crons": [{ "path": "/api/cron/lifecycle", "schedule": "0 * * * *" }] }]
 *     and set CRON_SECRET in Vercel; Vercel sends it as a Bearer token.
 *   QStash - point a schedule at this URL; the shared secret is sent the same
 *     way, so no separate verification path is needed.
 *
 * AUTHENTICATION
 *   This endpoint triggers email sends to every active user, so it must not be
 *   callable by the public. Verification lives in the shared `isAuthorizedCron`
 *   helper (src/lib/cron/auth.ts): when no secret is configured it refuses to
 *   run rather than running unauthenticated - an open email trigger is a spam
 *   cannon.
 */

export async function POST(req: Request) {
  if (!isAuthorizedCron(req)) {
    logger.warn('[cron/lifecycle] rejected an unauthorised invocation')
    // 401 with no detail: telling an attacker which credential was wrong helps
    // them, and tells a legitimate operator nothing they need.
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isLifecycleReady()) {
    // Not an error - a staging environment without Resend configured should
    // simply report that the worker has nothing to do.
    logger.info('[cron/lifecycle] skipped: email or database not configured')
    return NextResponse.json({ ok: true, skipped: 'not configured' })
  }

  let limit = 200
  try {
    const requested = Number(new URL(req.url).searchParams.get('limit'))
    if (Number.isFinite(requested) && requested > 0) {
      // Bounded so a typo cannot ask the worker to page through the whole table
      // inside a serverless timeout.
      limit = Math.min(1000, Math.round(requested))
    }
  } catch {
    limit = 200
  }

  const startedAt = Date.now()
  const result = await runLifecycleWorker(limit)

  return NextResponse.json({
    ok: true,
    ...result,
    durationMs: Date.now() - startedAt,
  })
}

/** GET is refused: a browser prefetch must never trigger a send run. */
export async function GET() {
  return NextResponse.json(
    { error: 'Use POST with the cron secret.' },
    { status: 405, headers: { Allow: 'POST' } }
  )
}
