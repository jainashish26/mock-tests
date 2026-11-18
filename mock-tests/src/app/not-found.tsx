import Link from 'next/link'

/**
 * Global 404 (src/app/not-found.tsx).
 *
 * The default Next.js 404 is unbranded and offers no way forward. This one
 * keeps the platform's visual language and gives the two exits that matter:
 * home, or the test store - a visitor who followed a stale link to a test or
 * blog post is one click from something useful instead of a dead end.
 *
 * Server component, no data access: a 404 page that queries the database can
 * turn one missing row into a second failure mode.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
          404
        </p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-foreground">
          We couldn&rsquo;t find that page
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The link may be out of date, or the page may have moved.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/"
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-primary px-6 font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Back to home
          </Link>
          <Link
            href="/tests"
            className="inline-flex min-h-12 items-center justify-center rounded-full border border-border px-6 font-semibold text-foreground hover:bg-muted"
          >
            Browse the test store
          </Link>
        </div>
      </div>
    </main>
  )
}