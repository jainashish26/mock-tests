'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TestRunner } from '@/features/runner/components/TestRunner'

type Props = {
  assignmentId: string
  testTitle?: string | null
  timeLimitMins: number
  initialQuestions: any[]
  /** Set when the server found an IN_PROGRESS attempt to resume. */
  initialAttemptId?: string | null
  /** Real attempt start time - the countdown is derived from this, not from mount. */
  startedAt?: string | null
  /** Answers already persisted server-side, keyed by question id. */
  savedResponses?: Record<string, string> | null
  dueAt?: string | null
  yearLevel?: number | null
}

type ActiveAttempt = {
  id: string
  startedAt: string | null
  savedResponses: Record<string, string>
}

export default function TestPageClient({
  assignmentId,
  testTitle,
  timeLimitMins,
  initialQuestions,
  initialAttemptId = null,
  startedAt = null,
  savedResponses = null,
  dueAt = null,
  yearLevel = null,
}: Props) {
  const router = useRouter()

  // A resumed attempt skips the intro screen entirely - showing "Start Test" to a
  // student who is already mid-exam let them reset their timer on every refresh.
  const [attempt, setAttempt] = useState<ActiveAttempt | null>(
    initialAttemptId
      ? { id: initialAttemptId, startedAt, savedResponses: savedResponses ?? {} }
      : null
  )
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isPastDue = !!dueAt && new Date(dueAt).getTime() < Date.now()

  const handleStart = async () => {
    setStarting(true)
    setError(null)
    try {
      const res = await fetch('/api/runner/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignmentId }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        // Already submitted - send them to the report instead of showing a dead end.
        if (data?.alreadySubmitted && data?.attemptId) {
          router.replace(`/student/report/${data.attemptId}`)
          return
        }
        throw new Error(data?.error || `Could not start the test (HTTP ${res.status})`)
      }
      if (data?.error) throw new Error(data.error)
      if (!data?.attemptId) throw new Error('Could not start the test')

      setAttempt({
        id: data.attemptId,
        startedAt: data.startedAt ?? new Date().toISOString(),
        savedResponses: savedResponses ?? {},
      })
    } catch (err: any) {
      setError(err?.message || 'Could not start the test. Please try again.')
      setStarting(false)
    }
  }

  if (attempt) {
    return (
      <TestRunner
        key={attempt.id}
        attemptId={attempt.id}
        testTitle={testTitle}
        timeLimitMins={timeLimitMins}
        startedAt={attempt.startedAt}
        initialQuestions={initialQuestions}
        savedResponses={attempt.savedResponses}
        yearLevel={yearLevel}
      />
    )
  }

  return (
    <div style={{ padding: '4rem 2rem', maxWidth: '800px', margin: '0 auto', fontFamily: 'var(--font-sans)' }}>
      <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
        <h1 style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>
          {testTitle ? `Ready to Start ${testTitle}?` : 'Ready to Start?'}
        </h1>
        <p style={{ fontSize: '1.25rem', color: 'var(--color-text-muted)' }}>
          You will have <strong style={{ color: 'var(--color-primary)' }}>{timeLimitMins} minutes</strong> to complete this test.
        </p>
        {dueAt && (
          <p style={{ marginTop: '0.75rem', color: 'var(--color-text-muted)', fontSize: '1rem' }}>
            Due:{' '}
            <strong style={{ color: isPastDue ? 'var(--color-danger)' : 'inherit' }}>
              {new Date(dueAt).toLocaleString()}
            </strong>
          </p>
        )}
      </div>

      {isPastDue && (
        <div
          role="alert"
          style={{
            background: 'var(--color-danger-bg)',
            color: 'var(--color-danger)',
            border: '1px solid var(--color-danger)',
            borderRadius: 'var(--radius-md)',
            padding: '1rem 1.25rem',
            marginBottom: '1.5rem',
            fontWeight: 600,
          }}
        >
          This assignment is past its due date and can no longer be started.
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            background: 'var(--color-danger-bg)',
            color: 'var(--color-danger)',
            border: '1px solid var(--color-danger)',
            borderRadius: 'var(--radius-md)',
            padding: '1rem 1.25rem',
            marginBottom: '1.5rem',
            fontWeight: 600,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '2rem', marginBottom: '3rem', boxShadow: 'var(--shadow-md)' }}>
        <h3 style={{ marginTop: 0, paddingBottom: '1rem', borderBottom: '1px solid var(--color-border)' }}>Test Instructions & Tips</h3>
        <ul style={{ lineHeight: '1.8', margin: '1.5rem 0', paddingLeft: '1.5rem' }}>
          <li>The timer will begin immediately after you click Start.</li>
          <li>Your progress is <strong>saved automatically</strong> to your device. You can safely disconnect from the internet and your answers will sync when you reconnect.</li>
          <li>You can flag questions for review and return to them later using the Question Navigator bar at the bottom of the screen.</li>
        </ul>

        <div style={{ background: 'var(--color-background)', padding: '1.5rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
          <h4 style={{ margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            Keyboard Shortcuts ⌨️
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.9rem' }}>
            <div><kbd style={{ padding: '0.2rem 0.5rem', background: '#e2e8f0', borderRadius: '4px', border: '1px solid #cbd5e1' }}>←</kbd> / <kbd style={{ padding: '0.2rem 0.5rem', background: '#e2e8f0', borderRadius: '4px', border: '1px solid #cbd5e1' }}>→</kbd> Previous/Next Question</div>
            <div><kbd style={{ padding: '0.2rem 0.5rem', background: '#e2e8f0', borderRadius: '4px', border: '1px solid #cbd5e1' }}>A</kbd>–<kbd style={{ padding: '0.2rem 0.5rem', background: '#e2e8f0', borderRadius: '4px', border: '1px solid #cbd5e1' }}>E</kbd> or <kbd style={{ padding: '0.2rem 0.5rem', background: '#e2e8f0', borderRadius: '4px', border: '1px solid #cbd5e1' }}>1</kbd>–<kbd style={{ padding: '0.2rem 0.5rem', background: '#e2e8f0', borderRadius: '4px', border: '1px solid #cbd5e1' }}>5</kbd> Select Option</div>
            <div>Shortcuts pause automatically while you are typing an answer.</div>
            <div>The test submits itself when the timer reaches zero.</div>
          </div>
        </div>
      </div>

      <div style={{ textAlign: 'center' }}>
        <button
          onClick={handleStart}
          disabled={starting || isPastDue}
          style={{ padding: '1rem 3rem', fontSize: '1.25rem', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-full)', cursor: starting || isPastDue ? 'not-allowed' : 'pointer', fontWeight: 'bold', boxShadow: 'var(--shadow-md)', transition: 'transform 0.2s', opacity: starting || isPastDue ? 0.6 : 1 }}
        >
          {starting ? 'Preparing Your Exam...' : 'Start Test Now'}
        </button>
      </div>
    </div>
  )
}
