import type { Metadata } from 'next'
import Link from 'next/link'
import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { buildReadinessReport } from '@/lib/report/readiness'
import { CONFIDENCE_LABEL } from '@/lib/report/readiness'
import { ReadinessReportView } from '@/features/report/components/ReadinessReportView'
import { getFunnelState, offerStatus } from '@/lib/funnel/state'
import { trackEvent } from '@/lib/funnel/track'

/**
 * /parent/readiness/[childId] - funnel step 4, and the step-6 paywall surface.
 *
 * This page does two jobs that pull in opposite directions, and the resolution is
 * the whole conversion mechanic:
 *
 *   GIVE ENOUGH THAT IT IS OBVIOUSLY WORTH SOMETHING. The score, the band per
 *   exam, the named topic gaps and the strengths are all rendered in full. A
 *   report that teases its own headline number is a report the parent resents,
 *   and resentment does not buy anything.
 *
 *   WITHHOLD THE PART THAT TURNS DIAGNOSIS INTO ACTION. Time-per-question,
 *   question-level review, longitudinal trend and the adaptive plan are shown as
 *   named, described, visibly-locked panels rather than omitted. Seeing what
 *   exists and cannot be opened is a far stronger motivator than not knowing it
 *   exists - the locked panel is the offer.
 *
 * Access control is RLS: `buildReadinessReport` is passed the parent's session
 * client, so a parent who guesses another family's child id gets no data at all.
 */

export const metadata: Metadata = {
  title: 'Exam readiness report',
  // A personalised report about a named child must never be indexable.
  robots: { index: false, follow: false },
}

export default async function ReadinessReportPage({
  params,
}: {
  params: Promise<{ childId: string }>
}) {
  const { user } = await requireRole(['PARENT'])
  const { childId } = await params
  const supabase = await createClient()

  // Confirm the link before building anything. RLS would return an empty report
  // anyway, but an explicit check lets us distinguish "not your child" from
  // "no data yet", which are different screens with different guidance.
  const { data: link } = await supabase
    .from('parent_student_links')
    .select('student_profiles(id, username, year_level)')
    .eq('parent_user_id', user.id)
    .eq('student_id', childId)
    .maybeSingle()

  type LinkedChild = { id: string; username: string; year_level: number } | null
  const child = (link as { student_profiles?: LinkedChild } | null)?.student_profiles ?? null

  if (!child) {
    return (
      <DashboardLayout role="PARENT" userName="Parent Account">
        <main style={emptyStyle}>
          <h1 style={emptyTitleStyle}>Report unavailable</h1>
          <p style={emptyBodyStyle}>
            That child profile is not on your account, or it has been removed.
          </p>
          <Link href="/parent" style={emptyLinkStyle}>
            Back to my dashboard
          </Link>
        </main>
      </DashboardLayout>
    )
  }

  // Does this family already own the deeper analytics? An active subscription
  // grants everything (see `has_active_subscription` in migration 010).
  const { data: unlimited } = await supabase
    .from('my_access')
    .select('is_unlimited')
    .maybeSingle()
  const unlocked = Boolean((unlimited as { is_unlimited?: boolean } | null)?.is_unlimited)

  const report = await buildReadinessReport(supabase, child.id, { unlocked })

  if (!report) {
    return (
      <DashboardLayout role="PARENT" userName="Parent Account">
        <main style={emptyStyle}>
          <h1 style={emptyTitleStyle}>No results yet for {child.username}</h1>
          <p style={emptyBodyStyle}>
            A readiness report needs at least one completed assessment. Assign a benchmark test and
            the report appears here automatically once it is submitted.
          </p>
          <Link href={`/parent/child/${child.id}`} style={emptyLinkStyle}>
            Assign a test
          </Link>
        </main>
      </DashboardLayout>
    )
  }

  // Whether the step-7 offer is live decides which CTA the locked panels show.
  // An offer that has expired must not be advertised as available.
  const state = await getFunnelState(user.id)
  const offerState = offerStatus(state)

  // READINESS_REPORT_VIEWED: funnel step 4. Fires server-side on every render,
  // which is correct for a VIEW event - each page load is a view. The parent
  // has already passed the access check (link exists, report built), so this
  // counts only genuine report views, not error screens or empty states.
  //
  // No score, no band, no topic detail in props: the event records that a
  // parent looked at a report, not what the report said. The report content
  // lives in fact_test_attempt and mv_topic_coverage, joined by student_id.
  await trackEvent({
    event: 'READINESS_REPORT_VIEWED',
    userId: user.id,
    studentId: child.id,
    props: {
      childId: child.id,
      surface: 'readiness',
      offerLive: offerState === 'live',
    },
  })

  return (
    <DashboardLayout role="PARENT" userName="Parent Account">
      <ReadinessReportView
        childLabel={child.username}
        report={report}
        confidenceLabel={CONFIDENCE_LABEL[report.exams.find((e) => e.eligible)?.confidence ?? 'low']}
        offerLive={offerState === 'live'}
        offerExpiresAt={state?.offer_expires_at ?? null}
        completedAttempts={state?.completed_attempts ?? report.attemptsUsed}
      />
    </DashboardLayout>
  )
}

const emptyStyle: React.CSSProperties = {
  maxWidth: '34rem',
  margin: '0 auto',
  padding: '4rem 1.25rem',
  textAlign: 'center',
}

const emptyTitleStyle: React.CSSProperties = {
  margin: '0 0 0.75rem',
  fontSize: '1.5rem',
  fontWeight: 800,
  letterSpacing: '-0.02em',
}

const emptyBodyStyle: React.CSSProperties = {
  margin: '0 0 1.5rem',
  fontSize: '0.9375rem',
  lineHeight: 1.7,
  color: 'var(--muted-foreground)',
}

const emptyLinkStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '0.8125rem 1.5rem',
  borderRadius: '9999px',
  background: 'var(--primary, #194bfb)',
  color: '#ffffff',
  fontSize: '0.9375rem',
  fontWeight: 700,
  textDecoration: 'none',
}
