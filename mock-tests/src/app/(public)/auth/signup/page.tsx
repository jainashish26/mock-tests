'use client'
import { useState } from 'react'
import { PublicLayout } from "@/components/layout/PublicLayout"
import { SpatialCard } from "@/components/ui/SpatialCard"
import { Button } from "@/components/ui/Button"
import { Badge } from "@/components/ui/Badge"
import styles from "@/app/page.module.css"
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function SignupPage() {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleSignup = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const email = formData.get('email') as string
    const password = formData.get('password') as string

    if (!email || !password) {
      setError('Please fill in all fields.')
      setLoading(false)
      return
    }

    const supabase = createClient()
    const { data: { user }, error: signUpError } = await supabase.auth.signUp({ email, password })

    if (signUpError) {
      setError(signUpError.message)
      setLoading(false)
      return
    }

    if (!user) {
      setError('Signup failed. Please try again.')
      setLoading(false)
      return
    }

    // Assign PARENT role via API route (uses service role server-side)
    const res = await fetch('/api/auth/assign-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, role: 'PARENT' }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.message || 'Account created but role assignment failed. Please contact support.')
      setLoading(false)
      return
    }

    router.push('/parent')
  }

  return (
    <PublicLayout>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 10rem)', paddingTop: '5rem' }}>
        <SpatialCard intensity={10} className={styles.authCard}>
          <div style={{ padding: '3rem', width: '100%', maxWidth: '450px' }}>
            <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
              <Badge variant="secondary" style={{ marginBottom: '1rem' }}>Get Started</Badge>
              <h1 style={{ fontSize: '2.25rem', fontWeight: 800, margin: 0 }}>Create Account</h1>
              <p style={{ color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>Join 50,000+ families today.</p>
            </div>

            {error && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '0.75rem', padding: '0.875rem 1rem', marginBottom: '1.25rem', color: '#ef4444', fontSize: '0.875rem' }}>
                {error}
              </div>
            )}

            <form onSubmit={handleSignup} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className={styles.inputGroup}>
                <label className={styles.inputLabel}>Parent's Email</label>
                <input
                  type="email"
                  name="email"
                  placeholder="parent@example.com"
                  required
                  className={styles.elegantInput}
                />
              </div>
              <div className={styles.inputGroup}>
                <label className={styles.inputLabel}>Create Password</label>
                <input
                  type="password"
                  name="password"
                  placeholder="Min. 8 characters"
                  required
                  minLength={8}
                  className={styles.elegantInput}
                />
              </div>
              <Button type="submit" size="lg" style={{ marginTop: '1rem', width: '100%' }} disabled={loading}>
                {loading ? 'Creating Account…' : 'Create Free Account'}
              </Button>
            </form>

            <div style={{ marginTop: '2rem', textAlign: 'center', fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
              Already have an account? <Link href="/auth/login" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>Log In</Link>
            </div>

            <p style={{ marginTop: '2rem', fontSize: '0.6875rem', color: '#94a3b8', textAlign: 'center' }}>
              By creating an account, you agree to our Terms of Service and Privacy Policy.
            </p>
          </div>
        </SpatialCard>
      </div>
    </PublicLayout>
  )
}
