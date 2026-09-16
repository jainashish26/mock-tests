import { requireRole } from '@/lib/rbac/require-role'
import { DashboardLayout } from "@/components/layout/DashboardLayout"
import { SpatialCard } from "@/components/ui/SpatialCard"

export default async function TutorSettingsPage() {
  const { user } = await requireRole(['TUTOR'])

  return (
    <DashboardLayout role="TUTOR" userName="Tutor Account">
      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        <h2 style={{ fontSize: '1.75rem', fontWeight: 800, marginBottom: '1.5rem' }}>Settings</h2>
        <SpatialCard intensity={5}>
          <div style={{ padding: '2rem' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '1rem' }}>Account Details</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', color: 'var(--color-text-muted)', marginBottom: '0.25rem' }}>Email Address</label>
                <div style={{ padding: '0.75rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                  {user.email}
                </div>
              </div>
              <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginTop: '1rem' }}>
                Additional settings and notification preferences will be available soon.
              </p>
            </div>
          </div>
        </SpatialCard>
      </div>
    </DashboardLayout>
  )
}
