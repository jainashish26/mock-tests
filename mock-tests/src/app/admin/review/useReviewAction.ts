'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'

import { useToast } from '@/components/ui/Toast'

import { ENTITY_COPY, type ReviewActionType, type ReviewEntity } from './types'

/**
 * Shared moderation mutation for the review screens.
 *
 * The list cards and the detail page both funnel approve / request-changes
 * through `POST /api/admin/review/[entity]/[id]`: the API flips the row to
 * PUBLISHED (approve — for tests it also publishes every mapped question) or
 * back to DRAFT (request changes / unpublish). The hook owns the confirm-dialog
 * state, the busy flag and the error text so both surfaces behave identically,
 * then toasts the outcome and refreshes server data.
 */
export function useReviewAction(
  entity: ReviewEntity,
  onReviewed?: (id: string, action: ReviewActionType) => void
) {
  const [pending, setPending] = React.useState<{ id: string; action: ReviewActionType } | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const toast = useToast()
  const router = useRouter()

  /** Opens the confirm dialog; nothing is sent until `confirmAction` runs. */
  const requestAction = React.useCallback((id: string, action: ReviewActionType) => {
    setError(null)
    setPending({ id, action })
  }, [])

  const cancel = React.useCallback(() => {
    if (busy) return
    setPending(null)
    setError(null)
  }, [busy])

  const confirmAction = React.useCallback(async () => {
    if (!pending || busy) return
    setBusy(true)
    setError(null)

    const { id, action } = pending
    try {
      const res = await fetch(`/api/admin/review/${entity}/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const payload = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        throw new Error(payload?.error || `The review request failed (${res.status}). Please try again.`)
      }

      setPending(null)
      onReviewed?.(id, action)

      const { singular } = ENTITY_COPY[entity]
      if (action === 'approve') {
        toast.success(
          'Approved and published',
          entity === 'tests'
            ? `The test and its mapped questions are now live.`
            : `The ${singular} is now live.`
        )
      } else {
        toast.success('Returned to draft', `The creator can edit the ${singular} and submit it again.`)
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }, [busy, entity, onReviewed, pending, router, toast])

  return { pending, busy, error, requestAction, confirmAction, cancel }
}
