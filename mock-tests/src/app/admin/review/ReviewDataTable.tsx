'use client'

import * as React from 'react'
import Link from 'next/link'
import { Inbox, SearchX } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Pagination } from '@/components/ui/Pagination'
import { ContentToolbar } from '@/features/creator/components/ContentToolbar'
import { StatusBadge } from '@/features/creator/components/StatusBadge'
import { formatDate } from '@/features/creator/format'
import { CONTENT_STATUSES, STATUS_LABELS } from '@/lib/creator/content-meta'

import { ReviewActionButtons } from './ReviewActionButtons'
import { ReviewConfirmDialog } from './ReviewConfirmDialog'
import { useReviewAction } from './useReviewAction'
import type { ReviewEntity, ReviewItem } from './types'

type SortKey = 'updated' | 'created' | 'title' | 'status'
type SortDir = 'asc' | 'desc'

const PAGE_SIZE = 10

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'updated', label: 'Last updated' },
  { value: 'created', label: 'Date created' },
  { value: 'title', label: 'Title' },
  { value: 'status', label: 'Status' },
]

const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All statuses' },
  ...CONTENT_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] ?? s })),
]

function statusRank(status: string): number {
  const idx = CONTENT_STATUSES.indexOf(status as (typeof CONTENT_STATUSES)[number])
  return idx === -1 ? CONTENT_STATUSES.length : idx
}

function titleKey(item: ReviewItem): string {
  return item.title.trim().toLowerCase()
}

function sortItems(items: ReviewItem[], key: SortKey, dir: SortDir): ReviewItem[] {
  const factor = dir === 'asc' ? 1 : -1
  return [...items].sort((a, b) => {
    switch (key) {
      case 'title':
        return factor * titleKey(a).localeCompare(titleKey(b))
      case 'created':
        return factor * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      case 'status': {
        const diff = statusRank(a.status) - statusRank(b.status)
        // Same status → newest activity first, matching the default order.
        return diff !== 0
          ? factor * diff
          : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      }
      case 'updated':
      default:
        return factor * (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
    }
  })
}

interface ReviewDataTableProps {
  /** Drives the API path, detail links and copy. */
  entity: ReviewEntity
  items: ReviewItem[]
  /** Initial status filter, e.g. from `?status=PENDING_APPROVAL` deep links. */
  initialStatus?: string
}

/**
 * Shared review queue for tests and questions.
 *
 * The server page flattens rows into `ReviewItem`s (title, status, meta chips,
 * timestamps); this component owns the moderation UX: search / status filter /
 * sort via the shared ContentToolbar, a mobile-first card per item with its
 * StatusBadge and deep link to the detail page, and approve / request-changes
 * buttons. Mutations go through `useReviewAction` →
 * `POST /api/admin/review/[entity]/[id]`, behind a single shared ConfirmDialog,
 * with toast feedback. Rows are patched locally on success and
 * `router.refresh()` revalidates the server data (queue counts, badges).
 * Pagination is client-side (10 per page) like the admin users table.
 */
export function ReviewDataTable({ entity, items, initialStatus = '' }: ReviewDataTableProps) {
  const [rows, setRows] = React.useState<ReviewItem[]>(items)
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [statusFilter, setStatusFilter] = React.useState(initialStatus)
  const [sortKey, setSortKey] = React.useState<SortKey>('updated')
  const [sortDir, setSortDir] = React.useState<SortDir>('desc')

  const review = useReviewAction(entity, (id, action) => {
    setRows((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, status: action === 'approve' ? 'PUBLISHED' : 'DRAFT' } : item
      )
    )
  })

  // Re-sync when the server refetches (e.g. router.refresh() after an action).
  React.useEffect(() => {
    setRows(items)
  }, [items])

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    let result = rows
    if (q) {
      result = result.filter((item) => titleKey(item).includes(q))
    }
    if (statusFilter) {
      result = result.filter((item) => item.status === statusFilter)
    }
    return sortItems(result, sortKey, sortDir)
  }, [rows, search, statusFilter, sortKey, sortDir])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const start = (safePage - 1) * PAGE_SIZE
  const visible = filtered.slice(start, start + PAGE_SIZE)

  const activeFilterCount = (search.trim() ? 1 : 0) + (statusFilter ? 1 : 0)

  const clearFilters = React.useCallback(() => {
    setSearch('')
    setStatusFilter('')
    setPage(1)
  }, [])

  const pendingItem = review.pending ? (rows.find((r) => r.id === review.pending!.id) ?? null) : null

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Inbox size={20} aria-hidden="true" />}
        title="Nothing to review yet"
        description={
          entity === 'tests'
            ? 'Tests created by the team will show up here for moderation.'
            : 'Questions created by the team will show up here for moderation.'
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      <ContentToolbar
        idPrefix={`review-${entity}`}
        searchLabel={`Search ${entity}`}
        search={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPage(1)
        }}
        searchPlaceholder={entity === 'tests' ? 'Search by title…' : 'Search by question…'}
        filters={[
          {
            key: 'status',
            label: 'Status',
            value: statusFilter,
            options: STATUS_FILTER_OPTIONS,
            onChange: (value) => {
              setStatusFilter(value)
              setPage(1)
            },
          },
        ]}
        sort={sortKey}
        dir={sortDir}
        sortOptions={SORT_OPTIONS}
        onSortChange={(value) => setSortKey(value as SortKey)}
        onDirChange={setSortDir}
        activeFilterCount={activeFilterCount}
        onClearFilters={clearFilters}
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon={<SearchX size={20} aria-hidden="true" />}
          title="No matches"
          description={`No ${entity} match your current search and filters.`}
          action={
            activeFilterCount > 0 ? (
              <Button type="button" variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {visible.map((item) => (
            <article key={item.id} className="rounded-xl border border-border bg-card p-4 shadow-xs">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/admin/review/${entity}/${item.id}`}
                      className="text-sm font-semibold text-foreground underline-offset-4 hover:underline"
                    >
                      {item.title}
                    </Link>
                    <StatusBadge status={item.status} />
                  </div>
                  {item.details.filter(Boolean).length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {item.details.filter(Boolean).map((detail) => (
                        <span key={detail}>{detail}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <p className="shrink-0 text-xs text-muted-foreground">
                  Updated {formatDate(item.updatedAt)}
                </p>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                <Button type="button" variant="ghost" size="sm" className="min-h-10 gap-1.5" asChild>
                  <Link href={`/admin/review/${entity}/${item.id}`}>Open review</Link>
                </Button>
                <div className="flex flex-wrap items-center gap-2">
                  <ReviewActionButtons
                    status={item.status}
                    busy={review.busy && review.pending?.id === item.id}
                    onRequest={(action) => review.requestAction(item.id, action)}
                  />
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <Pagination
        page={safePage}
        pageSize={PAGE_SIZE}
        count={filtered.length}
        onChange={setPage}
        itemLabel={entity}
        className="mt-4"
      />

      {/* One dialog for the whole list — `pendingItem` decides its copy. */}
      <ReviewConfirmDialog
        entity={entity}
        action={review.pending?.action ?? null}
        target={
          pendingItem
            ? {
                title: pendingItem.title,
                status: pendingItem.status,
                questionCount: pendingItem.questionCount,
              }
            : null
        }
        busy={review.busy}
        error={review.error}
        onConfirm={review.confirmAction}
        onCancel={review.cancel}
      />
    </div>
  )
}
