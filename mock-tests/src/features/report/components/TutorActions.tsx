'use client'

import { useState } from 'react'

/**
 * T5's "Remind" action.
 *
 * POSTs to /api/reporting/tutor/reminders and reports what actually happened.
 *
 * THE OUTCOME IS SHOWN IN WORDS, INCLUDING WHEN NOTHING WAS SENT. A reminder can
 * legitimately queue zero emails because one was already sent today, and a button
 * that silently does nothing on the second click reads as broken - so the tutor
 * clicks it again, and again. The server enforces the once-per-day limit through
 * email_log's unique index; this component's job is to make that limit visible
 * rather than to pretend it is a client-side concern.
 *
 * `unreachable` is reported separately again because "no email on record" is a
 * different problem from "already sent": one needs a data fix, the other needs
 * patience until tomorrow.
 */
export function RemindButton({
  assignmentId,
  label,
}: {
  assignmentId: string
  label: string
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  async function remind() {
    setBusy(true)
    setMessage(null)
    setFailed(false)
    try {
      const res = await fetch('/api/reporting/tutor/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignmentId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'Could not send the reminder')

      const parts: string[] = []
      if (json.queued > 0) parts.push(`Reminder queued for ${json.queued}.`)
      if (json.alreadySent > 0) parts.push('Already reminded today.')
      if (json.unreachable > 0) parts.push(`${json.unreachable} with no email on record.`)
      setMessage(parts.join(' ') || json.reason || 'Nothing to send.')
    } catch (err) {
      setFailed(true)
      setMessage(err instanceof Error ? err.message : 'Could not send the reminder')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void remind()}
        disabled={busy}
        aria-label={label}
        className="rounded-md border border-border px-2 py-1 text-[0.6875rem] font-medium hover:bg-muted disabled:opacity-50"
      >
        {busy ? 'Sending…' : 'Remind'}
      </button>
      {message && (
        <span
          role="status"
          className={`max-w-[14rem] text-right text-[0.625rem] ${
            failed ? 'text-destructive' : 'text-muted-foreground'
          }`}
        >
          {message}
        </span>
      )}
    </span>
  )
}

interface AssignableTest {
  test_id: string
  title: string
  matching_items: number
  total_items: number
  time_limit_mins: number
}

/**
 * T7's "Assign" action: turn a recommendation into work the student can see.
 *
 * THIS IS THE MISSING HALF OF T7. §4.5 pairs T7's next action with T5, and 074
 * shipped T7 read-only because public.tests was empty - there was literally nothing
 * to assign. With 53 published tests in the catalogue the action can be real, so a
 * recommendation stops being advice the tutor has to act on somewhere else.
 *
 * THE TEST LIST IS FETCHED, NOT HARDCODED, and is filtered server-side to tests
 * that (a) are published, (b) contain questions on this subject/topic, and (c) fit
 * the student's year band. Offering a test that `tutor_assign_test()` would then
 * reject is how a form earns a reputation for being broken, so the selector and the
 * write path are constrained by the same rules.
 *
 * Coverage is shown per option ("20/75 on this topic") because the recommendation is
 * about a weak topic: a test with one relevant question is a poor assignment however
 * good its title is, and the tutor should be able to see that.
 */
export function AssignControl({
  studentId,
  studentName,
  subject,
  topic,
}: {
  studentId: string
  studentName: string
  subject: string
  topic: string
}) {
  const [open, setOpen] = useState(false)
  const [tests, setTests] = useState<AssignableTest[] | null>(null)
  const [testId, setTestId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  async function openForm() {
    setOpen(true)
    setMessage(null)
    setFailed(false)
    if (tests !== null) return

    setBusy(true)
    try {
      const params = new URLSearchParams({ studentId, subject, topic })
      const res = await fetch(`/api/reporting/tutor/assignable-tests?${params.toString()}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'Could not load assignable tests')
      const rows = (json.data ?? []) as AssignableTest[]
      setTests(rows)
      setTestId(rows[0]?.test_id ?? '')
    } catch (err) {
      setFailed(true)
      setMessage(err instanceof Error ? err.message : 'Could not load assignable tests')
      setTests([])
    } finally {
      setBusy(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    setFailed(false)
    try {
      // An empty date input means "no deadline", which T5 renders as NO_DUE_DATE and
      // never as "on time". Sending an empty string would instead be parsed as an
      // invalid date, so it is omitted entirely.
      const body: { studentId: string; testId: string; dueAt?: string } = { studentId, testId }
      if (dueDate) body.dueAt = new Date(`${dueDate}T23:59:00`).toISOString()

      const res = await fetch('/api/reporting/tutor/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'Could not assign the test')

      setMessage(`Assigned to ${studentName}. It now appears in your assignment tracker.`)
      setOpen(false)
      setDueDate('')
    } catch (err) {
      setFailed(true)
      setMessage(err instanceof Error ? err.message : 'Could not assign the test')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="flex w-full flex-col items-end gap-1">
      {!open ? (
        <button
          type="button"
          onClick={() => void openForm()}
          className="rounded-md bg-primary px-2 py-1 text-[0.6875rem] font-medium text-primary-foreground disabled:opacity-50"
        >
          Assign
        </button>
      ) : (
        <form onSubmit={submit} className="w-full rounded-md border border-border p-2">
          <p className="mb-1.5 text-[0.6875rem] font-medium">
            Assign to {studentName} · {topic}
          </p>
          {busy && tests === null ? (
            <p className="text-[0.6875rem] text-muted-foreground">Finding tests…</p>
          ) : tests !== null && tests.length === 0 ? (
            <p className="text-[0.6875rem] text-muted-foreground">
              No published test covers {topic} for this student&apos;s year level yet.
            </p>
          ) : (
            <>
              <select
                value={testId}
                onChange={(e) => setTestId(e.target.value)}
                aria-label="Test to assign"
                className="mb-1.5 w-full rounded-md border border-border bg-background px-2 py-1 text-[0.6875rem]"
              >
                {(tests ?? []).map((t) => (
                  <option key={t.test_id} value={t.test_id}>
                    {t.title} — {t.matching_items}/{t.total_items} on this topic
                  </option>
                ))}
              </select>
              <label className="mb-1.5 block text-[0.6875rem]">
                <span className="mb-0.5 block text-muted-foreground">
                  Due (optional — blank sets no deadline)
                </span>
                <input
                  type="date"
                  value={dueDate}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2 py-1 text-[0.6875rem]"
                />
              </label>
              <span className="flex gap-1.5">
                <button
                  type="submit"
                  disabled={busy || !testId}
                  className="rounded-md bg-primary px-2 py-1 text-[0.6875rem] font-medium text-primary-foreground disabled:opacity-50"
                >
                  {busy ? 'Assigning…' : 'Confirm'}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={busy}
                  className="rounded-md border border-border px-2 py-1 text-[0.6875rem] disabled:opacity-50"
                >
                  Cancel
                </button>
              </span>
            </>
          )}
        </form>
      )}
      {message && (
        <span
          role="status"
          className={`text-right text-[0.625rem] ${failed ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {message}
        </span>
      )}
    </span>
  )
}

