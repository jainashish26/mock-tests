import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { DashboardLayout } from "@/components/layout/DashboardLayout"
import { Badge } from "@/components/ui/Badge"
import { getThemeForYear } from './themes'
import { YearMascot } from './YearMascot'
import css from './student-dashboard.module.css'

export default async function StudentDashboard() {
  const { user } = await requireRole(['STUDENT'])
  const supabase = await createClient()

  // Find student profile
  const { data: profile } = await supabase
    .from('student_profiles')
    .select('id, year_level, username')
    .eq('auth_user_id', user.id)
    .single()

  if (!profile) return <div>Student profile not found</div>

  const theme = getThemeForYear(profile.year_level)

  // Fetch pending assignments
  const { data: assignments } = await supabase
    .from('assignments')
    .select(`
      id,
      assigned_at,
      due_at,
      test_id,
      tests (
        id,
        title,
        exam_type,
        time_limit_mins
      )
    `)
    .eq('student_id', profile.id)

  const { count: completedAttemptsCount } = await supabase
    .from('attempts')
    .select('*', { count: 'exact', head: true })
    .eq('student_id', profile.id)
    .eq('status', 'COMPLETE')

  const activeAssignments = assignments || []
  const completedCount = Number(completedAttemptsCount) || 0

  const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  // Mock streak data (replace with real data later)
  const streakDays = [1, 1, 1, 1, 1, 0, 0]

  return (
    <DashboardLayout
      role="STUDENT"
      userName={profile.username}
      hasActiveTests={activeAssignments.length > 0}
      hasCompletedTests={completedCount > 0}
      hideSidebar={true}
    >
      {/* ===== Hero Banner ===== */}
      <div
        className={css.heroBanner}
        style={{ background: theme.colors.gradient }}
        role="banner"
        aria-label={`Welcome banner for Year ${theme.yearLevel} ${theme.name}`}
      >
        <div className={`${css.heroDecor} ${css.heroDecor1}`} />
        <div className={`${css.heroDecor} ${css.heroDecor2}`} />
        <div className={`${css.heroDecor} ${css.heroDecor3}`} />

        <div className={css.heroContent}>
          <h1 className={css.heroGreeting}>
            Hey {profile.username}! {theme.emoji}
          </h1>
          <p className={css.heroTagline}>{theme.tagline}</p>
          <div className={css.heroRankBadge} aria-label={`You are a Year ${theme.yearLevel} ${theme.name}`}>
            <span aria-hidden="true">⭐</span>
            Year {theme.yearLevel} {theme.name}
          </div>
        </div>

        <div className={css.heroMascotWrapper} aria-hidden="true">
          <YearMascot mascot={theme.mascot} size={140} />
        </div>
      </div>

      {/* ===== Stats Row ===== */}
      <div className={css.statsRow} role="region" aria-label="Your statistics">
        {/* Goal Progress */}
        <div
          className={css.statCard}
          style={{
            background: theme.colors.primaryLight,
            borderColor: `${theme.colors.primary}22`,
            boxShadow: theme.colors.cardGlow,
          }}
        >
          <div
            className={css.statIcon}
            style={{ background: `${theme.colors.primary}18`, color: theme.colors.primary }}
            aria-hidden="true"
          >
            🎯
          </div>
          <div>
            <div className={css.statValue} style={{ color: theme.colors.primaryDark }}>
              65%
            </div>
            <div className={css.statLabel} style={{ color: theme.colors.primaryDark }}>
              Goal Progress
            </div>
            <div
              className={css.progressBarOuter}
              style={{ background: `${theme.colors.primary}22`, marginTop: '0.5rem', width: '100px' }}
              role="progressbar"
              aria-valuenow={65}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Goal progress: 65%"
            >
              <div
                className={css.progressBarInner}
                style={{ width: '65%', background: theme.colors.primary }}
              />
            </div>
          </div>
        </div>

        {/* Tests Completed */}
        <div
          className={css.statCard}
          style={{
            background: theme.colors.secondaryLight,
            borderColor: `${theme.colors.secondary}22`,
            boxShadow: `0 4px 24px ${theme.colors.secondary}15`,
          }}
        >
          <div
            className={css.statIcon}
            style={{ background: `${theme.colors.secondary}18`, color: theme.colors.secondary }}
            aria-hidden="true"
          >
            ✅
          </div>
          <div>
            <div className={css.statValue} style={{ color: theme.colors.secondary }}>
              {completedCount}
            </div>
            <div className={css.statLabel} style={{ color: theme.colors.secondary }}>
              Tests Done
            </div>
          </div>
        </div>

        {/* Pending */}
        <div
          className={css.statCard}
          style={{
            background: '#fffbeb',
            borderColor: '#f59e0b22',
            boxShadow: '0 4px 24px rgba(245, 158, 11, 0.1)',
          }}
        >
          <div
            className={css.statIcon}
            style={{ background: '#fef3c7', color: '#d97706' }}
            aria-hidden="true"
          >
            📝
          </div>
          <div>
            <div className={css.statValue} style={{ color: '#92400e' }}>
              {activeAssignments.length}
            </div>
            <div className={css.statLabel} style={{ color: '#92400e' }}>
              To Do
            </div>
          </div>
        </div>
      </div>

      {/* ===== Streak Section ===== */}
      <div
        className={css.streakSection}
        style={{
          background: `${theme.colors.streakColor}08`,
          borderColor: `${theme.colors.streakColor}18`,
        }}
        role="region"
        aria-label="Weekly activity streak"
      >
        <div className={css.streakMeta}>
          <h2 className={css.streakTitle}>
            🔥 5 Day Streak! {theme.encouragement}
          </h2>
          <p className={css.streakSubtitle}>Keep practising to build your streak!</p>
        </div>
        <div className={css.streakDots} aria-label="5 of 7 days active this week">
          {streakDays.map((active, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
              <div
                className={`${css.streakDot} ${active ? css.streakDotActive : css.streakDotInactive}`}
                style={{
                  background: active ? theme.colors.streakColor : `${theme.colors.streakColor}20`,
                }}
                aria-label={`${DAY_LABELS[i]}: ${active ? 'Active' : 'Inactive'}`}
              >
                {active ? '✓' : ''}
              </div>
              <span className={css.streakDotLabel}>{DAY_LABELS[i]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ===== Active Assignments ===== */}
      <div className={css.sectionHeader}>
        <h2 className={css.sectionTitle}>
          <span className={css.sectionIcon} aria-hidden="true">📚</span>
          Your Assignments
        </h2>
        <Badge variant="secondary">{activeAssignments.length} Pending</Badge>
      </div>

      {activeAssignments.length === 0 ? (
        <div
          className={css.emptyState}
          style={{ borderColor: `${theme.colors.primary}40`, background: theme.colors.primaryLight }}
        >
          <span className={css.emptyIcon} aria-hidden="true">🎉</span>
          <h3 className={css.emptyTitle} style={{ color: theme.colors.primaryDark }}>All caught up!</h3>
          <p className={css.emptyText} style={{ color: theme.colors.primaryDark }}>
            You don&apos;t have any tests assigned right now. Great job!
          </p>
          <Link
            href="/free"
            className={css.startButton}
            style={{ background: theme.colors.primary, display: 'inline-flex' }}
          >
            🧪 Practice in the Sandbox
          </Link>
        </div>
      ) : (
        <div className={css.assignmentGrid}>
          {activeAssignments.map((assignment: any, index: number) => {
            // Alternate card tints between primary and secondary for visual variety
            const isEven = index % 2 === 0
            const cardBg = isEven ? theme.colors.primaryLight : theme.colors.secondaryLight
            const iconBg = isEven ? `${theme.colors.primary}18` : `${theme.colors.secondary}18`
            const iconColor = isEven ? theme.colors.primary : theme.colors.secondary
            const btnColor = isEven ? theme.colors.primary : theme.colors.secondary

            return (
              <div
                key={assignment.id}
                className={css.assignmentCard}
                style={{
                  background: cardBg,
                  borderColor: `${iconColor}22`,
                  boxShadow: `0 2px 16px ${iconColor}10`,
                }}
              >
                <div className={css.assignmentLeft}>
                  <div
                    className={css.assignmentIcon}
                    style={{ background: iconBg, color: iconColor }}
                    aria-hidden="true"
                  >
                    📄
                  </div>
                  <div className={css.assignmentInfo}>
                    <h3 className={css.assignmentTitle} style={{ color: 'var(--color-text)' }}>
                      {assignment.tests?.title}
                    </h3>
                    <div className={css.assignmentMeta}>
                      <span className={css.assignmentMetaItem}>
                        <Badge variant="outline" style={{ fontSize: '0.6rem' }}>{assignment.tests?.exam_type}</Badge>
                      </span>
                      <span className={css.assignmentMetaItem}>
                        ⏱️ {assignment.tests?.time_limit_mins} mins
                      </span>
                    </div>
                  </div>
                </div>

                <Link
                  href={`/student/test/${assignment.id}`}
                  className={css.startButton}
                  style={{ background: btnColor }}
                  aria-label={`Start test: ${assignment.tests?.title}`}
                >
                  Let&apos;s Go! ▶
                </Link>
              </div>
            )
          })}
        </div>
      )}

      {/* ===== AI Writing Banner ===== */}
      <div
        className={css.aiBanner}
        style={{ background: theme.colors.gradient }}
        role="region"
        aria-label="AI Writing Practice Feature"
      >
        <div className={css.aiBannerContent}>
          <h3 className={css.aiBannerTitle}>✨ Try the AI Writing Tool</h3>
          <p className={css.aiBannerText}>
            Write a response to any prompt and get instant feedback to level up your writing skills!
          </p>
          <Link
            href="/student/ai-practice"
            className={css.aiBannerBtn}
            style={{ color: theme.colors.primaryDark }}
          >
            🚀 Launch AI Practice
          </Link>
        </div>
        <div className={css.aiBannerMascot} aria-hidden="true">
          <YearMascot mascot={theme.mascot} size={100} />
        </div>
      </div>
    </DashboardLayout>
  )
}
