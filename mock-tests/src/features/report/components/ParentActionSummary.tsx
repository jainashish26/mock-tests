import { buildParentActions } from '@/lib/writing/evaluation-detail'
import type { WritingEvaluationDetail } from '@/lib/writing/types'

/**
 * Parent-facing "practise this week" card. Plain English, three actions max,
 * derived from the weakest category and the highest-value improvements.
 */
export function ParentActionSummary({ detail }: { detail: WritingEvaluationDetail }) {
  const actions = buildParentActions(detail)
  if (actions.length === 0) return null
  return (
    <div
      style={{
        marginTop: '1.5rem',
        background: 'var(--color-warning-bg, #fffbeb)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '1rem 1.25rem',
      }}
    >
      <h4 style={{ margin: '0 0 0.5rem' }}>Practise this week</h4>
      <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
        {actions.map((a, ai) => (
          <li key={ai} style={{ marginBottom: '0.35rem' }}>
            {a}
          </li>
        ))}
      </ul>
    </div>
  )
}