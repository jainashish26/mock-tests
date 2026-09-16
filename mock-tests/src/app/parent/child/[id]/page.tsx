import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'
import { AssignTestForm } from '@/features/auth/components/AssignTestForm'
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
    </main>
  )
}
