import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'
import { DashboardLayout } from "@/components/layout/DashboardLayout"
import { SpatialCard } from "@/components/ui/SpatialCard"
import { Sparkles, Construction } from "lucide-react"
import { Button } from "@/components/ui/Button"

export default async function AIPracticePage() {
  const { user } = await requireRole(['STUDENT'])
  const supabase = await createClient()

  const { data: profile } = await supabase
    .from('student_profiles')
    .select('username')
    .eq('auth_user_id', user.id)
    .single()

  return (
    <DashboardLayout role="STUDENT" userName={profile?.username || 'Student'}>
      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <Sparkles size={28} style={{ color: 'var(--color-primary)' }} />
          <h2 style={{ fontSize: '1.75rem', fontWeight: 800, margin: 0 }}>AI Practice Lab</h2>
        </div>
        
        <SpatialCard intensity={10}>
          <div style={{ padding: '4rem', textAlign: 'center' }}>
            <div style={{ background: 'var(--color-surface)', width: '5rem', height: '5rem', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
              <Construction size={40} style={{ color: 'var(--color-warning)' }} />
            </div>
            <h3 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0 }}>Under Construction</h3>
            <p style={{ color: 'var(--color-text-muted)', marginTop: '0.5rem', maxWidth: '400px', margin: '0.5rem auto 2rem' }}>
              We are currently fine-tuning our AI marking assistant. Soon you will be able to submit writing responses and get immediate, detailed feedback!
            </p>
            <Button variant="outline">Back to Dashboard</Button>
          </div>
        </SpatialCard>
      </div>
    </DashboardLayout>
  )
}
