import Link from 'next/link'
import { WritingReportPanel } from './WritingReportPanel'

const OPTION_COLUMNS = [
  ['A', 'answer_a'],
  ['B', 'answer_b'],
  ['C', 'answer_c'],
  ['D', 'answer_d'],
  ['E', 'answer_e'],
] as const

/** `responses.answer` is jsonb - render it safely instead of letting React choke on an object. */
function answerToText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(answerToText).filter(Boolean).join(', ')
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).map(answerToText).filter(Boolean).join(', ')
  return String(value)
}

function formatDate(value: unknown): string | null {
  if (!value) return null
  const d = new Date(String(value))
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

function scoreLabel(value: unknown): string | null {
  const n = typeof value === 'string' ? Number(value) : Number(value ?? NaN)
  if (!Number.isFinite(n)) return null
  return `${Math.round(n * 10) / 10}%`
}

/** Maps a stored option letter back to its option text for review. */
function optionTextFor(q: any, letter: string | null): string | null {
  if (!q || !letter) return null
  const entry = OPTION_COLUMNS.find(([l]) => l === letter.trim().toUpperCase()[0])
  if (!entry) return null
  const text = q[entry[1]]
  return typeof text === 'string' && text.trim() ? text.trim() : null
}

const card: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  padding: '2rem',
}

export function TestReportView({
  attempt,
  responses,
  writingEvaluations = [],
  role,
  unlocked = false,
}: {
  attempt: any
  responses: any[]
  writingEvaluations?: any[]
  role: 'STUDENT' | 'PARENT'
  unlocked?: boolean
}) {
  const status = attempt?.status
  const isComplete = status === 'COMPLETE'
  const isPendingWriting = status === 'WRITING_PENDING'
  const isSubmitted = status === 'SUBMITTED'
  const isInProgress = status === 'IN_PROGRESS'
  const overallScore = scoreLabel(attempt?.score_out_of100)
  const submittedOn = formatDate(attempt?.submitted_at)
  const sectionScores =
    attempt?.section_scores && typeof attempt.section_scores === 'object'
      ? Object.entries(attempt.section_scores as Record<string, unknown>)
      : []
  const showReview = !isInProgress
  const writingResponse = responses.find((r) => r?.questions?.type === 'WRITING')
  const writingStudentText = writingResponse ? answerToText(writingResponse.answer) : undefined

  const backLink = role === 'STUDENT' ? '/student' : `/parent/child/${attempt?.student_id ?? ''}`
  const backText = role === 'STUDENT' ? '← Back to Dashboard' : '← Back to Student Profile'

  const statusBanner = (() => {
    if (isInProgress) {
      return {
        heading: 'Test Still In Progress',
        body: 'This attempt has been submitted but not finished. The score below is not final.',
        tone: 'var(--color-warning-bg)',
        toneText: 'var(--color-warning)',
      }
    }
    if (isPendingWriting) {
      return {
        heading: 'Writing Section Being Evaluated',
        body: overallScore
          ? `Your objective score is ${overallScore}. The writing section is still being marked - your final score will update shortly.`
          : 'Your writing section is currently being evaluated. Check back soon for your full score.',
        tone: 'var(--color-warning-bg)',
        toneText: 'var(--color-warning)',
      }
    }
    if (isSubmitted) {
      return {
        heading: 'Scoring In Progress',
        body: 'Your test has been submitted and is being scored. Refresh shortly to see the result.',
        tone: 'var(--color-warning-bg)',
        toneText: 'var(--color-warning)',
      }
    }
    return null
  })()

  return (
    <main style={{ padding: '2rem', maxWidth: '860px', margin: '0 auto' }}>
      <div style={{ marginBottom: '2rem' }}>
        <Link href={backLink} style={{ color: 'var(--color-primary)' }}>
          {backText}
        </Link>
      </div>

      <div style={{ ...card, textAlign: 'center' }}>
        <h1 style={{ marginBottom: '0.5rem' }}>{attempt?.tests?.title ?? 'Test Report'}</h1>
        {submittedOn && (
          <p style={{ color: 'var(--color-text-muted)', marginBottom: '2rem' }}>Submitted {submittedOn}</p>
        )}

        {overallScore ? (
          <div>
            <div style={{ fontSize: '4rem', fontWeight: 'bold', color: 'var(--color-primary)', lineHeight: 1 }}>
              {overallScore}
            </div>
            <p style={{ marginTop: '0.5rem', color: 'var(--color-text-muted)' }}>
              {isComplete ? 'Overall Score' : 'Score So Far'}
            </p>
          </div>
        ) : (
          <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>No score recorded yet.</p>
        )}
      </div>

      {statusBanner && (
        <div
          role="status"
          style={{
            marginTop: '1.5rem',
            padding: '1.5rem 2rem',
            background: statusBanner.tone,
            borderRadius: 'var(--radius-md)',
            textAlign: 'center',
          }}
        >
          <h2 style={{ color: statusBanner.toneText, margin: 0, fontSize: '1.25rem' }}>
            {statusBanner.heading}
          </h2>
          <p style={{ marginTop: '0.5rem', marginBottom: 0 }}>{statusBanner.body}</p>
        </div>
      )}

      {sectionScores.length > 0 && (
        <section style={{ marginTop: '3rem' }}>
          <h2>Section Breakdown</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
            {sectionScores.map(([sec, score]) => {
              const label = scoreLabel(score)
              return (
                <div key={sec} style={{ ...card, padding: '1.5rem', textAlign: 'center' }}>
                  <h3 style={{ margin: 0, fontSize: '1.125rem' }}>{sec}</h3>
                  <div
                    style={{
                      fontSize: '2rem',
                      fontWeight: 'bold',
                      marginTop: '0.5rem',
                      color: label ? 'var(--color-primary)' : 'var(--color-text-muted)',
                    }}
                  >
                    {label ?? 'Pending'}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <WritingReportPanel evaluations={writingEvaluations} studentText={writingStudentText} unlocked={unlocked} />

      {showReview && responses.length > 0 && (
        <section style={{ marginTop: '3rem' }}>
          <h2>Review Responses</h2>
          <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {responses.map((r, i) => {
              const q = r?.questions
              const type = q?.type ?? 'MCQ'
              const isWriting = type === 'WRITING'
              const isShortAnswer = type === 'SHORT_ANSWER'
              const correct = r?.is_correct === true
              const graded = r?.is_correct !== null && r?.is_correct !== undefined

              const studentAnswer = answerToText(r?.answer)
              const correctLetter =
                typeof q?.correct_answer === 'string' ? q.correct_answer.trim().toUpperCase()[0] ?? null : null
              const studentLetter =
                !isWriting && !isShortAnswer && studentAnswer.trim().length === 1
                  ? studentAnswer.trim().toUpperCase()
                  : null

              const accent = isWriting || !graded
                ? 'var(--color-border)'
                : correct
                  ? 'var(--color-success)'
                  : 'var(--color-danger)'

              return (
                <li
                  key={r?.id ?? i}
                  style={{
                    ...card,
                    padding: '1.5rem',
                    textAlign: 'left',
                    borderLeft: `4px solid ${accent}`,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                    <strong>
                      Q{i + 1}
                      {r?.section_name ? ` · ${r.section_name}` : ''}
                    </strong>
                    {isWriting ? (
                      <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>
                        Written answer — see feedback above
                      </span>
                    ) : !graded ? (
                      <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Not marked</span>
                    ) : (
                      <span
                        style={{
                          color: correct ? 'var(--color-success)' : 'var(--color-danger)',
                          fontWeight: 'bold',
                        }}
                      >
                        {correct ? '✓ Correct' : '✗ Incorrect'}
                      </span>
                    )}
                  </div>

                  {q?.stem && <p style={{ marginBottom: '1rem' }}>{q.stem}</p>}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.9rem' }}>
                    <div>
                      <span style={{ color: 'var(--color-text-muted)', display: 'block', marginBottom: '0.25rem' }}>
                        Your answer
                      </span>
                      {studentAnswer ? (
                        <div
                          style={{
                            whiteSpace: 'pre-wrap',
                            fontWeight: 600,
                            color: isWriting || !graded ? 'inherit' : correct ? 'var(--color-success)' : 'var(--color-danger)',
                          }}
                        >
                          {studentLetter && optionTextFor(q, studentLetter)
                            ? `${studentLetter}. ${optionTextFor(q, studentLetter)}`
                            : studentAnswer}
                        </div>
                      ) : (
                        <em style={{ color: 'var(--color-text-muted)' }}>No answer saved</em>
                      )}
                    </div>

                    {!isWriting && !isShortAnswer && graded && !correct && (
                      <div>
                        <span style={{ color: 'var(--color-text-muted)', display: 'block', marginBottom: '0.25rem' }}>
                          Correct answer
                        </span>
                        <strong style={{ color: 'var(--color-success)' }}>
                          {correctLetter
                            ? `${correctLetter}${optionTextFor(q, correctLetter) ? `. ${optionTextFor(q, correctLetter)}` : ''}`
                            : answerToText(q?.correct_answer) || 'Not provided'}
                        </strong>
                      </div>
                    )}

                    {!isWriting && isShortAnswer && q?.correct_answer && (
                      <div>
                        <span style={{ color: 'var(--color-text-muted)', display: 'block', marginBottom: '0.25rem' }}>
                          Expected answer
                        </span>
                        <strong style={{ color: 'var(--color-success)' }}>{answerToText(q.correct_answer)}</strong>
                      </div>
                    )}

                    {q?.explanation && (
                      <div>
                        <span style={{ color: 'var(--color-text-muted)', display: 'block', marginBottom: '0.25rem' }}>
                          Explanation
                        </span>
                        <div style={{ whiteSpace: 'pre-wrap' }}>{q.explanation}</div>
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {showReview && responses.length === 0 && (
        <section style={{ marginTop: '3rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
          <p>No responses were recorded for this attempt.</p>
        </section>
      )}
    </main>
  )
}

