import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { DashboardLayout } from "@/components/layout/DashboardLayout"
import { StudentNavBar } from "@/components/layout/StudentNavBar"
import { Badge } from "@/components/ui/Badge"
import { getThemeForYear } from './themes'
import { YearMascot } from './YearMascot'
import css from './student-dashboard.module.css'
import {
  loadStudentToday,
  primaryTarget,
  countdownSentence,
  targetSentence,
} from '@/lib/reporting/student-today'

/** Shape of the assignment rows rendered as cards on the dashboard. */
type EmbeddedTest = {
  id?: string
  title?: string | null
  exam_type?: string | null
  time_limit_mins?: number | null
}

type AssignmentCardRow = {
  id: string
  // PostgREST returns a to-one embed as an object, but supabase-js types it as an
  // array when the client has no generated Database types. Accept both.
  tests?: EmbeddedTest | EmbeddedTest[] | null
}

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

  // "Tests Done" is a practice QUANTITY, not a result, so a student is entitled to
  // see it - but migration 015 removed student SELECT on `attempts`, so this can no
  // longer be a direct table query (it would silently return 0 forever). The
  // SECURITY DEFINER function returns `integer` and nothing else, so there is no
  // column in which a score could hide.
  //
  // Note the count now includes SUBMITTED as well as COMPLETE, which the previous
  // query did not: a submitted test is finished practice, and excluding it
  // under-counted any attempt still awaiting its writing mark.
  const { data: completedAttemptsCount } = await supabase.rpc('my_completed_attempt_count', {
    p_student_id: profile.id,
  })

  const activeAssignments = assignments || []
  const completedCount = Number(completedAttemptsCount) || 0

  // Reports S1 (exam countdown) and S2 (daily practice target) - the only two
  // reporting reads a student is permitted. See lib/reporting/student-today.ts.
  const today = await loadStudentToday(profile.id)
  const target = primaryTarget(today.rows)

  return (
    <DashboardLayout
      role="STUDENT"
      userName={profile.username}
      hideSidebar={true}
      topBar={<StudentNavBar userName={profile.username} />}
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
            {/* S1 - exam countdown. Replaces a hardcoded "65% Goal Progress" bar,
                which was mock data: a fabricated percentage shown to a child as
                though it were a measurement. */}
            <div className={css.statValue} style={{ color: theme.colors.primaryDark }}>
              {target?.exam_passed
                ? '🎉'
                : target?.days_to_exam !== null && target?.days_to_exam !== undefined
                  ? target.days_to_exam
                  : '—'}
            </div>
            <div className={css.statLabel} style={{ color: theme.colors.primaryDark }}>
              {target?.exam_date && !target.exam_passed ? 'Days to go' : 'Days to go'}
            </div>
            <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: theme.colors.primaryDark }}>
              {countdownSentence(target)}
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

      {/* ===== S2: Today's practice target ===== */}
      {/* Replaces a hardcoded "5 Day Streak!" with fabricated dots. A streak is a
          loss frame: it shows a child what they have broken. Rule B4 prohibits it,
          and the numbers were mock data in any case. The daily target answers the
          question a child actually asks - "how much should I do today?" - and
          cannot be failed in a way that is displayed. */}
      <div
        className={css.streakSection}
        style={{
          background: `${theme.colors.streakColor}08`,
          borderColor: `${theme.colors.streakColor}18`,
        }}
        role="region"
        aria-label="Today's practice target"
      >
        <div className={css.streakMeta}>
          <h2 className={css.streakTitle}>
            🎯 {targetSentence(target)} {theme.encouragement}
          </h2>
          <p className={css.streakSubtitle}>
            {today.error
              ? 'We could not load your practice right now. Try again in a minute.'
              : target?.daily_target_units && target.daily_target_units > 0
                ? 'Small and steady is the way to go.'
                : 'No pressure today.'}
          </p>
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
          {activeAssignments.map((assignment: AssignmentCardRow, index: number) => {
            // Alternate card tints between primary and secondary for visual variety
            const isEven = index % 2 === 0
            const test = Array.isArray(assignment.tests) ? assignment.tests[0] : assignment.tests
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
                      {test?.title}
                    </h3>
                    <div className={css.assignmentMeta}>
                      <span className={css.assignmentMetaItem}>
                        <Badge variant="outline" style={{ fontSize: '0.6rem' }}>{test?.exam_type}</Badge>
                      </span>
                      <span className={css.assignmentMetaItem}>
                        ⏱️ {test?.time_limit_mins} mins
                      </span>
                    </div>
                  </div>
                </div>

                <Link
                  href={`/student/test/${assignment.id}`}
                  className={css.startButton}
                  style={{ background: btnColor }}
                  aria-label={`Start test: ${test?.title}`}
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
