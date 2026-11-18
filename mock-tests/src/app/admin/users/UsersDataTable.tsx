'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CalendarDays, Users as UsersIcon, Wallet } from 'lucide-react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Pagination } from '@/components/ui/Pagination'
import { Select } from '@/components/ui/Select'
import { useToast } from '@/components/ui/Toast'
import { ConfirmDialog } from '@/features/creator/components/ConfirmDialog'
import { ContentToolbar } from '@/features/creator/components/ContentToolbar'
import { formatDate } from '@/features/creator/format'
import { ASSIGNABLE_ROLES, formatCents, roleMeta } from '@/lib/admin/display'

interface User {
  id: string
  email: string
  role: string
  created_at: string
  relatedEmail: string | null
  studentCount: number
  purchasesCount: number
  purchasesValueCents: number
}

type SortKey = 'joined' | 'email' | 'role'

const PAGE_SIZE = 10

const SORT_OPTIONS = [
  { value: 'joined', label: 'Date joined' },
  { value: 'email', label: 'Email (A–Z)' },
  { value: 'role', label: 'Role' },
]

const ROLE_FILTER_OPTIONS = [
  { value: '', label: 'All roles' },
  { value: 'NO_ROLE', label: 'No role' },
  ...ASSIGNABLE_ROLES.map((role) => ({ value: role, label: roleMeta(role).label })),
]

/**
 * Card list of every account, mobile-first (the old fixed-width table forced
 * horizontal scrolling on phones). Role changes go through a confirm dialog and
 * report success/failure via toasts instead of `window.confirm`/`alert`.
 */
export function UsersDataTable({ initialUsers }: { initialUsers: User[] }) {
  const [users, setUsers] = React.useState(initialUsers)
  const [search, setSearch] = React.useState('')
  const [role, setRole] = React.useState('')
  const [sort, setSort] = React.useState<SortKey>('joined')
  const [dir, setDir] = React.useState<'asc' | 'desc'>('desc')
  const [page, setPage] = React.useState(1)

  const [pending, setPending] = React.useState<{ user: User; role: string } | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const toast = useToast()
  const router = useRouter()

  React.useEffect(() => {
    setPage(1)
  }, [search, role, sort, dir])

  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase()
    let rows = users
    if (term) {
      rows = rows.filter(
        (u) => u.email.toLowerCase().includes(term) || (u.relatedEmail ?? '').toLowerCase().includes(term)
      )
    }
    if (role) rows = rows.filter((u) => u.role === role)

    const sorted = [...rows].sort((a, b) => {
      switch (sort) {
        case 'email':
          return a.email.localeCompare(b.email)
        case 'role':
          return a.role.localeCompare(b.role) || a.email.localeCompare(b.email)
        default:
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      }
    })
    return dir === 'asc' ? sorted : sorted.reverse()
  }, [users, search, role, sort, dir])

  const activeFilterCount = (search.trim() ? 1 : 0) + (role ? 1 : 0)
  const clearFilters = () => {
    setSearch('')
    setRole('')
  }

  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  /** Picking a new role opens the confirm dialog; nothing is sent yet. */
  const handleRoleSelect = (user: User, nextRole: string) => {
    if (nextRole === user.role) return
    setError(null)
    setPending({ user, role: nextRole })
  }

  const confirmRoleChange = async () => {
    if (!pending) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${pending.user.id}/role`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: pending.role }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Failed to update role')
      }
      toast.success('Role updated', `${pending.user.email} is now ${roleMeta(pending.role).label.toLowerCase()}.`)
      setUsers((prev) => prev.map((u) => (u.id === pending.user.id ? { ...u, role: pending.role } : u)))
      setPending(null)
      router.refresh()
    } catch (err) {
      // Kept inside the dialog so the reason stays visible while deciding next steps.
      setError(err instanceof Error ? err.message : 'Failed to update role')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ContentToolbar
        idPrefix="users"
        searchLabel="Search users by email"
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by email…"
        filters={[
          {
            key: 'role',
            label: 'Role',
            value: role,
            options: ROLE_FILTER_OPTIONS,
            onChange: setRole,
          },
        ]}
        sort={sort}
        dir={dir}
        sortOptions={SORT_OPTIONS}
        onSortChange={(value) => setSort(value as SortKey)}
        onDirChange={setDir}
        activeFilterCount={activeFilterCount}
        onClearFilters={clearFilters}
      />

      {users.length === 0 ? (
        <EmptyState
          icon={<UsersIcon size={20} />}
          title="No users yet"
          description="Accounts will appear here once people sign up."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<UsersIcon size={20} />}
          title="No users match those filters"
          description="Try a different search term, or clear the filters to see everyone."
          action={
            <Button type="button" variant="outline" size="sm" className="min-h-10" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {pageRows.map((user) => {
            const meta = roleMeta(user.role)
            return (
              <li key={user.id}>
                <article className="rounded-xl border border-border bg-card p-4 shadow-xs transition-colors hover:border-primary/40">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-foreground sm:text-base" title={user.email}>
                        {user.email}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <CalendarDays size={12} aria-hidden="true" />
                          Joined {formatDate(user.created_at)}
                        </span>
                        {user.role === 'STUDENT' ? (
                          <span className="inline-flex min-w-0 items-center gap-1">
                            <UsersIcon size={12} aria-hidden="true" />
                            <span className="truncate">
                              {user.relatedEmail ? `Parent: ${user.relatedEmail}` : 'No parent linked'}
                            </span>
                          </span>
                        ) : null}
                        {user.role === 'PARENT' || user.role === 'TUTOR' ? (
                          <>
                            <span className="inline-flex items-center gap-1">
                              <UsersIcon size={12} aria-hidden="true" />
                              {user.studentCount} student{user.studentCount === 1 ? '' : 's'}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Wallet size={12} aria-hidden="true" />
                              {user.purchasesCount} paid · {formatCents(user.purchasesValueCents)}
                            </span>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <Badge
                      variant={meta.variant}
                      className="shrink-0 text-[0.6875rem] font-bold tracking-wide uppercase"
                    >
                      {meta.label}
                    </Badge>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                    <label htmlFor={`user-role-${user.id}`} className="text-xs font-semibold text-muted-foreground">
                      Role
                    </label>
                    <Select
                      id={`user-role-${user.id}`}
                      value={ASSIGNABLE_ROLES.includes(user.role as (typeof ASSIGNABLE_ROLES)[number]) ? user.role : ASSIGNABLE_ROLES[0]}
                      disabled={busy}
                      onChange={(event) => handleRoleSelect(user, event.target.value)}
                      className="h-9 w-auto min-w-36 text-xs"
                      title={user.role === 'NO_ROLE' ? 'This user has no role yet — pick one to grant access' : 'Change role'}
                    >
                      {ASSIGNABLE_ROLES.map((option) => (
                        <option key={option} value={option}>
                          {roleMeta(option).label}
                        </option>
                      ))}
                    </Select>
                    {user.role === 'NO_ROLE' ? (
                      <span className="text-xs text-muted-foreground">No role assigned</span>
                    ) : null}
                  </div>
                </article>
              </li>
            )
          })}
        </ul>
      )}

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        count={filtered.length}
        onChange={setPage}
        itemLabel="users"
      />

      <ConfirmDialog
        open={pending !== null}
        title="Change user role?"
        description={
          pending ? (
            <>
              <p>
                <span className="font-semibold text-foreground">{pending.user.email}</span> will move from{' '}
                <span className="font-semibold text-foreground">{roleMeta(pending.user.role).label}</span> to{' '}
                <span className="font-semibold text-foreground">{roleMeta(pending.role).label}</span>.
              </p>
              {pending.role === 'ADMIN' ? (
                <p>Admins can moderate all content and change other users&apos; roles. Only grant this to trusted staff.</p>
              ) : null}
              <p>The change takes effect the next time they load the app.</p>
            </>
          ) : null
        }
        confirmLabel="Change role"
        destructive={pending?.role === 'ADMIN'}
        busy={busy}
        error={error}
        onConfirm={confirmRoleChange}
        onCancel={() => {
          if (busy) return
          setPending(null)
          setError(null)
        }}
      />
    </div>
  )
}
