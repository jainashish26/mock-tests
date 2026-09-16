'use client'

import { useState } from 'react'

export function StudentLoginForm() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const formData = new FormData(e.currentTarget)
    const username = formData.get('username') as string
    const password = formData.get('password') as string

    // Translate to synthetic email
    const syntheticEmail = `${username}@students.mocktest.internal`
    
    // Call our server action or do auth directly
    try {
      const res = await fetch('/api/auth/student-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: syntheticEmail, password })
      })
      const data = await res.json()
      
      if (data.error) throw new Error(data.error)
      
      // Redirect to student dashboard
      window.location.href = '/student'
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {error && <div style={{ color: 'var(--color-danger)' }}>{error}</div>}
      <input 
        type="text" 
        name="username" 
        placeholder="Username (e.g. RoseApple1234)" 
        required 
        style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--color-border)' }}
      />
      <input 
        type="password" 
        name="password" 
        placeholder="Password" 
        required 
        style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--color-border)' }}
      />
      <button 
        type="submit" 
        disabled={loading}
        style={{ padding: '0.75rem', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
      >
        {loading ? 'Logging In...' : 'Student Login'}
      </button>
    </form>
  )
}
