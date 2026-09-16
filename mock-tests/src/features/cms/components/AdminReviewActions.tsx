'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function AdminReviewActions({ entityType, entityId }: { entityType: 'tests' | 'questions', entityId: string }) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleAction = async (action: 'approve' | 'reject') => {
    setLoading(true)
    
    try {
      const res = await fetch(`/api/admin/review/${entityType}/${entityId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Request failed')
      }
      
      router.push('/admin')
      router.refresh()
    } catch (err: any) {
      alert(`Error: ${err.message}`)
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
      <button 
        onClick={() => handleAction('approve')}
        disabled={loading}
        style={{ padding: '0.75rem 1.5rem', background: 'var(--color-success)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 'bold' }}
      >
        Approve & Publish
      </button>
      <button 
        onClick={() => handleAction('reject')}
        disabled={loading}
        style={{ padding: '0.75rem 1.5rem', background: 'var(--color-danger)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 'bold' }}
      >
        Reject (Back to Draft)
      </button>
    </div>
  )
}
