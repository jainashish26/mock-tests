import { NextRequest, NextResponse } from 'next/server'
import {
  ApiError,
  EDITABLE_STATUSES,
  boolOr,
  cleanSearchTerm,
  enumParam,
  intOr,
  parsePagination,
  parsePayload,
  parseSort,
  requireCreator,
  supabaseErrorMessage,
  toErrorResponse,
} from '@/lib/creator/api'
import { CONTENT_STATUSES, EXAM_TYPE_VALUES } from '@/lib/creator/content-meta'

export const dynamic = 'force-dynamic'

const LIST_COLUMNS =
  'id, title, exam_type, year_level_min, year_level_max, time_limit_mins, is_free, status, created_at, updated_at'

/**
 * GET /api/creator/tests - paginated, searchable, filterable list of the signed-in
 * creator's own tests (admins see every test), each with its mapped question count.
 */
export async function GET(req: NextRequest) {
  try {
    const { supabase, user, role } = await requireCreator()
    const url = new URL(req.url)
    const { page, pageSize, from, to } = parsePagination(url)
    const search = cleanSearchTerm(url.searchParams.get('search'))
    const status = enumParam(url.searchParams.get('status'), CONTENT_STATUSES)
    const examType = enumParam(url.searchParams.get('exam_type'), EXAM_TYPE_VALUES)
    const { column, ascending } = parseSort(url, 'updated')

    let query = supabase.from('tests').select(LIST_COLUMNS, { count: 'exact' })
    if (role !== 'ADMIN') query = query.eq('created_by', user.id)
    if (search) query = query.ilike('title', `%${search}%`)
    if (status) query = query.eq('status', status)
    if (examType) query = query.eq('exam_type', examType)

    const { data, error, count } = await query
      .order(column, { ascending })
      .order('created_at', { ascending: false })
      .range(from, to)

    if (error) throw new ApiError(400, supabaseErrorMessage(error, "We couldn't load your tests."))

    const tests = data ?? []
    const questionCounts: Record<string, number> = {}

    if (tests.length > 0) {
      const { data: mappings, error: mappingError } = await supabase
        .from('test_questions')
        .select('test_id')
        .in(
          'test_id',
          tests.map((test) => test.id)
        )

      if (mappingError) {
        throw new ApiError(400, supabaseErrorMessage(mappingError, "We couldn't load question counts."))
      }

      for (const mapping of mappings ?? []) {
        questionCounts[mapping.test_id] = (questionCounts[mapping.test_id] ?? 0) + 1
      }
    }

    return NextResponse.json({
      data: tests.map((test) => ({ ...test, question_count: questionCounts[test.id] ?? 0 })),
      count: count ?? tests.length,
      page,
      pageSize,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** POST /api/creator/tests - create a draft test. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireCreator()
    const body = await parsePayload(req)

    const title = String(body.title ?? '').trim()
    if (!title) throw new ApiError(400, 'Give the test a title before saving it.')
    if (title.length > 200) throw new ApiError(400, 'Titles must be 200 characters or fewer.')

    const examType = enumParam(String(body.exam_type ?? ''), EXAM_TYPE_VALUES)
    if (!examType) throw new ApiError(400, 'Choose a valid exam type.')

    // Creators may only author editable content; publishing stays with moderators.
    const status = enumParam(String(body.status ?? 'DRAFT'), EDITABLE_STATUSES) ?? 'DRAFT'
    const yearMin = intOr(body.year_level_min, null, 2, 9, 'Year level (min)')
    const yearMax = intOr(body.year_level_max, null, 2, 9, 'Year level (max)')
    // Both columns are NOT NULL in Postgres; asking here beats a 23502 from the DB.
    if (yearMin === null) throw new ApiError(400, 'Choose the lowest year level this test covers.')
    if (yearMax === null) throw new ApiError(400, 'Choose the highest year level this test covers.')
    if (yearMin > yearMax) {
      throw new ApiError(400, 'The minimum year level cannot be higher than the maximum.')
    }
    const timeLimit = intOr(body.time_limit_mins, null, 1, 600, 'Time limit')
    if (timeLimit === null) throw new ApiError(400, 'Set a time limit in minutes.')

    const payload = {
      title,
      exam_type: examType,
      year_level_min: yearMin,
      year_level_max: yearMax,
      time_limit_mins: timeLimit,
      is_free: boolOr(body.is_free),
      status,
      created_by: ctx.user.id,
    }

    const { data, error } = await ctx.supabase.from('tests').insert(payload).select().single()
    if (error) throw new ApiError(400, supabaseErrorMessage(error, "We couldn't create the test."))

    return NextResponse.json({ id: data.id, test: data }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
