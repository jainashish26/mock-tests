import * as React from 'react'
import { AlertTriangle, ClipboardCheck } from 'lucide-react'

import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/features/creator/components/PageHeader'
import { yearRange } from '@/features/creator/format'
import { examTypeLabel, parseStatusParam } from '@/lib/creator/content-meta'
import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'

import { ReviewDataTable } from '../ReviewDataTable'
import type { ReviewItem } from '../types'

export const metadata = {
  title: 'Review tests — Admin',
}

export const dynamic = 'force-dynamic'

/**
 * Test moderation queue.
 *
 * The RLS client is enough here — the admin policies on `tests` and
 * `test_questions` let an ADMIN read every row (same pattern as the dashboard),
 * unlike the users page which needs the service client for auth data.
 * Rows are flattened into `ReviewItem`s for the shared table; `?status=`
 * deep links (e.g. from the dashboard queue counts) pre-select the filter.
 */
export default async function AdminReviewTestsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>
}) {
  await requireRole(['ADMIN'])

  const { status } = await searchParams
  const initialStatus = parseStatusParam(status)

  const supabase = await createClient()

  const [{ data: tests, error }, { data: mappings }] = await Promise.all([
    // One page of 200 covers the catalogue; the table paginates client-side.
    supabase
      .from('tests')
      .select(
        'id, title, exam_type, year_level_min, year_level_max, time_limit_mins, is_free, status, created_at, updated_at'
      )
      .order('updated_at', { ascending: false })
      .limit(200),
    supabase.from('test_questions').select('test_id'),
  ])

  if (error || !tests) {
    return (
      <>
        <PageHeader
          title="Review tests"
          description="Approve submitted tests for publishing, or send them back to the creator."
          backHref="/admin"
          backLabel="Admin dashboard"
        />
        <EmptyState
          icon={<AlertTriangle size={20} aria-hidden="true" />}
          title="We could not load tests"
          description={error?.message || 'Unknown error.'}
        />
      </>
    )
  }

  const questionCounts = new Map<string, number>()
  for (const mapping of mappings ?? []) {
    questionCounts.set(mapping.test_id, (questionCounts.get(mapping.test_id) ?? 0) + 1)
  }

  const items: ReviewItem[] = tests.map((test) => {
    const questionCount = questionCounts.get(test.id) ?? 0
    return {
      id: test.id,
      title: test.title,
      status: test.status,
      examType: test.exam_type,
      details: [
        examTypeLabel(test.exam_type),
        yearRange(test.year_level_min, test.year_level_max),
        `${test.time_limit_mins} min`,
        test.is_free ? 'Free' : 'Paid',
        `${questionCount} question${questionCount === 1 ? '' : 's'}`,
      ],
      questionCount,
      createdAt: test.created_at,
      updatedAt: test.updated_at,
    }
  })

  const pendingCount = items.filter((item) => item.status === 'PENDING_APPROVAL').length

  return (
    <>
      <PageHeader
        title="Review tests"
        description="Approve submitted tests for publishing, or send them back to the creator."
        backHref="/admin"
        backLabel="Admin dashboard"
        meta={
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <ClipboardCheck size={14} aria-hidden="true" />
            {pendingCount > 0
              ? `${pendingCount} waiting for review · ${items.length} test${items.length === 1 ? '' : 's'} loaded`
              : `${items.length} test${items.length === 1 ? '' : 's'} loaded · nothing waiting`}
          </span>
        }
      />
      <ReviewDataTable entity="tests" items={items} initialStatus={initialStatus} />
    </>
  )
}
