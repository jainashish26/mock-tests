'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  FileQuestion,
  Plus,
  RefreshCw,
  Upload,
} from 'lucide-react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { CreateQuestionDialog } from '@/features/creator/components/CreateQuestionDialog'
import { CreateTestDialog } from '@/features/creator/components/CreateTestDialog'
import { StatusBadge } from '@/features/creator/components/StatusBadge'
import { formatDate, previewText } from '@/features/creator/format'
import { creatorApi, errorMessage } from '@/lib/creator/client'
import { examTypeLabel, questionTypeLabel } from '@/lib/creator/content-meta'
import type { CreatorStats, QuestionRow, StatusCounts, TestRow } from '@/lib/creator/types'

interface DashboardData {
  stats: CreatorStats | null
  recentTests: TestRow[]
  recentQuestions: QuestionRow[]
}

const RECENT_PAGE_SIZE = 5

/**
 * The Quiz Master dashboard: headline counts, the two "start something" actions,
 * and the most recently touched test and question.
 *
 * Everything is loaded from the creator API rather than queried here, so the
 * numbers match the list pages exactly and all authorisation stays server-side.
 */
export function CreatorDashboard() {
  const router = useRouter()
  const toast = useToast()

  const [data, setData] = React.useState<DashboardData>({
    stats: null,
    recentTests: [],
    recentQuestions: [],
  })
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [createTestOpen, setCreateTestOpen] = React.useState(false)
  const [createQuestionOpen, setCreateQuestionOpen] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)

    const [stats, tests, questions] = await Promise.allSettled([
      creatorApi.stats(),
      creatorApi.listTests({ sort: 'updated', dir: 'desc', page: 1, pageSize: RECENT_PAGE_SIZE }),
      creatorApi.listQuestions({ sort: 'updated', dir: 'desc', page: 1, pageSize: RECENT_PAGE_SIZE }),
    ])

    // Stats are the headline; the recent lists are a nice-to-have, so a failure
    // there leaves the counts on screen instead of blanking the whole page.
    if (stats.status === 'rejected') {
      setError(errorMessage(stats.reason, 'We could not load your dashboard.'))
      setLoading(false)
      return
    }

    setData({
      stats: stats.value,
      recentTests: tests.status === 'fulfilled' ? tests.value.data : [],
      recentQuestions: questions.status === 'fulfilled' ? questions.value.data : [],
    })
    setLoading(false)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Quick actions" className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3">
        <Button type="button" className="min-h-12 gap-1.5" onClick={() => setCreateTestOpen(true)}>
          <Plus size={16} />
          New test
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="min-h-12 gap-1.5"
          onClick={() => setCreateQuestionOpen(true)}
        >
          <FileQuestion size={16} />
          New question
        </Button>
        <Button asChild variant="outline" className="min-h-12 gap-1.5">
          <Link href="/creator/tests">
            <BookOpen size={16} />
            Manage tests
          </Link>
        </Button>
        <Button asChild variant="outline" className="min-h-12 gap-1.5">
          <Link href="/creator/upload">
            <Upload size={16} />
            Import CSV
          </Link>
        </Button>
      </section>

      {loading ? (
        <DashboardSkeleton />
      ) : error ? (
        <EmptyState
          icon={<AlertTriangle size={20} />}
          title="We could not load your dashboard"
          description={error}
          action={
            <Button type="button" variant="outline" size="sm" className="min-h-10 gap-1.5" onClick={() => void load()}>
              <RefreshCw size={16} />
              Try again
            </Button>
          }
        />
      ) : (
        <>
          <section aria-label="Content counts" className="grid gap-3 sm:grid-cols-2">
            <CountCard
              title="Tests"
              counts={data.stats?.tests}
              icon={<BookOpen size={18} />}
              href="/creator/tests"
              linkLabel="Manage tests"
              pendingHref="/creator/tests?status=PENDING_APPROVAL"
            />
            <CountCard
              title="Questions"
              counts={data.stats?.questions}
              icon={<FileQuestion size={18} />}
              href="/creator/questions"
              linkLabel="Open question bank"
              pendingHref="/creator/questions?status=PENDING_APPROVAL"
            />
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <RecentList
              title="Recently updated tests"
              emptyTitle="No tests yet"
              emptyDescription="Create a test paper, then attach questions to it."
              viewAllHref="/creator/tests"
              items={data.recentTests}
              renderItem={(test) => (
                <li key={test.id}>
                  <Link
                    href={`/creator/tests/${test.id}`}
                    className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/40 hover:bg-accent/40"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-foreground">{test.title}</span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">
                        {examTypeLabel(test.exam_type)} · {test.question_count ?? 0} questions ·{' '}
                        {formatDate(test.updated_at)}
                      </span>
                    </span>
                    <StatusBadge status={test.status} withHint={false} className="shrink-0" />
                  </Link>
                </li>
              )}
            />

            <RecentList
              title="Recently updated questions"
              emptyTitle="No questions yet"
              emptyDescription="Write one by hand, or import a CSV of them in bulk."
              viewAllHref="/creator/questions"
              items={data.recentQuestions}
              renderItem={(question) => (
                <li key={question.id}>
                  <Link
                    href={`/creator/questions/${question.id}`}
                    className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/40 hover:bg-accent/40"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-foreground">
                        {previewText(question.stem, 70)}
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">
                        {questionTypeLabel(question.type)}
                        {question.subject ? ` · ${question.subject}` : ''} · {formatDate(question.updated_at)}
                      </span>
                    </span>
                    <StatusBadge status={question.status} withHint={false} className="shrink-0" />
                  </Link>
                </li>
              )}
            />
          </section>
        </>
      )}

      <CreateTestDialog
        open={createTestOpen}
        onClose={() => setCreateTestOpen(false)}
        onCreated={(id, title) => {
          setCreateTestOpen(false)
          toast.success('Test created', `"${title}" is ready — add sections and questions next.`)
          router.push(`/creator/tests/${id}`)
        }}
      />

      <CreateQuestionDialog
        open={createQuestionOpen}
        onClose={() => setCreateQuestionOpen(false)}
        onCreated={(id, stem) => {
          setCreateQuestionOpen(false)
          toast.success('Question created', previewText(stem, 60))
          router.push(`/creator/questions/${id}`)
        }}
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Presentation helpers                                                        */
/* -------------------------------------------------------------------------- */

function Stat({ label, value }: { label: string; value?: number }) {
  return (
    <div className="rounded-lg bg-muted/60 px-2 py-1.5 text-center">
      <dt className="text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="text-sm font-bold tabular-nums text-foreground">{value ?? 0}</dd>
    </div>
  )
}

interface CountCardProps {
  title: string
  counts?: StatusCounts
  icon: React.ReactNode
  href: string
  linkLabel: string
  pendingHref?: string
}

function CountCard({ title, counts, icon, href, linkLabel, pendingHref }: CountCardProps) {
  const pending = counts?.pending ?? 0

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {icon}
          </span>
          <h2 className="text-sm font-bold tracking-wide text-muted-foreground uppercase">{title}</h2>
        </div>
        <p className="text-3xl font-extrabold tabular-nums text-foreground">{counts?.total ?? 0}</p>
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Draft" value={counts?.draft} />
        <Stat label="Pending" value={pending} />
        <Stat label="Published" value={counts?.published} />
        <Stat label="Archived" value={counts?.archived} />
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{counts?.editable ?? 0}</span> still editable
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {pending > 0 && pendingHref ? (
            <Button asChild variant="outline" size="sm" className="min-h-9 gap-1.5">
              <Link href={pendingHref}>
                <Badge variant="warning">{pending}</Badge>
                awaiting review
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="ghost" size="sm" className="min-h-9 gap-1">
            <Link href={href}>
              {linkLabel}
              <ArrowRight size={14} />
            </Link>
          </Button>
        </div>
      </div>
    </article>
  )
}

interface RecentListProps<T> {
  title: string
  items: T[]
  renderItem: (item: T) => React.ReactNode
  emptyTitle: string
  emptyDescription: string
  viewAllHref: string
}

function RecentList<T>({
  title,
  items,
  renderItem,
  emptyTitle,
  emptyDescription,
  viewAllHref,
}: RecentListProps<T>) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-bold text-foreground">{title}</h2>
        <Button asChild variant="ghost" size="sm" className="min-h-9 gap-1 text-muted-foreground">
          <Link href={viewAllHref}>
            View all
            <ArrowRight size={14} />
          </Link>
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState compact icon={<FileQuestion size={16} />} title={emptyTitle} description={emptyDescription} />
      ) : (
        <ul className="flex flex-col gap-2">{items.map(renderItem)}</ul>
      )}
    </section>
  )
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Loading dashboard">
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1].map((card) => (
          <div key={card} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-9 w-32" />
              <Skeleton className="size-10 rounded-lg" />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-11" />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {[0, 1].map((column) => (
          <div key={column} className="flex flex-col gap-2">
            <Skeleton className="h-5 w-40" />
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-16 rounded-lg" />
            ))}
          </div>
        ))}
      </div>

      <span className="sr-only">Loading…</span>
    </div>
  )
}
