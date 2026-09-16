import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'
import { QuestionEditor } from '@/features/cms/components/QuestionEditor'
import Link from 'next/link'

export default async function QuestionEditorPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(['TEST_CREATOR'])
  const { id } = await params
  
  const isNew = id === 'new'
  let questionData = null

  if (!isNew) {
    const supabase = await createClient()
    const { data } = await supabase.from('questions').select('*').eq('id', id).single()
    if (!data) return <div>Question not found or access denied</div>
    questionData = data
  }

  return (
    <main style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <Link href="/creator" style={{ color: 'var(--color-primary)', display: 'inline-block', marginBottom: '2rem' }}>← Back to Dashboard</Link>
      
      <h1>{isNew ? 'New Question' : 'Edit Question'}</h1>
      <p style={{ color: 'var(--color-text-muted)', marginBottom: '2rem' }}>Ensure all mandatory tags are set before submitting for approval.</p>

      <QuestionEditor initialData={questionData} isNew={isNew} />
    </main>
  )
}
