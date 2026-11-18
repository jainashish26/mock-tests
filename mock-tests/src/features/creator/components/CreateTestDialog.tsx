'use client'

import * as React from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Checkbox, Field, Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { creatorApi, errorMessage } from '@/lib/creator/client'
import { EXAM_TYPE_SELECT_OPTIONS, YEAR_LEVELS } from '@/features/creator/options'
import type { TestInput } from '@/lib/creator/types'

interface CreateTestDialogProps {
  open: boolean
  onClose: () => void
  onCreated: (id: string, title: string) => void
}

const emptyForm = {
  title: '',
  exam_type: 'BENCHMARK',
  year_level_min: '7',
  year_level_max: '7',
  time_limit_mins: '60',
  is_free: false,
}

/**
 * Quick-create dialog for a test.
 *
 * Creates the test as `draft` (the API forces this) and hands the new id back so
 * the caller can route into the full editor to add sections and questions.
 * Validation errors come from the API and are shown inline next to the form.
 */
export function CreateTestDialog({ open, onClose, onCreated }: CreateTestDialogProps) {
  const [form, setForm] = React.useState(emptyForm)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const update = <K extends keyof typeof emptyForm>(key: K, value: (typeof emptyForm)[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    const yearMin = Number(form.year_level_min)
    const yearMax = Number(form.year_level_max)
    if (yearMax < yearMin) {
      setError('The maximum year level must be greater than or equal to the minimum.')
      setSubmitting(false)
      return
    }

    const payload: TestInput = {
      title: form.title.trim(),
      exam_type: form.exam_type,
      year_level_min: yearMin,
      year_level_max: yearMax,
      time_limit_mins: Number(form.time_limit_mins) || 0,
      is_free: form.is_free,
    }

    try {
      const response = await creatorApi.createTest(payload)
      setForm(emptyForm)
      onCreated(response.id, response.test.title)
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
      title="Create a new test"
      description="Starts as a draft. You can add sections and questions next."
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
          <Button type="submit" form="create-test-form" className="min-h-11 w-full sm:w-auto" disabled={submitting}>
            {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
            {submitting ? 'Creating…' : 'Create test'}
          </Button>
        </>
      }
    >
      <form id="create-test-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Test title" htmlFor="create-test-title" required>
          <Input
            id="create-test-title"
            name="title"
            value={form.title}
            onChange={(event) => update('title', event.target.value)}
            placeholder="e.g. Year 7 NAPLAN Maths Practice Test 1"
            required
            minLength={3}
            maxLength={300}
            data-autofocus
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Exam type" htmlFor="create-test-exam-type" required>
            <Select
              id="create-test-exam-type"
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

          <Field label="Time limit (minutes)" htmlFor="create-test-time" required>
            <Input
              id="create-test-time"
              type="number"
              min={1}
              max={600}
              value={form.time_limit_mins}
              onChange={(event) => update('time_limit_mins', event.target.value)}
              required
            />
          </Field>

          <Field label="Minimum year level" htmlFor="create-test-year-min">
            <Select
              id="create-test-year-min"
              value={form.year_level_min}
              onChange={(event) => update('year_level_min', event.target.value)}
            >
              {YEAR_LEVELS.map((year) => (
                <option key={year} value={year}>
                  Year {year}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Maximum year level" htmlFor="create-test-year-max">
            <Select
              id="create-test-year-max"
              value={form.year_level_max}
              onChange={(event) => update('year_level_max', event.target.value)}
            >
              {YEAR_LEVELS.map((year) => (
                <option key={year} value={year}>
                  Year {year}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <label className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3">
          <Checkbox
            name="is_free"
            checked={form.is_free}
            onChange={(event) => update('is_free', event.target.checked)}
            className="mt-0.5"
          />
          <span className="text-sm">
            <span className="font-semibold text-foreground">Free test</span>
            <span className="block text-xs text-muted-foreground">
              Free tests are available to every student without a subscription.
            </span>
          </span>
        </label>

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

