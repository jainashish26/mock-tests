import { NextRequest, NextResponse } from 'next/server'
import {
  ApiError,
  canManage,
  requireCreator,
  routeId,
  supabaseErrorMessage,
  toErrorResponse,
} from '@/lib/creator/api'

export const dynamic = 'force-dynamic'

type RouteContext = { params: { id: string } | Promise<{ id: string }> }

/** Columns that must never be carried over to a copy. */
const NOT_COPIED = [
  'id',
  'created_at',
  'updated_at',
  'created_by',
  'status',
  'total_attempts',
  'correct_attempts',
  'success_rate',
  'avg_time_taken_seconds',
  'most_common_wrong_answer',
  'skip_rate',
  'flag_count',
]

/**
 * POST /api/creator/questions/:id/duplicate
 *
 * Clones a question as a fresh DRAFT owned by the caller, resetting the attempt
 * statistics. Useful both for building variants and for editing content that has
 * already been published (which RLS keeps locked).
 */
export async function POST(_req: NextRequest, context: RouteContext) {
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

    const copy: Record<string, unknown> = { ...question }
    for (const column of NOT_COPIED) delete copy[column]
    copy.stem = `${String(question.stem ?? 'Question').slice(0, 1900)} (copy)`
    copy.status = 'DRAFT'
    copy.created_by = ctx.user.id
    copy.tags = question.tags ?? []

    const { data: created, error: createError } = await ctx.supabase
      .from('questions')
      .insert(copy)
      .select()
      .single()

    if (createError) {
      throw new ApiError(400, supabaseErrorMessage(createError, "We couldn't duplicate the question."))
    }

    return NextResponse.json({ id: created.id, question: created }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
