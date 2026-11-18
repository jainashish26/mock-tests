/**
 * CSV export for admin reporting endpoints.
 *
 * §12.1 requires `?format=csv` on every admin and tutor table endpoint, and
 * specifies that it "streams; never buffers the full set". The row counts here
 * are bounded (the SQL functions cap their date range at 366 days, so A14 is
 * at most ~8,800 hourly rows), which means buffering would probably work - but
 * "probably" is how an export endpoint becomes the thing that OOMs a serverless
 * function during the one week someone exports a year of data.
 *
 * ESCAPING IS THE PART THAT MATTERS
 *   A field beginning with `=`, `+`, `-` or `@` is executed as a formula by
 *   Excel and Google Sheets. These exports contain free text an operator did
 *   not author - a parent-entered exam label, a `detail` string assembled in
 *   SQL from data. Prefixing those with a tab neutralises the formula without
 *   changing what a human reads. This is CSV injection, it is a real vector,
 *   and an admin-only endpoint does not make it safe: the admin is the person
 *   you least want opening a weaponised spreadsheet.
 */

/** RFC 4180 escaping, plus formula neutralisation. */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return ''

  // Numbers are emitted bare. A negative metric (-5) begins with '-', which is
  // a formula trigger, but a spreadsheet parses a numeric cell as a number and
  // never evaluates it - and prefixing it with a tab would silently convert
  // every negative figure in the export into TEXT, breaking sums and sorts in a
  // way nobody would notice until the totals were wrong.
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : ''
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'

  const raw = value instanceof Date ? value.toISOString() : String(value)

  // Neutralise a leading formula trigger. Applied before quote-escaping so
  // the tab is inside the quoted field and survives a round trip.
  const safe = /^[=+\-@\t\r]/.test(raw) ? `\t${raw}` : raw

  if (/[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`
  return safe
}


/** Header row from an ordered column list. */
export function csvHeader(columns: string[]): string {
  return columns.map(csvField).join(',')
}

/** One data row, in the same column order as the header.
 *
 *  Takes `object` rather than `Record<string, unknown>`: a TypeScript interface
 *  has no index signature and is NOT assignable to `Record<string, unknown>`,
 *  so the stricter type would force a cast at every call site that passes a
 *  typed DTO row. Widening here keeps the call sites honest and the cast in
 *  one place. */
export function csvRow(columns: string[], record: object): string {
  const row = record as Record<string, unknown>
  return columns.map((c) => csvField(row[c])).join(',')
}

/**
 * Stream rows as CSV.
 *
 * Takes an iterable so a caller can hand it a generator and never hold the
 * whole result set in memory at once.
 */
export function csvResponse(
  filename: string,
  columns: string[],
  records: Iterable<object>
): Response {
  const encoder = new TextEncoder()

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`${csvHeader(columns)}\r\n`))

      for (const record of records) {
        controller.enqueue(encoder.encode(`${csvRow(columns, record)}\r\n`))
      }

      controller.close()
    },
  })

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      // attachment, not inline: a browser that renders a CSV inline renders a
      // spreadsheet of another family's data in a shared tab.
      'Content-Disposition': `attachment; filename="${filename}"`,
      // Per-family/per-operator data. Never public.
      'Cache-Control': 'no-store',
    },
  })
}
