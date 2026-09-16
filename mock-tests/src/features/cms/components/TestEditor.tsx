'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function TestEditor({ initialData, isNew }: { initialData?: any, isNew?: boolean }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const formData = new FormData(e.currentTarget)
    
    const payload = {
      title: formData.get('title'),
      exam_type: formData.get('exam_type'),
      year_level_min: parseInt(formData.get('year_level_min') as string),
      year_level_max: parseInt(formData.get('year_level_max') as string),
      time_limit_mins: parseInt(formData.get('time_limit_mins') as string),
      is_free: formData.get('is_free') === 'on',
      status: formData.get('status')
    }

    try {
      const url = isNew ? `/api/creator/tests` : `/api/creator/tests/${initialData.id}`
      const method = isNew ? 'POST' : 'PUT'
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error || 'Failed to save context')
      }
      
      router.push('/creator')
      router.refresh()
    } catch (err: any) {
      setError(err.message)
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', background: 'var(--color-surface)', padding: '2rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
      {error && <div style={{ color: 'var(--color-danger)' }}>{error}</div>}
      
      <label>
        <div>Test Title</div>
        <input type="text" name="title" defaultValue={initialData?.title || ''} required style={{ width: '100%', padding: '0.5rem' }} />
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <label>
          <div>Exam Type</div>
          <select name="exam_type" defaultValue={initialData?.exam_type || 'NAPLAN_STYLE_READING'} required style={{ width: '100%', padding: '0.5rem' }}>
            <option value="BENCHMARK">Benchmark</option>
            <option value="NAPLAN_STYLE_READING">NAPLAN Style Reading</option>
            <option value="NAPLAN_STYLE_NUMERACY">NAPLAN Style Numeracy</option>
            <option value="NAPLAN_STYLE_LANGUAGE_CONVENTION">NAPLAN Style Language Convention</option>
            <option value="MATHS_OLYMPIAD">Maths Olympiad</option>
            <option value="ENGLISH_OLYMPIAD">English Olympiad</option>
            <option value="SELECTIVE">Selective Entry</option>
            <option value="GRAMMAR">Grammar</option>
            <option value="VERBAL_REASONING">Verbal Reasoning</option>
            <option value="NUMERICAL_REASONING">Numerical Reasoning</option>
            <option value="SPELLING">Spelling</option>
            <option value="MENTAL_MATHS">Mental Maths</option>
            <option value="GEOMETRY">Geometry</option>
            <option value="WORD_PROBLEMS">Word Problems</option>
            <option value="PROBLEM_SOLVING">Problem Solving</option>
            <option value="CRITICAL_THINKING">Critical Thinking</option>
            <option value="VOCABULARY">Vocabulary</option>
          </select>
        </label>
        
        <label>
          <div>Time Limit (Minutes)</div>
          <input type="number" name="time_limit_mins" min="1" defaultValue={initialData?.time_limit_mins || 45} required style={{ width: '100%', padding: '0.5rem' }} />
        </label>

        <label>
          <div>Min Year Level (2-8)</div>
          <input type="number" name="year_level_min" min="2" max="8" defaultValue={initialData?.year_level_min || 3} required style={{ width: '100%', padding: '0.5rem' }} />
        </label>

        <label>
          <div>Max Year Level (2-8)</div>
          <input type="number" name="year_level_max" min="2" max="8" defaultValue={initialData?.year_level_max || 5} required style={{ width: '100%', padding: '0.5rem' }} />
        </label>
      </div>

      <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '1rem' }}>
        <input type="checkbox" name="is_free" defaultChecked={!!initialData?.is_free} />
        This is a free test (Requires no entitlement)
      </label>

      <label style={{ marginTop: '1rem' }}>
        <div>Status</div>
        <select name="status" defaultValue={initialData?.status || 'DRAFT'} required style={{ width: '100%', padding: '0.5rem' }}>
          <option value="DRAFT">Draft</option>
          <option value="PENDING_APPROVAL">Pending Approval</option>
        </select>
      </label>

      <div style={{ marginTop: '1rem' }}>
        <button type="submit" disabled={loading} style={{ padding: '0.75rem 1.5rem', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)' }}>
          {loading ? 'Saving...' : 'Save Test Details'}
        </button>
      </div>
    </form>
  )
}
