'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles, Send, ChevronLeft, Shuffle, Clock, CheckCircle2, AlertTriangle, ListChecks } from 'lucide-react'

type PromptType = 'narrative' | 'persuasive'

interface Prompt {
  id: string
  year: number
  territory: string
  type: PromptType
  text: string
}

interface Calibration {
  minWords: number
  maxWords: number
  mins: number
}

interface PracticeData {
  year: number
  calibration: Calibration
  prompts: Prompt[]
  criteria: { narrative: string[]; persuasive: string[] }
}

type Step = 'type' | 'prompt' | 'briefing' | 'writing' | 'done'

function countWords(t: string): number {
  const s = t.trim()
  return s ? s.split(/\s+/).length : 0
}

function fmtTime(total: number): string {
  const safe = Math.max(0, total)
  const m = Math.floor(safe / 60)
  const s = safe % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * AI Practice Lab — student writing experience.
 *
 * Flow: choose type → choose prompt (year-defaulted, or Random) → briefing with
 * the top marking criteria → "Start Writing" begins the countdown → a
 * distraction-free, full-screen focus editor (nav covered) with a live word
 * counter and anti-cheat guardrails → acknowledgement (students never see a
 * score; feedback goes to the parent, per migration 015).
 */
export default function AIPracticeClient({ yearLevel }: { yearLevel: number | null }) {
  const [data, setData] = useState<PracticeData | null>(null)
  const [step, setStep] = useState<Step>('type')
  const [type, setType] = useState<PromptType | null>(null)
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [text, setText] = useState('')
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [showCriteria, setShowCriteria] = useState(false)
  const submittedRef = useRef(false)
  const submitRef = useRef<((auto: boolean) => Promise<void>) | null>(null)

  useEffect(() => {
    fetch('/api/ai-practice')
      .then((r) => r.json())
      .then((d: PracticeData) => setData(d))
      .catch(() => setError('Could not load prompts. Please refresh the page.'))
  }, [])

  const words = useMemo(() => countWords(text), [text])
  const recommended = data?.calibration.maxWords ?? 0
  const displayYear = data?.year ?? yearLevel

  const submit = useCallback(
    async (auto = false) => {
      if (submittedRef.current || !prompt) return
      if (!text.trim()) {
        if (!auto) setError('Write something before submitting.')
        return
      }
      submittedRef.current = true
      setSubmitting(true)
      setError(null)
      try {
        const res = await fetch('/api/ai-practice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ promptId: prompt.id, text }),
        })
        const d = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) throw new Error(d?.error ?? 'Could not submit. Please try again.')
        setStep('done')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not submit. Please try again.')
        submittedRef.current = false
      } finally {
        setSubmitting(false)
      }
    },
    [prompt, text]
  )

  submitRef.current = submit

  // Countdown; auto-submits when it reaches zero.
  useEffect(() => {
    if (step !== 'writing') return
    if (secondsLeft <= 0) {
      void submitRef.current?.(true)
      return
    }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [step, secondsLeft])

  // Focus mode: lock background scroll and notice tab/window leave.
  useEffect(() => {
    if (step !== 'writing') return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const flag = () => {
      setWarning('Stay on this page while writing. Leaving may be recorded.')
    }
    const onVis = () => {
      if (document.visibilityState === 'hidden') flag()
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('blur', flag)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('blur', flag)
    }
  }, [step])

  const startWriting = () => {
    if (!data || !prompt) return
    submittedRef.current = false
    setSecondsLeft(data.calibration.mins * 60)
    setWarning(null)
    setStep('writing')
  }

  const pickRandom = () => {
    if (!data || !type) return
    const pool = data.prompts.filter((p) => p.type === type)
    if (pool.length === 0) return
    setPrompt(pool[Math.floor(Math.random() * pool.length)])
    setStep('briefing')
  }

  const resetAll = () => {
    submittedRef.current = false
    setText('')
    setPrompt(null)
    setType(null)
    setWarning(null)
    setSecondsLeft(0)
    setStep('type')
  }

  if (step === 'done') {
    return (
      <div style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}>
        <div style={{ maxWidth: '34rem', width: '100%', textAlign: 'center', padding: '3rem 2rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)' }}>
          <div aria-hidden="true" style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎉</div>
          <h2 style={{ margin: '0 0 0.75rem', fontSize: '1.5rem', fontWeight: 800 }}>Great work — you finished!</h2>
          <p style={{ color: 'var(--color-text-muted)', lineHeight: 1.6, margin: '0 auto 1.5rem', maxWidth: '26rem' }}>
            Your writing is saved. Feedback will be shared with your parent or guardian so you can keep improving.
          </p>
          <button type="button" onClick={resetAll} style={pillSecondary}>
            Write another
          </button>
        </div>
      </div>
    )
  }

  if (step === 'writing') {
    const lowTime = secondsLeft <= 60
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'var(--color-bg, #ffffff)', display: 'flex', flexDirection: 'column' }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem 1.25rem', borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)' }}>
              {prompt?.type} · {prompt?.territory}
              {displayYear ? ` · Year ${displayYear}` : ''}
            </div>
            <div style={{ fontSize: '0.95rem', fontWeight: 600, marginTop: '0.15rem' }}>{prompt?.text}</div>
          </div>
          <button type="button" onClick={() => setShowCriteria((s) => !s)} aria-expanded={showCriteria} style={ghostBtn} title="Show marking focus">
            <ListChecks size={16} /> <span style={{ fontSize: '0.8rem' }}>Focus</span>
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontVariantNumeric: 'tabular-nums', fontWeight: 800, fontSize: '1.25rem', color: lowTime ? 'var(--color-danger)' : 'var(--color-primary)' }}>
            <Clock size={18} aria-hidden="true" /> {fmtTime(secondsLeft)}
          </div>
        </header>

        {showCriteria && data && (
          <div style={{ padding: '0.6rem 1.25rem', background: 'var(--color-warning-bg, #fffbeb)', borderBottom: '1px solid var(--color-border)', fontSize: '0.85rem' }}>
            <strong>Remember: </strong>
            {(data.criteria[type ?? 'narrative'] ?? []).join(' · ')}
          </div>
        )}

        {warning && (
          <div role="status" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1.25rem', background: 'var(--color-danger-bg, #fef2f2)', color: 'var(--color-danger)', fontSize: '0.85rem' }}>
            <AlertTriangle size={14} aria-hidden="true" /> {warning}
          </div>
        )}

        <div style={{ flex: 1, display: 'flex', padding: '1rem 1.25rem', minHeight: 0 }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              e.preventDefault()
              setWarning('Pasting is disabled during the writing task.')
            }}
            onCopy={(e) => e.preventDefault()}
            onCut={(e) => e.preventDefault()}
            onDrop={(e) => e.preventDefault()}
            onContextMenu={(e) => e.preventDefault()}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            data-gramm="false"
            data-gramm_editor="false"
            placeholder="Start writing here…"
            aria-label="Your writing"
            style={{ flex: 1, width: '100%', resize: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '1.25rem', fontSize: '1.125rem', lineHeight: 1.9, fontFamily: 'inherit', background: 'var(--color-surface)', color: 'var(--color-text)', outline: 'none' }}
          />
        </div>

        <footer style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', padding: '0.75rem 1.25rem', borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)', flexWrap: 'wrap' }}>
          <div style={{ fontSize: '0.95rem', color: words >= recommended ? 'var(--color-success)' : 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            <strong style={{ fontSize: '1.15rem' }}>{words}</strong> / {recommended} words
          </div>
          {error && <span style={{ color: 'var(--color-danger)', fontSize: '0.85rem' }}>{error}</span>}
          <button type="button" onClick={() => submit(false)} disabled={submitting || !text.trim()} style={pillPrimary}>
            <Send size={16} aria-hidden="true" /> {submitting ? 'Submitting…' : 'Submit'}
          </button>
        </footer>
      </div>
    )
  }

  const promptsOfType = data && type ? data.prompts.filter((p) => p.type === type) : []

  return (
    <div style={{ maxWidth: '860px', margin: '0 auto', padding: '2rem 1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
        <Sparkles size={26} style={{ color: 'var(--color-primary)' }} aria-hidden="true" />
        <h2 style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0 }}>AI Practice Lab</h2>
      </div>
      <p style={{ color: 'var(--color-text-muted)', margin: '0 0 1.5rem' }}>
        {displayYear ? `Year ${displayYear} · ` : ''}Choose a topic, read the marking focus, then write against the clock.
      </p>

      {error && (
        <div role="alert" style={{ background: 'var(--color-danger-bg, #fef2f2)', color: 'var(--color-danger)', border: '1px solid var(--color-danger)', borderRadius: 'var(--radius-md)', padding: '0.75rem 1rem', marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      {!data && <p style={{ color: 'var(--color-text-muted)' }}>Loading prompts…</p>}

      {data && step === 'type' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
          <button type="button" onClick={() => { setType('narrative'); setStep('prompt') }} style={typeCard}>
            <span style={{ fontSize: '2rem' }} aria-hidden="true">📖</span>
            <strong style={{ fontSize: '1.2rem' }}>Narrative</strong>
            <span style={typeCardSub}>Tell a story — characters, a problem, and a resolution.</span>
          </button>
          <button type="button" onClick={() => { setType('persuasive'); setStep('prompt') }} style={typeCard}>
            <span style={{ fontSize: '2rem' }} aria-hidden="true">🗣️</span>
            <strong style={{ fontSize: '1.2rem' }}>Persuasive</strong>
            <span style={typeCardSub}>Argue a point of view and convince your reader.</span>
          </button>
        </div>
      )}

      {data && step === 'prompt' && type && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <button type="button" onClick={() => setStep('type')} style={ghostBtn}>
              <ChevronLeft size={16} aria-hidden="true" /> Back
            </button>
            <button type="button" onClick={pickRandom} style={pillSecondary}>
              <Shuffle size={16} aria-hidden="true" /> Random prompt
            </button>
          </div>
          <h3 style={{ margin: '0 0 1rem', textTransform: 'capitalize' }}>{type} prompts · Year {data.year}</h3>
          <div style={{ display: 'grid', gap: '0.6rem' }}>
            {promptsOfType.map((p) => (
              <button key={p.id} type="button" onClick={() => { setPrompt(p); setStep('briefing') }} style={promptCard}>
                <span style={territoryTag}>{p.territory}</span>
                <span>{p.text}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {data && step === 'briefing' && prompt && type && (
        <div>
          <button type="button" onClick={() => setStep('prompt')} style={{ ...ghostBtn, marginBottom: '1rem' }}>
            <ChevronLeft size={16} aria-hidden="true" /> Choose a different prompt
          </button>
          <div style={briefCard}>
            <span style={territoryTag}>{prompt.territory} · {prompt.type}</span>
            <h3 style={{ fontSize: '1.35rem', margin: '0.75rem 0 1rem', lineHeight: 1.4 }}>{prompt.text}</h3>
            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', color: 'var(--color-text-muted)', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
              <span><strong style={{ color: 'var(--color-text)' }}>{data.calibration.minWords}–{data.calibration.maxWords}</strong> words</span>
              <span><strong style={{ color: 'var(--color-text)' }}>{data.calibration.mins}</strong> minutes</span>
            </div>
            <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>Top marking focus</h4>
            <ul style={{ margin: '0 0 1.5rem', paddingLeft: '1.25rem', color: 'var(--color-text-muted)', lineHeight: 1.8 }}>
              {(data.criteria[type] ?? []).map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
            <button type="button" onClick={startWriting} style={pillPrimary}>
              <CheckCircle2 size={18} aria-hidden="true" /> Start writing
            </button>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '0.75rem' }}>
              The timer starts when you begin. Spelling and grammar helpers are turned off.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

const typeCard: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: '0.5rem',
  padding: '1.75rem',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  cursor: 'pointer',
  textAlign: 'left',
  font: 'inherit',
  color: 'inherit',
}

const typeCardSub: React.CSSProperties = {
  color: 'var(--color-text-muted)',
  fontSize: '0.9rem',
  lineHeight: 1.5,
}

const promptCard: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.4rem',
  alignItems: 'flex-start',
  padding: '1rem 1.1rem',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  textAlign: 'left',
  font: 'inherit',
  color: 'inherit',
  lineHeight: 1.5,
}

const territoryTag: React.CSSProperties = {
  fontSize: '0.7rem',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  fontWeight: 700,
  color: 'var(--color-primary)',
  background: 'var(--color-bg, #eef2ff)',
  border: '1px solid var(--color-border)',
  borderRadius: '999px',
  padding: '0.15rem 0.6rem',
}

const briefCard: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  padding: '2rem',
}

const pillPrimary: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.5rem',
  padding: '0.8rem 1.6rem',
  background: 'var(--color-primary)',
  color: '#fff',
  border: 'none',
  borderRadius: '999px',
  fontWeight: 700,
  fontSize: '1rem',
  cursor: 'pointer',
  minHeight: '48px',
}

const pillSecondary: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.5rem',
  padding: '0.6rem 1.2rem',
  background: 'var(--color-surface)',
  color: 'var(--color-primary)',
  border: '1px solid var(--color-border)',
  borderRadius: '999px',
  fontWeight: 700,
  cursor: 'pointer',
  minHeight: '44px',
}

const ghostBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.4rem',
  padding: '0.5rem 0.9rem',
  background: 'transparent',
  color: 'var(--color-text-muted)',
  border: '1px solid var(--color-border)',
  borderRadius: '999px',
  fontWeight: 600,
  cursor: 'pointer',
  font: 'inherit',
}