import { createAdminClient } from '../supabase/admin'
import { Client as QStashClient } from '@upstash/qstash'

export async function scoreAttempt(attemptId: string) {
  const admin = createAdminClient()

  // Fetch responses with question details
  const { data: responses, error: respErr } = await admin
    .from('responses')
    .select('id, answer, section_name, difficulty_served, time_spent_seconds, question_id, questions(id, type, correct_answer)')
    .eq('attempt_id', attemptId)

  if (respErr || !responses) throw new Error('Failed to fetch responses: ' + respErr?.message)

  let totalQuestions = 0
  let totalCorrect = 0
  
  let sectionStats: Record<string, { correct: number, total: number }> = {}

  let hasWriting = false
  const updates = []

  for (const r of responses) {
    const q = r.questions as any
    if (!q) continue

    if (q.type === 'WRITING') {
      // Writing questions are scored separately via AI worker
      hasWriting = true
      continue
    }

    let isCorrect = false

    if (q.type === 'MCQ') {
      isCorrect = (r.answer === q.correct_answer)
    } else if (q.type === 'SHORT_ANSWER') {
      // Simple exact match logic for MVP
      isCorrect = (String(r.answer).trim().toLowerCase() === String(q.correct_answer).trim().toLowerCase())
    }

    totalQuestions++
    if (isCorrect) totalCorrect++

    if (!sectionStats[r.section_name]) sectionStats[r.section_name] = { correct: 0, total: 0 }
    sectionStats[r.section_name].total++
    if (isCorrect) sectionStats[r.section_name].correct++

    updates.push({
      id: r.id,
      attempt_id: attemptId,
      question_id: r.question_id,
      section_name: r.section_name,
      difficulty_served: r.difficulty_served,
      answer: r.answer,
      is_correct: isCorrect
    })
  }

  // Update responses with is_correct flags
  // (In a real app, do mass upsert avoiding missing unique keys or update individually)
  for (const update of updates) {
    await admin.from('responses').update({ is_correct: update.is_correct }).eq('id', update.id)
  }

  const rawAccuracy = totalQuestions > 0 ? (totalCorrect / totalQuestions) * 100 : 0
  
  // Calculate section scores format: { "Math": 85.5, "Reading": 90.0 }
  const sectionScores: Record<string, number> = {}
  for (const [sec, stats] of Object.entries(sectionStats)) {
    sectionScores[sec] = stats.total > 0 ? (stats.correct / stats.total) * 100 : 0
  }

  // For MVP, weighted score is same as raw accuracy.
  const weightedScore = rawAccuracy
  const scoreOutOf100 = rawAccuracy

  const status = hasWriting ? 'WRITING_PENDING' : 'COMPLETE'

  // Mark attempt as COMPLETE if no writing answers pending, else WRITING_PENDING
  const { error: attemptErr } = await admin.from('attempts').update({
    status: status,
    score_out_of100: scoreOutOf100,
    section_scores: sectionScores,
    raw_accuracy: rawAccuracy,
    weighted_score: weightedScore
  }).eq('id', attemptId)

  if (attemptErr) throw new Error('Failed to update attempt stats')

  if (hasWriting) {
    // Trigger QStash
    const qstash = new QStashClient({ token: process.env.QSTASH_TOKEN! })
    await qstash.publishJSON({
      url: process.env.QSTASH_WRITING_EVAL_ENDPOINT!,
      body: { attemptId }
    })
  }

  return { rawAccuracy, scoreOutOf100, sectionScores }
}
