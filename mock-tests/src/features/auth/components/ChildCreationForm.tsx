'use client'

import { useState } from 'react'

interface ChildCreationFormProps {
  apiEndpoint?: string
  maxStudents?: number | null
  currentCount?: number
}

export function ChildCreationForm({ apiEndpoint = '/api/parent/child', maxStudents = 4, currentCount = 0 }: ChildCreationFormProps) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ username?: string; error?: string } | null>(null)

  const isAtLimit = maxStudents !== null && currentCount >= maxStudents

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setResult(null)

    const form = e.currentTarget
    const formData = new FormData(form)
    const yearLevel = formData.get('yearLevel')
    const password = formData.get('password')

    try {
      const res = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yearLevel, password })
      })
      const data = await res.json()
      
      if (data.error) throw new Error(data.error)
      setResult({ username: data.username })
      form.reset()
    } catch (err: any) {
      setResult({ error: err.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: '1.5rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' }}>
      <h2>Add a Student Profile</h2>
      <p style={{ color: 'var(--color-text-muted)' }}>We do not ask for real names. A fun username will be assigned.</p>
      
      {isAtLimit && (
        <div style={{ padding: '1rem', background: 'rgba(234, 179, 8, 0.1)', color: '#ca8a04', borderRadius: 'var(--radius-sm)', marginBottom: '1rem', fontSize: '0.875rem' }}>
          You have reached the maximum of <strong>{maxStudents}</strong> student profiles. To add more, please upgrade your plan or contact support.
        </div>
      )}

      {result?.error && <div style={{ color: 'var(--color-danger)' }}>{result.error}</div>}
      {result?.username && (
        <div style={{ padding: '1rem', background: 'var(--color-success-bg)', color: 'var(--color-success)', borderRadius: 'var(--radius-sm)', marginBottom: '1rem' }}>
          <strong>Success!</strong> Your student's username is: <code>{result.username}</code><br/>
          They can log in using this username and the password you set.
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
        <label>
          <div>Year Level (2-8)</div>
          <select name="yearLevel" required disabled={isAtLimit} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--color-border)' }}>
            <option value="">Select Year</option>
            {[2,3,4,5,6,7,8].map(y => <option key={y} value={y}>Year {y}</option>)}
          </select>
        </label>
        <label>
          <div>Set Password for Student</div>
          <input type="password" name="password" required minLength={6} disabled={isAtLimit} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--color-border)' }} />
        </label>
        <button type="submit" disabled={loading || isAtLimit} style={{ padding: '0.75rem', background: isAtLimit ? '#94a3b8' : 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: '4px', cursor: isAtLimit ? 'not-allowed' : 'pointer' }}>
          {loading ? 'Creating...' : 'Create Profile'}
        </button>
      </form>
    </div>
  )
}
