import { envelope, reportJson } from '@/lib/reporting/envelope'
import { requireReportingRole } from '@/lib/reporting/route-auth'
import { requireStudentId, textParam } from '@/lib/reporting/route-params'
import {
  loadParentHistory,
  primaryFamily,
  sectionTrends,
  type AttemptHistoryRow,
  type ProgressSummaryRow,
  type SectionTrendPoint,
} from '@/lib/reporting/parent-history'

/**
 * P4 - Test History & Trends. GET /api/reporting/parent/history
 *
 * AUTHORISATION IS TWO LAYERS, AND NEITHER IS THIS FILE ALONE
 *   The role check below proves the caller is a parent or an admin. It does
 *   NOT prove this parent may see THIS child - that is decided by
 *   `is_parent_of(p_student_id)` inside `child_attempt_history()` and
 *   `parent_progress_summary()`. A parent passing another family's studentId
 *   is correctly authenticated and still gets zero rows, because the link
 *   check runs against `auth.uid()` in the database.
 *
 * WHY `section` FILTERS IN THE ROUTE
 *   The filter is presentation-level. Filtering it in SQL would mean either a
 *   second function or a parameter that changes the view's shape, and the
 *   row count here is one child's attempts - tens of rows, not thousands.
 *   The 30 KB payload budget (§12.1) is not at risk from the unfiltered set.
 */

/** Per-child pagination caps from §12.1. */
const PAGE_SIZE = 20
const PAGE_MAX = 50

interface HistoryDto {
  attempts: AttemptHistoryRow[]
  summary: ProgressSummaryRow[]
  /** Trend for the family the header leads with, unless `section` narrows it. */
  sections: SectionTrendPoint[]
  leadFamily: string | null
}

export async function GET(req: Request) {
  const REPORT_ID = 'P4'
  const TTL_SECONDS = 900

  const auth = await requireReportingRole(REPORT_ID, ['PARENT', 'ADMIN'])
  if (!auth.ok) return auth.response

  const student = requireStudentId(REPORT_ID, req.url)
  if (!student.ok) return student.response

  const section = textParam(REPORT_ID, req.url, 'section')
  if (!section.ok) return section.response

  const result = await loadParentHistory(student.value)

  if (result.error) {
    // 503, not 500: the upstream view failed or the RPC errored. §12.1 maps a
    // stale/failed upstream to 503 and forbids a 500 with a stack trace.
    return reportJson(
      envelope<HistoryDto>({
        reportId: REPORT_ID,
        data: null,
        asAt: result.asAt,
        state: 'error',
      }),
      { status: 503 }
    )
  }

  const lead = primaryFamily(result.summary)

  // Narrow to one section family if asked. Matched case-insensitively against
  // both the group key and its parent-facing label, because a client is more
  // likely to have the label from a previous response than the internal key.
  const wanted = section.value?.toLowerCase()
  const attempts = wanted
    ? result.attempts.filter(
        (a) =>
          a.family_group.toLowerCase() === wanted ||
          a.family_group_label.toLowerCase() === wanted
      )
    : result.attempts

  const summary = wanted
    ? result.summary.filter(
        (s) =>
          s.family_group.toLowerCase() === wanted ||
          s.family_group_label.toLowerCase() === wanted
      )
    : result.summary

  const familyForSections = wanted
    ? (summary[0]?.family_group ?? null)
    : (lead?.family_group ?? null)

  const data: HistoryDto = {
    attempts: attempts.slice(0, PAGE_MAX),
    summary,
    sections: familyForSections ? sectionTrends(attempts, familyForSections) : [],
    leadFamily: lead?.family_group ?? null,
  }

  return reportJson(
    envelope<HistoryDto>({
      reportId: REPORT_ID,
      data,
      asAt: result.asAt,
      // Zero attempts is a true empty state, not an error: the child has not
      // sat a test yet. The UI says so plainly.
      state: attempts.length === 0 ? 'empty' : 'ok',
      pagination: {
        page: 1,
        pageSize: PAGE_SIZE,
        totalItems: attempts.length,
        hasMore: attempts.length > PAGE_MAX,
      },
    }),
    { status: 200, ttlSeconds: TTL_SECONDS }
  )
}
