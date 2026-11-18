'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { Flag, Accessibility, Moon, Sun, CloudOff, Cloud, Loader2, ChevronUp, ChevronDown } from 'lucide-react'
import { trackClientEvent } from '@/features/monetisation/track-client'
import styles from './TestRunner.module.css'

type Theme = 'light' | 'dark' | 'high-contrast'
type FontSize = 'small' | 'medium' | 'large'

export type RunnerOption = { letter: string; text: string }

export type RunnerQuestion = {
  id: string
  type: string
  stem: string
  section_name: string
  /** Reading-comprehension passages are supplied so the student can actually read them. */
  comprehension_text?: string | null
  options: RunnerOption[]
}

/** A single answer waiting to be persisted via /api/runner/save. */
type QueueItem = {
  questionId: string
  sectionName: string
  answer: string
  timeSpentSeconds: number
}

/** Both MCQ and reading-comprehension items are answered with a letter. */
const CHOICE_TYPES = new Set(['MCQ', 'READING_COMPREHENSION'])
const DEFAULT_TIME_LIMIT_MINS = 60
const SYNC_DEBOUNCE_MS = 800

/** `savedResponses` may arrive as one object or an array of objects. */
function normalizeSaved(saved: unknown): Record<string, string> {
  const merged: Record<string, string> = {}
  if (!saved) return merged
  const entries = Array.isArray(saved) ? saved : [saved]
  for (const entry of entries) {
    if (entry && typeof entry === 'object') {
      for (const [k, v] of Object.entries(entry as Record<string, unknown>)) {
        if (typeof v === 'string' && v.length > 0) merged[k] = v
      }
    }
  }
  return merged
}

function storageKey(attemptId: string) {
  return `mock_tests_runner_${attemptId}`
}

export default function TestRunner({
  attemptId,
  testTitle,
  timeLimitMins,
  startedAt,
  initialQuestions,
  savedResponses = [],
}: {
  attemptId: string
  testTitle?: string | null
  timeLimitMins: number
  startedAt?: string | null
  initialQuestions: RunnerQuestion[]
  savedResponses?: unknown
}) {
  const router = useRouter()

  const questions = useMemo<RunnerQuestion[]>(
    () => (Array.isArray(initialQuestions) ? initialQuestions : []),
    [initialQuestions]
  )

  const totalSeconds = useMemo(() => {
    const mins = Number(timeLimitMins)
    return (Number.isFinite(mins) && mins > 0 ? mins : DEFAULT_TIME_LIMIT_MINS) * 60
  }, [timeLimitMins])

  // ---- Core UI state -------------------------------------------------------
  const [currentIndex, setCurrentIndex] = useState(0)
  const [responses, setResponses] = useState<Record<string, string>>(() => normalizeSaved(savedResponses))
  const [flags, setFlags] = useState<Record<string, boolean>>({})
  const [timeLeft, setTimeLeft] = useState(totalSeconds)
  const [timeSpentPerQuestion, setTimeSpentPerQuestion] = useState<Record<string, number>>({})

  const [isOnline, setIsOnline] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showConfirmSubmit, setShowConfirmSubmit] = useState(false)

  // Accessibility preferences (kept client-only; they are cosmetic).
  const [theme, setTheme] = useState<Theme>('light')
  const [fontSize, setFontSize] = useState<FontSize>('medium')

  // Bottom question navigator: collapsed by default so the question gets maximum space.
  const [navigatorOpen, setNavigatorOpen] = useState(false)

  const currentQuestion = questions[currentIndex]
  const totalQuestions = questions.length

  // ---- Refs (values needed inside timers/callbacks without stale closures) --
  const hydratedRef = useRef(false)
  const questionEnterRef = useRef<number>(Date.now())
  const lastSaveRef = useRef<Record<string, number>>({})
  const submittingRef = useRef(false)
  const queueRef = useRef<QueueItem[]>([])
  const flushingRef = useRef(false)
  const [queueLength, setQueueLength] = useState(0)
  const submittedRef = useRef(false)
  const navTrackRef = useRef<HTMLDivElement | null>(null)

  const currentResponse = currentQuestion ? responses[currentQuestion.id] ?? '' : ''

  // ---- Hydration: resume a refresh or a return visit -----------------------
  // Server-side saved answers are the base; anything cached locally on this
  // device is layered on top because it may be newer than the last successful sync.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey(attemptId))
      if (raw) {
        const parsed = JSON.parse(raw) as { responses?: Record<string, string>; flags?: Record<string, boolean> }
        setResponses((prev) => ({ ...prev, ...(parsed.responses ?? {}) }))
        setFlags(parsed.flags ?? {})
      }
    } catch {
      // Corrupt cache is non-fatal - fall back to the server-provided answers.
    }
    hydratedRef.current = true

    // Resume the countdown from the attempt's real start time, otherwise a
    // refresh silently reset the clock and handed the student unlimited time.
    const started = startedAt ? new Date(startedAt).getTime() : NaN
    if (Number.isFinite(started)) {
      const elapsed = Math.floor((Date.now() - started) / 1000)
      setTimeLeft(Math.max(0, totalSeconds - elapsed))
    } else {
      setTimeLeft(totalSeconds)
    }

    questionEnterRef.current = Date.now()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId, startedAt, totalSeconds])

  // Persist locally so a crash or refresh never loses unsynced answers.
  useEffect(() => {
    if (!hydratedRef.current) return
    try {
      window.localStorage.setItem(
        storageKey(attemptId),
        JSON.stringify({ responses, flags, savedAt: Date.now() })
      )
    } catch {
      // Private browsing / quota errors are non-fatal.
    }
  }, [attemptId, responses, flags])

  // ---- Offline-safe sync queue --------------------------------------------
  // Answers are batched into ONE request. Failed flushes keep their items so a
  // dropped connection can never silently discard student work.
  const flushSyncQueue = useCallback(async (): Promise<boolean> => {
    if (flushingRef.current) return false
    const pending = queueRef.current
    if (pending.length === 0) return true

    flushingRef.current = true
    setIsSyncing(true)
    try {
      const res = await fetch('/api/runner/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId, answers: pending }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `Could not save your answer (HTTP ${res.status})`)
      }

      // Drop only what was actually accepted; anything queued meanwhile stays.
      const sent = new Set(pending)
      queueRef.current = queueRef.current.filter((item) => !sent.has(item))
      setQueueLength(queueRef.current.length)
      setSyncError(null)
      return true
    } catch (err: any) {
      setSyncError(err?.message || 'Could not save your answer. Retrying…')
      // A14 test_error_rate. phase:'during_test' is what makes this count -
      // an error on a marketing page is not a test error. No stack traces or
      // raw messages in props: the message is truncated to a short phrase so
      // a student's answer content cannot leak into the events table.
      void trackClientEvent('ERROR_OCCURRED', {
        phase: 'during_test',
        attemptId,
        errorType: 'save_failed',
        message: (err?.message || '').slice(0, 120),
      })
      return false
    } finally {
      flushingRef.current = false
      setIsSyncing(false)
    }
  }, [attemptId])

  // Keep the ref in sync so timers and handlers always flush the latest queue.
  const flushRef = useRef(flushSyncQueue)
  useEffect(() => {
    flushRef.current = flushSyncQueue
  }, [flushSyncQueue])

  const enqueueSave = useCallback((question: RunnerQuestion, answer: string) => {
    const enteredAt = questionEnterRef.current
    const now = Date.now()
    const elapsed = Math.max(0, Math.round((now - enteredAt) / 1000))
    lastSaveRef.current[question.id] = now

    const next: QueueItem = {
      questionId: question.id,
      sectionName: question.section_name ?? 'General',
      answer,
      timeSpentSeconds: elapsed,
    }

    // Only the latest answer per question matters, so replace rather than append.
    queueRef.current = [...queueRef.current.filter((i) => i.questionId !== question.id), next]
    setQueueLength(queueRef.current.length)

    setTimeSpentPerQuestion((prev) => ({
      ...prev,
      [question.id]: (prev[question.id] ?? 0) + elapsed,
    }))
  }, [])

  // Debounced flush: fires 800ms after the last keystroke/selection.
  useEffect(() => {
    if (!isOnline || queueLength === 0) return
    const timer = window.setTimeout(() => {
      void flushRef.current()
    }, SYNC_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [isOnline, queueLength, responses])

  // Retry stranded answers when the connection comes back.
  useEffect(() => {
    if (isOnline && queueLength > 0) void flushSyncQueue()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline])

  useEffect(() => {
    const goOnline = () => setIsOnline(true)
    const goOffline = () => setIsOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    setIsOnline(navigator.onLine)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  // ---- Answering -----------------------------------------------------------
  const saveResponse = useCallback(
    (question: RunnerQuestion, answer: string) => {
      setResponses((prev) => ({ ...prev, [question.id]: answer }))
      enqueueSave(question, answer)
    },
    [enqueueSave]
  )

  const handleOptionSelect = useCallback(
    (option: RunnerOption) => {
      if (!currentQuestion || isSubmitting || submittedRef.current) return
      // Store the LETTER - `questions.correct_answer` is a letter, so storing the
      // option text would mark every single answer wrong.
      saveResponse(currentQuestion, option.letter)
    },
    [currentQuestion, isSubmitting, saveResponse]
  )

  const toggleFlag = useCallback(() => {
    if (!currentQuestion) return
    setFlags((prev) => ({ ...prev, [currentQuestion.id]: !prev[currentQuestion.id] }))
  }, [currentQuestion])

  // ---- Countdown -----------------------------------------------------------
  const finalSubmitRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (submittedRef.current) return
    const interval = window.setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(interval)
          // Auto-submit flushes the queue first, so queued answers are not lost.
          finalSubmitRef.current()
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => window.clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const formatTime = useCallback((secs: number) => {
    const safe = Math.max(0, Math.floor(secs))
    const h = Math.floor(safe / 3600)
    const m = Math.floor((safe % 3600) / 60)
    const s = safe % 60
    const pad = (n: number) => String(n).padStart(2, '0')
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
  }, [])

  const timerClass =
    timeLeft <= 60 ? styles.timerRed : timeLeft <= 300 ? styles.timerOrange : styles.timerGreen

  // ---- Submission ----------------------------------------------------------
  const handleFinalSubmit = useCallback(async () => {
    if (submittingRef.current || submittedRef.current) return
    submittingRef.current = true
    setIsSubmitting(true)
    setSubmitError(null)
    setShowConfirmSubmit(false)

    // Never submit with unsynced answers - abort on failure so the student can
    // retry instead of handing in a blank paper.
    const synced = await flushRef.current()
    if (!synced) {
      submittingRef.current = false
      setIsSubmitting(false)
      setSubmitError('Your latest answers could not be saved. Check your connection and submit again.')
      // Pre-submit sync failure: the student tried to hand in but the queue
      // could not flush. Counts toward A14 as a during_test error.
      void trackClientEvent('ERROR_OCCURRED', {
        phase: 'during_test',
        attemptId,
        errorType: 'submit_sync_failed',
      })
      return
    }

    try {
      const res = await fetch('/api/runner/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId }),
      })

      const body = await res.json().catch(() => ({}))

      if (!res.ok) throw new Error(body?.error || `Submission failed (HTTP ${res.status})`)
      if (body?.error) throw new Error(body.error)

      submittedRef.current = true
      try {
        window.localStorage.removeItem(storageKey(attemptId))
      } catch {
        // ignore cleanup failures
      }

      router.push(`/student/report/${attemptId}`)
      router.refresh()
    } catch (err: any) {
      submittingRef.current = false
      setIsSubmitting(false)
      setSubmitError(err?.message || 'Submission failed. Please try again.')
      // A14 test_error_rate. The student pressed submit and the server
      // rejected it or the network failed. Truncated message only.
      void trackClientEvent('ERROR_OCCURRED', {
        phase: 'during_test',
        attemptId,
        errorType: 'submit_failed',
        message: (err?.message || '').slice(0, 120),
      })
    }
  }, [attemptId, router])

  // Keep the timer's auto-submit pointing at the latest closure.
  useEffect(() => {
    finalSubmitRef.current = () => {
      void handleFinalSubmit()
    }
  }, [handleFinalSubmit])

  const requestSubmit = useCallback(() => {
    if (submittingRef.current || submittedRef.current) return
    setSubmitError(null)
    setShowConfirmSubmit(true)
  }, [])

  // ---- Navigation ----------------------------------------------------------
  const goTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= totalQuestions) return
      questionEnterRef.current = Date.now()
      setCurrentIndex(index)
    },
    [totalQuestions]
  )

  const goNext = useCallback(
    () => goTo(Math.min(currentIndex + 1, totalQuestions - 1)),
    [currentIndex, goTo, totalQuestions]
  )

  const goPrev = useCallback(() => goTo(Math.max(currentIndex - 1, 0)), [currentIndex, goTo])

  // ---- Keyboard shortcuts --------------------------------------------------
  // Guarded so typing an essay never jumps questions or selects an option.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
          return
        }
      }
      if (showConfirmSubmit || submittedRef.current) return

      if (e.key === 'ArrowRight') {
        e.preventDefault()
        goNext()
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goPrev()
        return
      }

      if (!currentQuestion || !CHOICE_TYPES.has(currentQuestion.type)) return
      if (!/^[a-eA-E1-5]$/.test(e.key)) return

      const upper = e.key.toUpperCase()
      const mapped = /^[1-5]$/.test(upper) ? String.fromCharCode(64 + Number(upper)) : upper
      const option = currentQuestion.options.find((o) => o.letter === mapped)
      if (option) {
        e.preventDefault()
        handleOptionSelect(option)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [currentQuestion, goNext, goPrev, handleOptionSelect, showConfirmSubmit])

  // ---- Derived stats -------------------------------------------------------
  const answeredCount = useMemo(
    () => questions.filter((q) => String(responses[q.id] ?? '').trim().length > 0).length,
    [questions, responses]
  )
  const flaggedCount = useMemo(() => Object.values(flags).filter(Boolean).length, [flags])
  const unansweredCount = Math.max(0, totalQuestions - answeredCount)
  const progressPct = totalQuestions > 0 ? Math.round((answeredCount / totalQuestions) * 100) : 0
  const totalAnswerTime = useMemo(
    () => Object.values(timeSpentPerQuestion).reduce((a, b) => a + b, 0),
    [timeSpentPerQuestion]
  )

  // Keep the active question badge visible inside the horizontal navigator strip.
  useEffect(() => {
    if (!navigatorOpen) return
    const track = navTrackRef.current
    if (!track) return
    const active = track.querySelector<HTMLElement>('[data-current="true"]')
    active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [navigatorOpen, currentIndex])

  const fieldStyle: CSSProperties = {
    width: '100%',
    padding: '0.9rem 1rem',
    borderRadius: 'var(--radius-md, 8px)',
    border: '1px solid var(--runner-border, var(--color-border))',
    backgroundColor: 'var(--runner-bg, var(--color-background))',
    color: 'var(--runner-fg, var(--color-text))',
    fontSize: '1rem',
    fontFamily: 'inherit',
    lineHeight: 1.6,
    resize: 'vertical',
  }

  const renderAnswerInput = () => {
    if (!currentQuestion) return null
    const type = currentQuestion.type
    const value = responses[currentQuestion.id] ?? ''

    if (CHOICE_TYPES.has(type) && currentQuestion.options.length > 0) {
      return (
        <div className={styles.optionsGrid} role="radiogroup" aria-label="Answer options">
          {currentQuestion.options.map((option) => {
            const selected = value === option.letter
            return (
              <button
                key={option.letter}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`${styles.optionBtn} ${selected ? styles.optionSelected : ''}`}
                onClick={() => handleOptionSelect(option)}
                disabled={isSubmitting}
              >
                <span className={styles.optionLabel} aria-hidden="true">
                  {option.letter}
                </span>
                <span className={styles.optionText}>{option.text}</span>
              </button>
            )
          })}
        </div>
      )
    }

    if (type === 'SHORT_ANSWER') {
      return (
        <input
          type="text"
          value={value}
          placeholder="Type your answer…"
          onChange={(e) => saveResponse(currentQuestion, e.target.value)}
          disabled={isSubmitting}
          autoComplete="off"
          aria-label="Your answer"
          style={fieldStyle}
        />
      )
    }

    // WRITING, READING_COMPREHENSION without options, and any unknown type get a
    // textarea. We deliberately NEVER fall back to rendering `correct_answer` as
    // an option - that leaked the answer key to the student mid-exam.
    const words = value.trim() ? value.trim().split(/\s+/).length : 0
    return (
      <div>
        <textarea
          value={value}
          rows={10}
          placeholder="Write your answer here…"
          onChange={(e) => saveResponse(currentQuestion, e.target.value)}
          disabled={isSubmitting}
          aria-label="Your written answer"
          style={fieldStyle}
        />
        <div
          style={{
            marginTop: '0.5rem',
            fontSize: '0.85rem',
            color: 'var(--runner-fg, var(--color-text))',
            opacity: 0.65,
          }}
        >
          {words} {words === 1 ? 'word' : 'words'}
        </div>
      </div>
    )
  }

  if (totalQuestions === 0) {
    return (
      <div className={styles.runnerContainer} data-theme={theme} data-font-size={fontSize}>
        <div className={styles.header}>
          <h1 style={{ fontSize: '1.1rem', fontWeight: 600 }}>{testTitle ?? 'Mock Test'}</h1>
          <span className={`${styles.timer} ${styles.timerRed}`}>No questions</span>
        </div>
        <div className={styles.mainContent}>
          <div className={styles.questionSection} style={{ textAlign: 'center' }}>
            <p>This test has no published questions yet. Please contact your instructor.</p>
            <button
              type="button"
              className={styles.toolBtn}
              style={{ marginTop: '1rem' }}
              onClick={() => router.push('/student')}
            >
              Back to dashboard
            </button>
          </div>
        </div>
      </div>
    )
  }

  const isFlagged = currentQuestion ? !!flags[currentQuestion.id] : false

  return (
    <div className={styles.runnerContainer} data-theme={theme} data-font-size={fontSize}>
      {!isOnline && (
        <div className={styles.offlineBanner}>
          <CloudOff size={14} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 6 }} />
          You are offline. Answers are stored on this device and will sync automatically.
        </div>
      )}
      {isOnline && syncError && <div className={styles.offlineBanner}>{syncError}</div>}
      {isOnline && !syncError && isSyncing && (
        <div className={styles.syncingBanner}>
          <Loader2 size={14} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 6 }} />
          Saving your answer…
        </div>
      )}

      <header className={styles.header}>
        <div style={{ minWidth: 0 }}>
          <h1
            style={{
              fontSize: '1.05rem',
              fontWeight: 700,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {testTitle ?? 'Mock Test'}
          </h1>
          <p style={{ fontSize: '0.8rem', opacity: 0.7 }}>
            Question {currentIndex + 1} of {totalQuestions} · {answeredCount} answered
          </p>
        </div>
        <div className={`${styles.timer} ${timerClass}`} role="timer" aria-live="polite">
          {formatTime(timeLeft)}
        </div>
      </header>

      <div className={styles.toolbar}>
        <span
          style={{ marginRight: 'auto', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          {isOnline ? <Cloud size={14} /> : <CloudOff size={14} />}
          {queueLength > 0
            ? `${queueLength} answer${queueLength === 1 ? '' : 's'} pending`
            : isSyncing
              ? 'Syncing…'
              : 'All answers saved'}
        </span>

        <button
          type="button"
          className={styles.toolBtn}
          onClick={() => setTheme('light')}
          aria-pressed={theme === 'light'}
        >
          <Sun size={14} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} />
          Light
        </button>
        <button
          type="button"
          className={styles.toolBtn}
          onClick={() => setTheme('dark')}
          aria-pressed={theme === 'dark'}
        >
          <Moon size={14} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} />
          Dark
        </button>
        <button
          type="button"
          className={styles.toolBtn}
          onClick={() => setTheme('high-contrast')}
          aria-pressed={theme === 'high-contrast'}
        >
          <Accessibility size={14} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} />
          Contrast
        </button>
        <select
          className={styles.toolBtn}
          value={fontSize}
          onChange={(e) => setFontSize(e.target.value as FontSize)}
          aria-label="Font size"
        >
          <option value="small">A− Small</option>
          <option value="medium">A Normal</option>
          <option value="large">A+ Large</option>
        </select>
      </div>

      <main className={styles.mainContent}>
        <section className={styles.questionSection}>
          <div
            style={{
              height: 6,
              borderRadius: 999,
              backgroundColor: 'var(--runner-border, var(--color-border))',
              overflow: 'hidden',
              marginBottom: '1.5rem',
            }}
            aria-hidden="true"
          >
            <div
              style={{
                width: `${progressPct}%`,
                height: '100%',
                backgroundColor: 'var(--color-primary)',
                transition: 'width 0.3s ease',
              }}
            />
          </div>

          <div className={styles.questionHeaderRow}>
            <span className={styles.questionMeta}>
              {currentQuestion.section_name || 'General'} · Question {currentIndex + 1}
            </span>
            <button
              type="button"
              className={`${styles.flagBtn} ${isFlagged ? styles.flagBtnActive : ''}`}
              onClick={toggleFlag}
              aria-pressed={isFlagged}
              title={isFlagged ? 'Remove flag from this question' : 'Flag this question for review'}
            >
              <Flag size={14} />
              {isFlagged ? 'Flagged' : 'Flag'}
            </button>
          </div>

          {currentQuestion.comprehension_text && (
            <div
              style={{
                border: '1px solid var(--runner-border, var(--color-border))',
                borderLeft: '4px solid var(--color-primary)',
                borderRadius: 'var(--radius-md, 8px)',
                padding: '1rem 1.25rem',
                marginBottom: '1.5rem',
                maxHeight: '38vh',
                overflowY: 'auto',
                backgroundColor: 'var(--runner-bg, var(--color-background))',
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  fontSize: '0.78rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: '0.5rem',
                  opacity: 0.75,
                }}
              >
                Passage
              </div>
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
                {currentQuestion.comprehension_text}
              </div>
            </div>
          )}

          <h2 className={styles.questionStem}>{currentQuestion.stem}</h2>

          {renderAnswerInput()}

          {submitError && (
            <div
              role="alert"
              style={{
                marginTop: '1.5rem',
                padding: '0.85rem 1rem',
                borderRadius: 'var(--radius-md, 8px)',
                backgroundColor: 'var(--color-danger-bg)',
                color: 'var(--color-danger)',
                fontWeight: 600,
                fontSize: '0.9rem',
              }}
            >
              {submitError}
            </div>
          )}

          <div
            style={{
              display: 'flex',
              gap: '1rem',
              marginTop: '2rem',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <button
              type="button"
              className={styles.toolBtn}
              onClick={goPrev}
              disabled={currentIndex === 0 || isSubmitting}
              style={{ padding: '0.6rem 1.25rem' }}
            >
              ← Previous
            </button>

            {currentIndex < totalQuestions - 1 ? (
              <button
                type="button"
                className={styles.toolBtn}
                onClick={goNext}
                disabled={isSubmitting}
                style={{ padding: '0.6rem 1.25rem' }}
              >
                Next →
              </button>
            ) : (
              <button
                type="button"
                className={styles.toolBtn}
                onClick={requestSubmit}
                disabled={isSubmitting}
                style={{
                  padding: '0.6rem 1.5rem',
                  backgroundColor: 'var(--color-primary)',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 700,
                }}
              >
                {isSubmitting ? 'Submitting…' : 'Submit Test'}
              </button>
            )}
          </div>
        </section>

      </main>

      {/* Bottom question navigator: collapsible, horizontally scrollable strip. */}
      <div className={styles.navigatorBar}>
        <button
          type="button"
          className={styles.navigatorToggle}
          onClick={() => setNavigatorOpen((open) => !open)}
          aria-expanded={navigatorOpen}
        >
          <span>Question Navigator</span>
          <span className={styles.navigatorCounts}>
            {answeredCount}/{totalQuestions} answered
            {flaggedCount > 0 ? ` · ${flaggedCount} flagged` : ''}
          </span>
          {navigatorOpen ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
        </button>

        {navigatorOpen && (
          <div className={styles.navigatorBody}>
            <div
              className={styles.navigatorTrack}
              ref={navTrackRef}
              role="group"
              aria-label="Jump to question"
            >
              {questions.map((q, idx) => {
                const answered = String(responses[q.id] ?? '').trim().length > 0
                const badgeClass = [
                  styles.navBadge,
                  idx === currentIndex ? styles.navBadgeCurrent : '',
                  answered ? styles.navBadgeAnswered : '',
                  flags[q.id] ? styles.navBadgeFlagged : '',
                ]
                  .filter(Boolean)
                  .join(' ')

                return (
                  <button
                    key={q.id}
                    type="button"
                    className={badgeClass}
                    data-current={idx === currentIndex ? 'true' : undefined}
                    onClick={() => goTo(idx)}
                    aria-label={`Go to question ${idx + 1}${answered ? ', answered' : ', unanswered'}${
                      flags[q.id] ? ', flagged' : ''
                    }`}
                    aria-current={idx === currentIndex}
                  >
                    {idx + 1}
                  </button>
                )
              })}
            </div>

            <div className={styles.navigatorStats}>
              <span className={styles.legendItem}>
                <span className={`${styles.legendSwatch} ${styles.legendAnswered}`} />
                Answered <strong>{answeredCount}</strong> / {totalQuestions}
              </span>
              <span className={styles.legendItem}>
                <span className={`${styles.legendSwatch} ${styles.legendUnanswered}`} />
                Unanswered <strong>{unansweredCount}</strong>
              </span>
              <span className={styles.legendItem}>
                <span className={`${styles.legendSwatch} ${styles.legendFlagged}`} />
                Flagged <strong>{flaggedCount}</strong>
              </span>
              <span className={styles.legendItem}>
                Time on questions: <strong>{formatTime(totalAnswerTime)}</strong>
              </span>
              <button
                type="button"
                className={styles.toolBtn}
                style={{ marginLeft: 'auto', padding: '0.5rem 1.25rem', fontWeight: 700 }}
                onClick={requestSubmit}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Submitting…' : 'Submit Test'}
              </button>
            </div>
          </div>
        )}
      </div>

      {showConfirmSubmit && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="submit-title">
          <div className={styles.modalContent}>
            <h2 id="submit-title" style={{ fontSize: '1.35rem', fontWeight: 700 }}>
              Submit your test?
            </h2>
            <p style={{ marginTop: '0.5rem', opacity: 0.8, lineHeight: 1.6 }}>
              You will not be able to change your answers after submitting.
            </p>

            <div className={styles.modalGrid}>
              <div className={styles.statBox}>
                <div className={styles.statNumber}>{answeredCount}</div>
                <div className={styles.statLabel}>Answered</div>
              </div>
              <div className={styles.statBox}>
                <div className={styles.statNumber} style={{ color: 'var(--color-warning)' }}>
                  {unansweredCount}
                </div>
                <div className={styles.statLabel}>Unanswered</div>
              </div>
            </div>

            {queueLength > 0 && (
              <p style={{ fontSize: '0.875rem', opacity: 0.8, marginBottom: '1rem' }}>
                {queueLength} answer{queueLength === 1 ? '' : 's'} will be saved before submitting.
              </p>
            )}

            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.toolBtn}
                style={{ padding: '0.65rem 1.25rem' }}
                onClick={() => setShowConfirmSubmit(false)}
                disabled={isSubmitting}
              >
                Keep Working
              </button>
              <button
                type="button"
                className={styles.toolBtn}
                style={{
                  padding: '0.65rem 1.5rem',
                  backgroundColor: 'var(--color-primary)',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 700,
                }}
                onClick={() => void handleFinalSubmit()}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Submitting…' : 'Submit Now'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Named export kept for existing `import { TestRunner } from '...'` call sites. */
export { TestRunner }
