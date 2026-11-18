'use client'

import * as React from 'react'

import { ReviewActionButtons } from './ReviewActionButtons'
import { ReviewConfirmDialog } from './ReviewConfirmDialog'
import { useReviewAction } from './useReviewAction'
import type { ReviewEntity } from './types'

interface ReviewActionsProps {
  entity: ReviewEntity
  id: string
  status: string
  title: string
  /** Tests only — the mapped question count, used by the confirm copy. */
  questionCount?: number
}

/**
 * Self-contained approve / request-changes bar for a review detail page:
 * buttons + confirm dialog + the API mutation. After a successful action the
 * hook calls `router.refresh()`, so the server-rendered status badge and
 * overview update in place.
 */
export function ReviewActions({ entity, id, status, title, questionCount }: ReviewActionsProps) {
  const review = useReviewAction(entity)

  const target = React.useMemo(() => ({ title, status, questionCount }), [title, status, questionCount])

  return (
    <>
      <ReviewActionButtons
        status={status}
        busy={review.busy}
        onRequest={(action) => review.requestAction(id, action)}
      />
      <ReviewConfirmDialog
        entity={entity}
        action={review.pending?.action ?? null}
        target={review.pending?.id === id ? target : null}
        busy={review.busy}
        error={review.error}
        onConfirm={review.confirmAction}
        onCancel={review.cancel}
      />
    </>
  )
}
