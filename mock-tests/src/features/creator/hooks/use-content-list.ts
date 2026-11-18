'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { errorMessage } from '@/lib/creator/client'
import type { ContentFilters, ListResponse } from '@/lib/creator/types'

/**
 * Shared list state for the creator content managers.
 *
 * Handles the three things every list screen needs and that are easy to get
 * wrong: debounced search (typing must not fire a request per keystroke), request
 * cancellation (a slow response must not overwrite a newer one), and resetting to
 * page 1 when a filter changes.
 *
 * Loading and the visible rows are *derived* from the in-flight request key rather
 * than written with `setState` inside the effect, so a filter change shows the
 * spinner immediately without a cascading render, and a stale response can never
 * be mistaken for the current one.
 */

/** Filters plus the pagination this hook controls. */
export type ListRequestParams = ContentFilters & { page: number; pageSize: number }

export type ListFetcher<T> = (
  params: ListRequestParams,
  signal?: AbortSignal
) => Promise<ListResponse<T>>

interface UseContentListOptions {
  pageSize?: number
  debounceMs?: number
}

interface Settled<T> {
  /** Request key the payload belongs to. */
  key: string
  items: T[]
  count: number
  error: string | null
}

export function useContentList<T>(
  fetcher: ListFetcher<T>,
  filters: ContentFilters,
  options: UseContentListOptions = {}
) {
  const { pageSize = 10, debounceMs = 300 } = options

  const [page, setPage] = useState(1)
  const [reloadToken, setReloadToken] = useState(0)
  const [settled, setSettled] = useState<Settled<T> | null>(null)

  // `fetcher` is stable in practice; the ref keeps an inlined arrow function from
  // re-triggering the request effect. It is only ever written from an effect.
  const fetcherRef = useRef(fetcher)
  useEffect(() => {
    fetcherRef.current = fetcher
  }, [fetcher])

  const filterKey = JSON.stringify(filters)
  const [debouncedKey, setDebouncedKey] = useState(filterKey)
  const firstRun = useRef(true)

  // Debounce only applies to filter changes; paging and manual reloads are instant.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    const timer = window.setTimeout(() => {
      setDebouncedKey(filterKey)
      setPage(1)
    }, debounceMs)
    return () => window.clearTimeout(timer)
  }, [filterKey, debounceMs])

  const requestKey = JSON.stringify({ filters: debouncedKey, page, pageSize, reloadToken })

  useEffect(() => {
    const controller = new AbortController()
    const params: ListRequestParams = {
      ...(JSON.parse(debouncedKey) as ContentFilters),
      page,
      pageSize,
    }

    fetcherRef
      .current(params, controller.signal)
      .then((response) => {
        setSettled({
          key: requestKey,
          items: response.data ?? [],
          count: response.count ?? 0,
          error: null,
        })
      })
      .catch((err: unknown) => {
        if ((err as Error)?.name === 'AbortError') return
        setSettled({
          key: requestKey,
          items: [],
          count: 0,
          error: errorMessage(err, 'We could not load your content.'),
        })
      })

    return () => controller.abort()
  }, [requestKey, debouncedKey, page, pageSize])

  const reload = useCallback(() => setReloadToken((token) => token + 1), [setReloadToken])

  const current = settled && settled.key === requestKey ? settled : null
  const items = current?.items ?? []
  const count = current?.count ?? 0

  return {
    items,
    count,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(count / pageSize)),
    loading: current === null,
    error: current?.error ?? null,
    setPage,
    reload,
  }
}
