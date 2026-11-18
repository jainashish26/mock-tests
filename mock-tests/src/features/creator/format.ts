/**
 * Display helpers for the creator workspace.
 *
 * Dates come back from Postgres as ISO strings; these format them for a human
 * without pulling in a date library (none is in `package.json`).
 */

const dateFormatter = new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

/** `2026-09-14T02:11:00Z` → `14 Sep 2026`, or an em dash when unknown. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return dateFormatter.format(date)
}

/** Collapses whitespace and trims, so question stems preview cleanly. */
export function previewText(value: string | null | undefined, maxLength = 140): string {
  const clean = (value ?? '').replace(/\s+/g, ' ').trim()
  if (!clean) return 'Untitled'
  return clean.length > maxLength ? `${clean.slice(0, maxLength).trimEnd()}…` : clean
}

/** `7, 9` → `Years 7–9`; equal or missing values collapse sensibly. */
export function yearRange(min: number | null | undefined, max: number | null | undefined): string {
  if (min === null && max === null) return 'Any year'
  if (min === null) return `Up to Year ${max}`
  if (max === null || min === max) return `Year ${min}`
  return `Years ${min}–${max}`
}
