import Link from 'next/link'
import { AlertTriangle, ArrowRight, BarChart3, CalendarClock, Users } from 'lucide-react'

import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { ChildCreationForm } from '@/features/auth/components/ChildCreationForm'
import { ReportStateView } from '@/features/report/components/ReportStates'
import { requireRole } from '@/lib/rbac/require-role'
import { bandForScore } from '@/lib/report/readiness'
import {
  assignmentStatusLabel,
  atRiskRuleLabel,
  loadTutorAssignments,
  loadTutorAtRisk,
  loadTutorOverview,
} from '@/lib/reporting/tutor'
import {
  completionLabel,
  completionPct,
  consentWindowLabel,
  initialFor,
  movementLabel,
  sortAssignments,
  MOVEMENT_TONE_CLASS,
} from '@/lib/reporting/tutor-format'
import { createClient } from '@/lib/supabase/server'

export const metadata = {
  title: 'Students | Tutor',
  description: 'Who needs you today: consented students, what is overdue, and what is at risk.',
}

export const dynamic = 'force-dynamic'

/*
 * `/tutor` - the tutor's triage board.
 *
 * WHAT CHANGED, AND WHY
 *   The previous page opened with a six-panel report, then offered a second,
 *   contradictory student list (children the tutor created, queried through
 *   `parent_student_links`) beside a create-child form. Three problems:
 *
 *     1. The two lists answered different questions and could disagree, so a
 *        tutor with consented students saw an empty "My Students" column above a
 *        populated report - which reads as a bug, not as two models.
 *     2. Its two primary buttons ("View Report", "Assign Test") linked to
 *        `/tutor/student/:id`, a route that did not exist. Both 404'd.
 *     3. The report itself now lives at `/tutor/reports`, so the dashboard no
 *        longer needs to be six panels long.
 *
 *   This page now does one job: rank the work. Consent-based students are the
 *   only primary list; the self-created children are kept as a clearly secondary,
 *   collapsed section because that capability still exists and removing it would
 *   silently drop a flow. Every number here comes from the same loader the
 *   reports page uses, so the board and the report cannot disagree.
 *
 * DESIGN NOTE - this is a triage surface, not a showcase. Density over decoration:
 * hairline rules, tabular numerals, one accent (destructive) reserved for overdue
 * and high-severity. Anything decorative would compete with the two things a tutor
 * is looking for: what is late, and who is slipping.
 */

interface LegacyStudent {
  id: string
  username: string
  year_level: number
  attempts: { status: string; score_out_of100: number | null }[] | null
}

function Kpi({
  label,
  value,
  tone = 'default',
  hint,
}: {
  label: string
  value: number | string
  tone?: 'default' | 'danger'
  hint?: string
}) {
  return (
    <div
      className={
        tone === 'danger'
          ? 'rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3'
          : 'rounded-xl border border-border bg-card px-4 py-3'
      }
    >
      <dt className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd
        className={`mt-0.5 text-2xl font-extrabold tabular-nums ${
          tone === 'danger' ? 'text-destructive' : 'text-foreground'
        }`}
      >
        {value}
        {hint ? (
          <span className="mt-0.5 block text-[0.6875rem] font-normal text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </dd>
    </div>
  )
}

export default async function TutorDashboard() {
  const { user } = await requireRole(['TUTOR'])
  const supabase = await createClient()

  const [overview, atRisk, assignments, links] = await Promise.all([
    loadTutorOverview(30),
    loadTutorAtRisk(),
    loadTutorAssignments(),
    supabase
      .from('parent_student_links')
      .select(`student_profiles (id, year_level, username, attempts (id, status, score_out_of100))`)
      .eq('parent_user_id', user.id),
  ])

  // The join is an object for a to-one relationship, but PostgREST returns an
  // array when it cannot prove cardinality. Normalising both shapes here is what
  // lets this file stay typed instead of `any` - the previous version cast to
  // `any` and then called `.charAt()` on a field it had never verified.
  const legacyStudents: LegacyStudent[] = (links.data ?? [])
    .map(
      (row) =>
        (row as unknown as { student_profiles: LegacyStudent | LegacyStudent[] | null })
          .student_profiles
    )
    .flatMap((s) => (Array.isArray(s) ? s : s ? [s] : []))

  const overdue = assignments.rows.filter((a) => a.is_overdue)
  const highRisk = atRisk.rows.filter((r) => r.at_risk_severity === 'high')
  const openWork = assignments.rows.filter((a) => a.assignment_status !== 'COMPLETED')

  return (
    <DashboardLayout role="TUTOR" userName="Tutor Account">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
            <Users size={22} className="text-primary" aria-hidden />
            Students
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Only children whose parent currently consents to you appear here. Consent is checked in
            the database on every read, so a revocation removes access immediately — not at the next
            sign-in.
          </p>
        </div>
        <Link
          href="/tutor/reports"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <BarChart3 size={16} aria-hidden />
          Full reports
        </Link>
      </div>

      {overview.error ? (
        <ReportStateView state="error" />
      ) : (
        <>
          <dl className="mb-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Kpi
              label="Consented students"
              value={overview.rows.length}
              hint={overview.rows.length === 0 ? 'waiting on a parent' : 'current consent only'}
            />
            <Kpi
              label="Overdue"
              value={overdue.length}
              tone={overdue.length > 0 ? 'danger' : 'default'}
              hint={openWork.length > 0 ? `${openWork.length} outstanding in total` : 'nothing outstanding'}
            />
            <Kpi label="Needs attention" value={atRisk.rows.length} hint="fired at-risk rules" />
            <Kpi
              label="High severity"
              value={highRisk.length}
              tone={highRisk.length > 0 ? 'danger' : 'default'}
              hint="of the flags above"
            />
          </dl>

          {overview.rows.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-8 text-center">
              <Users size={40} className="mx-auto mb-3 text-muted-foreground/30" aria-hidden />
              <h2 className="text-base font-semibold text-foreground">No students yet</h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                A parent grants tutor access from their child&apos;s settings. Once they do, that
                child appears here with their consent expiry, their latest score and anything you
                have set for them.
              </p>
            </div>
          ) : (
            <ul className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {overview.rows.map((s) => {
                const completion = completionPct(s.assigned_count, s.completed_count)
                const movement = movementLabel(s.movement_pp)

                return (
                  <li key={s.student_id} className="h-full">
                    <Link
                      href={`/tutor/student/${s.student_id}`}
                      className="flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-xs transition-colors hover:border-primary/40 hover:bg-accent/30"
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2.5">
                          <span
                            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary"
                            aria-hidden
                          >
                            {initialFor(s.student_name)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-foreground">
                              {s.student_name}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              Year {s.year_level}
                            </span>
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-lg font-extrabold tabular-nums text-foreground">
                            {s.current_score ?? '—'}
                          </span>
                          <span className="block text-[0.625rem] uppercase tracking-wide text-muted-foreground">
                            {s.current_score === null ? 'no score' : bandForScore(s.current_score)}
                          </span>
                        </span>
                      </span>

                      <span className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-muted-foreground">Movement</span>
                        <span
                          className={
                            movement.tone === 'neutral'
                              ? 'text-muted-foreground'
                              : `font-semibold tabular-nums ${MOVEMENT_TONE_CLASS[movement.tone]}`
                          }
                        >
                          {movement.text}
                        </span>
                      </span>

                      <span>
                        <span className="flex items-baseline justify-between gap-2 text-xs">
                          <span className="text-muted-foreground">Work completed</span>
                          <span className="tabular-nums text-foreground">
                            {completionLabel(s.assigned_count, s.completed_count)}
                          </span>
                        </span>
                        <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted">
                          <span
                            className="block h-full rounded-full bg-primary"
                            style={{ width: `${completion ?? 0}%` }}
                          />
                        </span>
                      </span>

                      <span className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-2 text-[0.6875rem] text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <CalendarClock size={12} aria-hidden />
                          {consentWindowLabel(s.consent_expires_at) ?? 'no expiry recorded'}
                        </span>
                        <span className="inline-flex items-center gap-1 font-semibold text-primary">
                          Open
                          <ArrowRight size={12} aria-hidden />
                        </span>
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <AlertTriangle size={15} className="text-destructive" aria-hidden />
                  Needs attention
                </h2>
                <Link href="/tutor/reports" className="text-xs font-semibold text-primary hover:underline">
                  Why these fired
                </Link>
              </div>
              {atRisk.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No student currently meets an at-risk rule. That is a result, not missing data.
                </p>
              ) : (
                <ul className="space-y-2">
                  {atRisk.rows.slice(0, 6).map((r, i) => (
                    <li key={`${r.student_id}-${r.at_risk_rule}-${i}`} className="text-xs">
                      <Link
                        href={`/tutor/student/${r.student_id}`}
                        className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md px-1 py-0.5 hover:bg-muted"
                      >
                        <span className="font-semibold text-foreground">{r.student_name}</span>
                        <span
                          className={
                            r.at_risk_severity === 'high'
                              ? 'rounded-full border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[0.625rem] font-bold uppercase text-destructive'
                              : 'rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[0.625rem] font-bold uppercase text-amber-700'
                          }
                        >
                          {atRiskRuleLabel(r.at_risk_rule)}
                        </span>
                        <span className="w-full text-muted-foreground">{r.rule_detail}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {atRisk.rows.length > 6 ? (
                <p className="mt-2 text-[0.6875rem] text-muted-foreground">
                  +{atRisk.rows.length - 6} more in the report.
                </p>
              ) : null}
            </section>

            <section className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">Outstanding work</h2>
                <Link href="/tutor/reports" className="text-xs font-semibold text-primary hover:underline">
                  All assignments
                </Link>
              </div>
              {openWork.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing outstanding. Anything you set appears here until it is completed.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {sortAssignments(openWork).slice(0, 6).map((a) => (
                    <li key={a.assignment_id}>
                      <Link
                        href={`/tutor/student/${a.student_id}`}
                        className="flex items-center justify-between gap-2 rounded-md px-1 py-0.5 text-xs hover:bg-muted"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-foreground">
                            {a.student_name}
                            <span className="font-normal text-muted-foreground">
                              {' · '}
                              {a.test_title ?? 'Untitled test'}
                            </span>
                          </span>
                          <span className="text-muted-foreground">
                            {a.due_at
                              ? `due ${new Date(a.due_at).toLocaleDateString()}`
                              : 'no deadline set'}
                          </span>
                        </span>
                        <span
                          className={
                            a.is_overdue
                              ? 'shrink-0 rounded-full border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[0.625rem] font-bold uppercase text-destructive'
                              : 'shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[0.625rem] font-bold uppercase text-muted-foreground'
                          }
                        >
                          {assignmentStatusLabel(a.assignment_status)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <details className="mt-4 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
            <summary className="cursor-pointer text-sm font-semibold text-foreground">
              {legacyStudents.length > 0
                ? `Students you created (${legacyStudents.length})`
                : 'Add a practice profile'}
            </summary>
            <p className="mt-2 text-xs text-muted-foreground">
              These are profiles you created yourself, not children a parent has consented for you to
              see, so they are kept out of the consented list above. They carry no consent record and
              grant no access to anyone else&apos;s child.
            </p>
            {legacyStudents.length > 0 ? (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {legacyStudents.map((s) => {
                  const done = (s.attempts ?? []).filter((a) => a.status === 'COMPLETE')
                  const avg =
                    done.length > 0
                      ? Math.round(
                          done.reduce((t, a) => t + (Number(a.score_out_of100) || 0), 0) / done.length
                        )
                      : null

                  return (
                    <li key={s.id} className="rounded-md border border-border px-3 py-2 text-xs">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-foreground">{s.username}</span>
                        <span className="tabular-nums text-muted-foreground">Year {s.year_level}</span>
                      </span>
                      <span className="mt-0.5 block text-muted-foreground">
                        {done.length} completed {done.length === 1 ? 'test' : 'tests'}
                        {avg === null ? '' : ` · avg ${avg}%`}
                      </span>
                    </li>
                  )
                })}
              </ul>
            ) : null}
            <div className={legacyStudents.length > 0 ? 'mt-4 border-t border-border pt-4' : 'mt-3'}>
              <h3 className="mb-1 text-sm font-semibold text-foreground">
                {legacyStudents.length > 0 ? 'Add another practice profile' : 'Create a practice profile'}
              </h3>
              <p className="mb-3 text-xs text-muted-foreground">
                Creates a student profile you administer directly. It does not create tutor access to
                anybody else&apos;s child.
              </p>
              <ChildCreationForm
                apiEndpoint="/api/tutor/child"
                maxStudents={null}
                currentCount={legacyStudents.length}
              />
            </div>
          </details>
        </>
      )}
    </DashboardLayout>
  )
}
