import { createAdminClient } from '@/lib/supabase/admin'
import { scoreAttempt } from '@/lib/scoring/score-attempt'
import { WRITING_RUBRIC_VERSION, writingSystemPrompt } from './prompt'
import { countWords } from './word-limits'

/**
 * The writing-marking core, shared by BOTH entry points:
 *   - /api/jobs/writing-eval  (QStash, the fast path when Upstash is configured)
 *   - /api/cron/writing-backlog (sweeper for anything QStash never picked up,
 *     e.g. environments without Upstash credentials - an essay must never be
 *     stranded in WRITING_PENDING just because a queue is unconfigured)
 *
 * Keeping the grading logic in one module means the two paths cannot drift:
 * one rubric, one JSON contract, one storage shape, one status transition.
 *
 * SAFETY PROPERTIES (each one a past defect class in this codebase)
 *   - Idempotent: an attempt with an existing evaluation is never re-graded
 *     (QStash retries, cron overlaps, and re-grading double-charges the API).
 *   - `score_out_of100` is NOT NULL in the schema, so a malformed model reply
 *     is clamped, never thrown away mid-attempt.
 *   - Failures throw (the caller decides retry semantics): QStash retries on
 *     non-2xx; the cron sweeper leaves the attempt WRITING_PENDING for the
 *     next pass rather than marking a child's essay COMPLETE-ungraded.
 *   - The model, rubric version and token usage are stamped into
 *     raw_response, so every mark is traceable to what produced it (the
 *     AL-15 marking-ops audit reads this).
 */

type Admin = ReturnType<typeof createAdminClient>
type Row = Record<string, any>

export interface GradeWritingResult {
  status: 'graded' | 'already_graded' | 'no_writing' | 'not_configured'
  graded: number
  writingAverage: number | null
  model: string | null
}

export function isWritingMarkingConfigured(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY?.trim())
}

function deepseekConfig() {
  const base = (process.env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com').replace(/\/+$/, '')
  const timeoutSeconds = Number(process.env.DEEPSEEK_TIMEOUT_SECONDS)
  return {
    url: `${base}/chat/completions`,
    // deepseek-flash is the default for writing marking (fast + sufficient for
    // rubric grading); DEEPSEEK_MODEL pins another id if an operator needs to
    // move models without a deploy.
    model: process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-flash',
    timeoutMs: (Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? timeoutSeconds : 90) * 1000,
  }
}

/** `answer` is jsonb - it may arrive parsed or as a JSON-encoded string. */
function toText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function clampScore(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, Math.round(n * 10) / 10))
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((v) => toText(v)).filter(Boolean)
}

/** The model is asked for JSON but may wrap it in prose or code fences. */
export function parseModelJson(content: unknown): Record<string, any> | null {
  const raw = toText(content).trim()
  if (!raw) return null

  try {
    return JSON.parse(raw)
  } catch {
    // fall through to extraction
  }

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const braceStart = raw.indexOf('{')
  const braceEnd = raw.lastIndexOf('}')
  const candidates = [
    fenced?.[1],
    braceStart >= 0 && braceEnd > braceStart ? raw.slice(braceStart, braceEnd + 1) : '',
  ]

  for (const candidate of candidates) {
    if (!candidate || !candidate.trim()) continue
    try {
      const parsed = JSON.parse(candidate.trim())
      if (parsed && typeof parsed === 'object') return parsed
    } catch {
      // try the next candidate
    }
  }

  return null
}

/**
 * The `improvements` column stores plain strings (the UI renders a list), but
 * the rubric contract produces rich objects with an estimated score gain and a
 * grammar rewrite. Flatten for the column WITHOUT losing anything: the full
 * objects live in raw_response, which is the audit-grade record.
 */
function improvementsToLines(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object') {
        const o = item as Row
        const gain = Number(o.estimated_score_gain)
        const base = toText(o.suggestion)
        const rewrite = toText(o.rewrite)
        const parts = [base]
        if (Number.isFinite(gain) && gain > 0) parts.push(`(+${Math.round(gain)} points)`)
        if (rewrite) parts.push(`Rewrite: ${rewrite}`)
        return parts.filter(Boolean).join(' ')
      }
      return toText(item)
    })
    .filter(Boolean)
}

/** One DeepSeek chat-completion call for one essay. Throws on any failure. */
export async function callDeepseekForText(
  cfg: ReturnType<typeof deepseekConfig>,
  yearLevel: number | null,
  promptRef: string,
  studentText: string
): Promise<{ parsed: Record<string, any>; raw: Row; durationMs: number }> {
  const started = Date.now()
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: writingSystemPrompt(yearLevel) },
        { role: 'user', content: `Writing prompt: ${promptRef || '(open task)'}\n\nStudent text:\n${studentText}` },
      ],
    }),
    signal: AbortSignal.timeout(cfg.timeoutMs),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`DeepSeek API error ${res.status}: ${errText.slice(0, 300)}`)
  }

  const raw = (await res.json()) as Row
  const parsed = parseModelJson(raw?.choices?.[0]?.message?.content)
  if (!parsed) throw new Error('DeepSeek returned an unparseable response')
  return { parsed, raw, durationMs: Date.now() - started }
}

/**
 * Notify the linked PARENT(S) that feedback is ready.
 *
 * Deliberately NOT the student: a writing mark is a result, and migration 015
 * removed student SELECT on results tables (B2/B4). A notification telling a
 * child "your mark is ready" would advertise a number they are not permitted
 * to see - the notification follows the same boundary as the data.
 *
 * Message carries NO score: notifications surface in list views where a
 * number would be read out of context (the same reasoning as the funnel-props
 * boundary).
 */
async function notifyParents(admin: Admin, studentId: string, attemptId: string): Promise<void> {
  try {
    const { data: links } = await admin
      .from('parent_student_links')
      .select('parent_user_id')
      .eq('student_id', studentId)

    const parents = ((links ?? []) as Row[]).map((l) => String(l.parent_user_id)).filter(Boolean)
    if (parents.length === 0) return

    await admin.from('notifications').insert(
      parents.map((userId) => ({
        user_id: userId,
        type: 'WRITING_GRADED',
        title: 'Writing feedback is ready',
        message: 'The AI marking for a writing task has finished. Open the report to read the feedback.',
        link_url: `/parent/report/${attemptId}`,
        is_read: false,
      }))
    )
  } catch (err) {
    // A lost notification costs convenience, never correctness - the report
    // page is the source of truth. Logged, not thrown.
    console.error('[grade-writing] notification insert failed', err)
  }
}

/**
 * Grade every WRITING response on one attempt, store the evaluations, merge
 * the Writing section average, flip WRITING_PENDING -> COMPLETE and re-score.
 *
 * @param onNotConfigured 'complete' releases the attempt (QStash path: the
 *   student must not sit in limbo because an env var is missing; the essay can
 *   be re-queued later). 'leave-pending' keeps it for the next sweeper pass
 *   (cron path: silently completing would strand the essay ungraded forever).
 */
export async function gradeWritingForAttempt(
  attemptId: string,
  opts: { admin?: Admin; onNotConfigured: 'complete' | 'leave-pending' }
): Promise<GradeWritingResult> {
  const admin = opts.admin ?? createAdminClient()

  const { data: responses, error: respErr } = await admin
    .from('responses')
    .select('id, question_id, answer, questions(id, type, stem, explanation)')
    .eq('attempt_id', attemptId)
  if (respErr) throw new Error('Could not fetch responses: ' + respErr.message)

  const writingResponses = (responses ?? []).filter((r) => {
    const q = r.questions as Row | null
    return q && q.type === 'WRITING' && toText(r.answer).trim().length > 0
  })

  if (writingResponses.length === 0) {
    // Nothing to grade - release the attempt so the student sees a final score.
    await admin.from('attempts').update({ status: 'COMPLETE' }).eq('id', attemptId)
    await scoreAttempt(attemptId)
    return { status: 'no_writing', graded: 0, writingAverage: null, model: null }
  }

  // Idempotent: QStash retries on non-2xx, cron passes can overlap, and
  // re-grading would double-charge the API. attempt_id is UNIQUE in
  // writing_evaluations; checking first keeps the outcome explicit.
  const { data: existingEvals } = await admin
    .from('writing_evaluations')
    .select('id')
    .eq('attempt_id', attemptId)
    .limit(1)
  if (existingEvals && existingEvals.length > 0) {
    await admin.from('attempts').update({ status: 'COMPLETE' }).eq('id', attemptId)
    return { status: 'already_graded', graded: 0, writingAverage: null, model: null }
  }

  if (!isWritingMarkingConfigured()) {
    console.error('[grade-writing] DEEPSEEK_API_KEY not configured', { attemptId })
    if (opts.onNotConfigured === 'complete') {
      await admin.from('attempts').update({ status: 'COMPLETE' }).eq('id', attemptId)
    }
    return { status: 'not_configured', graded: 0, writingAverage: null, model: null }
  }

  // Year level calibrates rubric strictness (prompt.ts adaptation 1).
  const { data: attemptRow } = await admin
    .from('attempts')
    .select('student_id, section_scores, student_profiles(year_level)')
    .eq('id', attemptId)
    .single()
  const studentId = String((attemptRow as Row | null)?.student_id ?? '')
  const profile = (attemptRow as Row | null)?.student_profiles as Row | null
  const yearLevel = profile ? Number(profile.year_level) || null : null

  const cfg = deepseekConfig()
  const savedScores: number[] = []

  // Grade every essay, not just the first - multi-essay attempts previously
  // lost all but one response. (PM rule is max 1 writing question per test;
  // this loop makes violating that rule degrade gracefully instead of silently.)
  for (const writingResp of writingResponses) {
    const q = writingResp.questions as Row
    const studentText = toText(writingResp.answer)
    const promptRef = toText(q.stem)

    const { parsed, raw, durationMs } = await callDeepseekForText(cfg, yearLevel, promptRef, studentText)
    const score = clampScore(parsed.score_out_of100)
    savedScores.push(score)

    const { error: evalErr } = await admin.from('writing_evaluations').insert({
      attempt_id: attemptId,
      provider: 'DeepSeek',
      score_out_of100: score,
      strengths: asStringArray(parsed.strengths),
      improvements: improvementsToLines(parsed.improvements),
      improvements_detail: parsed.improvements ?? null,
      improved_text: toText(parsed.improved_text) || null,
      // First-class detail columns (096/100) so reports query marks directly
      // rather than re-parsing raw_response.
      text_type: toText(parsed.text_type) || null,
      category_scores: parsed.category_scores ?? null,
      techniques_used: parsed.techniques_used ?? null,
      practice_exercise: toText(parsed.practice_exercise) || null,
      rubric_version: WRITING_RUBRIC_VERSION,
      model: toText(raw?.model) || cfg.model,
      word_count: countWords(studentText),
      graded_at: new Date().toISOString(),
      duration_ms: durationMs,
      // Traceability: which model, which rubric, what it cost, and the full
      // criterion-level detail the columns cannot hold. The AL-15 marking-ops
      // alert and any future mark audit read from here.
      raw_response: {
        model: toText(raw?.model) || cfg.model,
        rubric_version: WRITING_RUBRIC_VERSION,
        usage: raw?.usage ?? null,
        category_scores: parsed.category_scores ?? null,
        text_type: parsed.text_type ?? null,
        techniques_used: parsed.techniques_used ?? null,
        practice_exercise: parsed.practice_exercise ?? null,
        response: raw,
      },
    })
    if (evalErr) throw evalErr
  }

  // Surface the essay in the section breakdown without distorting the
  // objective multiple-choice percentage.
  const writingAverage =
    savedScores.length > 0
      ? Math.round((savedScores.reduce((a, b) => a + b, 0) / savedScores.length) * 10) / 10
      : 0

  // ORDERING MATTERS - this was a live-proven defect in the original QStash
  // handler. scoreAttempt RECOMPUTES section_scores from the objective
  // responses and overwrites the column; merging Writing BEFORE calling it
  // means the essay average is silently erased on every single grading.
  // So: score first (the evaluation row already exists, so scoreAttempt will
  // leave the attempt COMPLETE and will not re-queue), then merge Writing
  // into the freshly recomputed breakdown.
  await scoreAttempt(attemptId)

  const { data: fresh } = await admin
    .from('attempts')
    .select('section_scores')
    .eq('id', attemptId)
    .single()
  const mergedSections = {
    ...(((fresh as Row | null)?.section_scores as Record<string, number>) ?? {}),
    Writing: writingAverage,
  }
  await admin
    .from('attempts')
    .update({ status: 'COMPLETE', section_scores: mergedSections })
    .eq('id', attemptId)

  if (studentId) await notifyParents(admin, studentId, attemptId)

  return { status: 'graded', graded: savedScores.length, writingAverage, model: cfg.model }
}

/**
 * Grade one AI Practice Lab session in place. Mirrors gradeWritingForAttempt's
 * safety properties (idempotent, clamped score, traceable) but stores the
 * result on writing_practice_sessions.evaluation - practice has no attempts row
 * (writing_evaluations.attempt_id is NOT NULL UNIQUE).
 *
 * onNotConfigured 'complete' releases nothing here (there is no attempt to
 * release); both callers rely on the sweeper leaving it PENDING.
 */
export async function gradePracticeSession(
  sessionId: string,
  opts: { admin?: Admin; onNotConfigured?: 'leave-pending' } = {}
): Promise<GradeWritingResult> {
  const admin = opts.admin ?? createAdminClient()

  const { data: session, error: fetchErr } = await admin
    .from('writing_practice_sessions')
    .select('id, status, prompt_text, student_text, year_level')
    .eq('id', sessionId)
    .single()
  if (fetchErr || !session) throw new Error('Could not fetch writing practice session: ' + (fetchErr?.message ?? 'not found'))

  // Idempotent: a QStash retry after a successful grade must not re-charge the
  // DeepSeek API. The job and sweeper both call this; whichever runs second
  // finds GRADED and stops.
  if ((session as Row).status === 'GRADED') {
    return { status: 'already_graded', graded: 0, writingAverage: null, model: null }
  }

  if (!isWritingMarkingConfigured()) {
    console.error('[grade-writing] DEEPSEEK_API_KEY not configured; practice session left pending', { sessionId })
    return { status: 'not_configured', graded: 0, writingAverage: null, model: null }
  }

  const yearLevel = Number((session as Row).year_level) || null
  const studentText = toText((session as Row).student_text)
  const promptRef = toText((session as Row).prompt_text)

  if (!studentText.trim()) {
    await admin.from('writing_practice_sessions').update({ status: 'FAILED' }).eq('id', sessionId)
    return { status: 'no_writing', graded: 0, writingAverage: null, model: null }
  }

  const cfg = deepseekConfig()
  const { parsed, raw, durationMs } = await callDeepseekForText(cfg, yearLevel, promptRef, studentText)
  const score = clampScore(parsed.score_out_of100)

  const evaluation = {
    score_out_of100: score,
    text_type: parsed.text_type ?? null,
    category_scores: parsed.category_scores ?? null,
    techniques_used: parsed.techniques_used ?? null,
    strengths: asStringArray(parsed.strengths),
    // Flat lines for any legacy consumer + rich objects for the parent detail
    // view (gains + rewrites survive without re-parsing a raw API payload).
    improvements: improvementsToLines(parsed.improvements),
    improvements_detail: Array.isArray(parsed.improvements) ? parsed.improvements : null,
    improved_text: toText(parsed.improved_text) || null,
    practice_exercise: toText(parsed.practice_exercise) || null,
  }

  const { error: updateErr } = await admin
    .from('writing_practice_sessions')
    .update({
      status: 'GRADED',
      score_out_of100: score,
      evaluation,
      rubric_version: WRITING_RUBRIC_VERSION,
      model: toText(raw?.model) || cfg.model,
      graded_at: new Date().toISOString(),
      duration_ms: durationMs,
    })
    .eq('id', sessionId)
  if (updateErr) throw updateErr

  return { status: 'graded', graded: 1, writingAverage: score, model: cfg.model }
}