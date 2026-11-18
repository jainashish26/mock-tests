'use client'

import { useCallback, useState } from 'react'

import { errorMessage } from '@/lib/creator/client'
import { useToast } from '@/components/ui/Toast'

/**
 * Mutation helper for the row actions (duplicate / delete / change status).
 *
 * Tracks which row is busy so its buttons can be disabled and spinner-ed,
 * surfaces the API's own message in a toast (the routes already return
 * creator-friendly copy, including "duplicate instead" guidance for published
 * content), and refreshes the list on success.
 */
export function useRowActions(reload: () => void) {
  const toast = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)

  const run = useCallback(
    async (
      id: string,
      action: () => Promise<string | void>,
      options: { successTitle?: string; refresh?: boolean } = {}
    ) => {
      const { successTitle, refresh = true } = options
      setBusyId(id)
      try {
        const description = await action()
        if (successTitle) toast.success(successTitle, description ?? undefined)
        if (refresh) reload()
        return true
      } catch (err) {
        toast.error(errorMessage(err))
        return false
      } finally {
        setBusyId(null)
      }
    },
    [reload, toast]
  )

  return { busyId, run, toast }
}
