import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'
import { DashboardLayout } from "@/components/layout/DashboardLayout"
import { SpatialCard } from "@/components/ui/SpatialCard"

export default async function StudentSettingsPage() {
  const { user } = await requireRole(['STUDENT'])
  const supabase = await createClient()

  // Find student profile to get the custom username
  const { data: profile } = await supabase
    .from('student_profiles')
    .select('username')
    .eq('auth_user_id', user.id)
    .single()

  return (
    <DashboardLayout role="STUDENT" userName={profile?.username || 'Student'}>
      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        <h2 style={{ fontSize: '1.75rem', fontWeight: 800, marginBottom: '1.5rem' }}>Account Details</h2>
        <SpatialCard intensity={5}>
          <div style={{ padding: '2rem' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '1rem' }}>Your Profile</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', color: 'var(--color-text-muted)', marginBottom: '0.25rem' }}>Student Username</label>
                <div style={{ padding: '0.75rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                  {profile?.username}
                </div>
              </div>
              <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginTop: '1rem' }}>
                If you need to change your password or upgrade your year level, please ask your parent to update it from their dashboard.
              </p>
            </div>
          </div>
        </SpatialCard>
      </div>
    </DashboardLayout>
  )
}
