import { StudentLoginForm } from '@/features/auth/components/StudentLoginForm'
import { PublicLayout } from "@/components/layout/PublicLayout"
import { SpatialCard } from "@/components/ui/SpatialCard"
import { Badge } from "@/components/ui/Badge"

export default function StudentLoginPage() {
  return (
    <PublicLayout>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 10rem)', paddingTop: '5rem' }}>
        <SpatialCard intensity={15} className="max-w-md w-full">
          <div style={{ padding: '3.5rem', width: '100%', maxWidth: '450px', textAlign: 'center' }}>
            <div style={{ marginBottom: '3rem' }}>
              <Badge variant="secondary" style={{ marginBottom: '1.25rem' }}>Student Portal</Badge>
              <h1 style={{ fontSize: '2.5rem', fontWeight: 800, margin: 0 }}>Ready to Learn?</h1>
              <p style={{ color: 'var(--muted-foreground)', marginTop: '0.75rem', fontSize: '1.125rem' }}>Enter your special username to start your adventure.</p>
            </div>
            
            <StudentLoginForm />
            
            <p style={{ marginTop: '3rem', fontSize: '0.8125rem', color: '#94a3b8' }}>
              Can&apos;t remember your name? Ask your parent or teacher for help!
            </p>
          </div>
        </SpatialCard>
      </div>
    </PublicLayout>
  )
}
