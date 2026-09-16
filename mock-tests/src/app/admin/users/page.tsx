import { requireRole } from '@/lib/rbac/require-role'
import { createAdminClient } from '@/lib/supabase/admin'
import { DashboardLayout } from "@/components/layout/DashboardLayout"
import { UsersDataTable } from './UsersDataTable'

export default async function AdminUsersPage() {
  await requireRole(['ADMIN'])
  
  const adminClient = createAdminClient()

  // 1. Fetch all data needed
  const [
    { data: authData, error: authErr },
    { data: rolesData, error: rolesErr },
    { data: profilesData },
    { data: linksData },
    { data: purchasesData }
  ] = await Promise.all([
    adminClient.auth.admin.listUsers(),
    adminClient.from('app_user_roles').select('user_id, role, created_at'),
    adminClient.from('student_profiles').select('id, auth_user_id'),
    adminClient.from('parent_student_links').select('parent_user_id, student_id'),
    adminClient.from('purchases').select('user_id, total_amount_cents, status')
  ])

  if (authErr || rolesErr) {
    return (
      <DashboardLayout role="ADMIN" userName="System Administrator">
        <div style={{ color: 'var(--color-danger)' }}>
          Error loading users: {authErr?.message || rolesErr?.message}
        </div>
      </DashboardLayout>
    )
  }

  // Maps for efficient lookups
  const rolesMap = new Map()
  if (rolesData) {
    for (const r of rolesData) rolesMap.set(r.user_id, r)
  }

  // student_profile_id -> auth_user_id
  const studentProfileToAuthId = new Map(profilesData?.map(p => [p.id, p.auth_user_id]))
  // auth_user_id -> student_profile_id
  const authIdToStudentProfile = new Map(profilesData?.map(p => [p.auth_user_id, p.id]))

  // parent_user_id -> Array<student_id>
  const parentToStudents = new Map()
  // student_id -> parent_user_id
  const studentToParent = new Map()

  if (linksData) {
    for (const link of linksData) {
      if (!parentToStudents.has(link.parent_user_id)) parentToStudents.set(link.parent_user_id, [])
      parentToStudents.get(link.parent_user_id).push(link.student_id)
      studentToParent.set(link.student_id, link.parent_user_id)
    }
  }

  // auth_id -> array of purchases
  const userPurchases = new Map()
  if (purchasesData) {
    for (const p of purchasesData) {
      if (!userPurchases.has(p.user_id)) userPurchases.set(p.user_id, [])
      userPurchases.get(p.user_id).push(p)
    }
  }

  // user emails
  const emailMap = new Map(authData.users.map(u => [u.id, u.email || 'No Email']))

  const users = authData.users.map(u => {
    const r = rolesMap.get(u.id)
    const role = r ? r.role : 'NO_ROLE'
    
    let relatedEmail: string | null = null
    let studentCount = 0
    let purchasesCount = 0
    let purchasesValueCents = 0

    if (role === 'STUDENT') {
      const studentProfileId = authIdToStudentProfile.get(u.id)
      if (studentProfileId) {
        const parentId = studentToParent.get(studentProfileId)
        if (parentId) {
          relatedEmail = emailMap.get(parentId) || null
        }
      }
    } else if (role === 'PARENT' || role === 'TUTOR') {
      const students = parentToStudents.get(u.id) || []
      studentCount = students.length

      const purchases = userPurchases.get(u.id) || []
      // We will count completed purchases. Depending on the mock, we can just filter out strictly 'FAILED' or we can leave all.
      // Let's only count if it's not pending or failed, e.g. COMPLETED or true. We can just count all here for simplicity. 
      const successfulPurchases = purchases.filter((p: any) => p.status !== 'FAILED')
      purchasesCount = successfulPurchases.length
      purchasesValueCents = successfulPurchases.reduce((sum: number, p: any) => sum + (p.total_amount_cents || 0), 0)
    }

    return {
      id: u.id,
      email: u.email || 'No Email',
      role,
      created_at: r ? r.created_at : u.created_at,
      relatedEmail,
      studentCount,
      purchasesCount,
      purchasesValueCents
    }
  }).sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  return (
    <DashboardLayout role="ADMIN" userName="System Administrator">
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 800 }}>Manage Users</h1>
        <p style={{ color: 'var(--color-text-muted)' }}>View and update user roles and access.</p>
      </div>

      <UsersDataTable initialUsers={users} />
    </DashboardLayout>
  )
}
