'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarDays, Check, Loader2, Target } from 'lucide-react'
import { trackClientEvent } from '@/features/monetisation/track-client'

/**
 * The exam target form (funnel step 8).
 *
 * WHY THIS SITS IN ONBOARDING RATHER THAN SETTINGS
 *   An exam date collected during setup is used; one collected in settings is
 *   never found. It also has to be asked for while the parent is thinking about
 *   the exam, which is the moment they signed up - not three weeks later when
 *   they are hunting through a preferences screen.
 *
 * WHY THE DATE IS OPTIONAL BUT ENCOURAGED
 *   Requiring a date would block parents whose child is not yet entered for
 *   anything, and a blocked onboarding step loses the family entirely. Making it
 *   skippable keeps the funnel moving while still explaining, in one line, what
 *   the date unlocks.
 */

export interface ExamTargetFormProps {
  studentId: string
  childLabel: string
  yearLevel: number
  /** Exam choices, passed from the server so both surfaces share one list. */
  examOptions: readonly string[]
  initialTargetExam?: string | null
  initialExamDate?: string | null
  initialGoal?: number | null
}

function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * Realistic Australian exam windows, offered as one-tap shortcuts.
 *
 * A blank date input is where this step gets abandoned: the parent has to
 * remember or look up when the exam actually is. Offering the three real windows
 * turns a research task into a choice, and a choice gets made.
 */
function suggestedDates(): { label: string; value: string }[] {
  const now = new Date()
  const windows: readonly [number, number, string][] = [
    // Month is zero-based: 2 = March, 5 = June, 7 = August.
    [2, 10, 'NAPLAN window (March)'],
    [5, 1, 'Selective sitting (June)'],
    [7, 1, 'Scholarship sitting (August)'],
  ]

  return windows.map(([month, day, label]) => {
    let candidate = new Date(now.getFullYear(), month, day)
    // Roll to next year once this year's window has already closed, so a parent
    // onboarding in September is offered next March rather than a past date.
    if (candidate.getTime() <= now.getTime()) {
      candidate = new Date(now.getFullYear() + 1, month, day)
    }
    return { label, value: toIsoDate(candidate) }
  })
}

/** Days from today, for the live "N days away" confirmation. */
function daysAway(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const target = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(target.getTime())) return null
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - startOfToday.getTime()) / 86_400_000)
}

export function ExamTargetForm({
  studentId,
  childLabel,
  yearLevel,
  examOptions,
  initialTargetExam = null,
  initialExamDate = null,
  initialGoal = 3,
}: ExamTargetFormProps) {
  const router = useRouter()
  const [targetExam, setTargetExam] = useState(initialTargetExam ?? '')
  const [examDate, setExamDate] = useState(initialExamDate ?? '')
  const [goal, setGoal] = useState(initialGoal ?? 3)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const remaining = daysAway(examDate)
  // At the chosen pace, how many sessions fit between now and the exam. Making
  // the arithmetic visible is what turns a date into a budget.
  const sessionsLeft =
    remaining !== null && remaining > 0 ? Math.round((remaining / 7) * goal) : null

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setSaved(false)

    if (!targetExam && !examDate) {
      setError('Choose a target exam or an exam date so we can build a plan.')
      return
    }

    await trackClientEvent('EXAM_TARGET_SET', {
      targetExam: targetExam || null,
      examDate: examDate || null,
      weeklySessionsGoal: goal,
      daysToExam: remaining,
    })

    try {
      const response = await fetch('/api/funnel/exam-target', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, targetExam, examDate, weeklySessionsGoal: goal }),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(
          typeof data.error === 'string' && data.error ? data.error : 'Could not save that.'
        )
      }

      setSaved(true)
      await trackClientEvent('STUDY_PLAN_CREATED', {
        targetExam: targetExam || null,
        examDate: examDate || null,
        weeklySessionsGoal: goal,
      })
      // The dashboard renders the countdown server-side, so it needs a refresh.
      startTransition(() => router.refresh())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that. Please try again.')
    }
  }

  return (
    <form onSubmit={handleSubmit} style={S.form}>
      <header style={S.header}>
        <Target size={16} aria-hidden="true" style={S.headerIcon} />
        <div>
          <h3 style={S.title}>{childLabel}</h3>
          <p style={S.subtitle}>Year {yearLevel}</p>
        </div>
      </header>

      <label style={S.label} htmlFor={`exam-${studentId}`}>
        What are they preparing for?
      </label>
      <select
        id={`exam-${studentId}`}
        name="targetExam"
        value={targetExam}
        onChange={(event) => {
          setTargetExam(event.target.value)
          setSaved(false)
        }}
        style={S.control}
      >
        <option value="">Choose an exam…</option>
        {examOptions.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>

      <label style={S.label} htmlFor={`date-${studentId}`}>
        <CalendarDays size={13} aria-hidden="true" /> Exam date
      </label>
      <input
        id={`date-${studentId}`}
        type="date"
        name="examDate"
        value={examDate}
        onChange={(event) => {
          setExamDate(event.target.value)
          setSaved(false)
        }}
        style={S.control}
      />
      <div style={S.suggestionRow}>
        {suggestedDates().map((suggestion) => (
          <button
            key={suggestion.value}
            type="button"
            onClick={() => {
              setExamDate(suggestion.value)
              setSaved(false)
            }}
            style={S.suggestion}
          >
            {suggestion.label}
          </button>
        ))}
      </div>

      <label style={S.label} htmlFor={`goal-${studentId}`}>
        Sessions per week
      </label>
      <input
        id={`goal-${studentId}`}
        type="number"
        name="weeklySessionsGoal"
        min={1}
        max={14}
        value={goal}
        onChange={(event) => {
          setGoal(Number(event.target.value))
          setSaved(false)
        }}
        style={S.control}
      />
      <p style={S.hint}>
        Three sessions of 20&ndash;30 minutes beats one long session. Short and repeated is how the
        material sticks.
      </p>

      {remaining !== null && remaining > 0 ? (
        <p style={S.countdownHint}>
          That is <strong>{remaining} days</strong> away
          {sessionsLeft !== null ? (
            <>
              {' '}
              &mdash; roughly <strong>{sessionsLeft} sessions</strong> at this pace
            </>
          ) : null}
          .
        </p>
      ) : null}

      {error ? (
        <p role="alert" style={S.error}>
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" style={S.saved}>
          <Check size={14} aria-hidden="true" /> Saved. The countdown is now on your dashboard.
        </p>
      ) : null}

      <button type="submit" disabled={pending} style={{ ...S.submit, opacity: pending ? 0.65 : 1 }}>
        {pending ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : null}
        {pending ? 'Saving…' : saved ? 'Update plan' : 'Save and build the plan'}
      </button>
    </form>
  )
}


const BORDER = 'var(--border)'
const MUTED = 'var(--muted-foreground)'

/** Local style map, matching the inline-style convention used across features/. */
const S: Record<string, React.CSSProperties> = {
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    padding: '1.25rem',
    borderRadius: '1rem',
    border: `1px solid ${BORDER}`,
    background: 'var(--card)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.625rem',
    marginBottom: '0.75rem',
  },
  headerIcon: { color: 'var(--primary, #194bfb)' },
  title: { margin: 0, fontSize: '1rem', fontWeight: 800 },
  subtitle: { margin: 0, fontSize: '0.8125rem', color: MUTED },
  label: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.375rem',
    marginTop: '0.5rem',
    fontSize: '0.8125rem',
    fontWeight: 700,
  },
  control: {
    width: '100%',
    padding: '0.625rem 0.75rem',
    borderRadius: '0.625rem',
    border: `1px solid ${BORDER}`,
    background: 'var(--card)',
    color: 'var(--foreground)',
    fontSize: '0.9375rem',
  },
  suggestionRow: {
    display: 'flex',
    gap: '0.375rem',
    flexWrap: 'wrap',
    marginTop: '0.375rem',
  },
  suggestion: {
    padding: '0.3125rem 0.625rem',
    borderRadius: '9999px',
    border: `1px solid ${BORDER}`,
    background: 'var(--muted, #f8fafc)',
    color: MUTED,
    fontSize: '0.6875rem',
    fontWeight: 700,
    cursor: 'pointer',
  },
  hint: {
    margin: '0.25rem 0 0',
    fontSize: '0.75rem',
    lineHeight: 1.55,
    color: MUTED,
  },
  countdownHint: {
    margin: '0.75rem 0 0',
    padding: '0.625rem 0.75rem',
    borderRadius: '0.625rem',
    background: 'rgba(25,75,251,0.07)',
    border: '1px solid rgba(25,75,251,0.2)',
    fontSize: '0.8125rem',
    lineHeight: 1.55,
  },
  error: {
    margin: '0.75rem 0 0',
    padding: '0.625rem 0.75rem',
    borderRadius: '0.625rem',
    background: 'rgba(220,38,38,0.08)',
    border: '1px solid rgba(220,38,38,0.25)',
    color: '#dc2626',
    fontSize: '0.8125rem',
  },
  saved: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.375rem',
    margin: '0.75rem 0 0',
    padding: '0.625rem 0.75rem',
    borderRadius: '0.625rem',
    background: 'rgba(5,150,105,0.09)',
    border: '1px solid rgba(5,150,105,0.25)',
    color: '#059669',
    fontSize: '0.8125rem',
    fontWeight: 700,
  },
  submit: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    marginTop: '1rem',
    padding: '0.75rem 1.25rem',
    borderRadius: '9999px',
    border: 0,
    background: 'var(--primary, #194bfb)',
    color: '#ffffff',
    fontSize: '0.9375rem',
    fontWeight: 800,
    cursor: 'pointer',
  },
}

