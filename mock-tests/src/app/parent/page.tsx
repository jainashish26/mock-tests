import { requireRole } from '@/lib/rbac/require-role'
import { ChildCreationForm } from '@/features/auth/components/ChildCreationForm'
import { SiblingRepurchaseCard } from '@/features/monetisation/SiblingRepurchaseCard'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import {
  Users,
  GraduationCap,
  ChevronRight,
  BarChart2,
  BookOpen,
  Sparkles,
  UserPlus,
  ShieldCheck,
  Info,
  ClipboardList,
  ArrowRight,
} from 'lucide-react'
import css from './parent-dashboard.module.css'

const MAX_STUDENTS = 4

type Attempt = {
  id: string
  status: string | null
  score_out_of100: number | string | null
}

type LinkedChild = {
  id: string
  username: string
  year_level: number
  created_at: string | null
  attempts: Attempt[] | null
}

function scoreTone(value: number) {
  if (value >= 80) return css.statValueGood
  if (value >= 50) return css.statValueMid
  return css.statValueLow
}

export default async function ParentDashboard() {
  const { user } = await requireRole(['PARENT'])
  const supabase = await createClient()

  const { data } = await supabase
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

  type LinkRow = { student_profiles: LinkedChild | null }
  const links = (data ?? []) as unknown as LinkRow[]

  const students = links
    .map((l) => l.student_profiles)
    .filter((s): s is LinkedChild => s !== null && s !== undefined)

  const kids = students.map((child) => {
    const attempts = child.attempts ?? []
    const completed = attempts.filter((a) => a.status === 'COMPLETE')
    const scores = completed.map((a) => Number(a.score_out_of100) || 0)
    const avgScore = scores.length
      ? Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length)
      : null
    const bestScore = scores.length ? Math.max(...scores) : null

    return {
      id: child.id,
      username: child.username,
      yearLevel: child.year_level,
      joinedLabel: child.created_at
        ? `Joined ${new Date(child.created_at).toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })}`
        : null,
      hasAttempts: attempts.length > 0,
      completedCount: completed.length,
      avgScore,
      bestScore,
      scores,
    }
  })

  const totalCompleted = kids.reduce((sum, k) => sum + k.completedCount, 0)
  const allScores = kids.flatMap((k) => k.scores)
  const overallAvg = allScores.length
    ? Math.round(allScores.reduce((sum, s) => sum + s, 0) / allScores.length)
    : null

  return (
    <DashboardLayout role="PARENT" userName="Parent Account">
      <div className={css.page}>
        {/* ── Hero ── */}
        <section className={css.hero} aria-label="Family overview">
          <div className={`${css.heroDecor} ${css.heroDecor1}`} aria-hidden="true" />
          <div className={`${css.heroDecor} ${css.heroDecor2}`} aria-hidden="true" />
          <div className={`${css.heroDecor} ${css.heroDecor3}`} aria-hidden="true" />
          <div className={css.heroArt} aria-hidden="true">
            <GraduationCap size={170} strokeWidth={1.5} />
          </div>

          <div className={css.heroContent}>
            <span className={css.heroBadge}>
              <Sparkles size={12} aria-hidden="true" /> Parent Dashboard
            </span>
            <h2 className={css.heroTitle}>
              Your family&rsquo;s exam journey, all in one place
            </h2>
            <p className={css.heroTagline}>
              Assign mock tests, track scores and see exactly where each child
              needs a little more practice.
            </p>
            <div className={css.heroActions}>
              <Link href="/tests" className={css.heroCtaPrimary}>
                Browse Test Store <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <a href="#add-profile" className={css.heroCtaGhost}>
                <UserPlus size={16} aria-hidden="true" /> Add Child Profile
              </a>
            </div>
          </div>

          <div className={css.heroStats}>
            <div className={css.heroStat}>
              <div className={css.heroStatValue}>{kids.length}</div>
              <div className={css.heroStatLabel}>Linked Children</div>
            </div>
            <div className={css.heroStat}>
              <div className={css.heroStatValue}>{totalCompleted}</div>
              <div className={css.heroStatLabel}>Tests Completed</div>
            </div>
            <div className={css.heroStat}>
              <div className={css.heroStatValue}>
                {overallAvg !== null ? `${overallAvg}%` : '—'}
              </div>
              <div className={css.heroStatLabel}>Avg Score</div>
            </div>
          </div>
        </section>

        {/* ── Children + Add-profile grid ── */}
        <div className={css.grid}>
          <section aria-labelledby="linked-children-title">
            <div className={css.sectionHeader}>
              <h2 className={css.sectionTitle} id="linked-children-title">
                <span className={css.sectionTitleIcon} aria-hidden="true">
                  <Users size={18} />
                </span>
                Linked Children
              </h2>
              <span className={css.countPill}>
                <Users size={12} aria-hidden="true" /> {kids.length} Registered
              </span>
            </div>

            <div className={css.childrenList}>
              {kids.length === 0 ? (
                <div className={css.emptyState}>
                  <div className={css.emptyIcon} aria-hidden="true">
                    <Users size={30} />
                  </div>
                  <h3 className={css.emptyTitle}>No children linked yet</h3>
                  <p className={css.emptyText}>
                    Create your first student profile to assign mock tests and
                    start tracking progress.
                  </p>
                  <a href="#add-profile" className={css.btnPrimary}>
                    <UserPlus size={15} aria-hidden="true" /> Add your first
                    child
                  </a>
                </div>
              ) : (
                kids.map((k) => (
                  <article key={k.id} className={css.childCard}>
                    <div className={css.childTop}>
                      <div className={css.childAvatar} aria-hidden="true">
                        {k.username.charAt(0).toUpperCase()}
                      </div>
                      <div className={css.childInfo}>
                        <h3 className={css.childName}>{k.username}</h3>
                        <div className={css.childMeta}>
                          <span className={css.yearBadge}>
                            <GraduationCap size={12} aria-hidden="true" /> Year{' '}
                            {k.yearLevel}
                          </span>
                          {k.joinedLabel && (
                            <span className={css.joinedLabel}>
                              {k.joinedLabel}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className={css.childBody}>
                      {k.hasAttempts ? (
                        <div className={css.statsRow}>
                          <div>
                            <div className={css.statValue}>
                              {k.completedCount}
                            </div>
                            <div className={css.statLabel}>Tests Completed</div>
                          </div>
                          <div>
                            <div
                              className={`${css.statValue} ${
                                k.avgScore !== null ? scoreTone(k.avgScore) : ''
                              }`}
                            >
                              {k.avgScore !== null ? `${k.avgScore}%` : '—'}
                            </div>
                            <div className={css.statLabel}>Avg Score</div>
                            {k.avgScore !== null && (
                              <div
                                className={css.progressTrack}
                                role="progressbar"
                                aria-valuenow={k.avgScore}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-label={`Average score ${k.avgScore} percent`}
                              >
                                <div
                                  className={css.progressFill}
                                  style={{ width: `${k.avgScore}%` }}
                                />
                              </div>
                            )}
                          </div>
                          <div>
                            <div className={css.statValue}>
                              {k.bestScore !== null ? `${k.bestScore}%` : '—'}
                            </div>
                            <div className={css.statLabel}>Best Score</div>
                          </div>
                        </div>
                      ) : (
                        <p className={css.noDataNote}>
                          <Info size={16} aria-hidden="true" /> No tests taken
                          yet — assign the first test to see progress here.
                        </p>
                      )}
                    </div>

                    <div className={css.childActions}>
                      <Link
                        href={`/parent/child/${k.id}`}
                        className={css.btnPrimary}
                      >
                        <ClipboardList size={15} aria-hidden="true" /> Assign
                        Test
                      </Link>
                      {k.completedCount > 0 && (
                        <Link
                          href={`/parent/child/${k.id}`}
                          className={css.btnOutline}
                        >
                          <BarChart2 size={15} aria-hidden="true" /> View Report
                        </Link>
                      )}
                      <Link href="/tests" className={css.btnGhostLink}>
                        <BookOpen size={15} aria-hidden="true" /> Test Store{' '}
                        <ChevronRight size={14} aria-hidden="true" />
                      </Link>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>

          <aside className={css.sideColumn}>
            <div className={css.addPanel} id="add-profile">
              <div className={css.addPanelHeader}>
                <span className={css.addPanelIcon} aria-hidden="true">
                  <UserPlus size={20} />
                </span>
                <div>
                  <h2 className={css.addPanelTitle}>Add a Student Profile</h2>
                  <p className={css.addPanelSub}>
                    Up to {MAX_STUDENTS} child profiles per account
                  </p>
                </div>
              </div>
              <p className={css.addPanelDesc}>
                Create a profile for each child to assign mock tests and monitor
                their results individually.
              </p>
              <div className={css.privacyNote}>
                <ShieldCheck
                  size={16}
                  className={css.privacyNoteIcon}
                  aria-hidden="true"
                />
                <span>
                  Privacy-first: we never ask for real names — each child gets a
                  fun generated username.
                </span>
              </div>
              <ChildCreationForm
                maxStudents={MAX_STUDENTS}
                currentCount={kids.length}
              />
            </div>
          </aside>
        </div>

        {/* N-8: one-tap re-purchase for customers with another child. Renders
            nothing unless the server says the family is eligible. */}
        <SiblingRepurchaseCard userId={user.id} />
      </div>
    </DashboardLayout>
  )
}


