import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'
import { AssignTestForm } from '@/features/auth/components/AssignTestForm'
import { ParentReportingPanels } from '@/features/report/components/ParentReportingPanels'
import { ConsentPanel } from '@/features/report/components/ConsentPanel'
import { PlanControls } from '@/features/report/components/PlanControls'
import { loadParentPlan, overloadSentence } from '@/lib/reporting/parent-plan'
import Link from 'next/link'

export default async function ChildDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireRole(['PARENT'])
  const supabase = await createClient()

  const { id: childId } = await params

  // Verify link
  const { data: link } = await supabase
    .from('parent_student_links')
    .select('id')
    .eq('parent_user_id', user.id)
    .eq('student_id', childId)
    .single()

  if (!link) {
    return <div>Access Denied or Child Not Found</div>
  }

  // Fetch child profile
  const { data: child } = await supabase
    .from('student_profiles')
    .select('username, year_level')
    .eq('id', childId)
    .single()

  // Fetch accessible tests (RLS filters out paid tests without entitlements)
  const { data: tests } = await supabase
    .from('tests')
    .select('id, title, exam_type, is_free')

  // Fetch current assignments
  const { data: assignments } = await supabase
    .from('assignments')
    .select('id, assigned_at, tests(title, exam_type)')
    .eq('student_id', childId)
    .order('assigned_at', { ascending: false })

  // P9 plan, loaded server-side so the form's first paint shows the stored
  // values rather than an empty form that then pops into place.
  const planResult = await loadParentPlan(childId)

  // Fetch attempt history
  const { data: attempts } = await supabase
    .from('attempts')
    .select('id, status, score_out_of100, started_at, tests(title)')
    .eq('student_id', childId)
    .order('started_at', { ascending: false })

  return (
    <main style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <div style={{ marginBottom: '2rem' }}>
        <Link href="/parent" style={{ color: 'var(--color-primary)' }}>← Back to Dashboard</Link>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1>{child?.username}</h1>
        <span style={{ color: 'var(--color-text-muted)' }}>Year {child?.year_level}</span>
      </div>

      <div style={{ marginTop: '0.75rem' }}>
        <Link href={`/parent/child/${childId}/writing`} style={{ color: 'var(--color-primary)' }}>
          View writing progress & AI practice →
        </Link>
      </div>

      <section style={{ marginTop: '3rem' }}>
        <h2>Assign a New Test</h2>
        <p style={{ color: 'var(--color-text-muted)' }}>Select from your available free and purchased tests.</p>
        <AssignTestForm studentId={childId} tests={tests || []} />
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginTop: '3rem' }}>
        <section>
          <h2>Current Assignments</h2>
          {(!assignments || assignments.length === 0) ? <p>No tests assigned.</p> : (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {assignments.map(a => (
                <li key={a.id} style={{ padding: '1rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: '0.5rem' }}>
                  <strong>{(a.tests as any)?.title}</strong>
                  <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>{new Date(a.assigned_at).toLocaleDateString()}</div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2>Attempt History & Reports</h2>
          {(!attempts || attempts.length === 0) ? <p>No completed tests yet.</p> : (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {attempts.map((a: any) => (
                <li key={a.id} style={{ padding: '1rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between' }}>
                  <div>
                    <strong>{(a.tests as any)?.title}</strong>
                    <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>{a.status}</div>
                  </div>
                  {a.status === 'COMPLETE' && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                      <span style={{ fontWeight: 'bold', color: 'var(--color-primary)' }}>{a.score_out_of100}%</span>
                      <Link href={`/parent/report/${a.id}`} style={{ fontSize: '0.875rem' }}>View Report</Link>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/*
        Phase 1 parent reporting (P1 projection, P4 trends, P7 behaviour,
        P8 recommendations, P9 plan controls).

        Kept as a separate section from the lists above on purpose. The lists
        are operational - assign a test, open a report - and read the
        operational tables directly. These panels are analytical and read the
        reporting layer (materialised views behind SECURITY DEFINER functions),
        which is where score, trend and behaviour figures are defined once and
        shared with the emailed readiness report. Mixing the two would invite a
        second definition of the same number living in a page component.
      */}
      <section style={{ marginTop: '3rem' }} aria-labelledby="progress-heading">
        <h2 id="progress-heading">Progress & insights</h2>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginTop: '-0.5rem' }}>
          Readiness, trends and what to practise next. Every panel shows when its data was last
          refreshed.
        </p>

        <div className="mt-4 space-y-4">
          <ParentReportingPanels studentId={childId} />

        {/*
          P10 - who can see this child's data. Placed with the reports rather than
          buried in settings: a parent reading their child's results is exactly
          the moment they may wonder who else can see them, and the control should
          be there rather than three clicks away.
        */}
        <div className="mt-4">
          <ConsentPanel studentId={childId} childLabel={child?.username ?? 'this child'} />
        </div>

          <PlanControls
            studentId={childId}
            initialPlan={planResult.plan}
            initialOverloadNotice={overloadSentence(planResult.plan)}
            asAt={planResult.asAt}
          />
        </div>
      </section>
    </main>
  )
}
