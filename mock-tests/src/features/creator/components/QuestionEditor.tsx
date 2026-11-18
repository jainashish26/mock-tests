'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  ArrowLeft,
  Copy,
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
import { Checkbox, Field, Input, Textarea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Skeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { ConfirmDialog } from '@/features/creator/components/ConfirmDialog'
import { Section } from '@/features/creator/components/CollapsibleSection'
import { StatusBadge } from '@/features/creator/components/StatusBadge'
import {
  EDITABLE_STATUS_OPTIONS,
  ENGLISH_SKILLS,
  EXAM_TYPE_SELECT_OPTIONS,
  MATHS_SKILLS,
  QUESTION_TYPE_OPTIONS,
  STATUS_OPTIONS,
  SUBJECT_SUGGESTIONS,
  YEAR_LEVELS,
  skillLabel,
} from '@/features/creator/options'
import type { SkillField } from '@/features/creator/options'
import { formatDate, previewText } from '@/features/creator/format'
import { creatorApi, errorMessage } from '@/lib/creator/client'
import { questionTypeLabel, statusLabel } from '@/lib/creator/content-meta'
import type { QuestionDetail, QuestionInput, QuestionRow } from '@/lib/creator/types'
import { cn } from '@/lib/utils'

/**
 * Full question editor for `/creator/questions/:id`.
 *
 * Replaces the old inline-styled form in `features/cms`: it loads through the
 * creator API (so ownership and status rules are enforced server-side), keeps
 * every field the API accepts, and reflects the status protections in the UI -
 * published/archived questions render read-only with a "duplicate to edit" path,
 * because that is exactly what the API will allow.
 */

/** Text columns: sent as trimmed strings, or null when blank. */
const TEXT_KEYS = [
  'stem',
  'comprehension_text',
  'image_url',
  'exam_type',
  'exam_id',
  'exam_section',
  'subject',
  'topic',
  'sub_topic',
  'answer_a',
  'answer_b',
  'answer_c',
  'answer_d',
  'answer_e',
  'correct_answer',
  'explanation',
  'explanation_media',
  'tags',
] as const

/** Integer columns (`intOr` on the server). */
const INT_KEYS = ['year_level', 'difficulty', 'average_time_seconds', 'correct_answer_score'] as const

/** Float columns (`floatOr` on the server), including every skill weighting. */
const FLOAT_KEYS = ['discrimination_index'] as const

const MCQ_LETTERS = ['A', 'B', 'C', 'D', 'E'] as const

type FormState = Record<string, string>

/** Turns a DB row into flat string form state (inputs are all strings). */
function toFormState(question: QuestionRow | null): FormState {
  const state: FormState = {
    type: question?.type ?? 'MCQ',
    status: question?.status ?? 'DRAFT',
    is_active: question?.is_active === false ? 'false' : 'true',
  }

  for (const key of TEXT_KEYS) {
    const value = question?.[key as keyof QuestionRow]
    state[key] = Array.isArray(value) ? value.join(', ') : value === null || value === undefined ? '' : String(value)
  }
  for (const key of [...INT_KEYS, ...FLOAT_KEYS]) {
    const value = question?.[key as keyof QuestionRow]
    state[key] = value === null || value === undefined ? '' : String(value)
  }
  for (const key of MATHS_SKILLS.concat(ENGLISH_SKILLS)) {
    const value = question?.[key as keyof QuestionRow]
    state[key] = value === null || value === undefined ? '' : String(value)
  }

  return state
}

/** Converts form state into the JSON body `questionPayload()` expects. */
function toPayload(form: FormState): QuestionInput {
  const payload: Record<string, unknown> = {
    type: form.type,
    status: form.status,
    is_active: form.is_active !== 'false',
  }

  for (const key of TEXT_KEYS) {
    const value = (form[key] ?? '').trim()
    payload[key] = value === '' ? null : value
  }
  for (const key of [...INT_KEYS, ...FLOAT_KEYS, ...MATHS_SKILLS, ...ENGLISH_SKILLS]) {
    const raw = (form[key] ?? '').trim()
    payload[key] = raw === '' ? null : Number(raw)
  }

  return payload as QuestionInput
}

const blankForm = (): FormState => ({
  ...toFormState(null),
  year_level: String(YEAR_LEVELS[0]),
  difficulty: '2',
  exam_type: 'NAPLAN_STYLE_NUMERACY',
})

export function QuestionEditor({ questionId }: { questionId: string }) {
  const router = useRouter()
  const toast = useToast()
  const isNew = questionId === 'new'

  const [detail, setDetail] = React.useState<QuestionDetail | null>(null)
  const [form, setForm] = React.useState<FormState>(blankForm)
  const [loading, setLoading] = React.useState(!isNew)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [duplicating, setDuplicating] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)
  const [dirty, setDirty] = React.useState(false)

  const question = detail?.question ?? null
  /** Published/archived rows are locked by the API, so the form is read-only. */
  const locked = detail ? !detail.editable : false
  const isMcq = form.type === 'MCQ'

  const load = React.useCallback(async () => {
    if (isNew) return
    setLoading(true)
    setLoadError(null)
    try {
      const response = await creatorApi.getQuestion(questionId)
      setDetail(response)
      setForm(toFormState(response.question))
      setDirty(false)
    } catch (err) {
      setLoadError(errorMessage(err, 'We could not load that question.'))
    } finally {
      setLoading(false)
    }
  }, [isNew, questionId])

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

  const update = (key: string, value: string) => {
    setForm((current) => ({ ...current, [key]: value }))
    setDirty(true)
  }

  const save = async (overrides: FormState = {}, successMessage?: string) => {
    const nextForm = { ...form, ...overrides }
    setSaving(true)
    setSaveError(null)

    try {
      const payload = toPayload(nextForm)
      if (isNew) {
        const response = await creatorApi.createQuestion(payload)
        setDirty(false)
        toast.success('Question created', successMessage)
        router.replace(`/creator/questions/${response.id}`)
      } else {
        await creatorApi.updateQuestion(questionId, payload)
        setForm(nextForm)
        setDirty(false)
        toast.success('Changes saved', successMessage)
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
    if (!question) return
    setDuplicating(true)
    try {
      const response = await creatorApi.duplicateQuestion(question.id)
      toast.success('Question duplicated', 'A draft copy was created for you to edit.')
      router.push(`/creator/questions/${response.id}`)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setDuplicating(false)
    }
  }

  const handleDelete = async () => {
    if (!question) return
    setDeleting(true)
    setDeleteError(null)
    try {
      const result = await creatorApi.deleteQuestion(question.id)
      toast.success(
        'Question deleted',
        result.detached_from > 0
          ? `Also removed from ${result.detached_from} editable test${result.detached_from === 1 ? '' : 's'}.`
          : undefined
      )
      setDeleteOpen(false)
      router.push('/creator/questions')
    } catch (err) {
      setDeleteError(errorMessage(err))
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4" role="status" aria-label="Loading question">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
        <span className="sr-only">Loading…</span>
      </div>
    )
  }

  if (loadError) {
    return (
      <EmptyState
        icon={<AlertTriangle size={20} />}
        title="We could not open that question"
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
              <Link href="/creator/questions">
                <ArrowLeft size={16} />
                Back to question bank
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
              <Link href="/creator/questions">
                <ArrowLeft size={16} />
                Question bank
              </Link>
            </Button>
            <h1 className="mt-1 text-lg font-extrabold break-words text-foreground sm:text-xl">
              {isNew ? 'New question' : previewText(question?.stem, 80)}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{questionTypeLabel(form.type)}</span>
              {form.subject ? <span>· {form.subject}</span> : null}
              {!isNew && question ? <span>· Updated {formatDate(question.updated_at)}</span> : null}
            </p>
          </div>
          <StatusBadge status={isNew ? 'DRAFT' : question?.status} className="shrink-0" />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button type="submit" className="min-h-11 gap-1.5" disabled={saving || locked}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {saving ? 'Saving…' : isNew ? 'Create question' : 'Save changes'}
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
                aria-label="Duplicate question"
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
                aria-label="Delete question"
                title={locked ? 'Published and archived questions cannot be deleted' : 'Delete question'}
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
              This question is <strong>{statusLabel(question?.status).toLowerCase()}</strong>, so it is
              read-only. Duplicate it to create an editable draft copy.
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

      <Section title="Question content" description="What the student reads.">
        <Field label="Question type" htmlFor="question-type" required>
          <Select
            id="question-type"
            value={form.type}
            disabled={locked}
            onChange={(event) => update('type', event.target.value)}
            required
          >
            {QUESTION_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Question text"
          htmlFor="question-stem"
          required
          hint="The stem shown to the student. Keep any shared passage in the comprehension field below."
        >
          <Textarea
            id="question-stem"
            rows={5}
            value={form.stem}
            disabled={locked}
            onChange={(event) => update('stem', event.target.value)}
            required
          />
        </Field>

        <Field
          label="Comprehension / passage text"
          htmlFor="question-passage"
          hint="Shown above the question for reading-comprehension items."
        >
          <Textarea
            id="question-passage"
            rows={4}
            value={form.comprehension_text}
            disabled={locked}
            onChange={(event) => update('comprehension_text', event.target.value)}
          />
        </Field>

        <Field label="Question image URL" htmlFor="question-image">
          <Input
            id="question-image"
            type="url"
            inputMode="url"
            placeholder="https://…/diagram.png"
            value={form.image_url}
            disabled={locked}
            onChange={(event) => update('image_url', event.target.value)}
          />
        </Field>
      </Section>

      <Section
        title="Answers"
        description={isMcq ? 'Tick the correct option.' : 'The expected answer and how it is marked.'}
      >
        {isMcq ? (
          <fieldset className="flex flex-col gap-3" disabled={locked}>
            <legend className="mb-1 text-xs font-semibold text-muted-foreground">
              Options (tick the correct one)
            </legend>
            {MCQ_LETTERS.map((letter) => {
              const key = `answer_${letter.toLowerCase()}`
              return (
                <div
                  key={letter}
                  className={cn(
                    'flex items-start gap-3 rounded-lg border p-3 transition-colors',
                    form.correct_answer === letter
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-background'
                  )}
                >
                  <input
                    type="radio"
                    name="correct_option"
                    value={letter}
                    checked={form.correct_answer === letter}
                    onChange={() => update('correct_answer', letter)}
                    aria-label={`Option ${letter} is correct`}
                    className="mt-2.5 size-4 shrink-0 accent-primary"
                  />
                  <span className="mt-1.5 w-5 shrink-0 text-sm font-bold text-foreground">{letter}.</span>
                  <Input
                    value={form[key] ?? ''}
                    disabled={locked}
                    onChange={(event) => update(key, event.target.value)}
                    placeholder={`Option ${letter}`}
                    aria-label={`Option ${letter} text`}
                  />
                </div>
              )
            })}
            <p className="text-xs text-muted-foreground">
              Leave an option empty if this question only needs two or three choices.
            </p>
          </fieldset>
        ) : (
          <Field
            label="Correct answer"
            htmlFor="question-correct"
            hint="For written responses, describe what a full-mark answer must include."
          >
            <Textarea
              id="question-correct"
              rows={3}
              value={form.correct_answer}
              disabled={locked}
              onChange={(event) => update('correct_answer', event.target.value)}
            />
          </Field>
        )}
      </Section>

      <Section title="Classification" description="Used for filtering, adaptive difficulty and reports.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Exam type" htmlFor="question-exam-type" required>
            <Select
              id="question-exam-type"
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

          <Field label="Exam section" htmlFor="question-exam-section" hint="e.g. Reading, Numeracy, Writing">
            <Input
              id="question-exam-section"
              value={form.exam_section}
              disabled={locked}
              onChange={(event) => update('exam_section', event.target.value)}
              maxLength={120}
            />
          </Field>

          <Field label="Subject" htmlFor="question-subject" required>
            <Input
              id="question-subject"
              list="question-subject-suggestions"
              value={form.subject}
              disabled={locked}
              onChange={(event) => update('subject', event.target.value)}
              required
              maxLength={120}
            />
            <datalist id="question-subject-suggestions">
              {SUBJECT_SUGGESTIONS.map((subject) => (
                <option key={subject} value={subject} />
              ))}
            </datalist>
          </Field>

          <Field label="Topic" htmlFor="question-topic">
            <Input
              id="question-topic"
              value={form.topic}
              disabled={locked}
              onChange={(event) => update('topic', event.target.value)}
              maxLength={120}
            />
          </Field>

          <Field label="Sub-topic" htmlFor="question-sub-topic">
            <Input
              id="question-sub-topic"
              value={form.sub_topic}
              disabled={locked}
              onChange={(event) => update('sub_topic', event.target.value)}
              maxLength={120}
            />
          </Field>

          <Field label="Exam ID" htmlFor="question-exam-id" hint="Test UUID used by the CSV importer.">
            <Input
              id="question-exam-id"
              value={form.exam_id}
              disabled={locked}
              onChange={(event) => update('exam_id', event.target.value)}
              placeholder="Optional"
            />
          </Field>

          <Field label="Year level" htmlFor="question-year-level" required>
            <Select
              id="question-year-level"
              value={form.year_level}
              disabled={locked}
              onChange={(event) => update('year_level', event.target.value)}
              required
            >
              {YEAR_LEVELS.map((year) => (
                <option key={year} value={year}>
                  Year {year}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Difficulty" htmlFor="question-difficulty" hint="1 is easiest, 5 is hardest.">
            <Select
              id="question-difficulty"
              value={form.difficulty}
              disabled={locked}
              onChange={(event) => update('difficulty', event.target.value)}
            >
              {[1, 2, 3, 4, 5].map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Section>

      <Section title="Explanation" description="Shown to the student after they answer.">
        <Field label="Explanation text" htmlFor="question-explanation">
          <Textarea
            id="question-explanation"
            rows={4}
            value={form.explanation}
            disabled={locked}
            onChange={(event) => update('explanation', event.target.value)}
          />
        </Field>

        <Field label="Explanation media URL" htmlFor="question-explanation-media">
          <Input
            id="question-explanation-media"
            type="url"
            inputMode="url"
            placeholder="https://…/worked-solution.png"
            value={form.explanation_media}
            disabled={locked}
            onChange={(event) => update('explanation_media', event.target.value)}
          />
        </Field>
      </Section>

      <Section title="Status and scoring">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Status"
            htmlFor="question-status"
            hint={
              locked
                ? 'Locked while published or archived.'
                : 'Creators can save as draft or send for approval; publishing is done by a moderator.'
            }
          >
            <Select
              id="question-status"
              value={form.status}
              disabled={locked || saving}
              onChange={(event) => update('status', event.target.value)}
            >
              {(locked ? STATUS_OPTIONS : EDITABLE_STATUS_OPTIONS).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Tags" htmlFor="question-tags" hint="Comma separated.">
            <Input
              id="question-tags"
              value={form.tags}
              disabled={locked}
              onChange={(event) => update('tags', event.target.value)}
              placeholder="fractions, revision"
            />
          </Field>

          <Field label="Score for a correct answer" htmlFor="question-score">
            <Input
              id="question-score"
              type="number"
              min={0}
              max={1000}
              inputMode="numeric"
              value={form.correct_answer_score}
              disabled={locked}
              onChange={(event) => update('correct_answer_score', event.target.value)}
              placeholder="1"
            />
          </Field>

          <Field label="Average time (seconds)" htmlFor="question-average-time">
            <Input
              id="question-average-time"
              type="number"
              min={0}
              max={7200}
              inputMode="numeric"
              value={form.average_time_seconds}
              disabled={locked}
              onChange={(event) => update('average_time_seconds', event.target.value)}
              placeholder="90"
            />
          </Field>

          <Field label="Discrimination index" htmlFor="question-discrimination" hint="Between 0 and 1.">
            <Input
              id="question-discrimination"
              type="number"
              min={0}
              max={1}
              step={0.01}
              inputMode="decimal"
              value={form.discrimination_index}
              disabled={locked}
              onChange={(event) => update('discrimination_index', event.target.value)}
            />
          </Field>

          <label className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3 sm:self-end">
            <Checkbox
              name="is_active"
              checked={form.is_active !== 'false'}
              disabled={locked}
              onChange={(event) => update('is_active', event.target.checked ? 'true' : 'false')}
            />
            <span className="text-sm">
              <span className="font-semibold text-foreground">Active</span>
              <span className="block text-xs text-muted-foreground">
                Inactive questions are hidden from the adaptive engine.
              </span>
            </span>
          </label>
        </div>
      </Section>

      <Section
        title="Skill weightings"
        description="How strongly this question exercises each skill (0 to 1). Drives the skill report."
        defaultOpen={false}
      >
        <SkillGroup title="English and reasoning" fields={ENGLISH_SKILLS} form={form} locked={locked} update={update} />
        <SkillGroup title="Maths" fields={MATHS_SKILLS} form={form} locked={locked} update={update} />
      </Section>

      {!isNew && question ? (
        <Section
          title="Where it is used"
          description="Read-only: detaching a question from a test is done in that test."
          defaultOpen={false}
        >
          {detail && detail.tests.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {detail.tests.map((test) => {
                const mapping = detail.mappings.find((entry) => entry.test_id === test.id)
                return (
                  <li key={test.id}>
                    <Link
                      href={`/creator/tests/${test.id}`}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background p-3 text-sm transition-colors hover:border-primary/40"
                    >
                      <span className="min-w-0 truncate font-semibold text-foreground">{test.title}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        {mapping?.section_name ? (
                          <span className="text-xs text-muted-foreground">{mapping.section_name}</span>
                        ) : null}
                        <StatusBadge status={test.status} withHint={false} />
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Not attached to any test yet. Add it from the test editor or the CSV importer.
            </p>
          )}

          <dl className="grid grid-cols-2 gap-2 border-t border-border pt-3 sm:grid-cols-4">
            <AnalyticsStat label="Attempts" value={question.total_attempts} />
            <AnalyticsStat
              label="Success rate"
              value={question.success_rate == null ? null : `${question.success_rate}%`}
            />
            <AnalyticsStat
              label="Avg. time"
              value={question.avg_time_taken_seconds == null ? null : `${question.avg_time_taken_seconds}s`}
            />
            <AnalyticsStat label="Flags" value={question.flag_count} />
          </dl>
        </Section>
      ) : null}

      {/* Sticky on phones so "Save" is always within thumb reach after a long scroll. */}
      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:flex-row sm:justify-end sm:rounded-xl sm:border sm:px-4">
        <Button asChild type="button" variant="ghost" className="min-h-11 w-full sm:w-auto">
          <Link href="/creator/questions">Cancel</Link>
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
          {saving ? 'Saving…' : isNew ? 'Create question' : 'Save changes'}
        </Button>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        busy={deleting}
        error={deleteError}
        title="Delete this question?"
        confirmLabel="Delete question"
        onCancel={() => {
          if (!deleting) {
            setDeleteOpen(false)
            setDeleteError(null)
          }
        }}
        onConfirm={handleDelete}
        description={
          <>
            <p className="break-words">
              <span className="font-semibold text-foreground">{previewText(question?.stem, 120)}</span> will be
              permanently deleted.
            </p>
            {detail && detail.tests.length > 0 ? (
              <p>
                It is attached to {detail.tests.length} test{detail.tests.length === 1 ? '' : 's'}. Draft tests you
                own will have it removed automatically; published, archived or other creators&apos; tests block the
                delete until it is removed there.
              </p>
            ) : (
              <p>It is not attached to any test, so nothing else changes.</p>
            )}
          </>
        }
      />
    </form>
  )
}

/* -------------------------------------------------------------------------- */
/* Presentation helpers                                                        */
/* -------------------------------------------------------------------------- */

interface SkillGroupProps {
  title: string
  fields: readonly SkillField[]
  form: FormState
  locked: boolean
  update: (key: string, value: string) => void
}

function SkillGroup({ title, fields, form, locked, update }: SkillGroupProps) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-bold tracking-wide text-muted-foreground uppercase">{title}</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {fields.map((field) => (
          <Field key={field} label={skillLabel(field)} htmlFor={`question-${field}`}>
            <Input
              id={`question-${field}`}
              type="number"
              min={0}
              max={1}
              step={0.05}
              inputMode="decimal"
              value={form[field] ?? ''}
              disabled={locked}
              onChange={(event) => update(field, event.target.value)}
              placeholder="0"
            />
          </Field>
        ))}
      </div>
    </div>
  )
}

function AnalyticsStat({ label, value }: { label: string; value: number | string | null | undefined }) {
  return (
    <div className="rounded-lg bg-muted/60 px-2 py-1.5 text-center">
      <dt className="text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="text-sm font-bold tabular-nums text-foreground">
        {value === null || value === undefined || value === '' ? '—' : value}
      </dd>
    </div>
  )
}

