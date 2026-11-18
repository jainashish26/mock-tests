import type { Metadata } from 'next'
import Link from 'next/link'
import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { ChildCreationForm } from '@/features/auth/components/ChildCreationForm'
import { ExamTargetForm } from '@/features/onboarding/ExamTargetForm'
import { ONBOARDING_STYLES as S } from '@/features/onboarding/onboarding.styles'
import { KNOWN_EXAMS } from '@/lib/funnel/exam-target'
import { getFunnelState } from '@/lib/funnel/state'
import { trackOnboardingProgress } from '@/lib/funnel/onboarding'

import { Check, ClipboardList, Rocket, Target, UserPlus } from 'lucide-react'

/**
 * /onboarding - funnel steps 3 and 8.
 *
 * WHY THIS PAGE EXISTS
 *   Before it, a successful signup landed on `/parent`: an empty dashboard with an
 *   "Add a Student Profile" form in a sidebar and no explanation of why any of it
 *   mattered. The spec asks for 70% of registered users to complete a diagnostic,
 *   and an empty dashboard does not produce that. This page replaces it as the
 *   post-signup destination with an explicit numbered path and a reason at each
 *   step.
 *
 * THE THREE STEPS, AND WHY IN THIS ORDER
 *   1. Add a child. Nothing else is possible without a profile - tests are
 *      assigned to a child and the readiness report is per child.
 *   2. Set the target exam and date. Collected here rather than later because
 *      this is the only moment the parent is definitely thinking about an exam.
 *      It is also what makes step 3 feel urgent rather than optional.
 *   3. Take the diagnostic. Last, because it is the longest action and the one the
 *      child does, not the parent. Asking for it first would stall the whole flow
 *      on someone who is not in the room.
 *
 *   Completed steps render as done rather than disappearing, so a returning parent
 *   sees progress instead of being asked to start over.
 */

export const metadata: Metadata = {
  title: 'Set up your family',
  robots: { index: false, follow: false },
}

const MAX_STUDENTS = 4

type ChildRow = { id: string; username: string; year_level: number }
type LinkRow = { student_profiles: ChildRow | null }
type TargetRow = {
  student_id: string
  target_exam: string | null
  exam_date: string | null
  weekly_sessions_goal: number | null
}

/** One numbered step in the progress rail. */
function Step({
  index,
  title,
  detail,
  done,
  disabled = false,
}: {
  index: number
  title: string
  detail: string
  done: boolean
  disabled?: boolean
}) {
  return (
    <li style={{ ...S.stepItem, opacity: disabled && !done ? 0.55 : 1 }}>
      <span style={{ ...S.stepIndex, ...(done ? S.stepIndexDone : S.stepIndexPending) }} aria-hidden="true">
        {done ? <Check size={13} /> : index}
      </span>
      <span style={S.stepText}>
        <strong style={S.stepTitle}>
          {title}
          {done ? <span style={{ color: '#059669' }}> &mdash; done</span> : null}
        </strong>
        <span style={S.stepDetail}>{detail}</span>
      </span>
    </li>
  )
}

export default async function OnboardingPage() {
  const { user } = await requireRole(['PARENT'])
  const supabase = await createClient()

  // One round of parallel queries: the three reads are independent and each is a
  // separate network hop on a serverless function, so serialising them would add
  // latency the parent waits through on every visit.
  const [{ data: linkRows }, { data: targetRows }, state] = await Promise.all([
    supabase
      .from('parent_student_links')
      .select('student_profiles(id, username, year_level)')
      .eq('parent_user_id', user.id),
    supabase
      .from('student_exam_targets')
      .select('student_id, target_exam, exam_date, weekly_sessions_goal'),
    getFunnelState(user.id),
  ])

  const children = ((linkRows ?? []) as unknown as LinkRow[])
    .map((row) => row.student_profiles)
    .filter((child): child is ChildRow => child !== null && child !== undefined)

  const targets = new Map<string, TargetRow>(
    ((targetRows ?? []) as unknown as TargetRow[]).map((row) => [String(row.student_id), row])
  )

  // A child counts as "planned" once they have an exam date, which is what the
  // countdown and the study plan both need. A target exam alone is not enough.
  const plannedChildren = children.filter((child) => Boolean(targets.get(child.id)?.exam_date))
  const completedAttempts = state?.completed_attempts ?? 0

  const step1Done = children.length > 0
  const step2Done = plannedChildren.length > 0
  const step3Done = completedAttempts > 0

  // Funnel step 3 instrumentation: ONBOARDING_STARTED on arrival, and
  // ONBOARDING_COMPLETED once all three rail steps are done. Both are
  // once-per-user, and `trackOnboardingProgress` never throws, so a failure
  // here degrades the analytics rather than blanking the page a parent is
  // using to set up their family.
  //
  // Uses the SAME step1/2/3 booleans the progress rail below renders, so the
  // event and the visible tick-marks cannot disagree about what "done" means.
  await trackOnboardingProgress({
    userId: user.id,
    hasChild: step1Done,
    hasExamTarget: step2Done,
    diagnosticCompleted: step3Done,
  })

  return (
    <DashboardLayout role="PARENT" userName="Parent Account">
      <main style={S.page}>
        <header style={S.header}>
          <span style={S.badge}>
            <Rocket size={13} aria-hidden="true" /> Let&apos;s get set up
          </span>
          <h1 style={S.h1}>Three steps to your child&apos;s first readiness report</h1>

          <p style={S.lede}>
            About five minutes of setup now, and you will have a banded readiness report naming the
            exact topics where marks are being lost. No card, and nothing to cancel.
          </p>
        </header>

        <ol style={S.progressList} aria-label="Setup progress">
          <Step
            index={1}
            title="Add your child"
            done={step1Done}
            detail={
              step1Done
                ? `${children.length} ${children.length === 1 ? 'profile' : 'profiles'} added`
                : 'Year level only - no name, no date of birth'
            }
          />
          <Step
            index={2}
            title="Set the target exam"
            done={step2Done}
            detail={
              step2Done
                ? `${plannedChildren.length} ${plannedChildren.length === 1 ? 'plan' : 'plans'} scheduled`
                : 'This is what starts the countdown'
            }
            disabled={!step1Done}
          />
          <Step
            index={3}
            title="Take the free diagnostic"
            done={step3Done}
            detail={
              step3Done
                ? `${completedAttempts} ${completedAttempts === 1 ? 'assessment' : 'assessments'} complete`
                : 'About 20 minutes, best done within 24 hours'
            }
            disabled={!step1Done}
          />
        </ol>


        {!step1Done ? (
          <section style={S.card} aria-labelledby="add-child-heading">
            <div style={S.cardHeader}>
              <UserPlus size={17} aria-hidden="true" style={S.cardIcon} />
              <div>
                <h2 id="add-child-heading" style={S.cardTitle}>
                  Add your first child
                </h2>
                <p style={S.cardSub}>
                  Up to {MAX_STUDENTS} profiles per account. Each child gets a generated username
                  like <em>RoseApple4821</em> &mdash; we never ask for a real name, a date of birth
                  or a school.
                </p>
              </div>
            </div>
            <ChildCreationForm maxStudents={MAX_STUDENTS} currentCount={0} />
          </section>
        ) : (
          <>
            <section style={S.card} aria-labelledby="exam-target-heading">
              <div style={S.cardHeader}>
                <Target size={17} aria-hidden="true" style={S.cardIcon} />
                <div>
                  <h2 id="exam-target-heading" style={S.cardTitle}>
                    What are they preparing for?
                  </h2>
                  <p style={S.cardSub}>
                    The exam date drives the countdown and sizes the weekly plan. You can change it
                    any time.
                  </p>
                </div>
              </div>

              <div style={S.formGrid}>
                {children.map((child) => {
                  const target = targets.get(child.id)
                  return (
                    <ExamTargetForm
                      key={child.id}
                      studentId={child.id}
                      childLabel={child.username}
                      yearLevel={child.year_level}
                      examOptions={KNOWN_EXAMS}
                      initialTargetExam={target?.target_exam ?? null}
                      initialExamDate={target?.exam_date ?? null}
                      initialGoal={target?.weekly_sessions_goal ?? 3}
                    />
                  )
                })}
              </div>
            </section>

            <section style={S.card} aria-labelledby="diagnostic-heading">
              <div style={S.cardHeader}>
                <ClipboardList size={17} aria-hidden="true" style={S.cardIcon} />
                <div>
                  <h2 id="diagnostic-heading" style={S.cardTitle}>
                    Assign the free diagnostic
                  </h2>
                  <p style={S.cardSub}>
                    A benchmark assessment is already free on your account. Your child completes it
                    in one sitting with the timer running, and the readiness report is generated
                    automatically and emailed to you.
                  </p>
                </div>
              </div>
              <div style={S.buttonRow}>
                {children.map((child) => (
                  <Link key={child.id} href={`/parent/child/${child.id}`} style={S.primaryButton}>
                    Assign to {child.username}
                  </Link>
                ))}
                <Link href="/parent" style={S.ghostButton}>
                  Add another child
                </Link>
              </div>
            </section>
          </>
        )}

        <p style={S.privacyNote}>
          Everything here is optional and reversible. The free tier never asks for payment details,
          and you can stop at any step.
        </p>
      </main>
    </DashboardLayout>
  )
}

