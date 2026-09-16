import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'
import { TestReportView } from '@/features/report/components/TestReportView'

export default async function StudentReportPage({ params }: { params: Promise<{ attemptId: string }> }) {
  await requireRole(['STUDENT'])
  const { attemptId } = await params
  
  const supabase = await createClient()

  // RLS will ensure the student only fetches their own attempt
  const { data: attempt } = await supabase
    .from('attempts')
    .select('*, tests(title)')
    .eq('id', attemptId)
    .single()

  if (!attempt) return <div>Report not found or access denied.</div>

  const { data: responses } = await supabase
    .from('responses')
    .select('id, section_name, answer, is_correct, questions(stem, correct_answer)')
    .eq('attempt_id', attemptId)
    .order('created_at', { ascending: true })

  return <TestReportView attempt={attempt} responses={responses || []} role="STUDENT" />
}
