import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'
import TestPageClient from './client'

export default async function TestPage({ params }: { params: Promise<{ assignmentId: string }> }) {
  await requireRole(['STUDENT'])
  const { assignmentId } = await params
  
  const supabase = await createClient()

  const { data: assignment } = await supabase
    .from('assignments')
    .select('*, tests(*)')
    .eq('id', assignmentId)
    .single()

  if (!assignment || !assignment.tests) return <div>Assignment not found</div>

  const { data: mappings } = await supabase
    .from('test_questions')
    .select('section_name, questions(id, stem, type, answer_a, answer_b, answer_c, answer_d, answer_e)')
    .eq('test_id', assignment.tests.id)

  const initialQuestions = mappings?.map(m => {
    const q = m.questions as any;
    if (!q) return null;
    return {
      ...q,
      section_name: m.section_name,
      options: [q.answer_a, q.answer_b, q.answer_c, q.answer_d, q.answer_e].filter(Boolean)
    };
  }).filter(Boolean) || []

  return (
    <TestPageClient 
      assignmentId={assignmentId} 
      timeLimitMins={assignment.tests.time_limit_mins} 
      initialQuestions={initialQuestions} 
    />
  )
}
