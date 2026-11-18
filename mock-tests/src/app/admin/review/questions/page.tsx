import * as React from 'react'
import { AlertTriangle, HelpCircle } from 'lucide-react'

import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/features/creator/components/PageHeader'
import { previewText } from '@/features/creator/format'
import { examTypeLabel, parseStatusParam, questionTypeLabel } from '@/lib/creator/content-meta'
import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'

import { ReviewDataTable } from '../ReviewDataTable'
import type { ReviewItem } from '../types'

export const metadata = {
  title: 'Review questions — Admin',
}

export const dynamic = 'force-dynamic'

/**
 * Question moderation queue.
 *
 * Same shape as the tests queue: RLS client (admin policies expose every
 * question), rows flattened into `ReviewItem`s — the title is a preview of the
 * stem, and the meta chips summarise type, exam, subject and year. `?status=`
 * deep links pre-select the filter.
 */
export default async function AdminReviewQuestionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>
}) {
  await requireRole(['ADMIN'])

  const { status } = await searchParams
  const initialStatus = parseStatusParam(status)

  const supabase = await createClient()

  // One page of 200 covers the bank; the table paginates client-side.
  const { data: questions, error } = await supabase
    .from('questions')
    .select(
      'id, stem, type, status, exam_type, subject, topic, year_level, difficulty, created_at, updated_at'
    )
    .order('updated_at', { ascending: false })
    .limit(200)

  if (error || !questions) {
    return (
      <>
        <PageHeader
          title="Review questions"
          description="Approve submitted questions for publishing, or send them back to the creator."
          backHref="/admin"
          backLabel="Admin dashboard"
        />
        <EmptyState
          icon={<AlertTriangle size={20} aria-hidden="true" />}
          title="We could not load questions"
          description={error?.message || 'Unknown error.'}
        />
      </>
    )
  }

  const items: ReviewItem[] = questions.map((question) => {
    const details = [
      questionTypeLabel(question.type),
      examTypeLabel(question.exam_type),
      question.subject
        ? question.topic
          ? `${question.subject} · ${question.topic}`
          : question.subject
        : '',
      question.year_level ? `Year ${question.year_level}` : '',
      question.difficulty ? `Difficulty ${question.difficulty}/4` : '',
    ]

    return {
      id: question.id,
      title: previewText(question.stem, 90),
      status: question.status,
      examType: question.exam_type,
      details,
      createdAt: question.created_at,
      updatedAt: question.updated_at,
    }
  })

  const pendingCount = items.filter((item) => item.status === 'PENDING_APPROVAL').length

  return (
    <>
      <PageHeader
        title="Review questions"
        description="Approve submitted questions for publishing, or send them back to the creator."
        backHref="/admin"
        backLabel="Admin dashboard"
        meta={
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <HelpCircle size={14} aria-hidden="true" />
            {pendingCount > 0
              ? `${pendingCount} waiting for review · ${items.length} question${items.length === 1 ? '' : 's'} loaded`
              : `${items.length} question${items.length === 1 ? '' : 's'} loaded · nothing waiting`}
          </span>
        }
      />
      <ReviewDataTable entity="questions" items={items} initialStatus={initialStatus} />
    </>
  )
}
