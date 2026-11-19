import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'
import { loadReportData } from '@/lib/report/load-report-data'
import { TestReportView } from '@/features/report/components/TestReportView'

export default async function ParentReportPage({ params }: { params: Promise<{ attemptId: string }> }) {
  await requireRole(['PARENT'])
  const { attemptId } = await params

  const supabase = await createClient()

  // RLS ensures the parent only ever receives a linked child's attempt.
  const { attempt, responses, writingEvaluations } = await loadReportData(supabase, attemptId)

  // Full writing detail is gated behind an active subscription (see
  // `has_active_subscription` in migration 010). The summary (score, band,
  // strengths, first two improvements) renders free.
  const { data: unlimited } = await supabase
    .from('my_access')
    .select('is_unlimited')
    .maybeSingle()
  const unlocked = Boolean((unlimited as { is_unlimited?: boolean } | null)?.is_unlimited)

  if (!attempt) {
    return (
      <main style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto', textAlign: 'center' }}>
        <h1>Report unavailable</h1>
        <p style={{ color: 'var(--color-text-muted)' }}>
          This report could not be found, or you do not have access to it.
        </p>
        <a href="/parent" style={{ color: 'var(--color-primary)' }}>← Back to Dashboard</a>
      </main>
    )
  }

  return (
    <TestReportView
      attempt={attempt}
      responses={responses}
      writingEvaluations={writingEvaluations}
      role="PARENT"
      unlocked={unlocked}
    />
  )
}
