import { createClient } from '@/lib/supabase/server'
import { envelope, reportJson } from '@/lib/reporting/envelope'
import { requireReportingRole } from '@/lib/reporting/route-auth'
import { requireStudentId } from '@/lib/reporting/route-params'
import { buildReadinessReport, type ReadinessReport } from '@/lib/report/readiness'
import { loadParentProjection, type ReadinessProjection } from '@/lib/reporting/parent-projection'

/**
 * P1 - Goal & Readiness. GET /api/reporting/parent/readiness
 *
 * §4.4 IS EXPLICIT THAT THIS ENDPOINT DOES NOT REDEFINE READINESS:
 *   "P1 readiness logic reuses src/lib/report/readiness.ts unchanged. I am not
 *   redefining readiness - that would create a second definition and breach
 *   MECE. P1 adds exactly one thing the module lacks: a projection with an
 *   explicit range."
 *
 * So this route does two things and no more. It calls the existing engine
 * (`buildReadinessReport`) for the readiness score, bands and topic gaps, and
 * it calls `parent_readiness_projection()` for the projection. It computes
 * nothing itself. The band thresholds in that SQL function mirror
 * `bandForScore()` in readiness.ts exactly, so the projected band and the
 * emailed readiness report share one vocabulary and cannot contradict each
 * other about the same child.
 *
 * THE PROJECTION IS NOT A FORECAST
 *   It is a transparent linear extrapolation of observed platform scores with
 *   a range from the child's own attempt variability. There is no validated
 *   predictive model for these exams and none is invented here. All three
 *   guardrails (B3/B13) live in SQL, so a UI change cannot quietly drop one:
 *   under three attempts yields `eligible: false` and null figures, the range
 *   is never narrower than the observed standard deviation, and the result is
 *   a named band rather than a decimal.
 */

const TTL_SECONDS = 900

interface ReadinessDto {
  /** The existing engine's output, unchanged. Null when there is no completed
   *  attempt - a report with no data behind it is worse than no report. */
  readiness: ReadinessReport | null
  projection: ReadinessProjection | null
}

export async function GET(req: Request) {
  const REPORT_ID = 'P1'

  const auth = await requireReportingRole(REPORT_ID, ['PARENT', 'ADMIN'])
  if (!auth.ok) return auth.response

  const student = requireStudentId(REPORT_ID, req.url)
  if (!student.ok) return student.response

  // The engine takes an already-authorised client and relies on RLS plus the
  // caller's JWT; it does no role check of its own (see its own header
  // comment). The role check above is that caller's job, now done.
  const supabase = await createClient()

  const [readiness, projection] = await Promise.all([
    buildReadinessReport(supabase, student.value).catch(() => null),
    loadParentProjection(student.value),
  ])

  if (projection.error) {
    return reportJson(
      envelope<ReadinessDto>({
        reportId: REPORT_ID,
        data: null,
        asAt: projection.asAt,
        state: 'error',
      }),
      { status: 503 }
    )
  }

  return reportJson(
    envelope<ReadinessDto>({
      reportId: REPORT_ID,
      data: { readiness, projection: projection.projection },
      asAt: projection.asAt,
      // No completed attempt at all is the empty state. A child WITH attempts
      // but under three is NOT empty - the readiness report renders and the
      // projection explains why it cannot project yet, which is itself the
      // next action ("sit another test").
      state: readiness === null ? 'empty' : 'ok',
    }),
    { status: 200, ttlSeconds: TTL_SECONDS }
  )
}
