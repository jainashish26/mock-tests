'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from "@/components/ui/Badge"

type User = {
  id: string
  email: string
  role: string
  created_at: string
  relatedEmail: string | null
  studentCount: number
  purchasesCount: number
  purchasesValueCents: number
}

const ROLES = ['STUDENT', 'PARENT', 'TUTOR', 'TEST_CREATOR', 'ADMIN']

export function UsersDataTable({ initialUsers }: { initialUsers: User[] }) {
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [roleFilter, setRoleFilter] = useState<string>('ALL')
  const router = useRouter()

  const handleRoleChange = async (id: string, newRole: string) => {
    if (!window.confirm(`Are you sure you want to change user role to ${newRole}?`)) return
    
    setLoadingId(id)
    try {
      const res = await fetch(`/api/admin/users/${id}/role`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole })
      })
      
      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || 'Failed to update role')
      }
      
      router.refresh()
    } catch (err: any) {
      alert(`Error: ${err.message}`)
    } finally {
      setLoadingId(null)
    }
  }

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case 'ADMIN': return 'destructive'
      case 'TEST_CREATOR': return 'warning'
      case 'TUTOR': return 'success'
      case 'PARENT': return 'secondary'
      case 'STUDENT': return 'default'
      default: return 'outline'
    }
  }

  const filteredUsers = useMemo(() => {
    if (roleFilter === 'ALL') return initialUsers
    return initialUsers.filter(u => u.role === roleFilter)
  }, [initialUsers, roleFilter])

  return (
    <div>
      <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <label htmlFor="roleFilter" style={{ fontWeight: 600 }}>Filter by Role:</label>
        <select 
          id="roleFilter"
          value={roleFilter} 
          onChange={(e) => setRoleFilter(e.target.value)}
          style={{ padding: '0.5rem', borderRadius: '0.5rem', border: '1px solid var(--color-border)', minWidth: '150px' }}
        >
          <option value="ALL">All Roles</option>
          {ROLES.map(r => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>

      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '1000px' }}>
          <thead style={{ background: 'var(--color-background-alt)', borderBottom: '1px solid var(--color-border)' }}>
            <tr>
              <th style={{ padding: '1rem', fontWeight: 600 }}>Email</th>
              <th style={{ padding: '1rem', fontWeight: 600 }}>Role</th>
              <th style={{ padding: '1rem', fontWeight: 600 }}>Related Role</th>
              <th style={{ padding: '1rem', fontWeight: 600 }}>Students Linked</th>
              <th style={{ padding: '1rem', fontWeight: 600 }}>Paid Tests</th>
              <th style={{ padding: '1rem', fontWeight: 600 }}>Value Bought</th>
              <th style={{ padding: '1rem', fontWeight: 600, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map(user => (
              <tr key={user.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={{ padding: '1rem', fontWeight: 500, color: 'var(--color-text)' }}>
                  {user.email}
                </td>
                <td style={{ padding: '1rem' }}>
                  <Badge variant={getRoleBadgeVariant(user.role)}>{user.role}</Badge>
                </td>
                <td style={{ padding: '1rem', color: 'var(--color-text-muted)' }}>
                  {user.role === 'STUDENT' ? (user.relatedEmail ? user.relatedEmail : 'None') : '-'}
                </td>
                <td style={{ padding: '1rem', color: 'var(--color-text-muted)' }}>
                  {(user.role === 'PARENT' || user.role === 'TUTOR') ? user.studentCount : '-'}
                </td>
                <td style={{ padding: '1rem', color: 'var(--color-text-muted)' }}>
                  {(user.role === 'PARENT' || user.role === 'TUTOR') ? user.purchasesCount : '-'}
                </td>
                <td style={{ padding: '1rem', color: 'var(--color-text-muted)' }}>
                  {(user.role === 'PARENT' || user.role === 'TUTOR') 
                    ? `$${(user.purchasesValueCents / 100).toFixed(2)}` 
                    : '-'}
                </td>
                <td style={{ padding: '1rem', textAlign: 'right' }}>
                  <select 
                    value={user.role} 
                    onChange={(e) => handleRoleChange(user.id, e.target.value)}
                    disabled={loadingId === user.id}
                    style={{ padding: '0.375rem', borderRadius: '0.25rem', border: '1px solid var(--color-border)' }}
                  >
                    <option value="NO_ROLE">Select Role...</option>
                    {ROLES.map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
            {filteredUsers.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                  No users found matching the selected filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
