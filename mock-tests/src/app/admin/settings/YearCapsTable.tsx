'use client'

import * as React from 'react'

import { Button } from '@/components/ui/Button'
import { Input, Label } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'

/**
 * NOTE ON THIS IMPORT
 *   Everything here comes from the *pure* module `@/lib/reporting/year-caps`, not
 *   from `@/lib/reporting/admin-year-caps`. The latter reaches `./connection`,
 *   which imports `next/headers`, and a client component may not pull that in —
 *   `next build` fails the whole graph, not just this page. Saving goes through
 *   `./actions`, which is a server action and therefore the legitimate crossing.
 *
 *   This is the boundary the pure/impure split was built for, so the mistake is
 *   worth recording rather than quietly fixing: the two modules sit side by side
 *   with near-identical exports, and importing from the wrong one is the obvious
 *   thing to do until the build says otherwise.
 */
import {
  CAP_BOUNDS,
  CAP_ENFORCEMENT_NOTE,
  QUESTION_MULTIPLIER_NOTE,
  describeCap,
  validateYearLevelCap,
  type CapValidationFailure,
  type YearLevelCap,
  type YearLevelCapDraft,
} from '@/lib/reporting/year-caps'

import { updateYearLevelCap } from './actions'

/**
 * The per-year-level practice-limit editor (decision 4-A).
 *
 * WHY ONE FORM PER ROW INSTEAD OF ONE BIG FORM
 *   Eight year levels, four numbers each, and a save that must be attributable. A
 *   single form would have to say "3 of 8 rows failed" and leave the operator to
 *   find which, and a partial write across rows is a state nobody asked for:
 *   ceilings for Year 2 and 3 updated while 4 through 9 did not. One form per row
 *   makes every failure name its year level, and makes the saved state exactly the
 *   row just edited.
 *
 * WHY THE CEILING AND THE RECOMMENDED TARGET ARE NOT ONE COLUMN
 *   They are different kinds of number with different consequences, and the table
 *   has to make that legible or the distinction exists only in a migration comment.
 *   Two labelled groups, and `CAP_ENFORCEMENT_NOTE` says plainly that only one of
 *   them currently changes what a child is asked to do — which is uncomfortable to
 *   print on an admin screen and worse to leave out.
 */

type FieldKey = keyof Omit<YearLevelCapDraft, 'year_level'>

const NUMERIC_FIELDS: { key: FieldKey; label: string; hint: string; max: number }[] = [
  { key: 'max_tests', label: 'Tests', hint: 'Hard ceiling on full papers in a day', max: CAP_BOUNDS.testsMax },
  { key: 'max_questions', label: 'Questions', hint: 'Hard ceiling on items in a day', max: CAP_BOUNDS.questionsMax },
  { key: 'recommended_tests', label: 'Tests', hint: 'What a normal day should aim at', max: CAP_BOUNDS.testsMax },
  {
    key: 'recommended_questions',
    label: 'Questions',
    hint: 'What a normal day should aim at',
    max: CAP_BOUNDS.questionsMax,
  },
]

function toDraft(cap: YearLevelCap): YearLevelCapDraft {
  return {
    year_level: cap.year_level,
    max_tests: cap.max_tests_per_day,
    max_questions: cap.max_questions_per_day,
    recommended_tests: cap.recommended_tests_per_day,
    recommended_questions: cap.recommended_questions_per_day,
  }
}

export function YearCapsTable({ caps }: { caps: YearLevelCap[] }) {
  const toast = useToast()
  const [drafts, setDrafts] = React.useState<Record<number, YearLevelCapDraft>>(() =>
    Object.fromEntries(caps.map((c) => [c.year_level, toDraft(c)]))
  )
  const [failures, setFailures] = React.useState<Record<number, CapValidationFailure[]>>({})
  const [savingYear, setSavingYear] = React.useState<number | null>(null)

  /**
   * Inputs hold their raw text, not a parsed number.
   *
   * Parsing on every keystroke makes a half-typed value indistinguishable from an
   * empty one: clear "15" to type "3" and the field either jumps back to 15 or
   * shows a validation error for a number the operator never entered. So the draft
   * coerces at the boundary — here for validation, and in the action for the write —
   * and the field keeps the person's actual text until then.
   */
  const setValue = (year: number, key: FieldKey, raw: string): void => {
    setDrafts((prev) => ({
      ...prev,
      [year]: { ...prev[year], [key]: raw === '' ? Number.NaN : Number(raw) },
    }))
    // Drop the row's errors the moment they edit it: a stale refusal beside a
    // field that has since changed is noise that teaches people to ignore it.
    setFailures((prev) => (prev[year] ? { ...prev, [year]: [] } : prev))
  }

  const handleSubmit = async (year: number): Promise<void> => {
    const draft = drafts[year]
    if (!draft || savingYear !== null) return

    const local = validateYearLevelCap(draft)
    if (local.length > 0) {
      setFailures((prev) => ({ ...prev, [year]: local }))
      toast.error(
        'Check this row',
        local.length === 1 ? local[0].message : `${local.length} problems in Year ${year}.`
      )
      return
    }

    setSavingYear(year)
    try {
      const result = await updateYearLevelCap(draft)
      if (result.ok && result.saved) {
        // Server truth replaces the draft, so what is on screen is what is stored.
        setDrafts((prev) => ({ ...prev, [year]: toDraft(result.saved as YearLevelCap) }))
        setFailures((prev) => ({ ...prev, [year]: [] }))
        toast.success('Saved', describeCap(result.saved as YearLevelCap))
      } else {
        const serverFailures = result.failures ?? []
        setFailures((prev) => ({ ...prev, [year]: serverFailures }))
        toast.error('Could not save', result.error ?? `Year ${year} was refused.`)
      }
    } catch (error) {
      toast.error('Could not save', error instanceof Error ? error.message : undefined)
    } finally {
      setSavingYear(null)
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{CAP_ENFORCEMENT_NOTE}</p>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="pb-2 text-left text-xs text-muted-foreground">
            Limits apply per student by their year level. Changes take effect on the next
            reporting refresh, not immediately.
          </caption>
          <thead>
            <tr className="border-b border-border text-left">
              <th scope="col" className="py-2 pr-4 font-semibold">
                Year
              </th>
              <th scope="col" className="py-2 pr-4 font-semibold" colSpan={2}>
                Ceiling — the most the system will ever ask
              </th>
              <th scope="col" className="py-2 pr-4 font-semibold" colSpan={2}>
                Recommended — guidance, not enforced
              </th>
              <th scope="col" className="py-2 font-semibold">
                <span className="sr-only">Save</span>
              </th>
            </tr>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th scope="col" className="py-1 pr-4 font-medium">
                level
              </th>
              {NUMERIC_FIELDS.map((f) => (
                <th
                  key={f.key}
                  scope="col"
                  className={f.key === 'recommended_tests' ? 'border-l border-border py-1 pl-3 pr-4 font-medium' : 'py-1 pr-4 font-medium'}
                >
                  {f.label}
                </th>
              ))}
              <th scope="col" className="py-1">
                <span className="sr-only">action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {caps.map((cap) => {
              const year = cap.year_level
              const draft = drafts[year]
              const rowFailures = failures[year] ?? []
              const dirty =
                !!draft &&
                (draft.max_tests !== cap.max_tests_per_day ||
                  draft.max_questions !== cap.max_questions_per_day ||
                  draft.recommended_tests !== cap.recommended_tests_per_day ||
                  draft.recommended_questions !== cap.recommended_questions_per_day)

              return (
                <tr key={year} className="border-b border-border/60 align-top">
                  <th scope="row" className="py-3 pr-4 font-semibold text-foreground">
                    {year}
                  </th>
                  {NUMERIC_FIELDS.map((f) => {
                    const id = `cap-${year}-${f.key}`
                    const fieldError = rowFailures.find((x) => x.field === f.key)
                    const value = draft ? draft[f.key] : Number.NaN
                    return (
                      <td
                        key={f.key}
                        className={f.key === 'recommended_tests' ? 'border-l border-border py-3 pl-3 pr-4' : 'py-3 pr-4'}
                      >
                        <Label htmlFor={id} className="sr-only">
                          Year {year} {f.label} — {f.hint}
                        </Label>
                        <Input
                          id={id}
                          type="number"
                          inputMode="numeric"
                          min={f.key.startsWith('max') ? 1 : CAP_BOUNDS.recommendedMin}
                          max={f.max}
                          step={1}
                          name={id}
                          className="w-24"
                          value={Number.isFinite(value) ? String(value) : ''}
                          aria-describedby={`${id}-hint ${id}-error`}
                          aria-invalid={fieldError ? true : undefined}
                          disabled={savingYear !== null}
                          onChange={(event) => setValue(year, f.key, event.target.value)}
                        />
                        <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">
                          {f.hint}
                        </p>
                        <p
                          id={`${id}-error`}
                          role={fieldError ? 'alert' : undefined}
                          className="text-xs text-destructive"
                        >
                          {fieldError?.message ?? ''}
                        </p>
                      </td>
                    )
                  })}
                  <td className="py-3">
                    <Button
                      type="submit"
                      size="sm"
                      form={`cap-form-${year}`}
                      disabled={!dirty || savingYear !== null}
                    >
                      {savingYear === year ? 'Saving…' : 'Save'}
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/*
        One form per row, so Enter-to-submit works and a save is scoped to a single
        year level. They sit outside the table because HTML forbids nesting a form
        inside a <tr>; each input names its form with the `form` attribute instead.
      */}
      {caps.map((cap) => (
        <form
          key={`form-${cap.year_level}`}
          id={`cap-form-${cap.year_level}`}
          onSubmit={(event) => {
            event.preventDefault()
            void handleSubmit(cap.year_level)
          }}
          className="hidden"
          aria-hidden="true"
        />
      ))}

      <p className="text-xs text-muted-foreground">{QUESTION_MULTIPLIER_NOTE}</p>
    </div>
  )
}

