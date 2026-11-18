'use client'

import { useState, useTransition } from 'react'
import { EXAM_LABEL, type ReadinessExam } from '@/lib/report/readiness'
// Imported from the isomorphic contract module, NOT from parent-plan.ts: that
// module pulls in `next/headers` via ./connection, which cannot be part of a
// client bundle. See the header comment in plan-types.ts.
import {
  MAX_WEEKLY_SESSIONS,
  MIN_WEEKLY_SESSIONS,
  type PracticePlan,
} from '@/lib/reporting/plan-types'

/**
 * P9 - Practice Plan Controls. The only Phase 1 parent report that writes.
 *
 * A CLIENT COMPONENT, AND THE ONLY ONE THAT NEEDS TO BE
 *   §12.2 marks P9 write-through and no-store. The parent changes a value and
 *   sees the stored result immediately, which needs a PUT from the browser.
 *   Every other Phase 1 parent panel is server-rendered.
 *
 * THE EXAM-FAMILY / ENUM MISMATCH, RESOLVED DELIBERATELY
 *   `student_exam_targets.target_exam_type` is the 17-value `public.exam_type`
 *   enum, but P1 reports against four readiness FAMILIES (NAPLAN, SCHOLARSHIP,
 *   SELECTIVE, OLYMPIAD). Three families map to several enum members - NAPLAN
 *   covers READING, NUMERACY and LANGUAGE_CONVENTION - and SCHOLARSHIP has no
 *   enum member at all.
 *
 *   So the form offers the four families, matching P1's vocabulary exactly, and
 *   writes:
 *     - `target_exam`      = the parent-facing family label (this is the field
 *                            `dim_practice_plan` and the daily-target view use)
 *     - `target_exam_type` = the enum ONLY where the family maps to exactly one
 *                            member (SELECTIVE). Otherwise null.
 *
 *   Picking `NAPLAN_STYLE_READING` for a child targeting NAPLAN would assert
 *   they are targeting Reading specifically. That is a claim nobody made, and
 *   it would feed a wrong value into any future query that filters on
 *   `target_exam_type`. Null is honest; a plausible-looking wrong enum is not.
 */

/** Family -> the single enum member it maps to, where one exists. */
const EXAM_TYPE_FOR_FAMILY: Partial<Record<ReadinessExam, string>> = {
  SELECTIVE: 'SELECTIVE',
}

/** The four families, in the order P1 presents them. */
const FAMILY_OPTIONS: ReadinessExam[] = ['NAPLAN', 'SCHOLARSHIP', 'SELECTIVE', 'OLYMPIAD']

/** Derive the selected family from a stored plan. */
function familyFromPlan(plan: PracticePlan | null): ReadinessExam | '' {
  if (!plan?.target_exam) return ''

  // Matched on the label, since that is what the form writes. A plan set
  // elsewhere (seed data, an older form) may hold a raw enum instead, so the
  // enum spelling is matched too rather than showing an empty select over a
  // plan that is in fact configured.
  const stored = plan.target_exam.trim()
  const byLabel = FAMILY_OPTIONS.find((f) => EXAM_LABEL[f] === stored)
  if (byLabel) return byLabel

  const byEnum = FAMILY_OPTIONS.find((f) => f === stored.toUpperCase())
  return byEnum ?? ''
}

/** `date` input value: YYYY-MM-DD in local time, not UTC. */
function toInputDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  // toISOString() would shift an evening Melbourne date back a day.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface PlanControlsProps {
  studentId: string
  /** The plan as loaded server-side, so the first paint is not an empty form. */
  initialPlan: PracticePlan | null
  initialOverloadNotice: string | null
  asAt: string | null
}

export function PlanControls({
  studentId,
  initialPlan,
  initialOverloadNotice,
  asAt,
}: PlanControlsProps) {
  const [family, setFamily] = useState<ReadinessExam | ''>(familyFromPlan(initialPlan))
  const [examDate, setExamDate] = useState(toInputDate(initialPlan?.exam_date))
  const [goal, setGoal] = useState(String(initialPlan?.weekly_sessions_goal ?? 3))
  const [plan, setPlan] = useState<PracticePlan | null>(initialPlan)
  const [notice, setNotice] = useState<string | null>(initialOverloadNotice)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  async function save() {
    setError(null)
    setSaved(false)

    const parsedGoal = Number(goal)
    if (
      !Number.isFinite(parsedGoal) ||
      parsedGoal < MIN_WEEKLY_SESSIONS ||
      parsedGoal > MAX_WEEKLY_SESSIONS
    ) {
      setError(
        `Weekly sessions must be between ${MIN_WEEKLY_SESSIONS} and ${MAX_WEEKLY_SESSIONS}.`
      )
      return
    }

    try {
      const res = await fetch('/api/reporting/parent/plan', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          // The label, not the enum spelling: it is what the daily-target view
          // reads, and it is what a parent recognises.
          targetExam: family ? EXAM_LABEL[family] : null,
          targetExamType: family ? (EXAM_TYPE_FOR_FAMILY[family] ?? null) : null,
          examDate: examDate || null,
          weeklySessionsGoal: parsedGoal,
        }),
      })

      const body = await res.json().catch(() => null)

      if (!res.ok) {
        // 403 means this account is not linked to the child. 400 means the
        // values were rejected. Neither is "try again later", so the message
        // differs rather than collapsing into one generic failure.
        setError(
          res.status === 403
            ? 'You are not authorised to change this plan.'
            : res.status === 400
              ? 'Those plan details were rejected. Check the exam date is in the future and the session count is in range.'
              : 'The plan could not be saved. Please try again.'
        )
        return
      }

      // Render the STORED row, not the values we sent. If the database
      // clamped or defaulted anything, the form must show what was actually
      // saved - otherwise the screen and the database disagree and the parent
      // has no way to notice.
      const stored = body?.data?.plan as PracticePlan | null
      if (stored) {
        setPlan(stored)
        setFamily(familyFromPlan(stored))
        setExamDate(toInputDate(stored.exam_date))
        setGoal(String(stored.weekly_sessions_goal))
      }
      setNotice((body?.data?.overloadNotice as string | null) ?? null)
      setSaved(true)
    } catch {
      setError('The plan could not be saved. Please try again.')
    }
  }

  function onSave() {
    startTransition(() => {
      void save()
    })
  }

  const inputClass =
    'w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <section
      id="plan"
      aria-labelledby="panel-P9"
      className="scroll-mt-24 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 id="panel-P9" className="text-sm font-semibold tracking-tight">
          Practice plan
        </h3>
        {/* P9 is write-through, so this note explains why the derived daily
            target may not move instantly. Without it a parent who saves and
            sees an unchanged number concludes the button is broken. */}
        {asAt && (
          <span className="text-[0.6875rem] text-muted-foreground">
            Daily target recalculated nightly
          </span>
        )}
      </div>

      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Target exam</span>
          <select
            className={inputClass}
            value={family}
            onChange={(e) => setFamily(e.target.value as ReadinessExam | '')}
          >
            <option value="">Not set</option>
            {FAMILY_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {EXAM_LABEL[f]}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Exam date</span>
            <input
              type="date"
              className={inputClass}
              value={examDate}
              // A past date is rejected by the API; `min` stops the parent
              // picking one in the first place.
              min={toInputDate(new Date().toISOString())}
              onChange={(e) => setExamDate(e.target.value)}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              Sessions per week
            </span>
            <input
              type="number"
              className={inputClass}
              value={goal}
              min={MIN_WEEKLY_SESSIONS}
              max={MAX_WEEKLY_SESSIONS}
              step={1}
              onChange={(e) => setGoal(e.target.value)}
            />
          </label>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </p>
        )}

        {/* The overload notice is the parent-facing counterpart to the child's
            capped daily number: it says the plan does not fit inside the cap
            and names the two things that would fix it. */}
        {notice && (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
            {notice}
          </p>
        )}

        {plan?.daily_target_units !== null && plan?.daily_target_units !== undefined && (
          <p className="text-xs text-muted-foreground">
            Today&rsquo;s target for your child:{' '}
            <span className="font-semibold text-foreground">
              {Math.round(Number(plan.daily_target_units))} {plan.unit_kind ?? 'units'}
            </span>
            {plan.days_to_exam !== null && plan.days_to_exam !== undefined && (
              <> · {plan.days_to_exam} days to the exam</>
            )}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onSave}
            disabled={pending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Save plan'}
          </button>

          {saved && !error && (
            <span role="status" className="text-xs font-medium text-emerald-600">
              Saved
            </span>
          )}
        </div>
      </div>
    </section>
  )
}


