'use client'

import { useEffect, useMemo, useState } from 'react'
import { Sparkles, Send, RotateCcw } from 'lucide-react'
import { scaffoldForYear } from '@/lib/writing/word-limits'

type PracticePrompt = {
  id: string
  text_type: 'narrative' | 'persuasive'
  prompt: string
  min_words: number
  suggested_mins: number
}

export default function AIPracticeClient({ yearLevel }: { yearLevel: number | null }) {
  const [prompts, setPrompts] = useState<PracticePrompt[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/ai-practice')
      .then((r) => r.json())
      .then((d) => setPrompts(d?.prompts ?? []))
      .catch(() => setError('Could not load writing prompts. Please refresh.'))
  }, [])

  const scaffold = scaffoldForYear(yearLevel)
  const selected = useMemo(() => prompts.find((p) => p.id === selectedId) ?? null, [prompts, selectedId])
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  const minWords = selected?.min_words ?? scaffold.minWords

  const submit = async () => {
    if (!selected || !text.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/ai-practice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptId: selected.id, text }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Could not submit. Please try again.')
      setSubmitted(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not submit. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const reset = () => {
    setSubmitted(false)
    setText('')
    setSelectedId(null)
  }

  if (submitted) {
    return (
      <div style={{ maxWidth: '760px', margin: '2rem auto', padding: '0 1rem' }}>
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '3rem 2rem', textAlign: 'center' }}>
          <div aria-hidden="true" style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎉</div>
          <h2 style={{ margin: '0 0 0.75rem', fontSize: '1.5rem' }}>All done — great effort!</h2>
          <p style={{ color: 'var(--color-text-muted)', maxWidth: '420px', margin: '0 auto 2rem', lineHeight: 1.6 }}>
            Your writing has been saved. Feedback will be shared with your parent or guardian so you can keep improving.
          </p>
          <button onClick={reset} style={secondaryBtn}>
            <RotateCcw size={16} /> Write another
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '820px', margin: '0 auto', padding: '2rem 1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <Sparkles size={28} style={{ color: 'var(--color-primary)' }} />
        <div>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 800, margin: 0 }}>AI Practice Lab</h2>
          <p style={{ color: 'var(--color-text-muted)', margin: '0.25rem 0 0' }}>
            Pick a prompt, write, and get detailed feedback shared with your family.
          </p>
        </div>
      </div>

      {error && (
        <div role="alert" style={{ background: 'var(--color-danger-bg, #fef2f2)', color: 'var(--color-danger)', border: '1px solid var(--color-danger)', borderRadius: 'var(--radius-md)', padding: '0.75rem 1rem', marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '1.5rem' }}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.125rem' }}>1. Choose a prompt</h3>
          <div style={{ display: 'grid', gap: '0.6rem' }}>
            {prompts.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                style={{
                  textAlign: 'left',
                  background: selectedId === p.id ? 'var(--color-primary)' : 'var(--color-bg, #f8fafc)',
                  color: selectedId === p.id ? '#fff' : 'inherit',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '0.9rem 1rem',
                  cursor: 'pointer',
                  font: 'inherit',
                }}
              >
                <span style={{ fontWeight: 700, textTransform: 'capitalize', display: 'block', marginBottom: '0.25rem' }}>
                  {p.text_type} · {p.suggested_mins} min
                </span>
                {p.prompt}
              </button>
            ))}
          </div>
        </div>

        {selected && (
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '1.5rem' }}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.125rem' }}>2. Write your response</h3>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={12}
              placeholder="Start writing here…"
              style={{ width: '100%', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', font: 'inherit', resize: 'vertical' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
              <span>{words} {words === 1 ? 'word' : 'words'}</span>
              <span style={{ color: words < minWords ? 'var(--color-warning)' : undefined }}>
                aim for at least {minWords} words
              </span>
            </div>
            <button onClick={submit} disabled={submitting || !text.trim()} style={primaryBtn}>
              <Send size={16} /> {submitting ? 'Saving…' : 'Submit for feedback'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const primaryBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.5rem',
  marginTop: '1rem',
  padding: '0.75rem 1.5rem',
  background: 'var(--color-primary)',
  color: '#fff',
  border: 'none',
  borderRadius: '9999px',
  fontWeight: 700,
  cursor: 'pointer',
  minHeight: '48px',
}

const secondaryBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.5rem',
  padding: '0.75rem 1.5rem',
  background: 'var(--color-surface)',
  color: 'var(--color-primary)',
  border: '1px solid var(--color-border)',
  borderRadius: '9999px',
  fontWeight: 700,
  cursor: 'pointer',
  minHeight: '48px',
}