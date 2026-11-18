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
  'published_at',
  'approved_by',
  'total_attempts',
  'completed_count',
  'avg_score_percentage',
]

/**
 * POST /api/creator/tests/:id/duplicate
 *
 * Clones a test (plus its sections and question mappings) as a fresh DRAFT owned by
 * the caller. This is the only way to iterate on published content, which RLS keeps
 * locked, so the copy is the escape hatch the UI points creators at.
 */
export async function POST(_req: NextRequest, context: RouteContext) {
  try {
    const id = await routeId(context.params)
    const ctx = await requireCreator()

    const { data: test, error } = await ctx.supabase.from('tests').select('*').eq('id', id).maybeSingle()

    if (error) throw new ApiError(400, supabaseErrorMessage(error, "We couldn't load that test."))
    if (!test) throw new ApiError(404, "We couldn't find that test. It may have been deleted.")
    if (!canManage(ctx, test)) throw new ApiError(403, 'That test belongs to another creator.')

    const copy: Record<string, unknown> = { ...test }
    for (const column of NOT_COPIED) delete copy[column]
    copy.title = `${String(test.title ?? 'Untitled test').slice(0, 190)} (copy)`
    copy.status = 'DRAFT'
    copy.created_by = ctx.user.id

    const { data: created, error: createError } = await ctx.supabase
      .from('tests')
      .insert(copy)
      .select()
      .single()

    if (createError) {
      throw new ApiError(400, supabaseErrorMessage(createError, "We couldn't duplicate the test."))
    }

    const [{ data: sections }, { data: mappings }] = await Promise.all([
      ctx.supabase.from('test_sections').select('*').eq('test_id', id),
      ctx.supabase
        .from('test_questions')
        .select('question_id, section_name, base_difficulty, question_order')
        .eq('test_id', id)
        .order('question_order'),
    ])

    if (sections && sections.length > 0) {
      const rows = sections.map((section) => {
        // Copy every column except the identity ones, which belong to the new test.
        const rest: Record<string, unknown> = { ...section }
        delete rest.id
        delete rest.test_id
        return { ...rest, test_id: created.id }
      })
      const { error: sectionError } = await ctx.supabase.from('test_sections').insert(rows)
      if (sectionError) {
        throw new ApiError(400, supabaseErrorMessage(sectionError, 'The copy was created but its sections could not be.'))
      }
    }

    if (mappings && mappings.length > 0) {
      const rows = mappings.map((mapping) => ({
        test_id: created.id,
        question_id: mapping.question_id,
        section_name: mapping.section_name,
        base_difficulty: mapping.base_difficulty,
        question_order: mapping.question_order,
      }))
      const { error: mappingError } = await ctx.supabase.from('test_questions').insert(rows)
      if (mappingError) {
        throw new ApiError(400, supabaseErrorMessage(mappingError, 'The copy was created but its questions could not be attached.'))
      }
    }

    return NextResponse.json(
      {
        id: created.id,
        test: created,
        sections_copied: sections?.length ?? 0,
        questions_copied: mappings?.length ?? 0,
      },
      { status: 201 }
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}
