import type { SupabaseClient } from '@supabase/supabase-js'
import { toEvaluationDetail, categoryPercents } from '@/lib/writing/evaluation-detail'
import type { WritingProgressPoint } from '@/lib/writing/types'

type Row = Record<string, unknown>

function iso(value: unknown): string {
  if (!value) return new Date(0).toISOString()
  const d = new Date(String(value))
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString()
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

/**
 * Writing progress for one student: every graded test writing evaluation plus
 * every graded AI-practice session, chronological. Access is enforced by RLS on
 * the two source tables (parent may read their linked child only).
 */
export async function loadWritingProgress(supabase: SupabaseClient, studentId: string): Promise<WritingProgressPoint[]> {
  const points: WritingProgressPoint[] = []

  // Test-based writing evaluations, joined through the student's attempts.
  const { data: attempts } = await supabase
    .from('attempts')
    .select('id, test_id, tests(title)')
    .eq('student_id', studentId)

  const attemptRows = (attempts ?? []) as Row[]
  const attemptIds = attemptRows.map((a) => a.id).filter((v): v is string => typeof v === 'string')
  const titleById = new Map<string, string | null>()
  for (const a of attemptRows) {
    const t = a.tests as { title?: string } | null | undefined
    titleById.set(String(a.id), (t?.title as string) ?? null)
  }

  if (attemptIds.length > 0) {
    const { data: evals } = await supabase
      .from('writing_evaluations')
      .select('id, attempt_id, score_out_of100, category_scores, text_type, rubric_version, model, word_count, created_at')
      .in('attempt_id', attemptIds)

    for (const row of (evals ?? []) as Row[]) {
      const detail = toEvaluationDetail(row)
      if (!detail) continue
      points.push({
        source: 'test',
        attempt_id: str(row.attempt_id),
        practice_session_id: null,
        test_title: titleById.get(String(row.attempt_id)) ?? null,
        text_type: detail.text_type,
        date: iso(row.created_at),
        score: detail.score_out_of100,
        categories: categoryPercents(detail.category_scores),
      })
    }
  }

  // AI-practice sessions (graded only).
  const { data: practice } = await supabase
    .from('writing_practice_sessions')
    .select('id, score_out_of100, evaluation, text_type, graded_at, created_at')
    .eq('student_id', studentId)
    .eq('status', 'GRADED')

  for (const row of (practice ?? []) as Row[]) {
    const evalObj = row.evaluation && typeof row.evaluation === 'object' ? (row.evaluation as Record<string, unknown>) : {}
    const detail = toEvaluationDetail({
      ...evalObj,
      score_out_of100: row.score_out_of100,
      text_type: row.text_type,
      created_at: row.graded_at ?? row.created_at,
    })
    if (!detail) continue
    points.push({
      source: 'practice',
      attempt_id: null,
      practice_session_id: str(row.id),
      test_title: null,
      text_type: detail.text_type,
      date: iso(row.graded_at ?? row.created_at),
      score: detail.score_out_of100,
      categories: categoryPercents(detail.category_scores),
    })
  }

  return points.sort((a, b) => a.date.localeCompare(b.date))
}