import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'
import { TestEditor } from '@/features/cms/components/TestEditor'
import Link from 'next/link'

export default async function TestEditorPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(['TEST_CREATOR'])
  const { id } = await params
  
  const isNew = id === 'new'
  let testData = null

  if (!isNew) {
    const supabase = await createClient()
    const { data } = await supabase.from('tests').select('*').eq('id', id).single()
    if (!data) return <div>Test not found or access denied</div>
    testData = data
  }

  return (
    <main style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <Link href="/creator" style={{ color: 'var(--color-primary)', display: 'inline-block', marginBottom: '2rem' }}>← Back to Dashboard</Link>
      
      <h1>{isNew ? 'New Test' : 'Edit Test'}</h1>
      <p style={{ color: 'var(--color-text-muted)', marginBottom: '2rem' }}>Define the test envelope. (Section and question mapping to be added in future tabs).</p>

      <TestEditor initialData={testData} isNew={isNew} />
    </main>
  )
}
