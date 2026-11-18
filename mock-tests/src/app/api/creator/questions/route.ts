import { NextRequest, NextResponse } from 'next/server'
import {
  ApiError,
  cleanSearchTerm,
  enumParam,
  parsePagination,
  parsePayload,
  parseSort,
  requireCreator,
  supabaseErrorMessage,
  toErrorResponse,
} from '@/lib/creator/api'
import { questionPayload } from '@/lib/creator/question-fields'
import { CONTENT_STATUSES, EXAM_TYPE_VALUES, QUESTION_TYPES } from '@/lib/creator/content-meta'

export const dynamic = 'force-dynamic'

const LIST_COLUMNS =
  'id, stem, type, status, exam_id, exam_type, exam_section, subject, topic, sub_topic, year_level, difficulty, is_active, tags, created_at, updated_at'

/**
 * GET /api/creator/questions - paginated, searchable, filterable list of the
 * signed-in creator's own questions (admins see every question).
 */
export async function GET(req: NextRequest) {
  try {
    const { supabase, user, role } = await requireCreator()
    const url = new URL(req.url)
    const { page, pageSize, from, to } = parsePagination(url)
    const search = cleanSearchTerm(url.searchParams.get('search'))
    const status = enumParam(url.searchParams.get('status'), CONTENT_STATUSES)
    const examType = enumParam(url.searchParams.get('exam_type'), EXAM_TYPE_VALUES)
    const questionType = enumParam(url.searchParams.get('type'), QUESTION_TYPES)
    const yearLevel = Number.parseInt(url.searchParams.get('year_level') ?? '', 10)
    const { column, ascending } = parseSort(url, 'updated')

    let query = supabase.from('questions').select(LIST_COLUMNS, { count: 'exact' })
    if (role !== 'ADMIN') query = query.eq('created_by', user.id)
    if (search) {
      query = query.or(`stem.ilike.%${search}%,topic.ilike.%${search}%,subject.ilike.%${search}%`)
    }
    if (status) query = query.eq('status', status)
    if (examType) query = query.eq('exam_type', examType)
    if (questionType) query = query.eq('type', questionType)
    if (Number.isFinite(yearLevel) && yearLevel >= 1 && yearLevel <= 13) {
      query = query.eq('year_level', yearLevel)
    }

    const { data, error, count } = await query
      .order(column, { ascending })
      .order('created_at', { ascending: false })
      .range(from, to)

    if (error) throw new ApiError(400, supabaseErrorMessage(error, "We couldn't load your questions."))

    return NextResponse.json({ data: data ?? [], count: count ?? 0, page, pageSize })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** POST /api/creator/questions - create a question owned by the signed-in creator. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireCreator()
    const body = await parsePayload(req)
    const payload = { ...questionPayload(body), created_by: ctx.user.id }

    const { data, error } = await ctx.supabase.from('questions').insert(payload).select().single()
    if (error) throw new ApiError(400, supabaseErrorMessage(error, "We couldn't save the question."))

    return NextResponse.json({ id: data.id, question: data }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
