import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'
import { CheckoutButton } from '@/features/store/components/CheckoutButton'
import Link from 'next/link'

export default async function TestStorePage() {
  const { user } = await requireRole(['PARENT'])
  const supabase = await createClient()

  // Fetch all published tests that are NOT free
  const { data: tests } = await supabase
    .from('tests')
    .select('id, title, exam_type, is_free')
    .eq('status', 'PUBLISHED')
    .eq('is_free', false)
    .order('created_at', { ascending: false })

  // Fetch user's entitlements
  const { data: entitlements } = await supabase
    .from('entitlements')
    .select('test_id')
    .eq('user_id', user.id)
    .eq('active', true)

  const entitledTestIds = new Set(entitlements?.map(e => e.test_id))

  return (
    <main style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto' }}>
      <Link href="/parent" style={{ color: 'var(--color-primary)', display: 'inline-block', marginBottom: '2rem' }}>← Back to Dashboard</Link>
      
      <h1>Test Store</h1>
      <p style={{ color: 'var(--color-text-muted)', marginBottom: '2rem' }}>Purchase premium practice tests for your children to attempt.</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '2rem' }}>
        {tests?.map(t => {
          const isOwned = entitledTestIds.has(t.id)

          return (
            <div key={t.id} style={{ display: 'flex', flexDirection: 'column', padding: '2rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', background: 'var(--color-surface)' }}>
              <div style={{ fontSize: '0.875rem', color: 'var(--color-primary)', fontWeight: 'bold', marginBottom: '0.5rem' }}>{t.exam_type}</div>
              <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem', flex: 1 }}>{t.title}</h2>
              
              <div style={{ marginTop: 'auto' }}>
                {isOwned ? (
                  <span style={{ display: 'inline-block', padding: '0.75rem 1.5rem', background: 'var(--color-success-bg)', color: 'var(--color-success)', borderRadius: 'var(--radius-md)', fontWeight: 'bold' }}>
                    Owned
                  </span>
                ) : (
                  <CheckoutButton testId={t.id} testTitle={t.title} />
                )}
              </div>
            </div>
          )
        })}
      </div>
    </main>
  )
}
