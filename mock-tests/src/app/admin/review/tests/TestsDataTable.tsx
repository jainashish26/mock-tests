'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from "@/components/ui/Button"
import { Badge } from "@/components/ui/Badge"
import Link from 'next/link'

type Test = {
  id: string
  title: string
  status: string
  exam_type: string
  created_at: string
  updated_at: string
}

export function TestsDataTable({ initialTests }: { initialTests: Test[] }) {
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const router = useRouter()

  const handleStatusChange = async (id: string, action: 'approve' | 'reject') => {
    setLoadingId(id)
    try {
      const res = await fetch(`/api/admin/review/tests/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      })
      
      if (!res.ok) {
        throw new Error('Failed to update status')
      }
      
      router.refresh()
    } catch (err: any) {
      alert(`Error: ${err.message}`)
    } finally {
      setLoadingId(null)
    }
  }

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'PUBLISHED': return 'success'
      case 'PENDING_APPROVAL': return 'warning'
      case 'DRAFT': return 'secondary'
      default: return 'default'
    }
  }

  return (
    <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
        <thead style={{ background: 'var(--color-background-alt)', borderBottom: '1px solid var(--color-border)' }}>
          <tr>
            <th style={{ padding: '1rem', fontWeight: 600 }}>Title</th>
            <th style={{ padding: '1rem', fontWeight: 600 }}>Exam Type</th>
            <th style={{ padding: '1rem', fontWeight: 600 }}>Status</th>
            <th style={{ padding: '1rem', fontWeight: 600 }}>Date updated</th>
            <th style={{ padding: '1rem', fontWeight: 600, textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {initialTests.map(test => (
            <tr key={test.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
              <td style={{ padding: '1rem', fontWeight: 500 }}>
                <Link href={`/admin/review/tests/${test.id}`} style={{ color: 'var(--color-text)', textDecoration: 'none' }}>
                  {test.title}
                </Link>
              </td>
              <td style={{ padding: '1rem', color: 'var(--color-text-muted)' }}>{test.exam_type}</td>
              <td style={{ padding: '1rem' }}>
                <Badge variant={getStatusBadgeVariant(test.status)}>{test.status}</Badge>
              </td>
              <td style={{ padding: '1rem', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
                {new Date(test.updated_at).toLocaleDateString()}
              </td>
              <td style={{ padding: '1rem', textAlign: 'right' }}>
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                  <Link href={`/admin/review/tests/${test.id}`}>
                    <Button variant="outline" size="sm">Details</Button>
                  </Link>
                  {test.status === 'PENDING_APPROVAL' && (
                    <Button 
                      variant="default"
                      size="sm"
                      disabled={loadingId === test.id}
                      onClick={() => handleStatusChange(test.id, 'approve')}
                      style={{ background: 'var(--color-success)', color: 'white', border: 'none' }}
                    >
                      Publish
                    </Button>
                  )}
                  {test.status === 'PUBLISHED' && (
                    <Button 
                      variant="secondary" 
                      size="sm"
                      disabled={loadingId === test.id}
                      onClick={() => handleStatusChange(test.id, 'reject')}
                    >
                      Revert to Draft
                    </Button>
                  )}
                  {(test.status === 'DRAFT' || test.status === 'REJECTED') && (
                    <Button 
                      variant="default" 
                      size="sm"
                      disabled={loadingId === test.id}
                      onClick={() => handleStatusChange(test.id, 'approve')}
                      style={{ background: 'var(--color-primary)', color: 'white', border: 'none' }}
                    >
                      Publish Directly
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {initialTests.length === 0 && (
            <tr>
              <td colSpan={5} style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                No tests found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
