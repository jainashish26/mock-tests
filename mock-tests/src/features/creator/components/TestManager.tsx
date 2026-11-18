'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  Clock,
  Copy,
  FileText,
  HelpCircle,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { Pagination } from '@/components/ui/Pagination'
import { Select } from '@/components/ui/Select'
import { useToast } from '@/components/ui/Toast'
import { ConfirmDialog } from '@/features/creator/components/ConfirmDialog'
import { ContentToolbar } from '@/features/creator/components/ContentToolbar'
import { CreateTestDialog } from '@/features/creator/components/CreateTestDialog'
import { StatusBadge } from '@/features/creator/components/StatusBadge'
import { useContentList } from '@/features/creator/hooks/use-content-list'
import { useRowActions } from '@/features/creator/hooks/use-row-actions'
import {
  DEFAULT_DIR,
  DEFAULT_SORT,
  examTypeOptions,
  statusOptions,
  TEST_SORT_OPTIONS,
} from '@/features/creator/options'
import { formatDate, yearRange } from '@/features/creator/format'
import { creatorApi } from '@/lib/creator/client'
import { CONTENT_STATUSES, isEditable, statusLabel } from '@/lib/creator/content-meta'
import type { ContentStatus } from '@/lib/creator/content-meta'
import type { SortDir, SortKey, TestRow } from '@/lib/creator/types'

/**
 * The "Manage tests" workspace: search, filter, sort, page, create, duplicate,
 * change status and delete tests through `/api/creator/tests`.
 *
 * All authorisation happens in the API routes — this component only renders what
 * the server returns and shows the server's message when an action is refused
 * (for example deleting a test that already has attempts).
 */
export function TestManager({ initialStatus }: { initialStatus?: ContentStatus }) {
  const router = useRouter()
  const toast = useToast()

  const [search, setSearch] = React.useState('')
  const [status, setStatus] = React.useState<ContentStatus | ''>(initialStatus ?? '')
  const [examType, setExamType] = React.useState('')
  const [sort, setSort] = React.useState<SortKey>(DEFAULT_SORT)
  const [dir, setDir] = React.useState<SortDir>(DEFAULT_DIR)

  const [createOpen, setCreateOpen] = React.useState(false)
  const [pendingDelete, setPendingDelete] = React.useState<TestRow | null>(null)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)
  const [deleting, setDeleting] = React.useState(false)

  const { items, count, page, pageSize, loading, error, setPage, reload } = useContentList<TestRow>(
    (params, signal) => creatorApi.listTests(params, signal),
    { search, status, exam_type: examType, sort, dir },
    { pageSize: 10 }
  )

  const { busyId, run } = useRowActions(reload)

  const activeFilterCount =
    [search, status, examType].filter(Boolean).length +
    (sort !== DEFAULT_SORT || dir !== DEFAULT_DIR ? 1 : 0)

  const clearFilters = () => {
    setSearch('')
    setStatus('')
    setExamType('')
    setSort(DEFAULT_SORT)
    setDir(DEFAULT_DIR)
  }

  const handleDuplicate = (test: TestRow) =>
    run(
      test.id,
      async () => {
        const response = await creatorApi.duplicateTest(test.id)
        return `${response.questions_copied} questions and ${response.sections_copied} sections copied as a draft.`
      },
      { successTitle: 'Test duplicated' }
    )

  const handleStatusChange = (test: TestRow, next: ContentStatus) =>
    run(
      test.id,
      async () => {
        await creatorApi.updateTest(test.id, { status: next })
      },
      { successTitle: `"${test.title}" marked as ${statusLabel(next)}` }
    )

  const confirmDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await creatorApi.deleteTest(pendingDelete.id)
      toast.success('Test deleted', `"${pendingDelete.title}" was removed.`)
      setPendingDelete(null)
      reload()
    } catch (err) {
      // Kept in the dialog (not a toast) so the reason stays on screen while the
      // creator decides what to do next.
      setDeleteError(err instanceof Error ? err.message : 'We could not delete this test.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ContentToolbar
        idPrefix="tests"
        searchLabel="Search tests by title"
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by test title…"
        filters={[
          {
            key: 'status',
            label: 'Status',
            value: status,
            options: statusOptions(),
            onChange: (value) => setStatus(value as ContentStatus | ''),
          },
          {
            key: 'exam_type',
            label: 'Exam type',
            value: examType,
            options: examTypeOptions(),
            onChange: setExamType,
          },
        ]}
        sort={sort}
        dir={dir}
        sortOptions={TEST_SORT_OPTIONS}
        onSortChange={(value) => setSort(value as SortKey)}
        onDirChange={setDir}
        activeFilterCount={activeFilterCount}
        onClearFilters={clearFilters}
        actions={
          <Button type="button" size="sm" className="min-h-10 gap-1.5" onClick={() => setCreateOpen(true)}>
            <Plus size={16} />
            <span className="hidden sm:inline">New test</span>
            <span className="sm:hidden">New</span>
          </Button>
        }
      />

      {loading ? (
        <ListSkeleton rows={4} />
      ) : error ? (
        <EmptyState
          icon={<AlertTriangle size={20} />}
          title="We could not load your tests"
          description={error}
          action={
            <Button type="button" variant="outline" size="sm" className="min-h-10 gap-1.5" onClick={reload}>
              <RefreshCw size={16} />
              Try again
            </Button>
          }
        />
      ) : items.length === 0 ? (
        activeFilterCount > 0 ? (
          <EmptyState
            icon={<FileText size={20} />}
            title="No tests match those filters"
            description="Try a different search term, or clear the filters to see everything."
            action={
              <Button type="button" variant="outline" size="sm" className="min-h-10" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<FileText size={20} />}
            title="No tests yet"
            description="Create your first test as a draft, then add sections and questions."
            action={
              <Button type="button" size="sm" className="min-h-10 gap-1.5" onClick={() => setCreateOpen(true)}>
                <Plus size={16} />
                New test
              </Button>
            }
          />
        )
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((test) => {
            const locked = !isEditable(test.status)
            const busy = busyId === test.id

            return (
              <li key={test.id}>
                <article className="rounded-xl border border-border bg-card p-4 shadow-xs transition-colors hover:border-primary/40">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-bold text-foreground sm:text-base">
                        <Link
                          href={`/creator/tests/${test.id}`}
                          className="hover:text-primary hover:underline focus-visible:underline"
                        >
                          {test.title}
                        </Link>
                      </h3>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <FileText size={12} aria-hidden="true" />
                          {test.exam_type ?? 'No exam type'}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          {yearRange(test.year_level_min, test.year_level_max)}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Clock size={12} aria-hidden="true" />
                          {test.time_limit_mins ?? '—'} min
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <HelpCircle size={12} aria-hidden="true" />
                          {test.question_count ?? 0} questions
                        </span>
                        {test.is_free ? <Badge variant="success">Free</Badge> : null}
                        <span className="hidden sm:inline">Updated {formatDate(test.updated_at)}</span>
                      </div>
                    </div>
                    <StatusBadge status={test.status} className="shrink-0" />
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <label htmlFor={`test-status-${test.id}`} className="sr-only">
                        Status for {test.title}
                      </label>
                      <Select
                        id={`test-status-${test.id}`}
                        value={test.status}
                        disabled={locked || busy}
                        onChange={(event) => void handleStatusChange(test, event.target.value as ContentStatus)}
                        className="h-9 w-auto min-w-32 text-xs"
                        title={
                          locked
                            ? 'Published and archived content is locked — duplicate it to make changes.'
                            : 'Change status'
                        }
                      >
                        {CONTENT_STATUSES.map((option) => (
                          <option key={option} value={option}>
                            {statusLabel(option)}
                          </option>
                        ))}
                      </Select>
                      {locked ? (
                        <Lock size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                      ) : null}
                    </div>

                    <div className="ml-auto flex items-center gap-1.5">
                      <Button asChild variant="outline" size="sm" className="min-h-9 gap-1.5">
                        <Link href={`/creator/tests/${test.id}`}>
                          <Pencil size={15} />
                          <span className="hidden sm:inline">Edit</span>
                        </Link>
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-9"
                        disabled={busy}
                        onClick={() => void handleDuplicate(test)}
                        aria-label={`Duplicate ${test.title}`}
                        title="Duplicate as a new draft"
                      >
                        {busy ? <Loader2 size={15} className="animate-spin" /> : <Copy size={15} />}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-9 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={busy}
                        onClick={() => {
                          setDeleteError(null)
                          setPendingDelete(test)
                        }}
                        aria-label={`Delete ${test.title}`}
                        title="Delete test"
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  </div>

                  <p className="mt-2 text-xs text-muted-foreground sm:hidden">
                    Updated {formatDate(test.updated_at)}
                  </p>
                </article>
              </li>
            )
          })}
        </ul>
      )}

      {!loading && !error && count > 0 ? (
        <Pagination page={page} pageSize={pageSize} count={count} onChange={setPage} itemLabel="tests" />
      ) : null}

      <CreateTestDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id, title) => {
          setCreateOpen(false)
          toast.success('Test created', `"${title}" is ready — add sections and questions next.`)
          router.push(`/creator/tests/${id}`)
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        busy={deleting}
        error={deleteError}
        title="Delete this test?"
        confirmLabel="Delete test"
        onCancel={() => {
          if (!deleting) {
            setPendingDelete(null)
            setDeleteError(null)
          }
        }}
        onConfirm={confirmDelete}
        description={
          pendingDelete ? (
            <>
              <p>
                <span className="font-semibold text-foreground">{pendingDelete.title}</span> will be permanently
                deleted, together with its sections and its links to questions.
              </p>
              <p>
                Tests that students have already attempted, or that are assigned to a class, cannot be deleted —
                set them to archived instead. The questions themselves are kept.
              </p>
            </>
          ) : null
        }
      />
    </div>
  )
}
