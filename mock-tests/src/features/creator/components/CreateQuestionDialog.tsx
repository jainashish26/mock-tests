'use client'

import * as React from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { creatorApi, errorMessage } from '@/lib/creator/client'
import {
  EXAM_TYPE_SELECT_OPTIONS,
  QUESTION_TYPE_OPTIONS,
  SUBJECT_SUGGESTIONS,
  YEAR_LEVELS,
} from '@/features/creator/options'
import type { QuestionInput } from '@/lib/creator/types'
import type { QuestionType } from '@/lib/creator/content-meta'

interface CreateQuestionDialogProps {
  open: boolean
  onClose: () => void
  onCreated: (id: string, stem: string) => void
}

const emptyForm = {
  stem: '',
  type: 'MCQ' as QuestionType,
  exam_type: 'NAPLAN_STYLE_NUMERACY',
  subject: '',
  topic: '',
  year_level: String(YEAR_LEVELS[0]),
  difficulty: '2',
  tags: '',
}

/**
 * Quick-create dialog for a question.
 *
 * Only the fields the API requires on create (`type`, `stem`, `exam_type`,
 * `year_level`, `subject`) plus the common metadata are collected here; the caller
 * then routes into the full editor for answer options, explanation and skill
 * weightings. The question is created as a DRAFT owned by the signed-in creator.
 */
export function CreateQuestionDialog({ open, onClose, onCreated }: CreateQuestionDialogProps) {
  const [form, setForm] = React.useState(emptyForm)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const update = <K extends keyof typeof emptyForm>(key: K, value: (typeof emptyForm)[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    const payload: QuestionInput = {
      stem: form.stem.trim(),
      type: form.type,
      exam_type: form.exam_type,
      subject: form.subject.trim(),
      topic: form.topic.trim() || null,
      year_level: Number(form.year_level),
      difficulty: Number(form.difficulty),
      tags: form.tags,
    }

    try {
      const response = await creatorApi.createQuestion(payload)
      const stem = form.stem.trim()
      setForm(emptyForm)
      onCreated(response.id, stem)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={submitting ? () => undefined : onClose}
      title="Create a new question"
      description="Saved as a draft. Answer options and the explanation come next in the editor."
      closeOnOverlay={!submitting}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full sm:w-auto"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="create-question-form"
            className="min-h-11 w-full sm:w-auto"
            disabled={submitting}
          >
            {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
            {submitting ? 'Creating…' : 'Create question'}
          </Button>
        </>
      }
    >
      <form id="create-question-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Question text" htmlFor="create-question-stem" required>
          <Textarea
            id="create-question-stem"
            name="stem"
            rows={4}
            value={form.stem}
            onChange={(event) => update('stem', event.target.value)}
            placeholder="e.g. A rectangle is 8 cm long and 5 cm wide. What is its area?"
            required
            minLength={3}
            data-autofocus
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Question type" htmlFor="create-question-type" required>
            <Select
              id="create-question-type"
              value={form.type}
              onChange={(event) => update('type', event.target.value as QuestionType)}
              required
            >
              {QUESTION_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Exam type" htmlFor="create-question-exam-type" required>
            <Select
              id="create-question-exam-type"
              value={form.exam_type}
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

          <Field label="Subject" htmlFor="create-question-subject" required>
            <Input
              id="create-question-subject"
              list="creator-subject-suggestions"
              value={form.subject}
              onChange={(event) => update('subject', event.target.value)}
              placeholder="Mathematics"
              required
              maxLength={120}
            />
            <datalist id="creator-subject-suggestions">
              {SUBJECT_SUGGESTIONS.map((subject) => (
                <option key={subject} value={subject} />
              ))}
            </datalist>
          </Field>

          <Field label="Topic" htmlFor="create-question-topic">
            <Input
              id="create-question-topic"
              value={form.topic}
              onChange={(event) => update('topic', event.target.value)}
              placeholder="Measurement"
              maxLength={120}
            />
          </Field>

          <Field label="Year level" htmlFor="create-question-year" required>
            <Select
              id="create-question-year"
              value={form.year_level}
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

          <Field label="Difficulty" htmlFor="create-question-difficulty" hint="1 is easiest, 5 is hardest.">
            <Select
              id="create-question-difficulty"
              value={form.difficulty}
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

        <Field
          label="Tags"
          htmlFor="create-question-tags"
          hint="Comma separated. Used for filtering and revision sets."
        >
          <Input
            id="create-question-tags"
            value={form.tags}
            onChange={(event) => update('tags', event.target.value)}
            placeholder="area, perimeter, revision"
          />
        </Field>

        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
          >
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  )
}
