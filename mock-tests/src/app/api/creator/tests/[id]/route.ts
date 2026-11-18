import { NextRequest, NextResponse } from 'next/server'
import {
  ApiError,
  EDITABLE_STATUSES,
  boolOr,
  canManage,
  enumParam,
  intOr,
  parsePayload,
  requireCreator,
  routeId,
  supabaseErrorMessage,
  toErrorResponse,
} from '@/lib/creator/api'
import {
  CONTENT_STATUSES,
  EXAM_TYPE_VALUES,
  STATUS_LABELS,
  isEditable,
  statusLabel,
} from '@/lib/creator/content-meta'

export const dynamic = 'force-dynamic'

type RouteContext = { params: { id: string } | Promise<{ id: string }> }

/** GET /api/creator/tests/:id - one test with its sections and mapped questions. */
export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const id = await routeId(context.params)
    const ctx = await requireCreator()

    const { data: test, error } = await ctx.supabase.from('tests').select('*').eq('id', id).maybeSingle()

    if (error) throw new ApiError(400, supabaseErrorMessage(error, "We couldn't load that test."))
    if (!test) throw new ApiError(404, "We couldn't find that test. It may have been deleted.")
    if (!canManage(ctx, test)) throw new ApiError(403, 'That test belongs to another creator.')

    const [{ data: sections }, { data: mappings }] = await Promise.all([
      ctx.supabase.from('test_sections').select('*').eq('test_id', id).order('section_order'),
      ctx.supabase
        .from('test_questions')
        .select(
          'question_id, section_name, base_difficulty, question_order, questions(id, stem, type, status, subject, topic, year_level, difficulty, correct_answer, explanation, exam_type, answer_a, answer_b, answer_c, answer_d, answer_e)'
        )
        .eq('test_id', id)
        .order('question_order'),
    ])

    return NextResponse.json({
      test,
      sections: sections ?? [],
      questions: (mappings ?? []).map((mapping, index) => ({
        question_id: mapping.question_id,
        section_name: mapping.section_name,
        base_difficulty: mapping.base_difficulty,
        question_order: mapping.question_order ?? index + 1,
        question: Array.isArray(mapping.questions)
          ? mapping.questions[0] ?? null
          : mapping.questions ?? null,
      })),
      editable: isEditable(test.status),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** PUT /api/creator/tests/:id - update a test the creator owns. */
export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    const id = await routeId(context.params)
    const ctx = await requireCreator()
    const body = await parsePayload(req)

    const { data: test, error } = await ctx.supabase
      .from('tests')
      .select('id, title, status, created_by, year_level_min, year_level_max')
      .eq('id', id)
      .maybeSingle()

    if (error) throw new ApiError(400, supabaseErrorMessage(error, "We couldn't load that test."))
    if (!test) throw new ApiError(404, "We couldn't find that test. It may have been deleted.")
    if (!canManage(ctx, test)) throw new ApiError(403, 'That test belongs to another creator.')

    const isAdmin = ctx.role === 'ADMIN'
    if (!isAdmin && !isEditable(test.status)) {
      throw new ApiError(
        409,
        `"${test.title}" is ${statusLabel(test.status).toLowerCase()}. Duplicate it to create an editable copy.`
      )
    }

    const patch: Record<string, unknown> = {}

    if (body.title !== undefined) {
      const title = String(body.title ?? '').trim()
      if (!title) throw new ApiError(400, 'The title cannot be empty.')
      if (title.length > 200) throw new ApiError(400, 'Titles must be 200 characters or fewer.')
      patch.title = title
    }
    if (body.exam_type !== undefined) {
      const examType = enumParam(String(body.exam_type ?? ''), EXAM_TYPE_VALUES)
      if (!examType) throw new ApiError(400, 'Choose a valid exam type.')
      patch.exam_type = examType
    }
    if (body.year_level_min !== undefined || body.year_level_max !== undefined) {
      // Years 2-8 is the band the platform serves (and the range the questions
      // table enforces), so the test header cannot drift outside it.
      const yearMin = intOr(body.year_level_min ?? test.year_level_min, null, 2, 8, 'Year level (min)')
      const yearMax = intOr(body.year_level_max ?? test.year_level_max, null, 2, 8, 'Year level (max)')
      if (yearMin === null || yearMax === null) {
        throw new ApiError(400, 'Both the minimum and maximum year level are required.')
      }
      if (yearMin > yearMax) {
        throw new ApiError(400, 'The minimum year level cannot be higher than the maximum.')
      }
      patch.year_level_min = yearMin
      patch.year_level_max = yearMax
    }
    if (body.time_limit_mins !== undefined) {
      const timeLimit = intOr(body.time_limit_mins, null, 1, 600, 'Time limit')
      // `tests.time_limit_mins` is NOT NULL, so an empty value must be rejected here.
      if (timeLimit === null) throw new ApiError(400, 'Set a time limit in minutes.')
      patch.time_limit_mins = timeLimit
    }
    if (body.is_free !== undefined) patch.is_free = boolOr(body.is_free)

    if (body.status !== undefined) {
      const allowed = isAdmin ? CONTENT_STATUSES : EDITABLE_STATUSES
      const status = enumParam(String(body.status), allowed)
      if (!status) {
        throw new ApiError(
          403,
          isAdmin
            ? 'Choose a valid status.'
            : `Creators can only move a test between ${STATUS_LABELS.DRAFT} and ${STATUS_LABELS.PENDING_APPROVAL}. Publishing is handled by a moderator.`
        )
      }
      patch.status = status
    }

    if (Object.keys(patch).length === 0) {
      throw new ApiError(400, 'Nothing to save yet - no fields were changed.')
    }

    const { data: updated, error: updateError } = await ctx.supabase
      .from('tests')
      .update(patch)
      .eq('id', id)
      .select()
      .single()

    if (updateError) throw new ApiError(400, supabaseErrorMessage(updateError, "We couldn't save the test."))

    return NextResponse.json({ test: updated })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/creator/tests/:id - remove a test the creator owns.
 *
 * Guarded three ways: ownership, status (published/archived content stays), and the
 * database's own ON DELETE RESTRICT from attempts/assignments. Sections and question
 * mappings cascade with the test.
 */
export async function DELETE(_req: NextRequest, context: RouteContext) {
  try {
    const id = await routeId(context.params)
    const ctx = await requireCreator()

    const { data: test, error } = await ctx.supabase
      .from('tests')
      .select('id, title, status, created_by')
      .eq('id', id)
      .maybeSingle()

    if (error) throw new ApiError(400, supabaseErrorMessage(error, "We couldn't load that test."))
    if (!test) throw new ApiError(404, "We couldn't find that test. It may already have been deleted.")
    if (!canManage(ctx, test)) throw new ApiError(403, 'That test belongs to another creator.')

    if (ctx.role !== 'ADMIN' && !isEditable(test.status)) {
      throw new ApiError(
        409,
        `"${test.title}" is ${statusLabel(test.status).toLowerCase()}, so it can't be deleted. Duplicate it if you need an editable copy.`
      )
    }

    // Creators cannot always read these tables under RLS; when the count comes back
    // empty the foreign keys below are the final guard.
    const [{ count: attempts }, { count: assignments }] = await Promise.all([
      ctx.supabase.from('attempts').select('id', { count: 'exact', head: true }).eq('test_id', id),
      ctx.supabase.from('assignments').select('id', { count: 'exact', head: true }).eq('test_id', id),
    ])

    if (attempts) {
      throw new ApiError(
        409,
        `"${test.title}" already has ${attempts} student attempt${attempts === 1 ? '' : 's'}, so it can't be deleted. Archive it instead.`
      )
    }
    if (assignments) {
      throw new ApiError(
        409,
        `"${test.title}" is assigned to ${assignments} student${assignments === 1 ? '' : 's'}, so it can't be deleted. Archive it instead.`
      )
    }

    const { error: deleteError } = await ctx.supabase.from('tests').delete().eq('id', id)

    if (deleteError) {
      if (deleteError.code === '23503') {
        throw new ApiError(
          409,
          `"${test.title}" is still referenced by student activity, so it can't be deleted. Archive it instead.`
        )
      }
      throw new ApiError(400, supabaseErrorMessage(deleteError, "We couldn't delete the test."))
    }

    return NextResponse.json({ success: true, id, title: test.title })
  } catch (err) {
    return toErrorResponse(err)
  }
}


