import { requireRole } from '@/lib/rbac/require-role'
import Link from 'next/link'

/**
 * Report S3 - Session Complete.
 *
 * WHAT THIS PAGE USED TO BE
 *   It rendered the full `TestReportView` with `role="STUDENT"`: scores,
 *   per-question correctness, explanations and AI writing marks. That breached the
 *   platform's hardest access rule ("the student role must have no SELECT permission
 *   on any results table"). Migration 015 closed the breach at the database layer by
 *   removing every student SELECT policy on `attempts`, `responses` and
 *   `writing_evaluations`, which made this page render "Report unavailable" - safe,
 *   but a dead end for a child who had just finished a test.
 *
 * WHAT IT IS NOW
 *   A completion message and a way back. Report S3 in
 *   11-bi-reporting-design.md §4.3 defines it with a ZERO-METRIC CONTRACT: the
 *   response carries no number of any kind.
 *
 * THE ZERO-METRIC CONTRACT, AND WHY IT IS STRUCTURAL
 *   There is deliberately no database read on this page. It does not query
 *   `attempts`, `responses`, `writing_evaluations` or the reporting schema. A query
 *   that cannot run cannot leak. The `attemptId` route parameter is accepted and
 *   ignored on purpose - the URL stays stable so bookmarks and the runner's redirect
 *   keep working, but nothing is fetched with it.
 *
 *   Adding any result-bearing field here would require editing this file against
 *   rules B2, B4, B5, B6 and B8 (no score, percentage, percentile, band, rank,
 *   correct/incorrect indicator, comparison, streak or warning state on a student
 *   surface). Test AC-11 asserts the API contract; this page has no payload at all.
 *
 *   Three independent layers now hold the rule:
 *     1. Database  - no student SELECT policy, plus `may_read_results()` (015)
 *     2. Grants    - no reporting MV granted to `authenticated` (014, 016)
 *     3. Code      - this page performs no query
 *   Any one of them is sufficient. A regression would have to defeat all three.
 *
 * BEHAVIOURAL RULES (11-…md §2.3)
 *   Positive framing. No punishment for a broken streak. No red or amber warning
 *   states. No comparison with other children. Copy at roughly a Year 4 reading
 *   level, sentences under 12 words.
 */
export default async function StudentSessionCompletePage() {
  // Still enforces the role: a parent or admin landing here is redirected by
  // requireRole, and a signed-out visitor goes to /auth/login.
  await requireRole(['STUDENT'])

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
        background: 'var(--color-bg, #f7f9fc)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '26rem',
          textAlign: 'center',
          padding: '2.5rem 1.5rem',
          borderRadius: '1.5rem',
          background: 'var(--card, #fff)',
          border: '1px solid var(--border, #e5e9f0)',
          boxShadow: '0 4px 24px rgba(15, 23, 42, 0.06)',
        }}
      >
        {/* Decorative, so it is hidden from screen readers; the heading carries the
            meaning. A celebration icon is not a score and implies no judgement. */}
        <div aria-hidden="true" style={{ fontSize: '3.5rem', lineHeight: 1, marginBottom: '1rem' }}>
          🎉
        </div>

        <h1
          style={{
            margin: '0 0 0.5rem',
            fontSize: '1.625rem',
            fontWeight: 800,
            lineHeight: 1.25,
            color: 'var(--color-text, #0f172a)',
          }}
        >
          Nice work — you finished!
        </h1>

        <p
          style={{
            margin: '0 0 2rem',
            fontSize: '1rem',
            lineHeight: 1.6,
            color: 'var(--color-text-muted, #64748b)',
          }}
        >
          Your practice is saved. That is all you need to do today.
        </p>

        <Link
          href="/student"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            padding: '0.875rem 1.75rem',
            borderRadius: '9999px',
            background: 'var(--color-primary, #4f46e5)',
            color: '#fff',
            fontWeight: 700,
            fontSize: '1rem',
            textDecoration: 'none',
            // WCAG 2.2 SC 2.5.8: minimum 24x24 CSS px target. This is well above it.
            minHeight: '48px',
            minWidth: '48px',
          }}
        >
          Back to my dashboard
        </Link>

        {/* No result, no score, no link to a report. Deliberately nothing else here:
            a "view your results" affordance would invite a child to look for the
            number this page exists to withhold. */}
      </div>
    </main>
  )
}

