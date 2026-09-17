import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { DashboardLayout } from "@/components/layout/DashboardLayout"
import { SpatialCard } from "@/components/ui/SpatialCard"
import { Badge } from "@/components/ui/Badge"
import { Button } from "@/components/ui/Button"
import { Plus, BookOpen, MessageSquare, ArrowRight, FileEdit, Clock, Upload } from "lucide-react"

export default async function CreatorDashboard() {
  const { user } = await requireRole(['TEST_CREATOR'])
  const supabase = await createClient()

  // Fetch created tests
  const { data: tests } = await supabase
    .from('tests')
    .select('id, title, status, exam_type')
    .eq('created_by', user.id)
    .order('created_at', { ascending: false })

  // Fetch created questions
  const { data: questions } = await supabase
    .from('questions')
    .select('id, stem, type, status')
    .eq('created_by', user.id)
    .order('created_at', { ascending: false })

  return (
    <DashboardLayout role="CREATOR" userName="Expert Content Creator">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '2rem', marginBottom: '3rem' }}>
        <SpatialCard intensity={5}>
            <div style={{ padding: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                   <div style={{ fontSize: '1.75rem', fontWeight: 800 }}>{tests?.length || 0}</div>
                   <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>Tests Created</div>
                </div>
                <Link href="/creator/tests/new">
                   <Button size="icon" style={{ borderRadius: '50%', width: '3.5rem', height: '3.5rem' }}><Plus /></Button>
                </Link>
            </div>
        </SpatialCard>
        <SpatialCard intensity={5}>
            <div style={{ padding: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                   <div style={{ fontSize: '1.75rem', fontWeight: 800 }}>{questions?.length || 0}</div>
                   <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>Questions Banks</div>
                </div>
                <Link href="/creator/questions/new">
                   <Button variant="secondary" size="icon" style={{ borderRadius: '50%', width: '3.5rem', height: '3.5rem' }}><Plus /></Button>
                </Link>
            </div>
        </SpatialCard>
        <SpatialCard intensity={5}>
            <div style={{ padding: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                   <div style={{ fontSize: '1.125rem', fontWeight: 700 }}>Bulk Import</div>
                   <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>Upload CSV</div>
                </div>
                <Link href="/creator/upload">
                   <Button variant="secondary" size="icon" style={{ borderRadius: '50%', width: '3.5rem', height: '3.5rem' }}><Upload /></Button>
                </Link>
            </div>
        </SpatialCard>
      </div>

       <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '3rem' }}>
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800 }}>My Test Drafts</h2>
            <Link href="/creator/tests"><Button variant="ghost" size="sm">Manage All</Button></Link>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {(!tests || tests.length === 0) ? <SpatialCard intensity={0}><div style={{ padding: '3rem', textAlign: 'center' }}>Start by creating your first exam pack.</div></SpatialCard> : (
              tests.map(t => (
                <SpatialCard key={t.id} intensity={2}>
                    <div style={{ padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                         <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                            <div style={{ background: t.status === 'PUBLISHED' ? '#ecfdf5' : 'var(--color-primary-light)', padding: '0.5rem', borderRadius: 'var(--radius-md)' }}>
                                <FileEdit size={18} color={t.status === 'PUBLISHED' ? '#059669' : 'var(--color-primary)'} />
                            </div>
                            <div>
                                <div style={{ fontWeight: 700, fontSize: '0.9375rem' }}>{t.title || 'Untitled Pack'}</div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                    <Badge variant="outline" style={{ fontSize: '0.625rem' }}>{t.exam_type}</Badge>
                                    <span style={{ fontSize: '0.625rem' }}>• {t.status}</span>
                                </div>
                            </div>
                         </div>
                         <Link href={`/creator/tests/${t.id}`}>
                            <Button size="icon" variant="ghost"><ArrowRight size={18} /></Button>
                         </Link>
                    </div>
                </SpatialCard>
              ))
          )}
          </div>
        </section>

        <section>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '1.5rem' }}>Recent Questions</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {(!questions || questions.length === 0) ? <div style={{ color: 'var(--color-text-muted)' }}>No questions created yet.</div> : (
              questions.map(q => (
                <div key={q.id} style={{ background: 'white', border: '1px solid var(--color-border)', padding: '1.25rem', borderRadius: 'var(--radius-md)' }}>
                   <div style={{ fontWeight: 600, marginBottom: '0.5rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{q.stem || 'Empty Question'}</div>
                   <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Badge style={{ fontSize: '0.625rem', padding: '0 0.5rem' }}>{q.type}</Badge>
                      <Link href={`/creator/questions/${q.id}`} style={{ fontSize: '0.75rem', color: 'var(--color-primary)', fontWeight: 600 }}>Edit Content →</Link>
                   </div>
                </div>
              ))
          )}
          </div>
        </section>
      </div>
    </DashboardLayout>
  )
}
