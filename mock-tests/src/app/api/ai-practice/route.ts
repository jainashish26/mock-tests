import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'
import { Client as QStashClient } from '@upstash/qstash'
import { writingPromptById, writingPromptsForBand } from '@/lib/writing/prompts-catalog'
import { bandForYear, countWords } from '@/lib/writing/word-limits'

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

  const band = bandForYear(profile?.year_level ? Number(profile.year_level) : 5)
  const prompts = writingPromptsForBand(band).map((p) => ({
    id: p.id,
    text_type: p.text_type,
    prompt: p.prompt,
    min_words: p.min_words[band],
    suggested_mins: p.suggested_mins[band],
  }))

  return NextResponse.json({ band, prompts })
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

    const meta = writingPromptById(promptId)
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
        text_type: meta.text_type,
        prompt_text: meta.prompt,
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