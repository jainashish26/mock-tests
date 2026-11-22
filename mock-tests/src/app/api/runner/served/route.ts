import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'

/**
 * Records which items were DISPLAYED to a student, so "skipped" can be told
 * apart from "never served".
 *
 * WHY A SEPARATE ENDPOINT RATHER THAN PART OF /save
 *   `/api/runner/save` writes answers, and it is deliberately batched behind an
 *   800 ms debounce plus an offline queue: a save that fails keeps the answer and
 *   retries. Served items have the opposite shape - they are observed the instant
 *   a question appears, they must never be debounced (a child who looks at a
 *   question for one second has still seen it), and losing one is a small,
 *   self-healing loss because the next navigation re-reports the pending delta.
 *   Folding the two would tie a correctness-critical write to a
 *   convenience-critical cadence in both directions.
 *
 * IDEMPOTENT BY CONSTRUCTION
 *   The table's primary key is (attempt_id, question_id) and this inserts with
 *   ON CONFLICT DO NOTHING, so a retried beacon, a resumed attempt re-reporting
 *   its history, or two tabs racing all converge on one row. Nothing here needs
 *   to know whether it has been called before, which is what makes it safe to
 *   fire without awaiting.
 *
 * AUTHORISATION IS CHECKED TWICE, ON PURPOSE
 *   `my_attempt_context()` resolves the attempt under the caller's own identity
 *   (student SELECT on `attempts` was removed by migration 015, so reading the
 *   table directly would return nothing), and the RLS policy on
 *   `attempt_items_served` re-checks `is_attempt_owner(attempt_id)` on write. A
 *   route that forgot the first check would still not be able to record served
 *   items against another family's attempt.
 */

const MAX_ITEMS_PER_CALL = 200
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type ServedBody = { attemptId?: unknown; questionIds?: unknown }

export async function POST(req: Request) {
  try {
    const { user } = await requireRole(['STUDENT'])

    let body: ServedBody
    try {
      body = (await req.json()) as ServedBody
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const attemptId = typeof body?.attemptId === 'string' ? body.attemptId : undefined
    if (!attemptId || !UUID_RE.test(attemptId)) {
      return NextResponse.json({ error: 'Missing or invalid attemptId' }, { status: 400 })
    }

    const raw: unknown = body?.questionIds
    if (!Array.isArray(raw) || raw.length === 0) {
      return NextResponse.json({ error: 'No questionIds supplied' }, { status: 400 })
    }

    // A cap rather than a truncation: silently dropping ids would under-report
    // exposure, which is the exact defect this table exists to remove.
    if (raw.length > MAX_ITEMS_PER_CALL) {
      return NextResponse.json(
        { error: `At most ${MAX_ITEMS_PER_CALL} items per call` },
        { status: 400 }
      )
    }

    const questionIds = [...new Set(raw.map((v) => String(v)).filter((v) => UUID_RE.test(v)))]
    if (questionIds.length === 0) {
      return NextResponse.json({ error: 'No valid questionIds supplied' }, { status: 400 })
    }

    const supabase = await createClient()

    const { data: profile } = await supabase
      .from('student_profiles')
      .select('id')
      .eq('auth_user_id', user.id)
      .single()

    if (!profile) return NextResponse.json({ error: 'Student profile not found' }, { status: 404 })

    const { data: attemptRow } = await supabase.rpc('my_attempt_context', {
      p_attempt_id: attemptId,
    })
    const attempt = Array.isArray(attemptRow) ? attemptRow[0] : attemptRow

    if (!attempt || attempt.student_id !== profile.id) {
      return NextResponse.json({ error: 'Attempt not found' }, { status: 404 })
    }

    if (attempt.status !== 'IN_PROGRESS') {
      // Not an error the student should ever see mid-test: it means the attempt
      // was submitted (auto-submit on timeout) while a beacon was in flight.
      // Reporting success keeps the runner quiet; recording nothing is correct
      // because the served set for a finished attempt is already closed.
      return NextResponse.json({ success: true, recorded: 0, closed: true })
    }

    // Proof the items belong to THIS test. Without it, a client could burn rows
    // naming arbitrary questions and pollute per-item exposure for tests the
    // child never sat.
    const { data: mappings, error: mapErr } = await supabase
      .from('test_questions')
      .select('question_id')
      .eq('test_id', attempt.test_id)
      .in('question_id', questionIds)

    if (mapErr) return NextResponse.json({ error: mapErr.message }, { status: 500 })

    const allowed = new Set((mappings ?? []).map((m) => m.question_id))
    const rows = questionIds
      .filter((id) => allowed.has(id))
      .map((id) => ({ attempt_id: attemptId, question_id: id }))

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'None of those items belong to this test' },
        { status: 400 }
      )
    }

    const { error } = await supabase
      .from('attempt_items_served')
      .upsert(rows, { onConflict: 'attempt_id,question_id', ignoreDuplicates: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true, recorded: rows.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 403 })
  }
}
