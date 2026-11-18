import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'
import { trackEvent } from '@/lib/funnel/track'

type SaveItem = {
  questionId: string
  sectionName?: string | null
  answer: unknown
  timeSpentSeconds?: number | null
}

function clampDifficulty(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 1
  return Math.min(4, Math.max(1, Math.round(n)))
}

/**
 * Persists one answer, or a batch when `answers` is supplied.
 *
 * `responses.answer` is jsonb NOT NULL and `difficulty_served` is NOT NULL with
 * CHECK (1..4), so both are normalised here rather than trusting the client -
 * the previous hardcoded `difficulty_served: 1` made the whole adaptive
 * difficulty column meaningless.
 */
export async function POST(req: Request) {
  try {
    const { user } = await requireRole(['STUDENT'])

    let body: any
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const attemptId: string | undefined = body?.attemptId
    if (!attemptId) {
      return NextResponse.json({ error: 'Missing attemptId' }, { status: 400 })
    }

    const items: SaveItem[] = Array.isArray(body?.answers)
      ? body.answers
      : body?.questionId
        ? [
            {
              questionId: body.questionId,
              sectionName: body.sectionName,
              answer: body.answer,
              timeSpentSeconds: body.timeSpentSeconds,
            },
          ]
        : []

    if (items.length === 0) {
      return NextResponse.json({ error: 'No answers supplied' }, { status: 400 })
    }

    const invalid = items.find((i) => !i.questionId)
    if (invalid) {
      return NextResponse.json({ error: 'Each answer needs a questionId' }, { status: 400 })
    }

    const supabase = await createClient()

    const { data: profile } = await supabase
      .from('student_profiles')
      .select('id')
      .eq('auth_user_id', user.id)
      .single()

    if (!profile) return NextResponse.json({ error: 'Student profile not found' }, { status: 404 })

    // Fail fast instead of letting RLS silently drop the write, which previously
    // looked like a successful save to the student while nothing was stored.
    // Was `.from('attempts').select('id, student_id, test_id, status')`.
    // Migration 015 removed the student SELECT policy on attempts, so that query
    // now returns null for a student and the save fails with "Attempt not found".
    // Same regression 023 fixed in submit/route.ts. Reading through the
    // SECURITY DEFINER function instead.
    const { data: attemptRow } = await supabase.rpc('my_attempt_context', {
      p_attempt_id: attemptId,
    })
    const attempt = Array.isArray(attemptRow) ? attemptRow[0] : attemptRow

    if (!attempt || attempt.student_id !== profile.id) {
      return NextResponse.json({ error: 'Attempt not found' }, { status: 404 })
    }

    if (attempt.status !== 'IN_PROGRESS') {
      return NextResponse.json(
        { error: 'This attempt has already been submitted and can no longer be edited' },
        { status: 409 }
      )
    }

    const questionIds = items.map((i) => i.questionId)

    // Real per-question difficulty from the test mapping, and proof that the
    // question actually belongs to this test.
    const { data: mappings, error: mapErr } = await supabase
      .from('test_questions')
      .select('question_id, section_name, base_difficulty')
      .eq('test_id', attempt.test_id)
      .in('question_id', questionIds)

    if (mapErr) return NextResponse.json({ error: mapErr.message }, { status: 500 })

    const mappingByQuestion = new Map((mappings ?? []).map((m) => [m.question_id, m]))

    const foreign = questionIds.filter((id) => !mappingByQuestion.has(id))
    if (foreign.length > 0) {
      return NextResponse.json(
        { error: 'One or more questions do not belong to this test' },
        { status: 400 }
      )
    }

    const rows = items.map((item) => {
      const mapping = mappingByQuestion.get(item.questionId)!
      return {
        attempt_id: attemptId,
        question_id: item.questionId,
        section_name: item.sectionName || mapping.section_name || 'General',
        difficulty_served: clampDifficulty(mapping.base_difficulty),
        // jsonb NOT NULL: keep strings as-is, fall back to '' rather than null.
        answer: item.answer === undefined || item.answer === null ? '' : item.answer,
        time_spent_seconds:
          item.timeSpentSeconds != null && Number.isFinite(Number(item.timeSpentSeconds))
            ? Math.max(0, Math.round(Number(item.timeSpentSeconds)))
            : null,
      }
    })

    const { error } = await supabase
      .from('responses')
      .upsert(rows, { onConflict: 'attempt_id,question_id' })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // ITEM_ANSWERED, batched: one event per row, fired server-side after the
    // upsert commits. Inherits the existing 500-row batch cadence, which is the
    // owner's chosen volume/currency tradeoff (15-conversion-and-ux-resolution.md
    // §1.1 "Wire it, batched").
    //
    // No `isCorrect` prop: putting correctness into an analytics event from a
    // student's own session would leak a result into the events table, which is
    // exactly the boundary migration 015 exists to hold. Correctness stays on
    // responses; the ETL joins it into fact_item_response server-side.
    //
    // No score, no section ranking, no mastery - only the fields a student could
    // legitimately know about their own answers: which question, how long they
    // spent, whether they skipped.
    await Promise.all(
      rows.map((r) =>
        trackEvent({
          event: 'ITEM_ANSWERED',
          userId: user.id,
          studentId: profile.id,
          props: {
            attemptId,
            testId: attempt.test_id,
            itemId: r.question_id,
            timeSpentSeconds: r.time_spent_seconds,
            skipped: r.answer === '' || r.answer == null,
          },
        })
      )
    )

    return NextResponse.json({ success: true, saved: rows.length })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unexpected error' }, { status: 403 })
  }
}

