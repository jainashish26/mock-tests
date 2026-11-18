import { bandForScore } from '@/lib/report/readiness'
import {
  assignmentStatusLabel,
  atRiskRuleLabel,
  dueStateLabel,
  loadTutorAssignments,
  loadTutorAtRisk,
  loadTutorOverview,
  loadTutorRecommendations,
  loadTutorSkillGaps,
} from '@/lib/reporting/tutor'
import type { TutorAssignmentRow, TutorRecommendationRow } from '@/lib/reporting/types'
import { ReportStateView } from './ReportStates'
import { TutorItemAnalysisPanel } from './TutorItemAnalysisPanel'
import { AssignControl, RemindButton } from './TutorActions'

/**
 * T1 / T2 / T3 / T5 / T7 - the consent-based tutor surface.
 *
 * REPLACES A STOPGAP, NOT A FEATURE
 *   The existing /tutor page queries `parent_student_links` filtered by
 *   `parent_user_id = tutor.id` - i.e. it treats the tutor as if they were a
 *   parent, and shows children the tutor created themselves. That was the only
 *   thing possible while `TUTOR` existed as an enum value and nothing else. These
 *   panels read the real model: students linked by a CURRENT consent record.
 *
 * RULES ENFORCED HERE
 *   * Banding comes from bandForScore() - §5.4 forbids T1 defining its own.
 *   * Movement is shown as "—" when null, never as 0. Null means "fewer than two
 *     attempts in a period", which is absence of evidence, not flat performance.
 *   * Every at-risk row shows its rule AND its explanation, because TU1 requires
 *     a tutor to be able to disagree with a flag.
 *   * The at-risk thresholds are labelled unvalidated. They are seeded defaults.
 *   * Consent expiry is visible (TU9): a tutor must be able to see that their
 *     access is time-limited and when it lapses.
 */

function Card({
  id,
  title,
  subtitle,
  children,
}: {
  id: string
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <section
      aria-labelledby={`panel-${id}`}
      className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-6"
    >
      <div className="mb-3">
        <h2 id={`panel-${id}`} className="text-sm font-semibold tracking-tight">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{id} · {subtitle}</p>
      </div>
      {children}
    </section>
  )
}

/** T2 - which skills each student needs help with. */
async function SkillGapPanel() {
  const result = await loadTutorSkillGaps()
  // Only topics with enough evidence to judge. Unsignalled topics are counted and
  // stated, not silently dropped and not shown as verdicts.
  const judged = result.rows.filter((r) => r.has_signal)
  const thin = result.rows.length - judged.length

  return (
    <Card id="T2" title="Skill gaps" subtitle="same accuracy figures the parent sees">
      <ReportStateView
        state={result.error ? 'error' : result.rows.length === 0 ? 'empty' : 'ok'}
        emptyTitle="No topic data yet"
        emptyMessage="Topics appear once your consented students have answered questions."
      />
      {!result.error && result.rows.length > 0 && (
        <>
          {thin > 0 && (
            <p className="mb-2 text-xs text-muted-foreground">
              {thin} topic{thin === 1 ? '' : 's'} hidden: fewer than five responses is not enough to
              judge, and showing them as weaknesses would send you after noise.
            </p>
          )}
          <div className="max-h-80 overflow-auto rounded-md border border-border">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr>
                  {['Student', 'Subject', 'Topic', 'Correct', 'Questions'].map((h) => (
                    <th key={h} className="border-b border-border px-2 py-1.5 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {judged.slice(0, 120).map((r) => (
                  <tr
                    key={`${r.student_id}-${r.subject}-${r.topic}`}
                    className="border-b border-border/50 last:border-0"
                  >
                    <td className="px-2 py-1">{r.student_name}</td>
                    <td className="px-2 py-1 text-muted-foreground">{r.subject}</td>
                    <td className="px-2 py-1">{r.topic}</td>
                    <td className="px-2 py-1 tabular-nums">
                      <span
                        className={
                          r.mastery_level === 'critical'
                            ? 'font-semibold text-destructive'
                            : r.mastery_level === 'watch'
                              ? 'text-amber-600'
                              : 'text-emerald-600'
                        }
                      >
                        {r.accuracy_pct ?? '—'}%
                      </span>
                    </td>
                    <td className="px-2 py-1 tabular-nums text-muted-foreground">{r.items_answered}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  )
}

/** T3 - who needs help this week, and why. */
async function AtRiskPanel() {
  const result = await loadTutorAtRisk()

  return (
    <Card id="T3" title="Needs attention" subtitle="every flag names its rule">
      <ReportStateView
        state={result.error ? 'error' : result.rows.length === 0 ? 'empty' : 'ok'}
        emptyTitle="No student currently meets an at-risk rule"
        emptyMessage="That is a good result, not missing data."
      />
      {!result.error && result.rows.length > 0 && (
        <>
          <p className="mb-2 text-xs text-muted-foreground">
            These thresholds are seeded defaults, not validated cut-points. Each flag shows its rule
            and the numbers behind it so you can disagree with it.
          </p>
          <ul className="space-y-1.5">
            {result.rows.map((r, i) => (
              <li
                key={`${r.student_id}-${r.at_risk_rule}-${i}`}
                className="border-b border-border/50 pb-1.5 text-xs last:border-0"
              >
                <div className="flex flex-wrap items-baseline gap-1.5">
                  <span className="font-medium">{r.student_name}</span>
                  <span
                    className={
                      r.at_risk_severity === 'high'
                        ? 'rounded-full border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[0.625rem] font-bold uppercase text-destructive'
                        : 'rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[0.625rem] font-bold uppercase text-amber-600'
                    }
                  >
                    {atRiskRuleLabel(r.at_risk_rule)}
                  </span>
                </div>
                <p className="mt-0.5 text-muted-foreground">{r.rule_detail}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}

/** The tutor panels, loaded in parallel. */
export async function TutorReportingPanels() {
  const [overview, gaps, atRisk, assignments, recommendations, itemAnalysis] = await Promise.all([
    OverviewPanel(),
    SkillGapPanel(),
    AtRiskPanel(),
    AssignmentPanel(),
    RecommendationPanel(),
    ItemAnalysisPanel(),
  ])

  return (
    <div className="space-y-4">
      {overview}
      <div className="grid gap-4 xl:grid-cols-2">
        {gaps}
        {atRisk}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {assignments}
        {recommendations}
      </div>
      {/* T4 is on a different axis from the panels above - per TEST rather than per
          student - and its distractor drill-down needs the width, so it is not
          paired into the two-column grid. */}
      {itemAnalysis}
    </div>
  )
}

/** T1 - who to look at first. */
async function OverviewPanel() {

  const result = await loadTutorOverview(30)

  return (
    <Card id="T1" title="My students" subtitle="consented students · last 30 days vs the 30 before">
      <ReportStateView
        state={result.error ? 'error' : result.rows.length === 0 ? 'empty' : 'ok'}
        emptyTitle="No students with current consent"
        emptyMessage="A parent grants access from their child's settings. Until then there is nothing to show here."
      />
      {!result.error && result.rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-muted/60">
              <tr>
                {['Student', 'Year', 'Assigned', 'Score', 'Band', 'Movement', 'Access until'].map((h) => (
                  <th key={h} className="border-b border-border px-2 py-1.5 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((s) => (
                <tr key={s.student_id} className="border-b border-border/50 last:border-0">
                  <td className="px-2 py-1 font-medium">{s.student_name}</td>
                  <td className="px-2 py-1 tabular-nums">{s.year_level}</td>
                  <td className="px-2 py-1 tabular-nums">
                    {s.assigned_count === 0 ? '—' : `${s.completed_count}/${s.assigned_count}`}
                  </td>
                  <td className="px-2 py-1 tabular-nums">{s.current_score ?? '—'}</td>
                  <td className="px-2 py-1">
                    {s.current_score === null ? '—' : bandForScore(s.current_score)}
                  </td>
                  <td className="px-2 py-1 tabular-nums">
                    {/* Null means thin data, not zero change. */}
                    {s.movement_pp === null ? (
                      <span className="text-muted-foreground">not enough attempts</span>
                    ) : (
                      <span className={s.movement_pp < 0 ? 'text-destructive' : 'text-emerald-600'}>
                        {s.movement_pp > 0 ? '+' : ''}{s.movement_pp} pp
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-muted-foreground">
                    {s.consent_expires_at ? new Date(s.consent_expires_at).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

/**
 * T5 - what has been set, and what is still outstanding.
 *
 * Rendered as four COLUMNS with counts, not a chart: the question is state per
 * item, not a distribution. Overdue is sorted first because this is a chase list.
 */
async function AssignmentPanel() {
  const result = await loadTutorAssignments()

  const counts: Record<TutorAssignmentRow['assignment_status'], number> = {
    ASSIGNED: 0, STARTED: 0, COMPLETED: 0, OVERDUE: 0,
  }
  for (const r of result.rows) counts[r.assignment_status] += 1

  return (
    <Card id="T5" title="Assignments" subtitle="work you set · overdue is live, not as of the last refresh">
      <ReportStateView
        state={result.error ? 'error' : result.rows.length === 0 ? 'empty' : 'ok'}
        emptyTitle="Nothing set yet"
        emptyMessage="Assignments you set for consented students appear here with their status."
      />
      {!result.error && result.rows.length > 0 && (
        <>
          <dl className="mb-3 grid grid-cols-4 gap-2">
            {(['OVERDUE', 'STARTED', 'ASSIGNED', 'COMPLETED'] as const).map((k) => (
              <div
                key={k}
                className={`rounded-md border px-2 py-1.5 text-center ${
                  k === 'OVERDUE' && counts.OVERDUE > 0
                    ? 'border-destructive/40 bg-destructive/5'
                    : 'border-border'
                }`}
              >
                <dt className="text-[0.625rem] uppercase tracking-wide text-muted-foreground">
                  {assignmentStatusLabel(k)}
                </dt>
                <dd className="text-lg font-bold tabular-nums">{counts[k]}</dd>
              </div>
            ))}
          </dl>
          <div className="max-h-80 overflow-auto rounded-md border border-border">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr>
                  {['Student', 'Test', 'Status', 'Due', 'Chase'].map((h) => (
                    <th key={h} className="border-b border-border px-2 py-1.5 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((a) => (
                  <tr key={a.assignment_id} className="border-b border-border/50 last:border-0">
                    <td className="px-2 py-1 font-medium">{a.student_name}</td>
                    <td className="px-2 py-1">{a.test_title ?? '—'}</td>
                    <td className="px-2 py-1">
                      <span className={a.is_overdue ? 'font-semibold text-destructive' : ''}>
                        {assignmentStatusLabel(a.assignment_status)}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-muted-foreground">
                      {/* NO_DUE_DATE must never read as "on time" - no deadline was set. */}
                      {a.due_state === 'NO_DUE_DATE'
                        ? dueStateLabel('NO_DUE_DATE')
                        : `${dueStateLabel(a.due_state)}${
                            a.due_at ? ` · ${new Date(a.due_at).toLocaleDateString()}` : ''
                          }`}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {/* Only outstanding work can be chased. A COMPLETED row with a
                          Remind button would invite the tutor to email a family about
                          work that has already been handed in. */}
                      {a.assignment_status === 'COMPLETED' ? (
                        <span className="text-[0.625rem] text-muted-foreground">Done</span>
                      ) : (
                        <RemindButton
                          assignmentId={a.assignment_id}
                          label={`Remind ${a.student_name} about ${a.test_title ?? 'the assignment'}`}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  )
}
/**
 * T7 - what to set next, per student.
 *
 * The figures are the ones the parent sees: both this and P8 read
 * reporting.recommendations_scored(), so the impact formula, the five-response
 * signal floor and B12's cap of three have a single definition. At most three per
 * student, grouped by student.
 *
 * THE "ASSIGN" ACTION IS WIRED. It was withheld in 074 because public.tests was
 * empty, so there was no practice test to map a subject/topic recommendation onto
 * and a tutor held no INSERT path into assignments. The content layer now carries
 * 53 published tests joined to 1,900 questions, and `tutor_assignable_tests()`
 * resolves a recommendation to the published tests that actually contain questions
 * on that topic for that student's year band - ordered by how much of the test
 * covers it, because a test with one relevant question out of fifty is a poor
 * assignment however well-titled. Validation (published, year band, live consent,
 * future due date) lives in `tutor_assign_test()`, not in the form.
 */
async function RecommendationPanel() {
  const result = await loadTutorRecommendations()

  const groups: { student_id: string; student_name: string; rows: TutorRecommendationRow[] }[] = []
  for (const r of result.rows) {
    let g = groups.find((x) => x.student_id === r.student_id)
    if (!g) {
      g = { student_id: r.student_id, student_name: r.student_name, rows: [] }
      groups.push(g)
    }
    g.rows.push(r)
  }

  return (
    <Card id="T7" title="What to set next" subtitle="same figures the parent sees · at most three per student">
      <ReportStateView
        state={result.error ? 'error' : result.rows.length === 0 ? 'empty' : 'ok'}
        emptyTitle="No recommendations yet"
        emptyMessage="A topic becomes a recommendation once a student has answered at least five questions in it."
      />
      {!result.error && groups.length > 0 && (
        <div className="max-h-80 space-y-3 overflow-auto pr-1">
          {groups.map((g) => (
            <div key={g.student_id}>
              <h3 className="mb-1 text-xs font-semibold">{g.student_name}</h3>
              <ol className="space-y-1">
                {g.rows.map((r) => (
                  <li
                    key={`${r.student_id}-${r.recommendation_rank}`}
                    className="rounded-md border border-border px-2 py-1.5 text-xs"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">
                        {r.recommendation_rank}. {r.topic}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {r.accuracy_pct ?? '—'}% · {r.items_answered} q
                      </span>
                    </div>
                    <p className="mt-0.5 text-muted-foreground">{r.reason}</p>
                    {/* T7's next action is "Assign" (§4.5). The recommendation names
                        a subject and topic; the control resolves that to published
                        tests that actually cover it for this student. */}
                    <span className="mt-1.5 block">
                      <AssignControl
                        studentId={r.student_id}
                        studentName={r.student_name}
                        subject={r.subject}
                        topic={r.topic}
                      />
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

/**
 * T4 - Item Analysis for tests this tutor assigned.
 *
 * "Is this item working for my students?" -> keep, replace or reteach.
 *
 * THE SELECTOR IS THE AUTHORISATION BOUNDARY MADE VISIBLE. §4.5 requires an
 * `assignments` row with `assigned_by = auth.uid()` for the test, combined with
 * current consent, and §12 makes the endpoint 403 otherwise. So the only tests
 * offered are the ones T5 already says this tutor set - the selector and the SQL
 * rule read the same table, and a tutor cannot even express a request for a test
 * they did not assign. The 403 remains the enforcement point; this is just not
 * offering a choice that would be refused.
 *
 * This re-loads T5's assignments rather than receiving them from the sibling
 * panel. Both calls run concurrently inside the parent's Promise.all, so the cost
 * is one extra RPC in exchange for the panels staying independent - and it cannot
 * drift, because both read `tutor_assignments()` and therefore the same consent
 * gate. Passing the rows down would couple two panels that the spec treats as
 * separate reports.
 */
async function ItemAnalysisPanel() {
  const assignments = await loadTutorAssignments()

  // One entry per test, in the order T5 returns them (overdue first), so the
  // selector leads with the work most likely to need attention.
  const seen = new Set<string>()
  const tests = assignments.error
    ? []
    : assignments.rows
        .filter((a) => {
          if (seen.has(a.test_id)) return false
          seen.add(a.test_id)
          return true
        })
        .map((a) => ({ test_id: a.test_id, test_title: a.test_title }))

  return (
    <Card
      id="T4"
      title="Item analysis"
      subtitle="your assigned tests · the same item figures an admin sees, for your students only"
    >
      {assignments.error ? (
        <ReportStateView state="error" />
      ) : (
        <TutorItemAnalysisPanel tests={tests} />
      )}
    </Card>
  )
}


