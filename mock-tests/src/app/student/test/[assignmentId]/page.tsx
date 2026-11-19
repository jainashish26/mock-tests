import { notFound, redirect } from 'next/navigation'
import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'
import { finalizeExpiredAttempt, isAttemptExpired } from '@/lib/runner/attempt-expiry'
import TestPageClient from './client'

/** Keep the letter next to its text: `.filter(Boolean)` on a bare array of
 *  option texts silently shifts every option when one column is NULL, so the
 *  index no longer matches the stored `correct_answer` letter. */
const OPTION_COLUMNS = [
  ['A', 'answer_a'],
  ['B', 'answer_b'],
  ['C', 'answer_c'],
  ['D', 'answer_d'],
  ['E', 'answer_e'],
] as const

export default async function TestPage({ params }: { params: Promise<{ assignmentId: string }> }) {
  const { user } = await requireRole(['STUDENT'])
  const { assignmentId } = await params

  const supabase = await createClient()

  const { data: profile } = await supabase
    .from('student_profiles')
    .select('id, year_level')
    .eq('auth_user_id', user.id)
    .single()

  if (!profile) notFound()

  const { data: assignment } = await supabase
    .from('assignments')
    .select('id, student_id, due_at, tests(*)')
    .eq('id', assignmentId)
    .single()

  if (!assignment || assignment.student_id !== profile.id || !assignment.tests) notFound()

  const test = assignment.tests as Record<string, any>

  // Deterministic order. `question_order` was NULL for every row before the
  // student_flow_fixes migration, so Postgres returned questions in physical
  // order and two page loads could show different sequences.
  const { data: mappings } = await supabase
    .from('test_questions')
    .select(
      'question_id, section_name, question_order, questions(id, stem, type, comprehension_text, answer_a, answer_b, answer_c, answer_d, answer_e)'
    )
    .eq('test_id', test.id)
    .order('question_order', { ascending: true })

  const initialQuestions = (mappings ?? [])
    .map((m) => {
      const q = m.questions as Record<string, any> | null
      if (!q) return null
      return {
        id: q.id,
        type: q.type,
        stem: q.stem,
        section_name: m.section_name ?? 'General',
        comprehension_text: q.comprehension_text ?? null,
        options: OPTION_COLUMNS.map(([letter, col]) => ({ letter, text: q[col] }))
          .filter((o) => o.text !== null && o.text !== undefined && String(o.text).trim() !== '')
          .map((o) => ({ letter: o.letter, text: String(o.text) })),
      }
    })
    .filter((q): q is NonNullable<typeof q> => q !== null)

  if (initialQuestions.length === 0) notFound()

  // Resume an in-progress attempt instead of always showing the intro screen,
  // and rehydrate saved answers so a student on a new device is not blanked out.
  const { data: openAttempt } = await supabase
    .from('attempts')
    .select('id, started_at')
    .eq('student_id', profile.id)
    .eq('test_id', test.id)
    .eq('status', 'IN_PROGRESS')
    .order('started_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  // Never resume an attempt whose countdown is already at zero: the runner
  // would auto-submit ~1s after mounting and the student would watch the exam
  // "end" seconds after opening it. Finalise it here (SUBMITTED + scored,
  // backdated to the deadline) and show the report directly.
  if (openAttempt && isAttemptExpired(openAttempt.started_at, test.time_limit_mins)) {
    await finalizeExpiredAttempt(supabase, openAttempt.id, openAttempt.started_at, test.time_limit_mins)
    redirect(`/student/report/${openAttempt.id}`)
  }

  const savedResponses: Record<string, string> = {}
  if (openAttempt) {
    const { data: existing } = await supabase
      .from('responses')
      .select('question_id, answer')
      .eq('attempt_id', openAttempt.id)

    for (const r of existing ?? []) {
      const a = r.answer
      savedResponses[r.question_id] =
        a === null || a === undefined ? '' : typeof a === 'string' ? a : JSON.stringify(a)
    }
  } else {
    // No open attempt: if one was already finished, `/api/runner/start` would
    // reject with 409, so send the student straight to their report rather than
    // showing a "Start Test" button that cannot work.
    const { data: finished } = await supabase
      .from('attempts')
      .select('id')
      .eq('student_id', profile.id)
      .eq('test_id', test.id)
      .in('status', ['COMPLETE', 'WRITING_PENDING', 'SUBMITTED'])
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (finished?.id) redirect(`/student/report/${finished.id}`)
  }

  return (
    <TestPageClient
      assignmentId={assignmentId}
      testTitle={test.title ?? 'Mock Test'}
      timeLimitMins={test.time_limit_mins ?? 60}
      initialQuestions={initialQuestions}
      initialAttemptId={openAttempt?.id ?? null}
      startedAt={openAttempt?.started_at ?? null}
      savedResponses={savedResponses}
      dueAt={assignment.due_at ?? null}
      yearLevel={profile.year_level ?? null}
    />
  )
}

