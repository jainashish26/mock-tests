import { NextRequest, NextResponse } from 'next/server'
import {
  ApiError,
  canManage,
  parsePayload,
  requireCreator,
  routeId,
  supabaseErrorMessage,
  toErrorResponse,
} from '@/lib/creator/api'
import { questionPayload } from '@/lib/creator/question-fields'
import { CONTENT_STATUSES, EDITABLE_STATUSES, isEditable, statusLabel } from '@/lib/creator/content-meta'

export const dynamic = 'force-dynamic'

type RouteContext = { params: { id: string } | Promise<{ id: string }> }

/** GET /api/creator/questions/:id - the full question plus the tests it appears in. */
export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const id = await routeId(context.params)
    const ctx = await requireCreator()

    const { data: question, error } = await ctx.supabase
      .from('questions')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (error) throw new ApiError(400, supabaseErrorMessage(error, "We couldn't load that question."))
    if (!question) throw new ApiError(404, "We couldn't find that question. It may have been deleted.")
    if (!canManage(ctx, question)) throw new ApiError(403, 'That question belongs to another creator.')

    const { data: mappings } = await ctx.supabase
      .from('test_questions')
      .select('test_id, section_name, question_order')
      .eq('question_id', id)

    const testIds = [...new Set((mappings ?? []).map((mapping) => mapping.test_id))]
    const { data: tests } = testIds.length
      ? await ctx.supabase.from('tests').select('id, title, status').in('id', testIds)
      : { data: [] }

    return NextResponse.json({
      question,
      editable: isEditable(question.status),
      tests: tests ?? [],
      mappings: mappings ?? [],
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** PUT /api/creator/questions/:id - update a question the creator owns. */
export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    const id = await routeId(context.params)
    const ctx = await requireCreator()
    const body = await parsePayload(req)

    const { data: question, error } = await ctx.supabase
      .from('questions')
      .select('id, stem, status, created_by')
      .eq('id', id)
      .maybeSingle()

    if (error) throw new ApiError(400, supabaseErrorMessage(error, "We couldn't load that question."))
    if (!question) throw new ApiError(404, "We couldn't find that question. It may have been deleted.")
    if (!canManage(ctx, question)) throw new ApiError(403, 'That question belongs to another creator.')

    const isAdmin = ctx.role === 'ADMIN'
    if (!isAdmin && !isEditable(question.status)) {
      throw new ApiError(
        409,
        `This question is ${statusLabel(question.status).toLowerCase()}. Duplicate it to create an editable copy.`
      )
    }

    const patch = questionPayload(body, {
      partial: true,
      allowedStatuses: isAdmin ? CONTENT_STATUSES : EDITABLE_STATUSES,
    })

    if (Object.keys(patch).length === 0) {
      throw new ApiError(400, 'Nothing to save yet - no fields were changed.')
    }

    const { data: updated, error: updateError } = await ctx.supabase
      .from('questions')
      .update(patch)
      .eq('id', id)
      .select()
      .single()

    if (updateError) {
      throw new ApiError(400, supabaseErrorMessage(updateError, "We couldn't save the question."))
    }

    return NextResponse.json({ question: updated })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/creator/questions/:id - remove a question the creator owns.
 *
 * The question is detached from the caller's own editable tests first. If any mapping
 * points at published/archived content, or at a test the caller cannot see, the delete
 * is refused rather than silently orphaning a live test.
 */
export async function DELETE(_req: NextRequest, context: RouteContext) {
  try {
    const id = await routeId(context.params)
    const ctx = await requireCreator()

    const { data: question, error } = await ctx.supabase
      .from('questions')
      .select('id, stem, status, created_by')
      .eq('id', id)
      .maybeSingle()

    if (error) throw new ApiError(400, supabaseErrorMessage(error, "We couldn't load that question."))
    if (!question) {
      throw new ApiError(404, "We couldn't find that question. It may already have been deleted.")
    }
    if (!canManage(ctx, question)) throw new ApiError(403, 'That question belongs to another creator.')

    if (ctx.role !== 'ADMIN' && !isEditable(question.status)) {
      throw new ApiError(
        409,
        `This question is ${statusLabel(question.status).toLowerCase()}, so it can't be deleted. Duplicate it if you need an editable copy.`
      )
    }

    const { data: mappings } = await ctx.supabase
      .from('test_questions')
      .select('test_id')
      .eq('question_id', id)

    const testIds = [...new Set((mappings ?? []).map((mapping) => mapping.test_id))]
    const detachable: string[] = []

    if (testIds.length > 0) {
      const { data: tests } = await ctx.supabase
        .from('tests')
        .select('id, status, created_by')
        .in('id', testIds)

      for (const test of tests ?? []) {
        if (canManage(ctx, test) && isEditable(test.status)) detachable.push(test.id)
      }

      if (detachable.length !== testIds.length) {
        const blocked = testIds.length - detachable.length
        throw new ApiError(
          409,
          `This question is used by ${blocked} test${blocked === 1 ? '' : 's'} that is published, archived or owned by someone else. Remove it from ${blocked === 1 ? 'that test' : 'those tests'} first, or duplicate it instead.`
        )
      }

      const { error: unmapError } = await ctx.supabase
        .from('test_questions')
        .delete()
        .eq('question_id', id)
        .in('test_id', detachable)

      if (unmapError) {
        throw new ApiError(400, supabaseErrorMessage(unmapError, "We couldn't detach the question from its tests."))
      }
    }

    const { error: deleteError } = await ctx.supabase.from('questions').delete().eq('id', id)

    if (deleteError) {
      if (deleteError.code === '23503') {
        throw new ApiError(
          409,
          "This question is still referenced by a live test or student responses, so it can't be deleted."
        )
      }
      throw new ApiError(400, supabaseErrorMessage(deleteError, "We couldn't delete the question."))
    }

    return NextResponse.json({ success: true, id, detached_from: detachable.length })
  } catch (err) {
    return toErrorResponse(err)
  }
}

