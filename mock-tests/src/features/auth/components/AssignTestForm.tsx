'use client'

import { useState } from 'react'

export function AssignTestForm({ studentId, tests }: { studentId: string, tests: any[] }) {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const handleAssign = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    const formData = new FormData(e.currentTarget)
    const testId = formData.get('testId')

    try {
      const res = await fetch('/api/parent/assign-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, testId })
      })
      const data = await res.json()
      
      if (data.error) throw new Error(data.error)
      setMessage('Test assigned successfully!')
    } catch (err: any) {
      setMessage(`Error: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleAssign} style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
      <select name="testId" required style={{ flex: 1, padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--color-border)' }}>
        <option value="">Select a test to assign...</option>
        {tests.map(t => (
          <option key={t.id} value={t.id}>{t.title} ({t.exam_type})</option>
        ))}
      </select>
      <button 
        type="submit" 
        disabled={loading || tests.length === 0}
        style={{ padding: '0.5rem 1rem', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
      >
        {loading ? 'Assigning...' : 'Assign'}
      </button>
      {message && <span style={{ marginLeft: '1rem', color: message.includes('Error') ? 'var(--color-danger)' : 'var(--color-success)', alignSelf: 'center' }}>{message}</span>}
    </form>
  )
}
