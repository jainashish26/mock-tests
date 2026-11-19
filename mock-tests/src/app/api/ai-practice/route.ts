import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'
import { Client as QStashClient } from '@upstash/qstash'
import { writingPromptById, promptsFor, calibrationFor, markingCriteria, normalizeYear } from '@/lib/writing/prompts-catalog'
import { countWords } from '@/lib/writing/word-limits'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * AI Practice Lab API.
 *
 * GET  - prompts for the student's year band (static catalog, filtered).
 * POST - accept a practice writing, store it as PENDING, enqueue QStash.
 *
 * ACCESS RULE (migration 015): the student creates their own practice row but
 * never SELECTs the result. The POST inserts with the student's own client so
 * RLS `is_student_self(student_id)` gates it, and the response deliberately
 * carries no score - the parent/tutor sees the graded result.
 */

export async function GET() {
  const { user } = await requireRole(['STUDENT'])
  const supabase = await createClient()

  const { data: profile } = await supabase
    .from('student_profiles')
    .select('year_level')
    .eq('auth_user_id', user.id)
    .single()

  const year = normalizeYear(profile?.year_level)
  const calibration = calibrationFor(year)

  // Prompts are managed in the database by the Quiz Master / admin (migration
  // 102). Serve the published prompts for this year; fall back to the in-code
  // catalog only if the bank has not been seeded for the year yet.
  const admin = createAdminClient()
  const { data: rows } = await admin
    .from('writing_prompts')
    .select('id, year_level, territory, type, text')
    .eq('status', 'PUBLISHED')
    .eq('year_level', year)
    .order('type', { ascending: true })
    .order('territory', { ascending: true })

  let prompts = (rows ?? []).map((r) => ({
    id: r.id,
    year: r.year_level,
    territory: r.territory,
    type: r.type,
    text: r.text,
  }))
  if (prompts.length === 0) {
    prompts = promptsFor(year).map((p) => ({
      id: p.id,
      year: p.year,
      territory: p.territory,
      type: p.type,
      text: p.text,
    }))
  }

  return NextResponse.json({
    year,
    calibration,
    prompts,
    criteria: {
      narrative: markingCriteria(year, 'narrative'),
      persuasive: markingCriteria(year, 'persuasive'),
    },
  })
}

export async function POST(req: Request) {
  try {
    const { user } = await requireRole(['STUDENT'])
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

    const promptId = String(body?.promptId ?? '')
    const text = String(body?.text ?? '').trim()
    if (!promptId || !text) {
      return NextResponse.json({ error: 'promptId and text are required' }, { status: 400 })
    }

    // Resolve the prompt from the managed bank (DB), falling back to the in-code
    // catalog for ids issued before the bank was seeded.
    const admin = createAdminClient()
    const { data: dbPrompt } = await admin
      .from('writing_prompts')
      .select('type, text')
      .eq('id', promptId)
      .maybeSingle()
    const catalogPrompt = dbPrompt ? null : writingPromptById(promptId)
    const meta = dbPrompt ?? (catalogPrompt ? { type: catalogPrompt.type, text: catalogPrompt.text } : null)
    if (!meta) {
      return NextResponse.json({ error: 'Unknown prompt' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: profile } = await supabase
      .from('student_profiles')
      .select('id, year_level')
      .eq('auth_user_id', user.id)
      .single()
    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const { data: session, error } = await supabase
      .from('writing_practice_sessions')
      .insert({
        student_id: profile.id,
        prompt_id: promptId,
        text_type: meta.type,
        prompt_text: meta.text,
        student_text: text,
        word_count: countWords(text),
        year_level: Number(profile.year_level),
        status: 'PENDING',
      })
      .select('id')
      .single()

    if (error || !session) {
      return NextResponse.json({ error: error?.message ?? 'Failed to save practice' }, { status: 500 })
    }

    // Fast path when QStash is configured; the cron sweeper is the safety net.
    try {
      const token = process.env.QSTASH_TOKEN
      const endpoint = process.env.QSTASH_WRITING_PRACTICE_ENDPOINT
      if (token && endpoint) {
        await new QStashClient({ token }).publishJSON({ url: endpoint, body: { sessionId: session.id } })
      }
    } catch (err) {
      console.error('[ai-practice] failed to enqueue', err)
    }

    return NextResponse.json({ success: true, sessionId: session.id })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}