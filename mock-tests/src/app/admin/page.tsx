import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { DashboardLayout } from "@/components/layout/DashboardLayout"
import { SpatialCard } from "@/components/ui/SpatialCard"
import { Badge } from "@/components/ui/Badge"
import { Button } from "@/components/ui/Button"
import { ShieldCheck, FileText, ClipboardCheck, ArrowRight, MessageSquareCode } from "lucide-react"

export default async function AdminDashboard() {
  await requireRole(['ADMIN'])
  const supabase = await createClient()

  const { data: tests } = await supabase
    .from('tests')
    .select('id, title, status, exam_type')
    .eq('status', 'PENDING_APPROVAL')
    .order('updated_at', { ascending: false })

  const { data: questions } = await supabase
    .from('questions')
    .select('id, stem, type, status')
    .eq('status', 'PENDING_APPROVAL')
    .order('updated_at', { ascending: false })

  return (
    <DashboardLayout role="ADMIN" userName="System Administrator">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '2rem', marginBottom: '3rem' }}>
        <SpatialCard intensity={5}>
            <div style={{ padding: '2rem', display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                <div style={{ width: '3.5rem', height: '3.5rem', background: 'var(--color-primary-light)', color: 'var(--color-primary)', borderRadius: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ClipboardCheck size={24} />
                </div>
                <div>
                    <div style={{ fontSize: '1.75rem', fontWeight: 800 }}>{tests?.length || 0}</div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>Pending Tests</div>
                </div>
            </div>
        </SpatialCard>
        <SpatialCard intensity={5}>
            <div style={{ padding: '2rem', display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                <div style={{ width: '3.5rem', height: '3.5rem', background: '#ecfdf5', color: '#059669', borderRadius: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <MessageSquareCode size={24} />
                </div>
                <div>
                    <div style={{ fontSize: '1.75rem', fontWeight: 800 }}>{questions?.length || 0}</div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>Pending Questions</div>
                </div>
            </div>
        </SpatialCard>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '3rem' }}>
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0 }}>Review Queue: Tests</h2>
            <Link href="/admin/review/tests" style={{ fontSize: '0.8125rem', color: 'var(--color-primary)', display: 'flex', alignItems: 'center' }}>View all <ArrowRight size={14} className="ml-1" /></Link>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {(!tests || tests.length === 0) ? <SpatialCard intensity={0}><div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>No tests pending approval.</div></SpatialCard> : (
              tests.map(t => (
                <SpatialCard key={t.id} intensity={2}>
                    <div style={{ padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                         <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                            <FileText size={20} style={{ color: 'var(--color-primary)' }} />
                            <div>
                                <div style={{ fontWeight: 700, fontSize: '0.9375rem' }}>{t.title}</div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{t.exam_type}</div>
                            </div>
                         </div>
                         <Link href={`/admin/review/tests/${t.id}`}>
                            <Button size="sm" variant="outline">Review Content</Button>
                         </Link>
                    </div>
                </SpatialCard>
              ))
          )}
          </div>
        </section>

        <section>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '1.5rem' }}>Pending Questions</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {(!questions || questions.length === 0) ? <div style={{ color: 'var(--color-text-muted)' }}>No questions pending.</div> : (
              questions.map(q => (
                <div key={q.id} style={{ padding: '1rem 1.25rem', background: 'white', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{q.stem}</div>
                    <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>{q.type}</div>
                  </div>
                  <Link href={`/admin/review/questions/${q.id}`}>
                    <Button variant="ghost" size="sm" style={{ padding: '0 0.5rem' }}>Review <ArrowRight size={14} className="ml-1" /></Button>
                  </Link>
                </div>
              ))
          )}
          </div>
        </section>
      </div>
    </DashboardLayout>
  )
}
