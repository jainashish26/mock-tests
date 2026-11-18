import type { Metadata } from 'next'

import { PageHeader } from '@/features/creator/components/PageHeader'
import {
  DataQualityPanel,
  PlatformHealthPanel,
} from '@/features/report/components/AdminOperationsPanels'
import { CoverageGapsPanel } from '@/features/report/components/CoveragePanels'
import { ItemStatisticsPanel } from '@/features/report/components/ItemStatisticsPanel'
import { FunnelPanel } from '@/features/report/components/FunnelPanel'
import { ExperimentsPanel } from '@/features/report/components/ExperimentsPanel'
import { defaultDateRange } from '@/lib/reporting/format'
import { requireRole } from '@/lib/rbac/require-role'
import { createAdminClient } from '@/lib/supabase/admin'

import { AttemptsDataTable, type AttemptRow } from './AttemptsDataTable'

export const metadata: Metadata = { title: 'Reports' }
export const dynamic = 'force-dynamic'

/**
 * FK joins come back as arrays from the untyped supabase client; flatten to a
 * single row (attempts belong to exactly one test/student).
 */
function firstJoinOf<T>(value: T[] | T | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

/**
 * Admin → Reports: every test attempt across the platform with student, test,
 * score, status and timing. Read-only — attempt details live in the student's
 * own report view. Uses the admin client because attempts belong to other
 * users and no RLS policy exposes them cross-user.
 */
export default async function AdminReportsPage() {
  await requireRole(['ADMIN'])

  // A11's window. 30 days: see the comment at the FunnelPanel below.
  const funnelRange = defaultDateRange(30)

  const adminClient = createAdminClient()

  const { data } = await adminClient
    .from('attempts')
    .select(
      'id, status, score_out_of100, started_at, submitted_at, duration_seconds, tests(title, exam_type), student_profiles(username)'
    )
    .order('started_at', { ascending: false })

  const rows: AttemptRow[] = ((data ?? []) as Record<string, unknown>[]).map((attempt) => {
    const test = firstJoinOf(attempt.tests as { title?: string | null; exam_type?: string | null } | null)
    const student = firstJoinOf(attempt.student_profiles as { username?: string | null } | null)
    return {
      id: String(attempt.id),
      status: typeof attempt.status === 'string' ? attempt.status : 'IN_PROGRESS',
      score:
        typeof attempt.score_out_of100 === 'number' || typeof attempt.score_out_of100 === 'string'
          ? attempt.score_out_of100
          : null,
      startedAt: typeof attempt.started_at === 'string' ? attempt.started_at : null,
      submittedAt: typeof attempt.submitted_at === 'string' ? attempt.submitted_at : null,
      durationSeconds:
        typeof attempt.duration_seconds === 'number' ? attempt.duration_seconds : null,
      testTitle: test?.title ?? null,
      testExamType: test?.exam_type ?? null,
      studentName: student?.username ?? null,
    }
  })

  return (
    <>
      <PageHeader
        title="Reports"
        description="Platform health, data quality, and every test attempt across the platform."
      />

      {/*
        A14 and A15 come FIRST, above the attempts table, deliberately.

        They answer "can I trust what is below?" - a stale materialised view is
        indistinguishable from a correct one, so an operator who scrolls
        straight to the attempt rows may be reading figures whose ETL stopped
        two days ago. Putting the freshness panel above the data means the
        caveat is seen before the numbers, not after.
      */}
      <div className="grid gap-4 xl:grid-cols-2">
        <PlatformHealthPanel />
        <DataQualityPanel />
      </div>

      {/*
        A3 sits under the two operations panels rather than beside them. A14/A15
        answer "can I trust the numbers?"; A3 answers a different question about
        the item bank, and it is wide enough that sharing a two-column row would
        compress its table into illegibility.
      */}
      <div className="mt-4">
        <CoverageGapsPanel />
      </div>

      {/*
        A1 sits directly under A3 because they are the two halves of the same
        question about the item bank: A3 asks whether there is ENOUGH content,
        A1 asks whether the content there is any GOOD. Reading them together is
        what stops a coverage gap being closed by commissioning more items that
        will themselves fail discrimination.

        It also carries the platform's most serious open data-quality finding:
        responses.is_correct currently contradicts questions.correct_answer for
        52% of MCQ responses, so every accuracy-derived figure - here and in P3,
        T1, T2, T3 and T7 - counts marks rather than right answers. The panel
        says so above its own chart rather than leaving it to A15.
      */}
      <div className="mt-4">
        <ItemStatisticsPanel />
      </div>

      {/*
        A11 - the conversion funnel. Thirty days, unsegmented.

        Placed with the other operator reports rather than on a marketing page
        because its output is an operational decision ("fix the weakest stage"),
        not a vanity metric. The window is 30 days rather than today because a
        single day rarely reaches the n>=20 reporting floor, and a panel that is
        permanently suppressed trains operators to stop reading it.

        Segmentation is available via the API (?segment=channel|campaign|device)
        but not surfaced as a control here yet: with current traffic almost every
        segment falls below the floor, so the honest default is the headline
        funnel.
      */}
      <div className="mt-4">
        <FunnelPanel fromDate={funnelRange.from} toDate={funnelRange.to} />
      </div>

      {/*
        C9 - the same funnel split by device. A separate panel rather than a
        toggle because the requirement is that EVERY funnel number be available
        by device, and a control that defaults to hidden satisfies the letter of
        that while leaving the operator looking at unsplit figures.

        showOutcomes={false}: free-to-paid, abandonment and time-to-first-value
        are whole-funnel measures and are not computed per device. Repeating them
        here would imply they were device-specific.
      */}
      <div className="mt-4">
        <FunnelPanel
          fromDate={funnelRange.from}
          toDate={funnelRange.to}
          segment="device"
          showOutcomes={false}
        />
      </div>

      {/*
        A12 sits directly below A11 because they answer consecutive questions:
        A11 says where the funnel leaks, A12 says whether the change made to fix
        it actually worked. Reading them apart invites shipping a fix on the
        strength of a funnel chart alone.
      */}
      <div className="mt-4">
        <ExperimentsPanel />
      </div>

      <section
        aria-labelledby="attempts-report"
        className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-6"
      >
        <h2 id="attempts-report" className="sr-only">
          Test attempts
        </h2>
        <AttemptsDataTable rows={rows} />
      </section>
    </>
  )
}
