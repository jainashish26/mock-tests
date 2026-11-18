import Link from 'next/link'
import {
  Award,
  BarChart3,
  CheckCircle2,
  Clock,
  FileQuestion,
  Lock,
  PenLine,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react'
import type { ReadinessReport } from '@/lib/report/readiness'
import { LockedInsightCard } from './LockedInsightPanel'
import { READINESS_STYLES as S, LOCKED_STYLES as L } from './readiness.styles'
import { PageViewTracker } from '@/features/monetisation/PageViewTracker'


/**
 * The readiness report (funnel step 4) and its natural paywall (step 6).
 *
 * A server component: everything here derives from data the route already
 * loaded, so there is no reason to ship it to the browser. The only interactive
 * piece is locked-panel click tracking, which lives in its own client child.
 */

export interface ReadinessReportViewProps {
  childLabel: string
  report: ReadinessReport
  confidenceLabel: string
  /** True while the step-7 launch offer window is open for this family. */
  offerLive: boolean
  offerExpiresAt: string | null
  completedAttempts: number
}

/** Colour per band, matching the email so the two surfaces never disagree. */
function bandColour(score: number): string {
  if (score < 50) return '#dc2626'
  if (score < 75) return '#d97706'
  return '#059669'
}

function severityLabel(severity: string): string {
  if (severity === 'critical') return 'Needs work'
  if (severity === 'watch') return 'Watch this'
  return 'Solid'
}

/** The locked insights, each with a concrete description of what it would say. */
const LOCKED_INSIGHTS = [
  {
    title: 'Time per question',
    body: 'Whether a wrong answer was a guess in four seconds or a careful miss after two minutes. Those need opposite fixes.',
    icon: <Clock size={17} />,
  },
  {
    title: 'Question-level review',
    body: 'Every item they missed, with the worked explanation and the reasoning step where it went wrong.',
    icon: <FileQuestion size={17} />,
  },
  {
    title: 'Progress trend',
    body: 'Score movement across attempts, so you can tell whether a gap is closing or simply has not been worked on yet.',
    icon: <TrendingUp size={17} />,
  },
  {
    title: 'Adaptive study plan',
    body: 'A weekly schedule that re-targets the weakest topic after every attempt, sized to the exam date you set.',
    icon: <BarChart3 size={17} />,
  },
  {
    title: 'Further AI writing marks',
    body: 'Criterion-level feedback against the official rubric on every writing task, not just the single free sample.',
    icon: <PenLine size={17} />,
  },
]

export function ReadinessReportView({
  childLabel,
  report,
  confidenceLabel,
  offerLive,
  offerExpiresAt,
  completedAttempts,
}: ReadinessReportViewProps) {
  const upgradeHref = offerLive ? '/parent/offer' : '/pricing'
  const upgradeLabel = offerLive ? 'See your launch offer' : 'See plans and pricing'

  return (
    <main style={S.page}>
      <header style={S.header}>
        <p style={S.eyebrow}>
          <Award size={13} aria-hidden="true" /> Exam readiness report
        </p>
        <h1 style={S.h1}>{childLabel}</h1>
        <p style={S.subhead}>
          Year {report.yearLevel} &middot; based on {report.attemptsUsed} completed{' '}
          {report.attemptsUsed === 1 ? 'assessment' : 'assessments'} ({report.questionsAnswered}{' '}
          questions)
        </p>
      </header>

      <section style={S.scoreCard} aria-labelledby="overall-score">
        <div style={S.scoreLeft}>
          <span id="overall-score" style={S.scoreEyebrow}>
            Overall readiness
          </span>
          <div style={S.scoreRow}>
            <span style={{ ...S.scoreValue, color: bandColour(report.overallScore) }}>
              {report.overallScore}
            </span>
            <span style={S.scoreMax}>/100</span>
          </div>
          <span style={S.scoreBand}>Band: {report.overallBand}</span>
        </div>
        <p style={S.scoreNote}>{confidenceLabel}</p>
      </section>

      <section aria-labelledby="exam-bands">
        <h2 id="exam-bands" style={S.h2}>
          <Sparkles size={17} aria-hidden="true" style={{ ...S.h2Icon, color: 'var(--primary)' }} />
          Readiness by exam
        </h2>
        <div style={S.examGrid}>
          {report.exams.map((exam) => (
            <article
              key={exam.exam}
              style={{ ...S.examCard, opacity: exam.eligible ? 1 : 0.62 }}
            >
              <h3 style={S.examName}>{exam.label}</h3>
              {exam.eligible ? (
                <>
                  <div style={S.examScoreRow}>
                    <span style={{ ...S.examScore, color: bandColour(exam.score) }}>
                      {exam.score}
                    </span>
                    <span style={S.examMax}>/100</span>
                  </div>
                  <span
                    style={{
                      ...S.examBand,
                      background: `${bandColour(exam.score)}14`,
                      color: bandColour(exam.score),
                    }}
                  >
                    {exam.band}
                  </span>
                  <p style={S.examSummary}>{exam.summary}</p>
                </>
              ) : (
                <p style={S.examSummary}>
                  {exam.eligibilityNote ? `${exam.eligibilityNote}. ` : ''}
                  {exam.summary}
                </p>
              )}
            </article>
          ))}
        </div>
      </section>

      {/* Topic gaps: the emotional core of the report, given away in full. */}
      <section aria-labelledby="topic-gaps">
        <h2 id="topic-gaps" style={S.h2}>
          <Target size={17} aria-hidden="true" style={S.h2Icon} />
          Where the marks are being lost
        </h2>
        {report.gaps.length > 0 ? (
          <>
            <p style={S.sectionLede}>
              Fixing the top topic moves an exam band further than anything else on this list.
            </p>
            <ul style={S.list}>
              {report.gaps.map((gap) => (
                <li key={`${gap.subject}-${gap.topic}`} style={S.listItem}>
                  <div style={S.listItemMain}>
                    <span style={S.listItemTitle}>{gap.topic}</span>
                    <span style={S.listItemMeta}>
                      {gap.subject} &middot; {gap.attempted} questions &middot; avg difficulty{' '}
                      {gap.avgDifficulty || 'n/a'}
                    </span>
                    <span style={S.barTrack} aria-hidden="true">
                      <span
                        style={{
                          ...S.barFill,
                          width: `${Math.max(2, Math.min(100, gap.accuracy))}%`,
                          background: bandColour(gap.accuracy),
                        }}
                      />
                    </span>
                  </div>
                  <div style={S.listItemRight}>
                    <span style={{ ...S.listItemValue, color: bandColour(gap.accuracy) }}>
                      {gap.accuracy}%
                    </span>
                    <span
                      style={{
                        ...S.severity,
                        background: `${bandColour(gap.accuracy)}14`,
                        color: bandColour(gap.accuracy),
                      }}
                    >
                      {severityLabel(gap.severity)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p style={S.sectionLede}>
            Every topic {childLabel} attempted is at or above 75%. The next step is harder content
            rather than remediation.
          </p>
        )}
      </section>

      {/* Strengths: a report that is only criticism gets deleted, not acted on. */}
      {report.strengths.length > 0 ? (
        <section aria-labelledby="strengths">
          <h2 id="strengths" style={S.h2}>
            <CheckCircle2 size={17} aria-hidden="true" style={{ ...S.h2Icon, color: '#059669' }} />
            What is already solid
          </h2>
          <ul style={S.list}>
            {report.strengths.map((item) => (
              <li key={`${item.subject}-${item.topic}`} style={S.listItem}>
                <div style={S.listItemMain}>
                  <span style={S.listItemTitle}>{item.topic}</span>
                  <span style={S.listItemMeta}>
                    {item.subject} &middot; {item.attempted} questions
                  </span>
                </div>
                <div style={S.listItemRight}>
                  <span style={{ ...S.listItemValue, color: '#059669' }}>{item.accuracy}%</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ---- Step 6: the natural paywall ---- */}
      {!report.unlocked ? (
        <section style={L.section} aria-labelledby="locked-insights">
          {/*
            Funnel step 6 impression. Fired once per mount, and only inside this
            branch - a parent whose report is already unlocked never sees a
            paywall and must not be counted as having done so.

            PAYWALL_TRIGGERED (fired in state.ts when the attempt threshold is
            crossed) records that a family BECAME eligible. This records that
            they actually SAW it. The gap between the two is the set of parents
            who qualified for the paywall but never came back to the report - a
            different problem needing a different fix, and completely invisible
            without this event.

            Props describe the paywall, never the child's results: no score, no
            band, no accuracy. This panel is rendered from the same data as the
            free report above it, but the event row is analytics, and analytics
            about a paywall does not need to carry a child's performance.
          */}
          <PageViewTracker
            event="PAYWALL_VIEWED"
            props={{
              lockedInsights: LOCKED_INSIGHTS.length,
              completedAttempts,
              offerLive,
            }}
          />

          <div style={L.sectionHead}>
            <div>
              <h2 id="locked-insights" style={L.sectionTitle}>
                <Lock size={16} aria-hidden="true" />
                The deeper analysis on this same data
              </h2>
              <p style={L.sectionLede}>
                Everything above is yours and stays free. What follows is already calculated for{' '}
                {childLabel} from the same {completedAttempts} completed{' '}
                {completedAttempts === 1 ? 'assessment' : 'assessments'} &mdash; it is the part that
                turns a diagnosis into a weekly schedule.
              </p>
            </div>
            <span style={L.attemptsPill}>
              {completedAttempts} / 2 assessments complete
            </span>
          </div>

          <ul style={L.grid}>
            {LOCKED_INSIGHTS.map((insight) => (
              <LockedInsightCard
                key={insight.title}
                title={insight.title}
                body={insight.body}
                icon={insight.icon}
              />
            ))}
          </ul>

          <div style={L.ctaRow}>
            <Link href={upgradeHref} style={L.ctaPrimary}>
              <Sparkles size={16} aria-hidden="true" />
              {upgradeLabel}
            </Link>
            <p style={L.guaranteeNote}>
              <ShieldCheck size={13} aria-hidden="true" />
              14-day money-back guarantee &middot; no card needed to keep using the free tier
            </p>
            {offerLive && offerExpiresAt ? (
              <Link href={upgradeHref} style={L.ctaSecondary}>
                Your launch price is time-limited &mdash; see how long is left
              </Link>
            ) : null}
          </div>
        </section>
      ) : (
        <section style={L.section} aria-labelledby="unlocked-insights">
          <h2 id="unlocked-insights" style={L.sectionTitle}>
            <CheckCircle2 size={16} aria-hidden="true" style={{ color: '#059669' }} />
            Everything is unlocked
          </h2>
          <p style={L.sectionLede}>
            Time-per-question diagnostics, question-level review, the progress trend and the
            adaptive plan are all available on this report.
          </p>
        </section>
      )}
    </main>
  )
}

