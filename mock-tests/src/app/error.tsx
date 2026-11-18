'use client'

import { useEffect } from 'react'
import Link from 'next/link'

/**
 * Global error boundary (src/app/error.tsx).
 *
 * WHY THIS EXISTS
 *   Without it an unhandled render error shows Next.js's default screen - a
 *   stack-trace-shaped page with no brand and no way forward. SPRINT_ANALYSIS
 *   flagged its absence as concern #5. Every reporting panel already refuses to
 *   render an error as "no data"; this is the same rule at the page level:
 *   a failure must LOOK like a failure, say it is our fault, and offer a way
 *   out.
 *
 * WHAT IT NEVER DOES
 *   The error message and stack are logged, never rendered. The `digest` is
 *   shown because it is the only safe handle support can correlate with server
 *   logs - it is an opaque id, not a detail. A child or parent must never see
 *   an exception string.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // The full error goes to the log (and to the platform's error reporting
    // via console in production). It goes to the screen only as a digest.
    console.error('[global-error]', error)
  }, [error])

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <h1 className="text-xl font-extrabold tracking-tight text-foreground">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This is a problem on our side, not something you did. Your practice
          and results are safe.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-primary px-6 font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex min-h-12 items-center justify-center rounded-full border border-border px-6 font-semibold text-foreground hover:bg-muted"
          >
            Back to home
          </Link>
        </div>

        {error.digest ? (
          <p className="mt-6 text-xs text-muted-foreground">
            If this keeps happening, contact support and mention reference{' '}
            <code className="rounded bg-muted px-1 py-0.5">{error.digest}</code>
          </p>
        ) : null}
      </div>
    </main>
  )
}