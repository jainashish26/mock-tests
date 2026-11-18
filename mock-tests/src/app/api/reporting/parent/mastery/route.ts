import { envelope, reportJson } from '@/lib/reporting/envelope'
import { requireReportingRole } from '@/lib/reporting/route-auth'
import { requireStudentId } from '@/lib/reporting/route-params'
import {
  loadParentMastery,
  masteryCounts,
  masteryHeadline,
  splitBySignal,
  type MasteryRow,
} from '@/lib/reporting/parent-mastery'

/**
 * P3 - Curriculum Mastery Map. GET /api/reporting/parent/mastery
 *
 * §12.2 requires that this endpoint's DTO has NO `content_description_code`
 * field. That is satisfied structurally rather than by omission: migration 026
 * dropped the VC2 curriculum, so the taxonomy behind P3 is subject -> topic ->
 * sub_topic and contains no codes to leak. `MasteryRow` cannot express one.
 *
 * The split into `judged` / `insufficient` is in the payload rather than left to
 * the client, because the distinction is a rule about what may be claimed, not a
 * rendering preference. A topic below five responses has no signal, and a client
 * that rendered it as "critical" would be telling a parent their child has failed
 * at something they answered twice.
 */

const REPORT_ID = 'P3'
const TTL_SECONDS = 900

interface MasteryDto {
  /** Topics with enough responses to judge. Weakest first. */
  judged: MasteryRow[]
  /** Topics below the five-response floor. Rendered as "not enough practice". */
  insufficient: MasteryRow[]
  counts: Record<string, number>
  headline: string
}

export async function GET(req: Request) {
  const auth = await requireReportingRole(REPORT_ID, ['PARENT', 'ADMIN'])
  if (!auth.ok) return auth.response

  const student = requireStudentId(REPORT_ID, req.url)
  if (!student.ok) return student.response

  const result = await loadParentMastery(student.value)

  if (result.error) {
    return reportJson(
      envelope<MasteryDto>({ reportId: REPORT_ID, data: null, asAt: result.asAt, state: 'error' }),
      { status: 503 }
    )
  }

  const { judged, insufficient } = splitBySignal(result.topics)

  return reportJson(
    envelope<MasteryDto>({
      reportId: REPORT_ID,
      data: {
        judged,
        insufficient,
        counts: masteryCounts(result.topics),
        headline: masteryHeadline(result.topics),
      },
      asAt: result.asAt,
      // Empty means no topic has been practised at all. Topics that exist but
      // lack signal are NOT empty - they arrive in `insufficient`, so the parent
      // sees the map filling in rather than a blank screen with no explanation.
      state: result.topics.length === 0 ? 'empty' : 'ok',
    }),
    { status: 200, ttlSeconds: TTL_SECONDS }
  )
}
