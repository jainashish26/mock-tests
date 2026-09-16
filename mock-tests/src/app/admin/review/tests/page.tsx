import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'
import { DashboardLayout } from "@/components/layout/DashboardLayout"
import { TestsDataTable } from './TestsDataTable'

export default async function AdminTestsPage() {
  await requireRole(['ADMIN'])
  const supabase = await createClient()

  // Fetch tests
  const { data: tests, error } = await supabase
    .from('tests')
    .select('id, title, status, exam_type, created_at, updated_at')
    .order('created_at', { ascending: false })

  return (
    <DashboardLayout role="ADMIN" userName="System Administrator">
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 800 }}>Manage Tests</h1>
        <p style={{ color: 'var(--color-text-muted)' }}>Review and manage the status of all tests.</p>
      </div>
      
      {error ? (
        <div style={{ color: 'var(--color-danger)' }}>Error loading tests: {error.message}</div>
      ) : (
        <TestsDataTable initialTests={tests || []} />
      )}
    </DashboardLayout>
  )
}
