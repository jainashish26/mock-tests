'use client'

import * as React from 'react'
import { SearchX, Timer } from 'lucide-react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Pagination } from '@/components/ui/Pagination'
import { ContentToolbar } from '@/features/creator/components/ContentToolbar'
import { formatDate } from '@/features/creator/format'
import { attemptStatusMeta, formatDuration, formatScore } from '@/lib/admin/display'
import { examTypeLabel } from '@/lib/creator/content-meta'

/** `attempt_status` enum values (verified against the live schema). */
const ATTEMPT_STATUSES = ['IN_PROGRESS', 'SUBMITTED', 'WRITING_PENDING', 'COMPLETE'] as const

/** One flattened attempt row, prepared by the server page. */
export interface AttemptRow {
  id: string
  status: string
  /** `score_out_of100` — numeric, string (numeric column) or null if ungraded. */
  score: number | string | null
  startedAt: string | null
  submittedAt: string | null
  durationSeconds: number | null
  testTitle: string | null
  testExamType: string | null
  studentName: string | null
}

type SortKey = 'started' | 'score' | 'test' | 'student' | 'status'
type SortDir = 'asc' | 'desc'

const PAGE_SIZE = 10

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'started', label: 'Date started' },
  { value: 'score', label: 'Score' },
  { value: 'test', label: 'Test' },
  { value: 'student', label: 'Student' },
  { value: 'status', label: 'Status' },
]

const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All statuses' },
  ...ATTEMPT_STATUSES.map((status) => ({ value: status, label: attemptStatusMeta(status).label })),
]

function scoreValue(score: number | string | null): number {
  const value = Number(score)
  return Number.isNaN(value) ? -1 : value
}

function timeValue(value: string | null): number {
  return value ? new Date(value).getTime() : 0
}

function sortRows(rows: AttemptRow[], key: SortKey, dir: SortDir): AttemptRow[] {
  const factor = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    switch (key) {
      case 'score':
        return factor * (scoreValue(a.score) - scoreValue(b.score))
      case 'test':
        return (
          factor * (a.testTitle ?? '').toLowerCase().localeCompare((b.testTitle ?? '').toLowerCase())
        )
      case 'student':
        return (
          factor *
          (a.studentName ?? '').toLowerCase().localeCompare((b.studentName ?? '').toLowerCase())
        )
      case 'status': {
        const diff =
          ATTEMPT_STATUSES.indexOf(a.status as (typeof ATTEMPT_STATUSES)[number]) -
          ATTEMPT_STATUSES.indexOf(b.status as (typeof ATTEMPT_STATUSES)[number])
        return diff !== 0 ? factor * diff : timeValue(b.startedAt) - timeValue(a.startedAt)
      }
      case 'started':
      default:
        return factor * (timeValue(a.startedAt) - timeValue(b.startedAt))
    }
  })
}

/**
 * Attempts report table — read-only.
 *
 * Mirrors the review/users tables: ContentToolbar for search (student or test),
 * status filter and sort; a mobile-first card per attempt; client-side
 * pagination at 10 per page. Attempts have no admin detail route, so cards are
 * informational rather than links.
 */
export function AttemptsDataTable({ rows }: { rows: AttemptRow[] }) {
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [statusFilter, setStatusFilter] = React.useState('')
  const [sortKey, setSortKey] = React.useState<SortKey>('started')
  const [sortDir, setSortDir] = React.useState<SortDir>('desc')

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    let result = rows
    if (q) {
      result = result.filter(
        (row) =>
          (row.studentName ?? '').toLowerCase().includes(q) ||
          (row.testTitle ?? '').toLowerCase().includes(q)
      )
    }
    if (statusFilter) {
      result = result.filter((row) => row.status === statusFilter)
    }
    return sortRows(result, sortKey, sortDir)
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

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Timer size={20} aria-hidden="true" />}
        title="No attempts yet"
        description="Student test activity will appear here as soon as the first attempt is started."
      />
    )
  }

  return (
    <div className="space-y-4">
      <ContentToolbar
        idPrefix="reports-attempts"
        searchLabel="Search attempts"
        search={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPage(1)
        }}
        searchPlaceholder="Search by student or test…"
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
          description="No attempts match your current search and filters."
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
          {visible.map((row) => {
            const meta = attemptStatusMeta(row.status)
            const graded = row.score !== null && row.score !== undefined && scoreValue(row.score) >= 0
            return (
              <article key={row.id} className="rounded-xl border border-border bg-card p-4 shadow-xs">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">
                        {row.testTitle || 'Test removed'}
                      </p>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{row.studentName || 'Student'}</span>
                      {row.testExamType ? <span>{examTypeLabel(row.testExamType)}</span> : null}
                      <span>Started {formatDate(row.startedAt)}</span>
                      <span>Duration {formatDuration(row.durationSeconds)}</span>
                      {row.submittedAt ? <span>Submitted {formatDate(row.submittedAt)}</span> : null}
                    </div>
                  </div>
                  <p
                    className={
                      graded
                        ? 'shrink-0 text-sm font-bold text-emerald-600'
                        : 'shrink-0 text-sm text-muted-foreground'
                    }
                  >
                    {graded ? `Score ${formatScore(row.score)}` : 'Not graded'}
                  </p>
                </div>
              </article>
            )
          })}
        </div>
      )}

      <Pagination
        page={safePage}
        pageSize={PAGE_SIZE}
        count={filtered.length}
        onChange={setPage}
        itemLabel="attempts"
        className="mt-4"
      />
    </div>
  )
}

