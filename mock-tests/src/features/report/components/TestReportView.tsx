import Link from 'next/link'

export function TestReportView({ attempt, responses, role }: { attempt: any, responses: any[], role: 'STUDENT' | 'PARENT' }) {
  const isComplete = attempt.status === 'COMPLETE'
  const isPending = attempt.status === 'WRITING_PENDING'

  const backLink = role === 'STUDENT' ? '/student' : `/parent/child/${attempt.student_id}`
  const backText = role === 'STUDENT' ? '← Back to Dashboard' : '← Back to Student Profile'

  return (
    <main style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <div style={{ marginBottom: '2rem' }}>
        <Link href={backLink} style={{ color: 'var(--color-primary)' }}>{backText}</Link>
      </div>

      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '2rem', textAlign: 'center' }}>
        <h1 style={{ marginBottom: '0.5rem' }}>{attempt.tests?.title}</h1>
        <p style={{ color: 'var(--color-text-muted)', marginBottom: '2rem' }}>{new Date(attempt.submitted_at).toLocaleDateString()}</p>

        {isPending ? (
          <div style={{ padding: '2rem', background: 'var(--color-warning-bg)', borderRadius: 'var(--radius-md)' }}>
            <h2 style={{ color: 'var(--color-warning)', margin: 0 }}>Scoring in Progress</h2>
            <p style={{ marginTop: '0.5rem' }}>Your writing section is currently being evaluated. Check back soon for your full score.</p>
          </div>
        ) : isComplete ? (
          <div>
            <div style={{ fontSize: '4rem', fontWeight: 'bold', color: 'var(--color-primary)', lineHeight: 1 }}>
              {attempt.score_out_of100}%
            </div>
            <p style={{ marginTop: '0.5rem', color: 'var(--color-text-muted)' }}>Overall Score</p>
          </div>
        ) : (
          <p>Test not complete.</p>
        )}
      </div>

      {isComplete && attempt.section_scores && (
        <section style={{ marginTop: '3rem' }}>
          <h2>Section Breakdown</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            {Object.entries(attempt.section_scores).map(([sec, score]) => (
              <div key={sec} style={{ padding: '1.5rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
                <h3 style={{ margin: 0, fontSize: '1.125rem' }}>{sec}</h3>
                <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--color-primary)', marginTop: '0.5rem' }}>
                  {Number(score).toFixed(0)}%
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {isComplete && (
        <section style={{ marginTop: '3rem' }}>
          <h2>Review Responses</h2>
          <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {responses.map((r, i) => {
              const q = r.questions
              const correct = r.is_correct

              return (
                <li key={r.id} style={{ padding: '1.5rem', background: 'var(--color-surface)', border: `1px solid ${correct ? 'var(--color-success)' : 'var(--color-danger)'}`, borderLeft: `4px solid ${correct ? 'var(--color-success)' : 'var(--color-danger)'}`, borderRadius: 'var(--radius-md)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <strong>Q{i + 1} ({r.section_name})</strong>
                    <span style={{ color: correct ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 'bold' }}>
                      {correct ? '✓ Correct' : '✗ Incorrect'}
                    </span>
                  </div>
                  <p style={{ marginBottom: '1rem' }}>{q?.stem}</p>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.875rem' }}>
                    <div style={{ display: 'flex', gap: '1rem' }}>
                      <span style={{ color: 'var(--color-text-muted)', width: '100px' }}>Your Answer:</span>
                      <strong style={{ color: correct ? 'var(--color-success)' : 'var(--color-danger)' }}>{r.answer}</strong>
                    </div>
                    {!correct && (
                      <div style={{ display: 'flex', gap: '1rem' }}>
                        <span style={{ color: 'var(--color-text-muted)', width: '100px' }}>Correct Answer:</span>
                        <strong style={{ color: 'var(--color-success)' }}>{q?.correct_answer}</strong>
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </main>
  )
}
