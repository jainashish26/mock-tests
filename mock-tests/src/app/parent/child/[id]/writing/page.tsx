import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { WritingProgressChart } from '@/features/report/components/WritingProgressChart'
import { loadWritingProgress } from '@/lib/report/load-writing-progress'
import { scoreBand } from '@/lib/writing/evaluation-detail'
import Link from 'next/link'

/**
 * Parent-facing writing progress report. Threads the same child-link check as
 * /parent/child/[id], then plots every graded writing (tests + AI practice) on
 * one trend. The deep per-attempt feedback still lives in the checklist report
 * (WritingReportPanel); this page is the "how is my child tracking over time"
 * view.
 */
export default async function ChildWritingPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireRole(['PARENT'])
  const supabase = await createClient()

  const { id: childId } = await params

  const { data: link } = await supabase
    .from('parent_student_links')
    .select('id')
    .eq('parent_user_id', user.id)
    .eq('student_id', childId)
    .single()

  if (!link) {
    return <div style={{ padding: '4rem', textAlign: 'center' }}>Access Denied or Child Not Found</div>
  }

  const { data: child } = await supabase
    .from('student_profiles')
    .select('username, year_level')
    .eq('id', childId)
    .single()

  const points = await loadWritingProgress(supabase, childId)
  const recent = [...points].reverse()

  return (
    <DashboardLayout role="PARENT" userName={user.email ?? 'Parent'}>
      <div style={{ maxWidth: '820px', margin: '0 auto', padding: '2rem 1rem' }}>
        <div style={{ marginBottom: '1rem' }}>
          <Link href={`/parent/child/${childId}`} style={{ color: 'var(--color-primary)' }}>
            ← Back to {child?.username ?? 'profile'}
          </Link>
        </div>

        <h1 style={{ fontSize: '1.75rem', fontWeight: 800, margin: '0 0 0.25rem' }}>
          Writing progress{child?.username ? ` — ${child.username}` : ''}
        </h1>
        <p style={{ color: 'var(--color-text-muted)', margin: '0 0 2rem' }}>
          {child?.year_level ? `Year ${child.year_level} · ` : ''}Overall and per-category writing scores across tests and AI practice.
        </p>

        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '2rem', marginBottom: '2rem' }}>
          <WritingProgressChart points={points} />
        </div>

        {recent.length > 0 && (
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '1.5rem 2rem' }}>
            <h2 style={{ fontSize: '1.25rem', margin: '0 0 1rem' }}>Recent results</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ padding: '0.5rem 0' }}>Date</th>
                  <th style={{ padding: '0.5rem 0' }}>Type</th>
                  <th style={{ padding: '0.5rem 0' }}>Source</th>
                  <th style={{ padding: '0.5rem 0', textAlign: 'right' }}>Score</th>
                  <th style={{ padding: '0.5rem 0', textAlign: 'right' }}>Band</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((p, i) => {
                  const d = new Date(p.date)
                  const date = Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString()
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '0.6rem 0' }}>{date}</td>
                      <td style={{ padding: '0.6rem 0', textTransform: 'capitalize' }}>{p.text_type ?? '—'}</td>
                      <td style={{ padding: '0.6rem 0' }}>
                        {p.source === 'test' && p.attempt_id ? (
                          <Link href={`/parent/report/${p.attempt_id}`} style={{ color: 'var(--color-primary)' }}>
                            Test
                          </Link>
                        ) : p.practice_session_id ? (
                          <Link href={`/parent/child/${childId}/writing/${p.practice_session_id}`} style={{ color: 'var(--color-primary)' }}>
                            AI Practice
                          </Link>
                        ) : p.source === 'test' ? 'Test' : 'AI Practice'}
                      </td>
                      <td style={{ padding: '0.6rem 0', textAlign: 'right', fontWeight: 700 }}>{Math.round(p.score)}</td>
                      <td style={{ padding: '0.6rem 0', textAlign: 'right' }}>{scoreBand(p.score)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}