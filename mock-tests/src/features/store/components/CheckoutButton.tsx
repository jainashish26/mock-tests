'use client'

import { useState } from 'react'

export function CheckoutButton({ testId, testTitle }: { testId: string, testTitle: string }) {
  const [loading, setLoading] = useState(false)

  const handleCheckout = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testId, testTitle })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      
      window.location.href = data.url
    } catch (err) {
      console.error(err)
      alert('Failed to start checkout process')
      setLoading(false)
    }
  }

  return (
    <button 
      onClick={handleCheckout} 
      disabled={loading}
      style={{ padding: '0.75rem 1.5rem', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 'bold' }}
    >
      {loading ? 'Processing...' : 'Purchase for $15'}
    </button>
  )
}
