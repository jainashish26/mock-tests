'use client'
import { useState } from 'react'
import { PublicLayout } from "@/components/layout/PublicLayout"
import { SpatialCard } from "@/components/ui/SpatialCard"
import { Button } from "@/components/ui/Button"
import { Badge } from "@/components/ui/Badge"
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Users, GraduationCap } from 'lucide-react'

const ROLE_REDIRECTS: Record<string, string> = {
  PARENT: '/parent',
  ADMIN: '/admin',
  TEST_CREATOR: '/creator',
  STUDENT: '/student',
  TUTOR: '/tutor',
}

export default function LoginPage() {
  const [activeTab, setActiveTab] = useState<'PARENT' | 'STUDENT'>('PARENT')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const password = formData.get('password') as string
    let email = ''

    if (activeTab === 'STUDENT') {
      const username = formData.get('username') as string
      if (!username || !password) {
        setError('Please enter username and password.')
        setLoading(false)
        return
      }
      email = `${username.trim()}@students.mocktest.internal`
    } else {
      email = formData.get('email') as string
      if (!email || !password) {
        setError('Please enter email and password.')
        setLoading(false)
        return
      }
    }

    const supabase = createClient()
    const { data: { user }, error: signInError } = await supabase.auth.signInWithPassword({ email, password })

    if (signInError || !user) {
      setError(signInError?.message ?? 'Login failed. Please try again.')
      setLoading(false)
      return
    }

    // Fetch the user's role to redirect appropriately
    const { data: roleData } = await supabase
      .from('app_user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single()

    const destination = roleData?.role ? (ROLE_REDIRECTS[roleData.role] ?? '/') : '/'
    router.push(destination)
  }

  return (
    <PublicLayout>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 10rem)', paddingTop: '5rem', paddingBottom: '3rem' }}>
        <SpatialCard intensity={10} className="max-w-md w-full">
          <div style={{ padding: '3rem', width: '100%', maxWidth: '450px' }}>
            <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
              <Badge variant="secondary" style={{ marginBottom: '1rem' }}>Welcome Back</Badge>
              <h1 style={{ fontSize: '2.25rem', fontWeight: 800, margin: 0 }}>Log In</h1>
              <p style={{ color: 'var(--muted-foreground)', marginTop: '0.5rem' }}>Access your mock tests dashboard.</p>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem', padding: '0.35rem', background: 'var(--card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>
              <button 
                type="button"
                onClick={() => { setActiveTab('PARENT'); setError(null); }}
                style={{ flex: 1, padding: '0.75rem', borderRadius: 'var(--radius-md)', background: activeTab === 'PARENT' ? 'white' : 'transparent', color: activeTab === 'PARENT' ? 'var(--foreground)' : 'var(--muted-foreground)', border: activeTab === 'PARENT' ? '1px solid var(--border)' : 'none', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', boxShadow: activeTab === 'PARENT' ? 'var(--shadow-sm)' : 'none', transition: 'all 0.2s', cursor: 'pointer' }}>
                <Users size={16} /> Parent
              </button>
              <button 
                type="button"
                onClick={() => { setActiveTab('STUDENT'); setError(null); }}
                style={{ flex: 1, padding: '0.75rem', borderRadius: 'var(--radius-md)', background: activeTab === 'STUDENT' ? 'white' : 'transparent', color: activeTab === 'STUDENT' ? 'var(--foreground)' : 'var(--muted-foreground)', border: activeTab === 'STUDENT' ? '1px solid var(--border)' : 'none', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', boxShadow: activeTab === 'STUDENT' ? 'var(--shadow-sm)' : 'none', transition: 'all 0.2s', cursor: 'pointer' }}>
                <GraduationCap size={16} /> Student
              </button>
            </div>

            {error && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '0.75rem', padding: '0.875rem 1rem', marginBottom: '1.25rem', color: '#ef4444', fontSize: '0.875rem' }}>
                {error}
              </div>
            )}

            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {activeTab === 'PARENT' ? (
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-foreground">Email Address</label>
                  <input
                    type="email"
                    name="email"
                    placeholder="name@example.com"
                    required
                    className="w-full px-4 py-3 rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground transition-all duration-200 focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/10"
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-foreground">Student Username</label>
                  <input
                    type="text"
                    name="username"
                    placeholder="e.g. MagicApple"
                    required
                    className="w-full px-4 py-3 rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground transition-all duration-200 focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/10"
                  />
                  <p style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--muted-foreground)' }}>
                    Your unique fun name linked to your parent's account.
                  </p>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="text-sm font-semibold text-foreground">Password</label>
                  {activeTab === 'PARENT' && (
                    <a href="#" style={{ fontSize: '0.75rem', color: 'var(--primary)' }}>Forgot password?</a>
                  )}
                </div>
                <input
                  type="password"
                  name="password"
                  placeholder="••••••••"
                  required
                  className="w-full px-4 py-3 rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground transition-all duration-200 focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/10"
                />
              </div>

              <Button type="submit" size="lg" style={{ marginTop: '1rem', width: '100%' }} disabled={loading}>
                {loading ? 'Signing In…' : `Sign In as ${activeTab === 'PARENT' ? 'Parent' : 'Student'}`}
              </Button>
            </form>

            <div style={{ marginTop: '2rem', textAlign: 'center', fontSize: '0.875rem', color: 'var(--muted-foreground)' }}>
              Don't have an account? <Link href="/auth/signup" style={{ color: 'var(--primary)', fontWeight: 600 }}>Create parent account</Link>
            </div>
          </div>
        </SpatialCard>
      </div>
    </PublicLayout>
  )
}
