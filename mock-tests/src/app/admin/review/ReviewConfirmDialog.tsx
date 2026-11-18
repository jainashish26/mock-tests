'use client'

import * as React from 'react'

import { ConfirmDialog } from '@/features/creator/components/ConfirmDialog'

import type { ReviewActionType, ReviewEntity } from './types'

interface ReviewTarget {
  title: string
  status: string
  /** Tests only — drives the "publishes mapped questions too" copy. */
  questionCount?: number
}

interface ReviewConfirmDialogProps {
  entity: ReviewEntity
  action: ReviewActionType | null
  target: ReviewTarget | null
  busy: boolean
  error: string | null
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

/**
 * Confirmation step for every moderation action, shared by the review lists
 * and the detail page.
 *
 * The copy spells out what the API actually does — approving a test publishes
 * its mapped questions with it, and "request changes" / "return to draft" both
 * move the row back to DRAFT so the creator can edit and resubmit.
 */
export function ReviewConfirmDialog({
  entity,
  action,
  target,
  busy,
  error,
  onConfirm,
  onCancel,
}: ReviewConfirmDialogProps) {
  const open = action !== null && target !== null

  let title = ''
  let confirmLabel = 'Confirm'
  let destructive = false
  let body: React.ReactNode = null

  if (action === 'approve' && target) {
    title = 'Approve and publish?'
    confirmLabel = 'Approve & publish'
    body =
      entity === 'tests' ? (
        <>
          <p>
            <span className="font-semibold text-foreground">{target.title}</span> will be published immediately and
            become available to students.
          </p>
          {target.questionCount === 0 ? (
            <p>
              This test has no questions mapped yet — publishing it would put an empty test in front of students.
            </p>
          ) : (
            <p>
              Every question mapped to this test
              {target.questionCount !== undefined ? ` (${target.questionCount})` : ''} is published with it.
            </p>
          )}
        </>
      ) : (
        <p>
          <span className="font-semibold text-foreground">{target.title}</span> will be published and become available
          in tests students can sit.
        </p>
      )
  } else if (action === 'reject' && target) {
    destructive = true
    confirmLabel = 'Return to draft'
    if (target.status === 'PUBLISHED') {
      title = 'Return to draft?'
      body = (
        <>
          <p>
            <span className="font-semibold text-foreground">{target.title}</span> is currently published. Returning it
            to draft unpublishes it — students lose access until it is approved again.
          </p>
        </>
      )
    } else {
      title = 'Request changes?'
      body = (
        <p>
          <span className="font-semibold text-foreground">{target.title}</span> will go back to draft. The creator can
          edit it and submit it for review again.
        </p>
      )
    }
  }

  return (
    <ConfirmDialog
      open={open}
      title={title}
      description={body}
      confirmLabel={confirmLabel}
      destructive={destructive}
      busy={busy}
      error={error}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
