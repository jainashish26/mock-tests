import { requireRole } from '@/lib/rbac/require-role'
import { ChildCreationForm } from '@/features/auth/components/ChildCreationForm'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { DashboardLayout } from "@/components/layout/DashboardLayout"
import { SpatialCard } from "@/components/ui/SpatialCard"
import { Badge } from "@/components/ui/Badge"
import { Button } from "@/components/ui/Button"
import { Users, GraduationCap, ChevronRight, BarChart2, BookOpen } from "lucide-react"
import styles from "@/app/page.module.css"

export default async function ParentDashboard() {
  const { user } = await requireRole(['PARENT'])
  const supabase = await createClient()
  
  const { data: links } = await supabase
    .from('parent_student_links')
    .select(`
      student_profiles (
        id,
        year_level,
        username,
        created_at,
        attempts (
          id,
          status,
          score_out_of100
        )
      )
    `)
    .eq('parent_user_id', user.id)

  const students = links?.map(l => (l as any).student_profiles).filter(Boolean) || []

  return (
    <DashboardLayout role="PARENT" userName="Parent Account">
      <div className={styles.dashboardGrid}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
            <h2 style={{ fontSize: '1.75rem', fontWeight: 800, margin: 0 }}>Linked Children</h2>
            <Badge variant="secondary"><Users size={12} className="mr-1" /> {students.length} Registered</Badge>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {students.length === 0 ? (
              <SpatialCard intensity={0}>
                  <div style={{ padding: '4rem', textAlign: 'center' }}>
                    <Users size={48} style={{ color: 'var(--color-text-muted)', opacity: 0.2, marginBottom: '1rem' }} />
                    <h3 style={{ margin: 0 }}>No Children Linked</h3>
                    <p style={{ color: 'var(--color-text-muted)' }}>Create a student profile to start assigned tests and track progress.</p>
                  </div>
              </SpatialCard>
            ) : (
                students.map((s: any) => {
                  const completedAttempts = s.attempts?.filter((a: any) => a.status === 'COMPLETE') || []
                  const hasAttempts = s.attempts && s.attempts.length > 0
                  
                  let avgScore = 0
                  if (completedAttempts.length > 0) {
                    const total = completedAttempts.reduce((sum: number, att: any) => sum + (Number(att.score_out_of100) || 0), 0)
                    avgScore = Math.round(total / completedAttempts.length)
                  }

                  return (
                  <SpatialCard key={s.id} intensity={5}>
                    <div style={{ padding: '1.5rem 2rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                            <div style={{ width: '3.5rem', height: '3.5rem', borderRadius: '50%', background: 'linear-gradient(135deg, var(--color-primary), #a855f7)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem', fontWeight: 800 }}>
                                {s.username.charAt(0).toUpperCase()}
                            </div>
                            <div>
                                <h3 style={{ margin: 0, fontSize: '1.25rem' }}>{s.username}</h3>
                                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                                    <Badge variant="outline" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}><GraduationCap size={12} /> Year {s.year_level}</Badge>
                                </div>
                            </div>
                        </div>
                        {hasAttempts && (
                          <Link href={`/parent/child/${s.id}`}>
                              <Button variant="ghost" className="flex items-center gap-2">View Report <BarChart2 size={16} /></Button>
                          </Link>
                        )}
                      </div>
                      
                      <div style={{ marginTop: '2rem', display: 'flex', gap: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--color-border)' }}>
                        {hasAttempts ? (
                          <>
                            <div style={{ flex: 1, textAlign: 'center' }}>
                                <div style={{ fontSize: '1.25rem', fontWeight: 800 }}>{completedAttempts.length}</div>
                                <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Completed Tests</div>
                            </div>
                            <div style={{ width: '1px', background: 'var(--color-border)' }} />
                            <div style={{ flex: 1, textAlign: 'center' }}>
                                <div style={{ fontSize: '1.25rem', fontWeight: 800 }}>{avgScore}%</div>
                                <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Avg Score</div>
                            </div>
                          </>
                        ) : (
                          <div style={{ flex: 2, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.875rem', alignSelf: 'center' }}>
                            No tests taken yet.
                          </div>
                        )}
                        <div style={{ flex: 2, display: 'flex', gap: '0.5rem' }}>
                            <Link href={`/parent/child/${s.id}`} style={{ flex: 1 }}>
                                <Button className="w-full" size="sm">Assign Test <ChevronRight size={14} /></Button>
                            </Link>
                            <Link href={`/tests`} style={{ flex: 1 }}>
                                <Button variant="outline" className="w-full" size="sm">Store <BookOpen size={14} /></Button>
                            </Link>
                        </div>
                      </div>
                    </div>
                  </SpatialCard>
                  )
                })
            )}
          </div>
        </div>
        
        <div style={{ position: 'sticky', top: '2rem' }}>
          <SpatialCard intensity={2}>
            <div style={{ padding: '2.5rem' }}>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '0.5rem' }}>Add a Student Profile</h3>
                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginBottom: '2rem' }}>Creating a profile for your child allows you to assign specific mock tests to them and monitor their results individually.</p>
                <ChildCreationForm maxStudents={4} currentCount={students.length} />
            </div>
          </SpatialCard>
        </div>
      </div>
    </DashboardLayout>
  )
}
