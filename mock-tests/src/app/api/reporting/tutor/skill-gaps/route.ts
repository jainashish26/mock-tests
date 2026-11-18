import { envelope, reportJson } from '@/lib/reporting/envelope'
import { requireReportingRole } from '@/lib/reporting/route-auth'
import { csvResponse } from '@/lib/reporting/csv'
import { loadTutorSkillGaps, type TutorSkillGapRow } from '@/lib/reporting/tutor'

/**
 * T2 - Skill Gap Heatmap. GET /api/reporting/tutor/skill-gaps
 *
 * TUTOR only, consented students only. Reads reporting.mv_skill_gap - the SAME
 * view P3 and P8 use - so a tutor and a parent looking at the same child see the
 * same accuracy. `has_signal` marks topics below five responses, which must be
 * rendered as "not enough practice" rather than as a verdict.
 */

const REPORT_ID = 'T2'
const TTL_SECONDS = 900

const CSV_COLUMNS = [
  'student_name', 'subject', 'topic', 'items_answered', 'accuracy_pct',
  'mastery_level', 'has_signal',
]

export async function GET(req: Request) {
  const auth = await requireReportingRole(REPORT_ID, ['TUTOR'])
  if (!auth.ok) return auth.response

  const result = await loadTutorSkillGaps()

  if (result.error) {
    const status = result.code === '42501' ? 403 : 503
    if (new URL(req.url).searchParams.get('format') === 'csv') {
      return new Response('Export unavailable\n', {
        status,
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    }
    return reportJson(
      envelope<TutorSkillGapRow[]>({ reportId: REPORT_ID, data: null, asAt: null, state: 'error' }),
      { status }
    )
  }

  if (new URL(req.url).searchParams.get('format') === 'csv') {
    return csvResponse('tutor-skill-gaps.csv', CSV_COLUMNS, result.rows)
  }

  return reportJson(
    envelope<TutorSkillGapRow[]>({
      reportId: REPORT_ID,
      data: result.rows,
      asAt: new Date().toISOString(),
      state: result.rows.length === 0 ? 'empty' : 'ok',
    }),
    { status: 200, ttlSeconds: TTL_SECONDS }
  )
}
