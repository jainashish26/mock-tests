import * as React from 'react'
import { AlertTriangle, Users as UsersIcon } from 'lucide-react'

import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/features/creator/components/PageHeader'
import { requireRole } from '@/lib/rbac/require-role'
import { createAdminClient } from '@/lib/supabase/admin'

import { UsersDataTable } from './UsersDataTable'

export const metadata = {
  title: 'Manage users — Admin',
}

export const dynamic = 'force-dynamic'

/**
 * Aggregates every account into one flat list for `UsersDataTable`:
 * auth users + roles + parent/student links + purchase totals.
 *
 * The service client is required — `app_user_roles`, links and purchases belong
 * to other users, so the RLS client would hide them from an admin.
 */
export default async function AdminUsersPage() {
  await requireRole(['ADMIN'])

  const adminClient = createAdminClient()

  const [
    { data: authData, error: authErr },
    { data: rolesData, error: rolesErr },
    { data: profilesData },
    { data: linksData },
    { data: purchasesData },
  ] = await Promise.all([
    // GoTrue has no count endpoint; one page of 200 covers the current user base.
    adminClient.auth.admin.listUsers({ page: 1, perPage: 200 }),
    adminClient.from('app_user_roles').select('user_id, role, created_at'),
    adminClient.from('student_profiles').select('id, auth_user_id'),
    adminClient.from('parent_student_links').select('parent_user_id, student_id'),
    adminClient.from('purchases').select('user_id, total_amount_cents, status'),
  ])

  if (authErr || rolesErr) {
    return (
      <>
        <PageHeader title="Manage users" description="View and update user roles and access." />
        <EmptyState
          icon={<AlertTriangle size={20} />}
          title="We could not load users"
          description={authErr?.message || rolesErr?.message || 'Unknown error.'}
        />
      </>
    )
  }

  // Latest role wins if a user somehow has several rows.
  const rolesMap = new Map<string, { role: string; created_at: string }>()
  for (const r of rolesData ?? []) rolesMap.set(r.user_id, r)

  // auth_user_id -> student_profile_id
  const authIdToStudentProfile = new Map<string, string>(
    (profilesData ?? []).map((p) => [p.auth_user_id, p.id])
  )
  // parent_user_id -> student profile ids; student profile id -> parent user id
  const parentToStudents = new Map<string, string[]>()
  const studentToParent = new Map<string, string>()
  for (const link of linksData ?? []) {
    if (!parentToStudents.has(link.parent_user_id)) parentToStudents.set(link.parent_user_id, [])
    parentToStudents.get(link.parent_user_id)!.push(link.student_id)
    studentToParent.set(link.student_id, link.parent_user_id)
  }

  // user id -> purchases
  const userPurchases = new Map<string, { total_amount_cents: number | null; status: string }[]>()
  for (const p of purchasesData ?? []) {
    if (!userPurchases.has(p.user_id)) userPurchases.set(p.user_id, [])
    userPurchases.get(p.user_id)!.push(p)
  }

  const emailMap = new Map((authData?.users ?? []).map((u) => [u.id, u.email || 'No email']))

  const users = (authData?.users ?? [])
    .map((u) => {
      const r = rolesMap.get(u.id)
      const role = r ? r.role : 'NO_ROLE'

      let relatedEmail: string | null = null
      let studentCount = 0
      let purchasesCount = 0
      let purchasesValueCents = 0

      if (role === 'STUDENT') {
        const studentProfileId = authIdToStudentProfile.get(u.id)
        const parentId = studentProfileId ? studentToParent.get(studentProfileId) : undefined
        if (parentId) relatedEmail = emailMap.get(parentId) ?? null
      } else if (role === 'PARENT' || role === 'TUTOR') {
        studentCount = (parentToStudents.get(u.id) ?? []).length
        // Anything that is not FAILED counts towards their spend.
        const successfulPurchases = (userPurchases.get(u.id) ?? []).filter((p) => p.status !== 'FAILED')
        purchasesCount = successfulPurchases.length
        purchasesValueCents = successfulPurchases.reduce((sum, p) => sum + (p.total_amount_cents || 0), 0)
      }

      return {
        id: u.id,
        email: u.email || 'No email',
        role,
        created_at: r ? r.created_at : u.created_at,
        relatedEmail,
        studentCount,
        purchasesCount,
        purchasesValueCents,
      }
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  return (
    <>
      <PageHeader
        title="Manage users"
        description="Search every account, see their role and links, and change access when needed."
        meta={
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <UsersIcon size={14} aria-hidden="true" />
            {users.length} account{users.length === 1 ? '' : 's'}
          </span>
        }
      />
      <UsersDataTable initialUsers={users} />
    </>
  )
}
