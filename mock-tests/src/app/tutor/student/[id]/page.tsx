import Link from 'next/link'
import { AlertTriangle, ArrowLeft, ArrowRight, CalendarClock, ShieldCheck } from 'lucide-react'

import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { AssignControl, RemindButton } from '@/features/report/components/TutorActions'
import { ReportStateView } from '@/features/report/components/ReportStates'
import { requireRole } from '@/lib/rbac/require-role'
import { bandForScore } from '@/lib/report/readiness'
import {
  assignmentStatusLabel,
  atRiskRuleLabel,
  consentStateLabel,
  dueStateLabel,
  loadTutorAssignments,
  loadTutorAtRisk,
  loadTutorConsents,
  loadTutorOverview,
  loadTutorRecommendations,
  loadTutorSkillGaps,
} from '@/lib/reporting/tutor'
import {
  completionLabel,
  completionPct,
  consentWindowLabel,
  movementLabel,
  sortAssignments,
  MOVEMENT_TONE_CLASS,
} from '@/lib/reporting/tutor-format'

export const metadata = {
  title: 'Student | Tutor',
  description: 'One consented student: what they scored, what they need, and what you set.',
}

export const dynamic = 'force-dynamic'

/*
 * `/tutor/student/:id`
 *
 * WHY THIS PAGE DID NOT EXIST AND HAD TO
 *   The dashboard has linked "View Report" and "Assign Test" here since the first
 *   tutor build, and the route was never created - so the two most obvious buttons
 *   on the tutor's landing page returned 404. A tutor's unit of work is a child,
 *   not a table row; the drill-down is where "this one student needs X this week"
 *   gets answered without hunting through six cross-student panels.
 *
 * THE CONSENT GATE IS THE PAGE'S FIRST FACT, NOT A FOOTNOTE
 *   A row only appears here if the parent currently consents (the loaders enforce
 *   it in SQL). When there is no row the page does not pretend the child does not
 *   exist: it shows the consent record and its state, because "the parent withdrew
 *   access on the 3rd" and "we cannot see this child" are different things and a
 *   tutor chasing a family needs to know which one they are looking at.
 *
 * NOTHING HERE RECOMPUTES A METRIC. Every figure comes from the same loader that
 * T1/T2/T3/T5/T7 use on the reports page, filtered to one student, so this page and
 * the report can never disagree about the same child.
 */

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  )
}

function Metric({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <dt className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-xl font-extrabold tabular-nums text-foreground">
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

export default async function TutorStudentPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(['TUTOR'])
  const { id } = await params

  const [overview, atRisk, gaps, assignments, recommendations, consents] = await Promise.all([
    loadTutorOverview(30),
    loadTutorAtRisk(),
    loadTutorSkillGaps(),
    loadTutorAssignments(),
    loadTutorRecommendations(),
    loadTutorConsents(id),
  ])

  const student = overview.rows.find((r) => r.student_id === id) ?? null
  const consent = consents.rows[0] ?? null
  const consentWindow = consentWindowLabel(student?.consent_expires_at ?? null)
  const movement = movementLabel(student?.movement_pp ?? null)

  const myRisk = atRisk.rows.filter((r) => r.student_id === id)
  // Overdue first: this is a chase list, and the reason to open this page is
  // usually "what is late". The ordering lives in tutor-format so the dashboard's
  // "Outstanding work" list cannot sort differently from this one.
  const myAssignments = sortAssignments(assignments.rows.filter((a) => a.student_id === id))
  const myGaps = gaps.rows
    .filter((g) => g.student_id === id && g.has_signal)
    .sort((a, b) => (a.accuracy_pct ?? 999) - (b.accuracy_pct ?? 999))
  const myRecs = recommendations.rows
    .filter((r) => r.student_id === id)
    .sort((a, b) => a.recommendation_rank - b.recommendation_rank)

  const header = (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <Link
          href="/tutor"
          className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={16} aria-hidden />
          All students
        </Link>
        <h1 className="truncate text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
          {student?.student_name ?? 'Student'}
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          {student ? <span>Year {student.year_level}</span> : null}
          {consent ? (
            <span
              className={
                consent.state === 'ACTIVE'
                  ? 'inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700'
                  : 'inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-700'
              }
            >
              <ShieldCheck size={12} aria-hidden />
              {consentStateLabel(consent.state)}
            </span>
          ) : null}
          {consentWindow ? (
            <span className="inline-flex items-center gap-1 text-xs">
              <CalendarClock size={12} aria-hidden />
              Access {consentWindow}
            </span>
          ) : null}
        </p>
      </div>
      <Link
        href="/tutor/reports"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
      >
        Full report
        <ArrowRight size={16} aria-hidden />
      </Link>
    </div>
  )

  // No consent (or no row): say so plainly, and show the record that explains it.
  if (!student) {
    return (
      <DashboardLayout role="TUTOR" userName="Tutor Account">
        {header}
        <Panel title="No current access" hint="enforced in SQL by the loaders, not here">
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
            <p className="flex items-start gap-2 text-sm text-foreground">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" aria-hidden />
              <span>
                This child has no current consent for you, so nothing about their work is loaded on
                this page. That is not an error and not missing data — it is the privacy boundary
                working. A parent grants and revokes access from their child&apos;s settings, and a
                revocation takes effect immediately.
              </span>
            </p>
          </div>

          {consents.error ? (
            <div className="mt-4">
              <ReportStateView state="error" />
            </div>
          ) : consent ? (
            <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
              {[
                ['State', consentStateLabel(consent.state)],
                ['Granted', consent.granted_at ? new Date(consent.granted_at).toLocaleDateString() : '—'],
                ['Expires', consent.expires_at ? new Date(consent.expires_at).toLocaleDateString() : '—'],
                ['Revoked', consent.revoked_at ? new Date(consent.revoked_at).toLocaleDateString() : 'Not revoked'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border border-border px-3 py-2">
                  <dt className="text-[0.625rem] uppercase tracking-wide text-muted-foreground">
                    {label}
                  </dt>
                  <dd className="font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              No consent record exists for this child at all, so access has never been granted.
            </p>
          )}
        </Panel>
      </DashboardLayout>
    )
  }

  const completion = completionPct(student.assigned_count, student.completed_count)

  return (
    <DashboardLayout role="TUTOR" userName="Tutor Account">
      {header}

      {myRisk.length > 0 ? (
        <div className="mb-4 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
          <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-destructive">
            <AlertTriangle size={16} aria-hidden />
            Needs attention now
          </h2>
          <ul className="space-y-1">
            {myRisk.map((r, i) => (
              <li key={`${r.at_risk_rule}-${i}`} className="text-xs">
                <span className="font-semibold">{atRiskRuleLabel(r.at_risk_rule)}</span>
                <span className="text-muted-foreground"> · {r.rule_detail}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[0.6875rem] text-muted-foreground">
            Thresholds are seeded defaults, not validated cut-points. The rule and the numbers behind
            it are shown so you can disagree with the flag.
          </p>
        </div>
      ) : null}

      <dl className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric
          label="Current score"
          value={student.current_score ?? '—'}
          hint={
            student.current_score === null
              ? 'no completed attempt yet'
              : bandForScore(student.current_score)
          }
        />
        <Metric
          label="Movement"
          value={
            <span
              className={
                movement.tone === 'neutral'
                  ? 'text-sm font-semibold text-muted-foreground'
                  : MOVEMENT_TONE_CLASS[movement.tone]
              }
            >
              {movement.text}
            </span>
          }
          hint="last 30 days vs the 30 before"
        />
        <Metric
          label="Work completed"
          value={completionLabel(student.assigned_count, student.completed_count)}
          hint={completion === null ? 'nothing assigned yet' : undefined}
        />
        <Metric
          label="Attempts"
          value={student.current_attempts}
          hint={`${student.prior_attempts} in the prior period`}
        />
      </dl>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Assignments" hint="overdue first · remind only where work is outstanding">
          {assignments.error ? (
            <ReportStateView state="error" />
          ) : myAssignments.length === 0 ? (
            <ReportStateView
              state="empty"
              emptyTitle="Nothing set for this student yet"
              emptyMessage="Assign from a recommendation below, so the work targets a weak topic rather than guessing."
            />
          ) : (
            <ul className="space-y-1.5">
              {myAssignments.map((a) => (
                <li
                  key={a.assignment_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-2.5 py-2 text-xs"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{a.test_title ?? 'Untitled test'}</span>
                    <span className="text-muted-foreground">
                      {a.due_state === 'NO_DUE_DATE'
                        ? dueStateLabel('NO_DUE_DATE')
                        : `${dueStateLabel(a.due_state)}${
                            a.due_at ? ` · ${new Date(a.due_at).toLocaleDateString()}` : ''
                          }`}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      className={
                        a.is_overdue
                          ? 'rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[0.625rem] font-bold uppercase text-destructive'
                          : 'rounded-full border border-border px-2 py-0.5 text-[0.625rem] font-bold uppercase text-muted-foreground'
                      }
                    >
                      {assignmentStatusLabel(a.assignment_status)}
                    </span>
                    {a.assignment_status === 'COMPLETED' ? (
                      <span className="text-[0.625rem] text-muted-foreground">Done</span>
                    ) : (
                      <RemindButton
                        assignmentId={a.assignment_id}
                        label={`Remind ${a.student_name} about ${a.test_title ?? 'the assignment'}`}
                      />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Skill gaps" hint="under five responses is not a verdict, so it is not shown">
          {gaps.error ? (
            <ReportStateView state="error" />
          ) : myGaps.length === 0 ? (
            <ReportStateView
              state="empty"
              emptyTitle="No topic has enough evidence yet"
              emptyMessage="Topics appear once this student has answered at least five questions in them."
            />
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-muted/60">
                  <tr>
                    {['Topic', 'Subject', 'Correct', 'Questions'].map((h) => (
                      <th key={h} className="border-b border-border px-2 py-1.5 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {myGaps.map((g) => (
                    <tr
                      key={`${g.subject}-${g.topic}`}
                      className="border-b border-border/50 last:border-0"
                    >
                      <td className="px-2 py-1">{g.topic}</td>
                      <td className="px-2 py-1 text-muted-foreground">{g.subject}</td>
                      <td
                        className={`px-2 py-1 tabular-nums ${
                          g.mastery_level === 'critical'
                            ? 'font-semibold text-destructive'
                            : g.mastery_level === 'watch'
                              ? 'text-amber-600'
                              : 'text-emerald-600'
                        }`}
                      >
                        {g.accuracy_pct ?? '—'}%
                      </td>
                      <td className="px-2 py-1 tabular-nums text-muted-foreground">
                        {g.items_answered}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-4">
        <Panel title="What to set next" hint="same figures the parent sees · at most three">
          {recommendations.error ? (
            <ReportStateView state="error" />
          ) : myRecs.length === 0 ? (
            <ReportStateView
              state="empty"
              emptyTitle="No recommendation yet"
              emptyMessage="A topic becomes a recommendation once this student has answered at least five questions in it."
            />
          ) : (
            <ol className="grid gap-2 md:grid-cols-3">
              {myRecs.map((r) => (
                <li
                  key={r.recommendation_rank}
                  className="flex flex-col justify-between gap-2 rounded-md border border-border px-2.5 py-2 text-xs"
                >
                  <div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold">
                        {r.recommendation_rank}. {r.topic}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {r.accuracy_pct ?? '—'}% · {r.items_answered} q
                      </span>
                    </div>
                    <p className="mt-0.5 text-muted-foreground">{r.reason}</p>
                  </div>
                  <AssignControl
                    studentId={r.student_id}
                    studentName={r.student_name}
                    subject={r.subject}
                    topic={r.topic}
                  />
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </DashboardLayout>
  )
}
