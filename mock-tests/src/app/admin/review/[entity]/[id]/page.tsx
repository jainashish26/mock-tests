import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'
import { AdminReviewActions } from '@/features/cms/components/AdminReviewActions'
import Link from 'next/link'

export default async function AdminReviewPage({ params }: { params: Promise<{ entity: string, id: string }> }) {
  const { user } = await requireRole(['ADMIN'])
  const supabase = await createClient()

  const { entity, id } = await params
  const isQuestion = entity === 'questions'
  const isTest = entity === 'tests'

  if (!isQuestion && !isTest) return <div>Invalid entity</div>

  let data = null

  if (isQuestion) {
    const res = await supabase.from('questions').select('*').eq('id', id).single()
    data = res.data
  } else {
    // Tests: also load sections and questions (including question content and correct answer)
    const res = await supabase.from('tests').select('*, test_sections(*), test_questions(*, questions(id, stem, correct_answer))').eq('id', id).single()
    data = res.data
  }

  if (!data) return <div>Entity not found</div>

  return (
    <main style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <Link href="/admin" style={{ color: 'var(--color-primary)', display: 'inline-block', marginBottom: '2rem' }}>← Back to Dashboard</Link>
      
      <h1>Reviewing {isQuestion ? 'Question' : 'Test'}</h1>
      <div style={{ background: 'var(--color-surface)', padding: '2rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
        <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)' }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>

      <AdminReviewActions entityType={isQuestion ? 'questions' : 'tests'} entityId={id} />
    </main>
  )
}
