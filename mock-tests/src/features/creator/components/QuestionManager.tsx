'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  Copy,
  FileQuestion,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { Pagination } from '@/components/ui/Pagination'
import { Select } from '@/components/ui/Select'
import { useToast } from '@/components/ui/Toast'
import { ConfirmDialog } from '@/features/creator/components/ConfirmDialog'
import { ContentToolbar } from '@/features/creator/components/ContentToolbar'
import { CreateQuestionDialog } from '@/features/creator/components/CreateQuestionDialog'
import { StatusBadge } from '@/features/creator/components/StatusBadge'
import { useContentList } from '@/features/creator/hooks/use-content-list'
import { useRowActions } from '@/features/creator/hooks/use-row-actions'
import {
  DEFAULT_DIR,
  DEFAULT_SORT,
  examTypeOptions,
  QUESTION_SORT_OPTIONS,
  questionTypeOptions,
  statusOptions,
  yearLevelOptions,
} from '@/features/creator/options'
import { formatDate, previewText } from '@/features/creator/format'
import { creatorApi } from '@/lib/creator/client'
import { CONTENT_STATUSES, isEditable, questionTypeLabel, statusLabel } from '@/lib/creator/content-meta'
import type { ContentStatus, QuestionType } from '@/lib/creator/content-meta'
import type { QuestionRow, SortDir, SortKey } from '@/lib/creator/types'

/**
 * The "Question bank" workspace: search, filter, sort, page, create, duplicate,
 * change status and delete questions through `/api/creator/questions`.
 *
 * Deleting a question detaches it from the caller's editable tests and refuses
 * while it is still attached to a published/archived test; that refusal is
 * surfaced verbatim in the confirm dialog.
 */
export function QuestionManager({ initialStatus }: { initialStatus?: ContentStatus }) {
  const router = useRouter()
  const toast = useToast()

  const [search, setSearch] = React.useState('')
  const [status, setStatus] = React.useState<ContentStatus | ''>(initialStatus ?? '')
  const [type, setType] = React.useState<QuestionType | ''>('')
  const [examType, setExamType] = React.useState('')
  const [yearLevel, setYearLevel] = React.useState('')
  const [sort, setSort] = React.useState<SortKey>(DEFAULT_SORT)
  const [dir, setDir] = React.useState<SortDir>(DEFAULT_DIR)

  const [createOpen, setCreateOpen] = React.useState(false)
  const [pendingDelete, setPendingDelete] = React.useState<QuestionRow | null>(null)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)
  const [deleting, setDeleting] = React.useState(false)

  const { items, count, page, pageSize, loading, error, setPage, reload } = useContentList<QuestionRow>(
    (params, signal) => creatorApi.listQuestions(params, signal),
    {
      search,
      status,
      type,
      exam_type: examType,
      year_level: yearLevel === '' ? '' : Number(yearLevel),
      sort,
      dir,
    },
    { pageSize: 10 }
  )

  const { busyId, run } = useRowActions(reload)

  const activeFilterCount =
    [search, status, type, examType, yearLevel].filter(Boolean).length +
    (sort !== DEFAULT_SORT || dir !== DEFAULT_DIR ? 1 : 0)

  const clearFilters = () => {
    setSearch('')
    setStatus('')
    setType('')
    setExamType('')
    setYearLevel('')
    setSort(DEFAULT_SORT)
    setDir(DEFAULT_DIR)
  }

  const handleDuplicate = (question: QuestionRow) =>
    run(
      question.id,
      async () => {
        await creatorApi.duplicateQuestion(question.id)
        return 'A draft copy was added to your question bank.'
      },
      { successTitle: 'Question duplicated' }
    )

  const handleStatusChange = (question: QuestionRow, next: ContentStatus) =>
    run(
      question.id,
      async () => {
        await creatorApi.updateQuestion(question.id, { status: next })
      },
      { successTitle: `Marked as ${statusLabel(next)}` }
    )

  const confirmDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    setDeleteError(null)
    try {
      const result = await creatorApi.deleteQuestion(pendingDelete.id)
      toast.success(
        'Question deleted',
        result.detached_from > 0
          ? `Removed from ${result.detached_from} editable test${result.detached_from === 1 ? '' : 's'}.`
          : undefined
      )
      setPendingDelete(null)
      reload()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'We could not delete this question.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ContentToolbar
        idPrefix="questions"
        searchLabel="Search questions by text, topic or subject"
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search question text, topic or subject…"
        filters={[
          {
            key: 'status',
            label: 'Status',
            value: status,
            options: statusOptions(),
            onChange: (value) => setStatus(value as ContentStatus | ''),
          },
          {
            key: 'type',
            label: 'Type',
            value: type,
            options: questionTypeOptions(),
            onChange: (value) => setType(value as QuestionType | ''),
          },
          {
            key: 'exam_type',
            label: 'Exam type',
            value: examType,
            options: examTypeOptions(),
            onChange: setExamType,
          },
          {
            key: 'year_level',
            label: 'Year level',
            value: yearLevel,
            options: yearLevelOptions(),
            onChange: setYearLevel,
          },
        ]}
        sort={sort}
        dir={dir}
        sortOptions={QUESTION_SORT_OPTIONS}
        onSortChange={(value) => setSort(value as SortKey)}
        onDirChange={setDir}
        activeFilterCount={activeFilterCount}
        onClearFilters={clearFilters}
        actions={
          <Button type="button" size="sm" className="min-h-10 gap-1.5" onClick={() => setCreateOpen(true)}>
            <Plus size={16} />
            <span className="hidden sm:inline">New question</span>
            <span className="sm:hidden">New</span>
          </Button>
        }
      />

      {loading ? (
        <ListSkeleton rows={5} />
      ) : error ? (
        <EmptyState
          icon={<AlertTriangle size={20} />}
          title="We could not load your questions"
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
            icon={<FileQuestion size={20} />}
            title="No questions match those filters"
            description="Try a different search term, or clear the filters to see your whole bank."
            action={
              <Button type="button" variant="outline" size="sm" className="min-h-10" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<FileQuestion size={20} />}
            title="Your question bank is empty"
            description="Write a question one at a time, or bulk-import a CSV of them."
            action={
              <>
                <Button type="button" size="sm" className="min-h-10 gap-1.5" onClick={() => setCreateOpen(true)}>
                  <Plus size={16} />
                  New question
                </Button>
                <Button asChild variant="outline" size="sm" className="min-h-10">
                  <Link href="/creator/upload">Import CSV</Link>
                </Button>
              </>
            }
          />
        )
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((question) => {
            const locked = !isEditable(question.status)
            const busy = busyId === question.id

            return (
              <li key={question.id}>
                <article className="rounded-xl border border-border bg-card p-4 shadow-xs transition-colors hover:border-primary/40">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-bold break-words text-foreground sm:text-base">
                        <Link
                          href={`/creator/questions/${question.id}`}
                          className="hover:text-primary hover:underline focus-visible:underline"
                        >
                          {previewText(question.stem, 120)}
                        </Link>
                      </h3>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">
                          {questionTypeLabel(question.type)}
                        </span>
                        {question.subject ? <span>{question.subject}</span> : null}
                        {question.topic ? <span className="truncate">{question.topic}</span> : null}
                        {question.year_level ? <span>Year {question.year_level}</span> : null}
                        {question.difficulty ? <span>Difficulty {question.difficulty}/5</span> : null}
                        <span className="hidden sm:inline">Updated {formatDate(question.updated_at)}</span>
                      </div>
                    </div>
                    <StatusBadge status={question.status} className="shrink-0" />
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <label htmlFor={`question-status-${question.id}`} className="sr-only">
                        Status for {previewText(question.stem, 40)}
                      </label>
                      <Select
                        id={`question-status-${question.id}`}
                        value={question.status}
                        disabled={locked || busy}
                        onChange={(event) => void handleStatusChange(question, event.target.value as ContentStatus)}
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
                        <Link href={`/creator/questions/${question.id}`}>
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
                        onClick={() => void handleDuplicate(question)}
                        aria-label="Duplicate this question"
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
                          setPendingDelete(question)
                        }}
                        aria-label="Delete this question"
                        title="Delete question"
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  </div>

                  <p className="mt-2 text-xs text-muted-foreground sm:hidden">
                    Updated {formatDate(question.updated_at)}
                  </p>
                </article>
              </li>
            )
          })}
        </ul>
      )}

      {!loading && !error && count > 0 ? (
        <Pagination page={page} pageSize={pageSize} count={count} onChange={setPage} itemLabel="questions" />
      ) : null}

      <CreateQuestionDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id, stem) => {
          setCreateOpen(false)
          toast.success('Question created', previewText(stem, 60))
          router.push(`/creator/questions/${id}`)
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        busy={deleting}
        error={deleteError}
        title="Delete this question?"
        confirmLabel="Delete question"
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
              <p className="break-words">
                <span className="font-semibold text-foreground">
                  {previewText(pendingDelete.stem, 120)}
                </span>{' '}
                will be permanently deleted.
              </p>
              <p>
                It is first removed from any draft test you own. If it is still attached to a published or
                archived test — or to someone else&apos;s test — the delete is refused and it must be removed
                there first.
              </p>
            </>
          ) : null
        }
      />
    </div>
  )
}
