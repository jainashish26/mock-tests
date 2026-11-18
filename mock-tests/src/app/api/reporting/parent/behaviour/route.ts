import { envelope, reportJson } from '@/lib/reporting/envelope'
import { requireReportingRole } from '@/lib/reporting/route-auth'
import { intParam, requireStudentId } from '@/lib/reporting/route-params'
import { loadParentBehaviour, type StudyBehaviourRow } from '@/lib/reporting/parent-behaviour'

/**
 * P7 - Study Behaviour. GET /api/reporting/parent/behaviour
 *
 * `weeks` is capped at 26 by §12.2. The cap is enforced twice: here, so the
 * caller gets a clean 400 rather than a silent truncation, and inside
 * `parent_study_behaviour()` via LEAST/GREATEST, so a caller that reaches the
 * SQL directly still cannot widen the window.
 *
 * The metrics this endpoint returns include two proxies - `guess_rate` (a
 * rapid-wrong-answer inference, not a measured flag) and `pace_vs_expected`
 * (measured against same-year peers, because no expected pace is authored).
 * Both are labelled as estimates by the UI; neither is presented as a
 * measurement of the child's intent.
 */

const TTL_SECONDS = 900
const WEEKS_MAX = 26
const WEEKS_DEFAULT = 12

interface BehaviourDto {
  weeks: StudyBehaviourRow[]
  weeksRequested: number
}

export async function GET(req: Request) {
  const REPORT_ID = 'P7'

  const auth = await requireReportingRole(REPORT_ID, ['PARENT', 'ADMIN'])
  if (!auth.ok) return auth.response

  const student = requireStudentId(REPORT_ID, req.url)
  if (!student.ok) return student.response

  const weeks = intParam(REPORT_ID, req.url, 'weeks', {
    fallback: WEEKS_DEFAULT,
    min: 1,
    max: WEEKS_MAX,
  })
  if (!weeks.ok) return weeks.response

  const result = await loadParentBehaviour(student.value, weeks.value)

  if (result.error) {
    return reportJson(
      envelope<BehaviourDto>({ reportId: REPORT_ID, data: null, asAt: result.asAt, state: 'error' }),
      { status: 503 }
    )
  }

  return reportJson(
    envelope<BehaviourDto>({
      reportId: REPORT_ID,
      data: { weeks: result.weeks, weeksRequested: weeks.value },
      asAt: result.asAt,
      state: result.weeks.length === 0 ? 'empty' : 'ok',
    }),
    { status: 200, ttlSeconds: TTL_SECONDS }
  )
}
