import type { SupabaseClient } from '@supabase/supabase-js'

export type ReportData = {
  attempt: any | null
  responses: any[]
  writingEvaluations: any[]
}

/**
 * Loads everything the student/parent report needs in one place so both pages
 * stay in sync. Access control is enforced by RLS - this only shapes the data.
 */
export async function loadReportData(supabase: SupabaseClient, attemptId: string): Promise<ReportData> {
  const { data: attempt, error: attemptError } = await supabase
    .from('attempts')
    .select('*, tests(title, time_limit_mins)')
    .eq('id', attemptId)
    .maybeSingle()

  if (attemptError || !attempt) return { attempt: null, responses: [], writingEvaluations: [] }

  const [responsesRes, evalsRes, orderRes] = await Promise.all([
    supabase
      .from('responses')
      .select(
        `id, question_id, section_name, answer, is_correct, time_spent_seconds,
         questions(type, stem, correct_answer, explanation, answer_a, answer_b, answer_c, answer_d, answer_e)`
      )
      .eq('attempt_id', attemptId),
    supabase
      .from('writing_evaluations')
      .select('id, provider, score_out_of100, strengths, improvements, improved_text, created_at')
      .eq('attempt_id', attemptId)
      .order('created_at', { ascending: true }),
    attempt.test_id
      ? supabase
          .from('test_questions')
          .select('question_id, question_order')
          .eq('test_id', attempt.test_id)
      : Promise.resolve({ data: [] as any[] | null }),
  ])

  // `responses` has no order column, so sort by the test's question_order.
  const orderMap = new Map<string, number>()
  for (const row of orderRes.data ?? []) {
    if (row?.question_id) orderMap.set(String(row.question_id), Number(row.question_order ?? 0))
  }

  const responses = [...(responsesRes.data ?? [])].sort((a: any, b: any) => {
    const oa = orderMap.has(String(a.question_id)) ? orderMap.get(String(a.question_id))! : Number.MAX_SAFE_INTEGER
    const ob = orderMap.has(String(b.question_id)) ? orderMap.get(String(b.question_id))! : Number.MAX_SAFE_INTEGER
    return oa - ob
  })

  return { attempt, responses, writingEvaluations: evalsRes.data ?? [] }
}
