import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

interface ChildSummary {
  id: string
  username: string
  year_level: number | null
  latestWritingScore: number | string | null
  latestWritingType: string | null
  latestWritingDate: string | null
  latestTestScore: number | string | null
  latestTestTitle: string | null
  latestTestDate: string | null
}

export default async function ParentReportsPage() {
  const { user } = await requireRole(['PARENT'])
  const supabase = await createClient()

  // Linked children (RLS already limits this to the caller's own links).
  const { data: links } = await supabase
    .from('parent_student_links')
    .select(`
      student_profiles (
        id,
        username,
        year_level
      )
    `)
    .eq('parent_user_id', user.id)

  type LinkRow = { student_profiles: ChildSummary | null }
  const children = ((links ?? []) as unknown as LinkRow[])
    .map((l) => l.student_profiles)
    .filter((s): s is ChildSummary => s !== null && s !== undefined)

  // Latest writing + latest completed test for each child. Reads go through the
  // parent's own client so RLS (may_read_results + is_parent_of) gates them.
  const childSummaries: ChildSummary[] = await Promise.all(
    children.map(async (child) => {
      const { data: practice } = await supabase
        .from('writing_practice_sessions')
        .select('score_out_of100, graded_at, text_type')
        .eq('student_id', child.id)
        .eq('status', 'GRADED')
        .order('graded_at', { ascending: false })
        .limit(1)

      const { data: attempts } = await supabase
        .from('attempts')
        .select('score_out_of100, started_at, tests(title)')
        .eq('student_id', child.id)
        .eq('status', 'COMPLETE')
        .order('started_at', { ascending: false })
        .limit(1)

      type AttemptRow = {
        score_out_of100: number | string | null
        started_at: string | null
        tests: { title: string | null } | null
      }
      const attemptRows = (attempts ?? []) as unknown as AttemptRow[]
      const latestAttempt = attemptRows[0] ?? null

      return {
        ...child,
        latestWritingScore: practice?.[0]?.score_out_of100 ?? null,
        latestWritingType: practice?.[0]?.text_type ?? null,
        latestWritingDate: practice?.[0]?.graded_at ?? null,
        latestTestScore: latestAttempt?.score_out_of100 ?? null,
        latestTestTitle: latestAttempt?.tests?.title ?? null,
        latestTestDate: latestAttempt?.started_at ?? null,
      }
    })
  )


  return (
    <main style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ marginBottom: '1rem' }}>
        <Link href="/parent" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>
          ← Back to Children
        </Link>
      </div>

      <h1 style={{ margin: '0 0 0.25rem', fontSize: '1.75rem', fontWeight: 800 }}>Reports</h1>
      <p style={{ color: 'var(--color-text-muted)', margin: '0 0 2rem' }}>
        Writing scores, test results and progress for each of your linked children.
      </p>

      {childSummaries.length === 0 ? (
        <div
          style={{
            padding: '4rem 2rem',
            textAlign: 'center',
            color: 'var(--color-text-muted)',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
          }}
        >
          <p style={{ margin: '0 0 1rem' }}>No linked children yet. Add a student profile to start.</p>
          <Link href="/parent" style={{ color: 'var(--color-primary)', fontWeight: 700 }}>
            Go to Children →
          </Link>
        </div>
      ) : (
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: '1.5rem',
          }}
        >
          {childSummaries.map((child) => (
            <article
              key={child.id}
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)',
                padding: '1.5rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Link
                  href={`/parent/child/${child.id}`}
                  style={{ color: 'var(--color-primary)', textDecoration: 'none', fontWeight: 700, fontSize: '1.15rem' }}
                >
                  {child.username}
                </Link>
                <span
                  style={{
                    fontSize: '0.8rem',
                    color: 'var(--color-text-muted)',
                    background: 'var(--color-bg, #f1f5f9)',
                    padding: '0.125rem 0.6rem',
                    borderRadius: '999px',
                  }}
                >
                  Year {child.year_level ?? '—'}
                </span>
              </div>


              <div
                style={{
                  padding: '1rem',
                  background: 'var(--color-bg, #f8fafc)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, color: 'var(--color-text-muted)', marginBottom: '0.35rem' }}>
                  Latest writing score
                </div>
                {child.latestWritingScore !== null ? (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '1.9rem', fontWeight: 800, lineHeight: 1, color: 'var(--color-primary)' }}>
                      {Math.round(Number(child.latestWritingScore))}
                    </span>
                    <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>/ 100</span>
                    {child.latestWritingType && (
                      <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', textTransform: 'capitalize' }}>
                        · {child.latestWritingType}
                      </span>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>No writing results yet</div>
                )}
              </div>

              <div
                style={{
                  padding: '1rem',
                  background: 'var(--color-bg, #f8fafc)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, color: 'var(--color-text-muted)', marginBottom: '0.35rem' }}>
                  Latest test score
                </div>
                {child.latestTestScore !== null ? (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '1.9rem', fontWeight: 800, lineHeight: 1, color: 'var(--color-primary)' }}>
                      {Math.round(Number(child.latestTestScore))}
                    </span>
                    <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>%</span>
                    {child.latestTestTitle && (
                      <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>· {child.latestTestTitle}</span>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>No completed tests yet</div>
                )}
              </div>

              <div style={{ marginTop: 'auto', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <Link
                  href={`/parent/child/${child.id}/writing`}
                  style={{
                    flex: '1 1 45%',
                    textAlign: 'center',
                    padding: '0.6rem 0.75rem',
                    background: 'var(--color-primary)',
                    color: '#fff',
                    borderRadius: 'var(--radius-md)',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    textDecoration: 'none',
                  }}
                >
                  Writing progress
                </Link>
                <Link
                  href={`/parent/child/${child.id}`}
                  style={{
                    flex: '1 1 45%',
                    textAlign: 'center',
                    padding: '0.6rem 0.75rem',
                    background: 'var(--color-surface)',
                    color: 'var(--color-primary)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    textDecoration: 'none',
                  }}
                >
                  Test reports
                </Link>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  )
}

