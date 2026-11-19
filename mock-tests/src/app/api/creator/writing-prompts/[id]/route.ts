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
import { writingPromptPayload } from '@/lib/creator/writing-prompt-fields'

export const dynamic = 'force-dynamic'

type RouteContext = { params: { id: string } | Promise<{ id: string }> }

/** PUT /api/creator/writing-prompts/:id - update a prompt the caller may manage. */
export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    const id = await routeId(context.params)
    const ctx = await requireCreator()
    const body = await parsePayload(req)

    const { data: prompt, error } = await ctx.supabase
      .from('writing_prompts')
      .select('id, created_by')
      .eq('id', id)
      .maybeSingle()

    if (error) throw new ApiError(400, supabaseErrorMessage(error, "We couldn't load that prompt."))
    if (!prompt) throw new ApiError(404, "We couldn't find that prompt. It may have been deleted.")
    if (!canManage(ctx, prompt)) throw new ApiError(403, 'That prompt belongs to another creator.')

    const patch = writingPromptPayload(body, { partial: true })
    if (Object.keys(patch).length === 0) {
      throw new ApiError(400, 'Nothing to save yet - no fields were changed.')
    }
    patch.updated_at = new Date().toISOString()

    const { data: updated, error: updateError } = await ctx.supabase
      .from('writing_prompts')
      .update(patch)
      .eq('id', id)
      .select()
      .single()

    if (updateError) throw new ApiError(400, supabaseErrorMessage(updateError, "We couldn't save the prompt."))

    return NextResponse.json({ prompt: updated })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/creator/writing-prompts/:id - remove a prompt the caller may manage.
 * Practice sessions keep a snapshot of the prompt text, so deleting a prompt
 * never orphans historical student work.
 */
export async function DELETE(_req: NextRequest, context: RouteContext) {
  try {
    const id = await routeId(context.params)
    const ctx = await requireCreator()

    const { data: prompt, error } = await ctx.supabase
      .from('writing_prompts')
      .select('id, created_by')
      .eq('id', id)
      .maybeSingle()

    if (error) throw new ApiError(400, supabaseErrorMessage(error, "We couldn't load that prompt."))
    if (!prompt) throw new ApiError(404, "We couldn't find that prompt. It may already have been deleted.")
    if (!canManage(ctx, prompt)) throw new ApiError(403, 'That prompt belongs to another creator.')

    const { error: deleteError } = await ctx.supabase.from('writing_prompts').delete().eq('id', id)
    if (deleteError) throw new ApiError(400, supabaseErrorMessage(deleteError, "We couldn't delete the prompt."))

    return NextResponse.json({ success: true, id })
  } catch (err) {
    return toErrorResponse(err)
  }
}