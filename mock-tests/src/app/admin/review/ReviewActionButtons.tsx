'use client'

import * as React from 'react'
import { Check, RotateCcw } from 'lucide-react'

import { Button } from '@/components/ui/Button'

import type { ReviewActionType } from './types'

interface ReviewActionButtonsProps {
  status: string
  busy?: boolean
  onRequest: (action: ReviewActionType) => void
}

/**
 * The moderation buttons for one item, without any dialog/mutation logic —
 * the caller wires `onRequest` to a confirm flow.
 *
 * Which buttons show depends on the current status: pending items can be
 * approved or sent back for changes, published items can be pulled back to
 * draft, and drafts/archived items have no moderation action (the creator
 * owns them).
 */
export function ReviewActionButtons({ status, busy = false, onRequest }: ReviewActionButtonsProps) {
  if (status === 'PENDING_APPROVAL') {
    return (
      <>
        <Button
          type="button"
          size="sm"
          className="min-h-10 gap-1.5"
          disabled={busy}
          onClick={() => onRequest('approve')}
        >
          <Check size={16} aria-hidden="true" />
          Approve
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-10 gap-1.5"
          disabled={busy}
          onClick={() => onRequest('reject')}
        >
          <RotateCcw size={16} aria-hidden="true" />
          Request changes
        </Button>
      </>
    )
  }

  if (status === 'PUBLISHED') {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-10 gap-1.5 text-destructive hover:text-destructive"
        disabled={busy}
        onClick={() => onRequest('reject')}
      >
        <RotateCcw size={16} aria-hidden="true" />
        Return to draft
      </Button>
    )
  }

  return null
}
