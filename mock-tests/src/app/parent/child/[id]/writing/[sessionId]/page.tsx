import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { WritingReportPanel } from '@/features/report/components/WritingReportPanel'
import Link from 'next/link'

/**
 * Parent-facing detail view for a single AI-practice session. The graded result
 * is stored on writing_practice_sessions.evaluation (jsonb); it is shaped into
 * the same report panel as a test essay, so parents see one consistent report.
 */
export default async function PracticeDetailPage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>
}) {
  const { user } = await requireRole(['PARENT'])
  const supabase = await createClient()

  const { id: childId, sessionId } = await params

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

  const { data: session } = await supabase
    .from('writing_practice_sessions')
    .select('id, student_id, prompt_text, student_text, text_type, year_level, score_out_of100, evaluation, rubric_version, model, graded_at, created_at')
    .eq('id', sessionId)
    .eq('student_id', childId)
    .single()

  if (!session) {
    return <div style={{ padding: '4rem', textAlign: 'center' }}>Practice not found, or it is not graded yet.</div>
  }

  // Full detail is gated behind an active subscription; the summary renders free.
  const { data: unlimited } = await supabase
    .from('my_access')
    .select('is_unlimited')
    .maybeSingle()
  const unlocked = Boolean((unlimited as { is_unlimited?: boolean } | null)?.is_unlimited)

  const evaluationRow = {
    ...(session.evaluation && typeof session.evaluation === 'object' ? session.evaluation : {}),
    score_out_of100: session.score_out_of100,
    text_type: session.text_type,
    rubric_version: session.rubric_version,
    model: session.model,
    created_at: session.graded_at ?? session.created_at,
  }

  return (
    <DashboardLayout role="PARENT" userName={user.email ?? 'Parent'}>
      <div style={{ maxWidth: '860px', margin: '0 auto', padding: '2rem 1rem' }}>
        <div style={{ marginBottom: '1rem' }}>
          <Link href={`/parent/child/${childId}/writing`} style={{ color: 'var(--color-primary)' }}>
            ← Back to writing progress
          </Link>
        </div>

        <h1 style={{ fontSize: '1.75rem', fontWeight: 800, margin: '0 0 0.5rem' }}>
          AI Practice — {child?.username ?? 'student'}
        </h1>
        <p style={{ color: 'var(--color-text-muted)', margin: '0 0 2rem', lineHeight: 1.6 }}>
          {session.prompt_text}
        </p>

        <WritingReportPanel evaluations={[evaluationRow]} studentText={session.student_text} unlocked={unlocked} />
      </div>
    </DashboardLayout>
  )
}