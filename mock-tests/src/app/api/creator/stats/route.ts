import { NextResponse } from 'next/server'
import { ApiError, requireCreator, supabaseErrorMessage, toErrorResponse } from '@/lib/creator/api'
import { CONTENT_STATUSES, EDITABLE_STATUSES } from '@/lib/creator/content-meta'

export const dynamic = 'force-dynamic'

/**
 * GET /api/creator/stats - the counters behind the creator dashboard.
 *
 * Uses head-only count queries (no row transfer) and runs them in parallel. Counts
 * are always scoped to the signed-in creator's own content; admins get platform-wide
 * numbers, which matches what they see in the admin queue.
 */
export async function GET() {
  try {
    const { supabase, user, role } = await requireCreator()
    const isAdmin = role === 'ADMIN'

    const countIn = async (table: 'tests' | 'questions', status: string | null) => {
      let query = supabase.from(table).select('id', { count: 'exact', head: true })
      if (!isAdmin) query = query.eq('created_by', user.id)
      if (status) query = query.eq('status', status)
      const { count, error } = await query
      if (error) throw new ApiError(400, supabaseErrorMessage(error, "We couldn't load your counts."))
      return count ?? 0
    }

    const statuses = [...CONTENT_STATUSES]
    const [testCounts, questionCounts] = await Promise.all([
      Promise.all([
        countIn('tests', null),
        ...statuses.map((status) => countIn('tests', status)),
      ]),
      Promise.all([
        countIn('questions', null),
        ...statuses.map((status) => countIn('questions', status)),
      ]),
    ])

    const shape = (counts: number[]) => ({
      total: counts[0],
      draft: counts[1 + statuses.indexOf('DRAFT')],
      pending: counts[1 + statuses.indexOf('PENDING_APPROVAL')],
      published: counts[1 + statuses.indexOf('PUBLISHED')],
      archived: counts[1 + statuses.indexOf('ARCHIVED')],
      editable:
        counts[1 + statuses.indexOf('DRAFT')] + counts[1 + statuses.indexOf('PENDING_APPROVAL')],
    })

    return NextResponse.json({
      tests: shape(testCounts),
      questions: shape(questionCounts),
      editableStatuses: EDITABLE_STATUSES,
      generatedAt: new Date().toISOString(),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
