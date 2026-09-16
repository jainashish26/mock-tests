'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TestRunner } from '@/features/runner/components/TestRunner'

export default function TestPageClient({ assignmentId, initialAttemptId, timeLimitMins, initialQuestions }: any) {
  const [attemptId, setAttemptId] = useState<string | null>(initialAttemptId)
  const [starting, setStarting] = useState(false)
  const router = useRouter()

  const handleStart = async () => {
    setStarting(true)
    try {
      const res = await fetch('/api/runner/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignmentId })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setAttemptId(data.attemptId)
    } catch(err) {
      console.error(err)
      setStarting(false)
    }
  }

  if (attemptId) {
    return <TestRunner attemptId={attemptId} timeLimitMins={timeLimitMins} initialQuestions={initialQuestions} />
  }

  return (
    <div style={{ padding: '4rem 2rem', maxWidth: '800px', margin: '0 auto', fontFamily: 'var(--font-sans)' }}>
      <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
        <h1 style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>Ready to Start?</h1>
        <p style={{ fontSize: '1.25rem', color: 'var(--color-text-muted)' }}>
          You will have <strong style={{ color: 'var(--color-primary)' }}>{timeLimitMins} minutes</strong> to complete this test.
        </p>
      </div>

      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '2rem', marginBottom: '3rem', boxShadow: 'var(--shadow-md)' }}>
        <h3 style={{ marginTop: 0, paddingBottom: '1rem', borderBottom: '1px solid var(--color-border)' }}>Test Instructions & Tips</h3>
        <ul style={{ lineHeight: '1.8', margin: '1.5rem 0', paddingLeft: '1.5rem' }}>
          <li>The timer will begin immediately after you click Start.</li>
          <li>Your progress is <strong>saved automatically</strong> to your device. You can safely disconnect from the internet and your answers will sync when you reconnect.</li>
          <li>You can flag questions for review and return to them later using the Question Navigator sidebar.</li>
        </ul>

        <div style={{ background: 'var(--color-background)', padding: '1.5rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
          <h4 style={{ margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            Keyboard Shortcuts ⌨️
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.9rem' }}>
            <div><kbd style={{ padding: '0.2rem 0.5rem', background: '#e2e8f0', borderRadius: '4px', border: '1px solid #cbd5e1' }}>←</kbd> / <kbd style={{ padding: '0.2rem 0.5rem', background: '#e2e8f0', borderRadius: '4px', border: '1px solid #cbd5e1' }}>→</kbd> Previous/Next Question</div>
            <div><kbd style={{ padding: '0.2rem 0.5rem', background: '#e2e8f0', borderRadius: '4px', border: '1px solid #cbd5e1' }}>A</kbd> <kbd style={{ padding: '0.2rem 0.5rem', background: '#e2e8f0', borderRadius: '4px', border: '1px solid #cbd5e1' }}>B</kbd> ... Select Option</div>
            <div><kbd style={{ padding: '0.2rem 0.5rem', background: '#e2e8f0', borderRadius: '4px', border: '1px solid #cbd5e1' }}>F</kbd> Flag Question</div>
          </div>
        </div>
      </div>

      <div style={{ textAlign: 'center' }}>
        <button 
          onClick={handleStart} 
          disabled={starting}
          style={{ padding: '1rem 3rem', fontSize: '1.25rem', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-full)', cursor: starting ? 'not-allowed' : 'pointer', fontWeight: 'bold', boxShadow: 'var(--shadow-md)', transition: 'transform 0.2s', opacity: starting ? 0.7 : 1 }}
        >
          {starting ? 'Preparing Your Exam...' : 'Start Test Now'}
        </button>
      </div>
    </div>
  )
}
