import { envelope, forbidden, reportJson } from '@/lib/reporting/envelope'
import { requireReportingRole } from '@/lib/reporting/route-auth'
import { requireStudentId } from '@/lib/reporting/route-params'
import {
  cohortContextSentence,
  loadParentPercentile,
  percentileSentence,
  progressPairingSentence,
  type PercentileRow,
} from '@/lib/reporting/parent-percentile'

/**
 * P2 - Percentile & Cohort Context. GET /api/reporting/parent/percentile
 *
 * THE TWO ACCESS RULES ARE SERVER-SIDE (14-...md §15.3):
 *   AC-19: 403 unless P1 resolves for the same student. parent_percentile()
 *          raises 42501 when no completed, scored attempt exists - the exact
 *          condition under which readiness.ts returns null - and this route
 *          maps that to 403. The check is in SQL, so a future caller of the
 *          RPC cannot skip it by forgetting a route-level guard.
 *   AC-20: a cohort below the floor returns `data: null`,
 *          `meta.suppressed: true`, `meta.cohort.size: n`. The suppression
 *          itself is computed in the MV; this route only transports it.
 *
 * B1 PAIRING: every non-suppressed payload carries `progress`, P4's
 * personal_progress_delta in words, so a percentile can never render alone.
 * The cohort context (size, window, "platform cohort" disclaimer) is likewise
 * part of the payload, not a rendering choice.
 */

const REPORT_ID = 'P2'
const TTL_SECONDS = 900

interface PercentileDto {
  /** One row per exam family, most-attempted first. */
  rows: PercentileRow[]
  leadFamily: string
  headline: string
  cohortContext: string
  /** B1: always present, even when the delta is null. */
  progress: string
}

export async function GET(req: Request) {
  const auth = await requireReportingRole(REPORT_ID, ['PARENT', 'ADMIN'])
  if (!auth.ok) return auth.response

  const student = requireStudentId(REPORT_ID, req.url)
  if (!student.ok) return student.response

  const result = await loadParentPercentile(student.value)

  if (result.error) {
    // AC-19 / B1: the RPC refused because P1 does not resolve. A 403 with the
    // standard envelope, not a 500 and not a redirect.
    if (result.code === '42501') return forbidden(REPORT_ID)
    return reportJson(
      envelope<PercentileDto>({ reportId: REPORT_ID, data: null, asAt: result.asAt, state: 'error' }),
      { status: 503 }
    )
  }

  // No cohort rows at all: the child has completed tests (B1 passed) but the
  // nightly cohort has not been rebuilt since. Empty, with the lag badge
  // telling the truth about freshness.
  if (result.rows.length === 0) {
    return reportJson(
      envelope<PercentileDto>({ reportId: REPORT_ID, data: null, asAt: result.asAt, state: 'empty' }),
      { status: 200, ttlSeconds: TTL_SECONDS }
    )
  }

  const lead = result.rows[0]
  const cohort = {
    size: lead.cohort_size,
    windowMonths: lead.cohort_window_months,
    definition: 'platform cohort' as const,
  }
  const allSuppressed = result.rows.every((r) => r.suppressed)

  // AC-20: suppression blanks the payload but keeps the cohort context, so
  // the parent sees HOW MANY students are in the cohort and why there is no
  // figure - not an empty screen that looks broken.
  if (allSuppressed) {
    return reportJson(
      envelope<PercentileDto>({
        reportId: REPORT_ID,
        data: null,
        asAt: result.asAt,
        cohort,
        suppressed: true,
        state: 'low_data',
      }),
      { status: 200, ttlSeconds: TTL_SECONDS }
    )
  }

  return reportJson(
    envelope<PercentileDto>({
      reportId: REPORT_ID,
      data: {
        rows: result.rows,
        leadFamily: lead.family_group,
        headline: percentileSentence(lead),
        cohortContext: cohortContextSentence(lead),
        progress: progressPairingSentence(lead.personal_progress_delta),
      },
      asAt: result.asAt,
      cohort,
      suppressed: false,
      state: 'ok',
    }),
    { status: 200, ttlSeconds: TTL_SECONDS }
  )
}