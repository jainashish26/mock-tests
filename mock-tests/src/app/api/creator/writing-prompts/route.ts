import { NextRequest, NextResponse } from 'next/server'
import {
  ApiError,
  cleanSearchTerm,
  enumParam,
  parsePagination,
  parsePayload,
  requireCreator,
  supabaseErrorMessage,
  toErrorResponse,
} from '@/lib/creator/api'
import { CONTENT_STATUSES } from '@/lib/creator/content-meta'
import { WRITING_PROMPT_TYPES, writingPromptPayload } from '@/lib/creator/writing-prompt-fields'

export const dynamic = 'force-dynamic'

const LIST_COLUMNS = 'id, year_level, territory, type, text, status, created_by, created_at, updated_at'

/**
 * GET /api/creator/writing-prompts - paginated, filterable list. A Quiz Master
 * (TEST_CREATOR) sees their own prompts; an ADMIN sees every prompt.
 */
export async function GET(req: NextRequest) {
  try {
    const { supabase, user, role } = await requireCreator()
    const url = new URL(req.url)
    const { page, pageSize, from, to } = parsePagination(url)
    const search = cleanSearchTerm(url.searchParams.get('search'))
    const status = enumParam(url.searchParams.get('status'), CONTENT_STATUSES)
    const type = enumParam(url.searchParams.get('type'), WRITING_PROMPT_TYPES)
    const yearLevel = Number.parseInt(url.searchParams.get('year_level') ?? '', 10)

    let query = supabase.from('writing_prompts').select(LIST_COLUMNS, { count: 'exact' })
    if (role !== 'ADMIN') query = query.eq('created_by', user.id)
    if (search) query = query.or(`text.ilike.%${search}%,territory.ilike.%${search}%`)
    if (status) query = query.eq('status', status)
    if (type) query = query.eq('type', type)
    if (Number.isFinite(yearLevel) && yearLevel >= 2 && yearLevel <= 9) {
      query = query.eq('year_level', yearLevel)
    }

    const { data, error, count } = await query
      .order('year_level', { ascending: true })
      .order('type', { ascending: true })
      .order('created_at', { ascending: false })
      .range(from, to)

    if (error) throw new ApiError(400, supabaseErrorMessage(error, "We couldn't load the writing prompts."))

    return NextResponse.json({ data: data ?? [], count: count ?? 0, page, pageSize })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** POST /api/creator/writing-prompts - create a prompt owned by the caller. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireCreator()
    const body = await parsePayload(req)
    const payload = { ...writingPromptPayload(body), created_by: ctx.user.id }

    const { data, error } = await ctx.supabase.from('writing_prompts').insert(payload).select().single()
    if (error) throw new ApiError(400, supabaseErrorMessage(error, "We couldn't save the prompt."))

    return NextResponse.json({ id: data.id, prompt: data }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}