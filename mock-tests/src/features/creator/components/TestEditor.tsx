'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  Copy,
  FileQuestion,
  Layers,
  Loader2,
  Lock,
  RefreshCw,
  Save,
  Send,
  Trash2,
} from 'lucide-react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Checkbox, Field, Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Skeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { ConfirmDialog } from '@/features/creator/components/ConfirmDialog'
import { StatusBadge } from '@/features/creator/components/StatusBadge'
import {
  EDITABLE_STATUS_OPTIONS,
  EXAM_TYPE_SELECT_OPTIONS,
  STATUS_OPTIONS,
  YEAR_LEVELS,
} from '@/features/creator/options'
import { formatDate, previewText, yearRange } from '@/features/creator/format'
import { creatorApi, errorMessage } from '@/lib/creator/client'
import { examTypeLabel, questionTypeLabel, statusLabel } from '@/lib/creator/content-meta'
import { Section } from '@/features/creator/components/CollapsibleSection'
import type { ContentStatus } from '@/lib/creator/content-meta'
import type { TestDetail, TestInput, TestRow } from '@/lib/creator/types'

/**
 * Test editor for `/creator/tests/:id`.
 *
 * Edits the test "envelope" (title, exam type, year band, time limit, free flag,
 * status) through `PUT /api/creator/tests/:id`, and renders the sections and
 * attached questions from the detail endpoint read-only: there is no creator API
 * for section or mapping CRUD, and offering writes the server would reject is
 * worse than saying so. Questions are attached by the CSV importer (`ExamID`
 * column) or by an admin.
 */

interface TestFormState {
  title: string
  exam_type: string
  year_level_min: string
  year_level_max: string
  time_limit_mins: string
  is_free: boolean
  status: ContentStatus
}

function toFormState(test: TestRow | null): TestFormState {
  return {
    title: test?.title ?? '',
    exam_type: test?.exam_type ?? 'BENCHMARK',
    year_level_min: String(test?.year_level_min ?? YEAR_LEVELS[0]),
    year_level_max: String(test?.year_level_max ?? YEAR_LEVELS[0]),
    time_limit_mins: String(test?.time_limit_mins ?? 60),
    is_free: test?.is_free ?? false,
    status: (test?.status ?? 'DRAFT') as ContentStatus,
  }
}

function toPayload(form: TestFormState): TestInput {
  return {
    title: form.title.trim(),
    exam_type: form.exam_type,
    year_level_min: Number(form.year_level_min),
    year_level_max: Number(form.year_level_max),
    time_limit_mins: Number(form.time_limit_mins),
    is_free: form.is_free,
    status: form.status,
  }
}

export function TestEditor({ testId }: { testId: string }) {
  const router = useRouter()
  const toast = useToast()
  const isNew = testId === 'new'

  const [detail, setDetail] = React.useState<TestDetail | null>(null)
  const [form, setForm] = React.useState<TestFormState>(() => toFormState(null))
  const [loading, setLoading] = React.useState(!isNew)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [duplicating, setDuplicating] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)
  const [dirty, setDirty] = React.useState(false)

  const test = detail?.test ?? null
  /** Published/archived tests are locked by the API, so the form is read-only. */
  const locked = detail ? !detail.editable : false

  const load = React.useCallback(async () => {
    if (isNew) return
    setLoading(true)
    setLoadError(null)
    try {
      const response = await creatorApi.getTest(testId)
      setDetail(response)
      setForm(toFormState(response.test))
      setDirty(false)
    } catch (err) {
      setLoadError(errorMessage(err, 'We could not load that test.'))
    } finally {
      setLoading(false)
    }
  }, [isNew, testId])

  React.useEffect(() => {
    void load()
  }, [load])

  // Unsaved edits should not vanish on an accidental reload or back swipe.
  React.useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const update = <K extends keyof TestFormState>(key: K, value: TestFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    setDirty(true)
  }

  const save = async (overrides: Partial<TestFormState> = {}, successMessage?: string) => {
    const nextForm = { ...form, ...overrides }

    // Caught here as well as server-side so the creator sees it next to the field.
    if (Number(nextForm.year_level_max) < Number(nextForm.year_level_min)) {
      setSaveError('The maximum year level cannot be lower than the minimum.')
      return false
    }

    setSaving(true)
    setSaveError(null)

    try {
      if (isNew) {
        const response = await creatorApi.createTest(toPayload(nextForm))
        setDirty(false)
        toast.success('Test created', successMessage)
        router.replace(`/creator/tests/${response.id}`)
      } else {
        await creatorApi.updateTest(testId, toPayload(nextForm))
        setForm(nextForm)
        setDirty(false)
        toast.success('Test saved', successMessage)
        await load()
      }
      return true
    } catch (err) {
      setSaveError(errorMessage(err))
      return false
    } finally {
      setSaving(false)
    }
  }

  const handleDuplicate = async () => {
    if (!test) return
    setDuplicating(true)
    try {
      const response = await creatorApi.duplicateTest(test.id)
      toast.success(
        'Test duplicated',
        `${response.questions_copied} questions and ${response.sections_copied} sections copied as a draft.`
      )
      router.push(`/creator/tests/${response.id}`)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setDuplicating(false)
    }
  }

  const handleDelete = async () => {
    if (!test) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await creatorApi.deleteTest(test.id)
      toast.success('Test deleted', `"${test.title}" was removed.`)
      setDeleteOpen(false)
      router.push('/creator/tests')
    } catch (err) {
      setDeleteError(errorMessage(err))
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4" role="status" aria-label="Loading test">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
        <span className="sr-only">Loading…</span>
      </div>
    )
  }

  if (loadError) {
    return (
      <EmptyState
        icon={<AlertTriangle size={20} />}
        title="We could not open that test"
        description={loadError}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-10 gap-1.5"
              onClick={() => void load()}
            >
              <RefreshCw size={16} />
              Try again
            </Button>
            <Button asChild variant="ghost" size="sm" className="min-h-10 gap-1.5">
              <Link href="/creator/tests">
                <ArrowLeft size={16} />
                Back to my tests
              </Link>
            </Button>
          </div>
        }
      />
    )
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-xs">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="-ml-2 gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <Link href="/creator/tests">
                <ArrowLeft size={16} />
                My tests
              </Link>
            </Button>
            <h1 className="mt-1 text-lg font-extrabold break-words text-foreground sm:text-xl">
              {isNew ? 'New test' : form.title || 'Untitled test'}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>{examTypeLabel(form.exam_type)}</span>
              <span>· {yearRange(Number(form.year_level_min), Number(form.year_level_max))}</span>
              <span>· {form.time_limit_mins || '—'} min</span>
              {test ? <span>· {detail?.questions.length ?? 0} questions</span> : null}
              {test ? <span>· Updated {formatDate(test.updated_at)}</span> : null}
            </p>
          </div>
          <StatusBadge status={isNew ? 'DRAFT' : test?.status} className="shrink-0" />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button type="submit" className="min-h-11 gap-1.5" disabled={saving || locked}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {saving ? 'Saving…' : isNew ? 'Create test' : 'Save changes'}
          </Button>

          {!locked && form.status === 'DRAFT' ? (
            <Button
              type="button"
              variant="secondary"
              className="min-h-11 gap-1.5"
              disabled={saving}
              onClick={() => void save({ status: 'PENDING_APPROVAL' }, 'Sent to a moderator for review.')}
            >
              <Send size={16} />
              Submit for approval
            </Button>
          ) : null}

          {!isNew ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-11"
                disabled={duplicating}
                onClick={() => void handleDuplicate()}
                aria-label="Duplicate test"
                title="Duplicate as a new draft"
              >
                {duplicating ? <Loader2 size={16} className="animate-spin" /> : <Copy size={16} />}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-11 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={locked}
                onClick={() => {
                  setDeleteError(null)
                  setDeleteOpen(true)
                }}
                aria-label="Delete test"
                title={locked ? 'Published and archived tests cannot be deleted' : 'Delete test'}
              >
                <Trash2 size={16} />
              </Button>
            </>
          ) : null}

          {dirty ? <Badge variant="warning">Unsaved changes</Badge> : null}
        </div>
      </div>

      {locked ? (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-50 p-4 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between dark:bg-amber-950/50 dark:text-amber-50">
          <p className="flex items-start gap-2">
            <Lock size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              This test is <strong>{statusLabel(test?.status).toLowerCase()}</strong>, so it is read-only.
              Duplicate it to create an editable draft copy.
            </span>
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-10 shrink-0 gap-1.5"
            disabled={duplicating}
            onClick={() => void handleDuplicate()}
          >
            <Copy size={15} />
            Duplicate
          </Button>
        </div>
      ) : null}

      {saveError ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
        >
          {saveError}
        </p>
      ) : null}

      <Section title="Test details" description="The envelope students see before they start.">
        <Field label="Title" htmlFor="test-title" required>
          <Input
            id="test-title"
            value={form.title}
            disabled={locked}
            onChange={(event) => update('title', event.target.value)}
            required
            minLength={3}
            maxLength={200}
            placeholder="Year 5 NAPLAN Numeracy Practice Test 2"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Exam type" htmlFor="test-exam-type" required>
            <Select
              id="test-exam-type"
              value={form.exam_type}
              disabled={locked}
              onChange={(event) => update('exam_type', event.target.value)}
              required
            >
              {EXAM_TYPE_SELECT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Time limit (minutes)" htmlFor="test-time-limit" required>
            <Input
              id="test-time-limit"
              type="number"
              min={1}
              max={600}
              inputMode="numeric"
              value={form.time_limit_mins}
              disabled={locked}
              onChange={(event) => update('time_limit_mins', event.target.value)}
              required
            />
          </Field>

          <Field label="Minimum year level" htmlFor="test-year-min" required>
            <Select
              id="test-year-min"
              value={form.year_level_min}
              disabled={locked}
              onChange={(event) => update('year_level_min', event.target.value)}
              required
            >
              {YEAR_LEVELS.map((year) => (
                <option key={year} value={year}>
                  Year {year}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Maximum year level" htmlFor="test-year-max" required>
            <Select
              id="test-year-max"
              value={form.year_level_max}
              disabled={locked}
              onChange={(event) => update('year_level_max', event.target.value)}
              required
            >
              {YEAR_LEVELS.map((year) => (
                <option key={year} value={year}>
                  Year {year}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Status"
            htmlFor="test-status"
            hint={
              locked
                ? 'Locked while published or archived.'
                : 'Creators move a test between draft and pending approval; a moderator publishes it.'
            }
          >
            <Select
              id="test-status"
              value={form.status}
              disabled={locked || saving}
              onChange={(event) => update('status', event.target.value as ContentStatus)}
            >
              {(locked ? STATUS_OPTIONS : EDITABLE_STATUS_OPTIONS).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          <label className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3 sm:self-end">
            <Checkbox
              name="is_free"
              checked={form.is_free}
              disabled={locked}
              onChange={(event) => update('is_free', event.target.checked)}
              className="mt-0.5"
            />
            <span className="text-sm">
              <span className="font-semibold text-foreground">Free test</span>
              <span className="block text-xs text-muted-foreground">
                Available to every student without a purchase or entitlement.
              </span>
            </span>
          </label>
        </div>
      </Section>

      {!isNew ? (
        <>
          <Section
            title="Sections"
            description="Sections group questions inside the paper and can carry their own time limit."
            aside={<Badge variant="muted">{detail?.sections.length ?? 0}</Badge>}
            defaultOpen={(detail?.sections.length ?? 0) > 0}
          >
            {detail && detail.sections.length > 0 ? (
              <ol className="flex flex-col gap-2">
                {detail.sections.map((section) => (
                  <li
                    key={section.id}
                    className="flex items-center gap-3 rounded-lg border border-border bg-background p-3"
                  >
                    <Layers size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-foreground">{section.name}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        Order {section.section_order} · {section.question_count} questions
                        {section.time_limit_mins ? ` · ${section.time_limit_mins} min` : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState
                compact
                icon={<Layers size={16} />}
                title="No sections yet"
                description="Sections are created when questions are imported with a section name, or by an admin."
              />
            )}
          </Section>

          <Section
            title="Questions"
            description="Attached to this test. Open one to edit its content."
            aside={<Badge variant="muted">{detail?.questions.length ?? 0}</Badge>}
          >
            {detail && detail.questions.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {detail.questions.map((entry, index) => (
                  <li key={entry.question_id}>
                    <Link
                      href={`/creator/questions/${entry.question_id}`}
                      className="flex items-start gap-3 rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/40"
                    >
                      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold tabular-nums text-muted-foreground">
                        {entry.question_order ?? index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold break-words text-foreground">
                          {previewText(entry.question?.stem, 100)}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <span>{questionTypeLabel(entry.question?.type)}</span>
                          {entry.section_name ? <span>· {entry.section_name}</span> : null}
                          {entry.base_difficulty ? <span>· Base difficulty {entry.base_difficulty}</span> : null}
                          {entry.question?.year_level ? <span>· Year {entry.question.year_level}</span> : null}
                        </span>
                      </span>
                      <StatusBadge status={entry.question?.status} withHint={false} className="shrink-0" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                compact
                icon={<FileQuestion size={16} />}
                title="No questions attached"
                description="Import a CSV with this test's ID in the ExamID column to attach questions in bulk."
                action={
                  <Button asChild variant="outline" size="sm" className="min-h-10">
                    <Link href="/creator/upload">Import CSV</Link>
                  </Button>
                }
              />
            )}

            {test ? (
              <p className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
                <Clock size={13} aria-hidden="true" />
                Test ID for CSV imports:
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.6875rem] text-foreground select-all">
                  {test.id}
                </code>
              </p>
            ) : null}
          </Section>
        </>
      ) : null}

      {/* Sticky on phones so "Save" stays within thumb reach after a long scroll. */}
      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:flex-row sm:justify-end sm:rounded-xl sm:border sm:px-4">
        <Button asChild type="button" variant="ghost" className="min-h-11 w-full sm:w-auto">
          <Link href="/creator/tests">Cancel</Link>
        </Button>
        {!locked && form.status === 'DRAFT' ? (
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 w-full gap-1.5 sm:w-auto"
            disabled={saving}
            onClick={() => void save({ status: 'PENDING_APPROVAL' }, 'Sent to a moderator for review.')}
          >
            <Send size={16} />
            Submit for approval
          </Button>
        ) : null}
        <Button type="submit" className="min-h-11 w-full gap-1.5 sm:w-auto" disabled={saving || locked}>
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {saving ? 'Saving…' : isNew ? 'Create test' : 'Save changes'}
        </Button>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        busy={deleting}
        error={deleteError}
        title="Delete this test?"
        confirmLabel="Delete test"
        onCancel={() => {
          if (!deleting) {
            setDeleteOpen(false)
            setDeleteError(null)
          }
        }}
        onConfirm={handleDelete}
        description={
          <>
            <p>
              <span className="font-semibold text-foreground">{test?.title}</span> will be permanently deleted,
              together with its {detail?.sections.length ?? 0} section
              {(detail?.sections.length ?? 0) === 1 ? '' : 's'} and its links to {detail?.questions.length ?? 0}{' '}
              question{(detail?.questions.length ?? 0) === 1 ? '' : 's'}.
            </p>
            <p>
              The questions themselves are kept. Tests that students have already attempted, or that are assigned
              to a class, cannot be deleted — archive them instead.
            </p>
          </>
        }
      />
    </form>
  )
}
