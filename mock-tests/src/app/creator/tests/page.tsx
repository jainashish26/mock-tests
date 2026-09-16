import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { DashboardLayout } from "@/components/layout/DashboardLayout"
import { SpatialCard } from "@/components/ui/SpatialCard"
import { Badge } from "@/components/ui/Badge"
import { Button } from "@/components/ui/Button"
import { Plus, ArrowLeft, FileEdit, Clock, Copy } from "lucide-react"

export default async function MyTestsPage() {
  const { user } = await requireRole(['TEST_CREATOR', 'ADMIN'])
  const supabase = await createClient()

  // Fetch created tests
  const { data: tests } = await supabase
    .from('tests')
    .select('id, title, status, exam_type, created_at')
    .eq('created_by', user.id)
    .order('created_at', { ascending: false })

  return (
    <DashboardLayout role="CREATOR" userName="Expert Content Creator">
      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <Link href="/creator">
              <Button variant="ghost" size="icon"><ArrowLeft size={20} /></Button>
            </Link>
            <div>
              <h1 style={{ fontSize: '1.75rem', fontWeight: 800, margin: 0 }}>My Exams</h1>
              <p style={{ color: 'var(--color-text-muted)', margin: 0, marginTop: '0.25rem' }}>Use the Exam IDs in your CSV files for bulk uploads.</p>
            </div>
          </div>
          <Link href="/creator/tests/new">
            <Button className="flex items-center gap-2"><Plus size={18} /> Create New Exam</Button>
          </Link>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {(!tests || tests.length === 0) ? (
            <SpatialCard intensity={0}>
              <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                You haven't created any exams yet.
              </div>
            </SpatialCard>
          ) : (
             <div style={{ display: 'grid', gap: '1rem' }}>
               {tests.map(t => (
                  <SpatialCard key={t.id} intensity={2}>
                      <div style={{ padding: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1.5rem' }}>
                           <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
                              <div style={{ background: t.status === 'PUBLISHED' ? '#ecfdf5' : 'var(--color-primary-light)', padding: '1rem', borderRadius: 'var(--radius-md)' }}>
                                  <FileEdit size={24} color={t.status === 'PUBLISHED' ? '#059669' : 'var(--color-primary)'} />
                              </div>
                              <div>
                                  <div style={{ fontWeight: 800, fontSize: '1.125rem' }}>{t.title || 'Untitled Pack'}</div>
                                  <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.35rem' }}>
                                      <Badge variant="outline" style={{ fontSize: '0.625rem' }}>{t.exam_type}</Badge>
                                      <span>{t.status}</span>
                                      <span style={{ color: 'var(--color-text-muted)' }}>• {new Date(t.created_at).toLocaleDateString()}</span>
                                  </div>
                              </div>
                           </div>
                           
                           <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', background: 'var(--color-surface)', padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                                <div style={{ fontSize: '0.625rem', textTransform: 'uppercase', fontWeight: 800, color: 'var(--color-text-muted)', marginBottom: '0.25rem' }}>Exam ID (for CSV)</div>
                                <code style={{ fontSize: '0.8125rem', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem', userSelect: 'all' }}>
                                  {t.id}
                                </code>
                              </div>
                              <Link href={`/creator/tests/${t.id}`}>
                                  <Button variant="outline">Edit Exam Details</Button>
                              </Link>
                           </div>
                      </div>
                  </SpatialCard>
               ))}
             </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
