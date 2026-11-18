import { createAdminClient } from '../supabase/admin'
import { Client as QStashClient } from '@upstash/qstash'

/**
 * Scoring engine.
 *
 * Two conventions for `questions.correct_answer` exist in the data and BOTH must
 * be supported, otherwise every MCQ is silently marked wrong:
 *
 *   1. A letter key    -> "C"                        (what the CSV importer writes)
 *   2. The option text -> "The report was thorough"
 *
 * The runner stores whichever the student clicked, so both sides are canonicalised
 * to the option *text* before comparing.
 */

const OPTION_COLUMNS = ['answer_a', 'answer_b', 'answer_c', 'answer_d', 'answer_e'] as const
const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E'] as const

const GRADED_TYPES = new Set(['MCQ', 'READING_COMPREHENSION', 'SHORT_ANSWER'])

type Row = Record<string, any>

/** Postgres `jsonb` comes back already-parsed, but legacy rows may hold strings. */
function toText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/** Collapse whitespace + case so "  Yes " === "yes". */
function normalize(value: unknown): string {
  return toText(value).trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Strip a leading option label, e.g. "C) Because..." or "B. Because...". */
function stripOptionLabel(text: string): string {
  return text.replace(/^\s*[([]?([A-Ea-e])[).:\]]\s*/, '').trim()
}

/**
 * Resolve any stored answer to the canonical option *text*, so a letter and the
 * text it points to compare equal.
 */
function canonicalize(raw: unknown, question: Row | null): string {
  const text = stripOptionLabel(toText(raw))
  if (!text) return ''

  const upper = text.toUpperCase()

  // Single letter A-E: map it onto that option's text when the question has one.
  if (/^[A-E]$/.test(upper)) {
    const idx = OPTION_LETTERS.indexOf(upper as (typeof OPTION_LETTERS)[number])
    const optionText = question ? toText(question[OPTION_COLUMNS[idx]]) : ''
    if (optionText) return normalize(stripOptionLabel(optionText))
    return upper.toLowerCase()
  }

  return normalize(text)
}

function isChoiceCorrect(responseAnswer: unknown, question: Row): boolean {
  const given = canonicalize(responseAnswer, question)
  const expected = canonicalize(question.correct_answer, question)
  if (!given || !expected) return false
  if (given === expected) return true

  // Last resort: both sides are bare letters.
  const givenLetter = stripOptionLabel(toText(responseAnswer)).toUpperCase()
  const expectedLetter = stripOptionLabel(toText(question.correct_answer)).toUpperCase()
  return /^[A-E]$/.test(givenLetter) && givenLetter === expectedLetter
}

/** Numeric compare that tolerates "$1,200", "45%" and "3.0" vs "3". */
function numbersEqual(a: string, b: string): boolean {
  const parse = (s: string) => {
    const cleaned = s.replace(/[^0-9.\-]/g, '')
    if (!cleaned || cleaned === '-' || cleaned === '.') return NaN
    return Number(cleaned)
  }
  const na = parse(a)
  const nb = parse(b)
  return !Number.isNaN(na) && !Number.isNaN(nb) && na === nb
}

/** SHORT_ANSWER accepts several correct spellings separated by `|`, `;` or `/`. */
function isShortAnswerCorrect(responseAnswer: unknown, question: Row): boolean {
  const given = normalize(responseAnswer)
  if (!given) return false

  const expectedRaw = toText(question.correct_answer).trim()
  if (!expectedRaw) return false

  const accepted = expectedRaw
    .split(/\s*[|;]\s*|\s+\/\s+/)
    .map((s) => normalize(s))
    .filter(Boolean)

  return accepted.some((c) => c === given || numbersEqual(given, c))
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** responses.difficulty_served has CHECK (1..4) and is NOT NULL. */
function clampDifficulty(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 1
  return Math.min(4, Math.max(1, Math.round(n)))
}

export interface ScoreResult {
  rawAccuracy: number
  scoreOutOf100: number
  sectionScores: Record<string, number>
  totalCorrect: number
  totalGraded: number
  status: string
}

export async function scoreAttempt(attemptId: string): Promise<ScoreResult> {
  const admin = createAdminClient()

  const { data: attempt, error: attemptErr } = await admin
    .from('attempts')
    .select('id, test_id, student_id, started_at, submitted_at')
    .eq('id', attemptId)
    .single()

  if (attemptErr || !attempt) {
    throw new Error('Failed to fetch attempt: ' + (attemptErr?.message ?? 'not found'))
  }

  // The FULL question set is the denominator. Scoring only *answered* questions
  // would let a student who answers 1 of 90 correctly score 100%.
  const { data: mappings, error: mapErr } = await admin
    .from('test_questions')
    .select(
      'question_id, section_name, base_difficulty, question_order, questions(id, type, correct_answer, answer_a, answer_b, answer_c, answer_d, answer_e)'
    )
    .eq('test_id', attempt.test_id)
    .order('question_order', { ascending: true })

  if (mapErr) throw new Error('Failed to fetch test questions: ' + mapErr.message)

  const { data: responses, error: respErr } = await admin
    .from('responses')
    .select('id, question_id, answer, section_name, difficulty_served, time_spent_seconds')
    .eq('attempt_id', attemptId)

  if (respErr) throw new Error('Failed to fetch responses: ' + respErr.message)

  const responseByQuestion = new Map<string, Row>()
  for (const r of responses ?? []) responseByQuestion.set(r.question_id, r)

  let totalGraded = 0
  let totalCorrect = 0
  // Difficulty-weighted accumulators for `weighted_score`. Kept separate from
  // totalCorrect/totalGraded so the unweighted `raw_accuracy` stays genuinely
  // unweighted - the two must be able to disagree, or one of them is redundant.
  let weightedCorrect = 0
  let weightedTotal = 0
  let answeredSeconds = 0
  let writingNeedsGrading = false

  const sectionStats: Record<string, { correct: number; total: number }> = {}
  const gradingRows: Row[] = []

  for (const mapping of mappings ?? []) {
    const question = mapping.questions as Row | null
    if (!question) continue

    const sectionName: string = mapping.section_name ?? 'General'
    const response = responseByQuestion.get(mapping.question_id)
    const answerText = response ? toText(response.answer) : ''

    if (response?.time_spent_seconds) {
      answeredSeconds += Number(response.time_spent_seconds) || 0
    }

    // Writing is graded asynchronously by the AI worker, so it is excluded from
    // the accuracy denominator and contributes via writing_evaluations instead.
    if (question.type === 'WRITING') {
      if (answerText.trim().length > 0) writingNeedsGrading = true
      if (response) {
        gradingRows.push({
          attempt_id: attemptId,
          question_id: response.question_id,
          section_name: response.section_name,
          difficulty_served: clampDifficulty(response.difficulty_served),
          answer: response.answer,
          is_correct: null,
        })
      }
      continue
    }

    if (!GRADED_TYPES.has(question.type)) continue

    const isCorrect =
      question.type === 'SHORT_ANSWER'
        ? isShortAnswerCorrect(response?.answer, question)
        : !!response && isChoiceCorrect(response.answer, question)

    totalGraded++
    if (isCorrect) totalCorrect++

    // Difficulty-weighted accumulation, for `weighted_score`.
    //
    // WHY THIS EXISTS: all three score columns were previously assigned the same
    // value (score-attempt.ts:263-267 before this change), so `weighted_score` was
    // not weighted and `raw_accuracy` was indistinguishable from the reported
    // score. On inspection `raw_accuracy` was already correct - unweighted
    // correct/total x 100 is exactly what the implementation plan specifies - so
    // the genuine defect was `weighted_score` alone.
    //
    // Weight is the difficulty actually SERVED (which may differ from the authored
    // difficulty when the adaptive engine substitutes an item), so the weighted
    // score reflects the paper the student sat rather than the paper that was
    // planned. A correct answer on a hard item counts for more than a correct
    // answer on an easy one; the denominator sums the same weights, so the result
    // stays on a 0-100 scale and remains comparable with raw_accuracy.
    const servedDifficulty = clampDifficulty(mapping.base_difficulty)
    weightedTotal += servedDifficulty
    if (isCorrect) weightedCorrect += servedDifficulty

    if (!sectionStats[sectionName]) sectionStats[sectionName] = { correct: 0, total: 0 }
    sectionStats[sectionName].total++
    if (isCorrect) sectionStats[sectionName].correct++

    gradingRows.push({
      attempt_id: attemptId,
      question_id: mapping.question_id,
      section_name: sectionName,
      difficulty_served: clampDifficulty(mapping.base_difficulty),
      answer: response ? response.answer : '',
      is_correct: isCorrect,
    })
  }

  // Persist grading only for questions the student actually answered; unanswered
  // ones are represented by the absence of a response row (and still count as
  // wrong via the denominator above). One upsert instead of N round-trips -
  // `responses` has UNIQUE(attempt_id, question_id).
  const answeredRows = gradingRows.filter((r) => responseByQuestion.has(r.question_id))
  for (let i = 0; i < answeredRows.length; i += 500) {
    const { error: upsertErr } = await admin
      .from('responses')
      .upsert(answeredRows.slice(i, i + 500), { onConflict: 'attempt_id,question_id' })
    if (upsertErr) throw new Error('Failed to persist response grading: ' + upsertErr.message)
  }

  const sectionScores: Record<string, number> = {}
  for (const [sec, stats] of Object.entries(sectionStats)) {
    sectionScores[sec] = stats.total > 0 ? round1((stats.correct / stats.total) * 100) : 0
  }

  const scoreOutOf100 = totalGraded > 0 ? round1((totalCorrect / totalGraded) * 100) : 0

  // Unweighted correct/total x 100. This is what 07-implementation-plan.md:613
  // specifies for `raw_accuracy`, and it is deliberately identical to
  // scoreOutOf100 today because the reported score is not itself weighted. If the
  // reported score ever becomes weighted, this stays the unweighted figure.
  const rawAccuracy = scoreOutOf100

  // Difficulty-weighted accuracy on the same 0-100 scale. Distinct from
  // rawAccuracy whenever item difficulties differ, which is the normal case.
  const weightedScore = weightedTotal > 0 ? round1((weightedCorrect / weightedTotal) * 100) : 0

  // Elapsed wall-clock time is a better proxy than the sum of per-question timers.
  const startedMs = attempt.started_at ? new Date(attempt.started_at).getTime() : NaN
  const submittedMs = attempt.submitted_at ? new Date(attempt.submitted_at).getTime() : Date.now()
  const timeSpentSeconds =
    Number.isFinite(startedMs) && submittedMs > startedMs
      ? Math.round((submittedMs - startedMs) / 1000)
      : answeredSeconds

  // Only hold the attempt open for AI grading if an evaluation is not already done,
  // so re-scoring an attempt never re-queues the same essay forever.
  let status: 'COMPLETE' | 'WRITING_PENDING' = 'COMPLETE'
  if (writingNeedsGrading) {
    const { data: existingEvals } = await admin
      .from('writing_evaluations')
      .select('id')
      .eq('attempt_id', attemptId)
      .limit(1)
    if (!existingEvals || existingEvals.length === 0) status = 'WRITING_PENDING'
  }

  const { error: updateErr } = await admin
    .from('attempts')
    .update({
      status,
      submitted_at: attempt.submitted_at ?? new Date().toISOString(),
      score_out_of100: scoreOutOf100,
      section_scores: sectionScores,
      // Was `raw_accuracy: scoreOutOf100, weighted_score: scoreOutOf100` - three
      // columns holding one number. Now raw_accuracy is the unweighted figure and
      // weighted_score is difficulty-weighted, so the two can disagree and a
      // "weighted vs raw" gap actually means something.
      raw_accuracy: rawAccuracy,
      weighted_score: weightedScore,
      time_spent_seconds: timeSpentSeconds,
    })
    .eq('id', attemptId)

  if (updateErr) throw new Error('Failed to update attempt stats: ' + updateErr.message)

  if (status === 'WRITING_PENDING') {
    // A missing QStash config must never fail the student's submission - the
    // objective score is already persisted and the essay can be graded later.
    try {
      const token = process.env.QSTASH_TOKEN
      const endpoint = process.env.QSTASH_WRITING_EVAL_ENDPOINT
      if (token && endpoint) {
        const qstash = new QStashClient({ token })
        await qstash.publishJSON({ url: endpoint, body: { attemptId } })
      } else {
        console.error('[scoreAttempt] QStash not configured; writing left ungraded', { attemptId })
      }
    } catch (err) {
      console.error('[scoreAttempt] Failed to enqueue writing evaluation', err)
    }
  }

  return {
    rawAccuracy: scoreOutOf100,
    scoreOutOf100,
    sectionScores,
    totalCorrect,
    totalGraded,
    status,
  }
}

