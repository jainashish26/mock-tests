/**
 * A4 wording and derivations - deliberately free of `next/headers`.
 *
 * Everything here is a pure function of rows that came back from SQL, so the
 * test suite can assert the sentences without a database and without dragging
 * the server client in. The IO half lives in ./test-forms.
 *
 * WHY THE WORDING IS NOT IN THE COMPONENT
 *   Every claim in this module has a failure mode that is silent if it drifts:
 *   a reliability figure described as "good" while the state says it was never
 *   computed, or a completion rate quoted without the attempt count it came
 *   from. Putting them here makes them testable; the A1 precedent (format.ts)
 *   exists for the same reason.
 */

/** The only states the SQL emits. Kept in step with 121 by a test that reads it. */
export const RELIABILITY_STATES = [
  'OK',
  'TOO_FEW_ITEMS',
  'NO_COMPLETE_ATTEMPTS',
  'TOO_FEW_ATTEMPTS',
  'NO_VARIANCE',
] as const

export type ReliabilityState = (typeof RELIABILITY_STATES)[number]

/** Structural shape of one A4 row. Numeric columns may arrive as strings. */
export interface TestFormMetricLike {
  test_title: string | null
  attempts_started: number
  attempts_submitted: number
  abandoned_attempts: number
  completion_rate_pct: number | string | null
  completion_reportable: boolean
  abandonment_point: number | string | null
  abandonment_share_pct: number | string | null
  abandonment_flagged: boolean
  items_in_form: number
  items_answered_by_all: number
  reliability_coefficient: number | string | null
  reliability_state: string
  reliability_meets_floor: boolean
  mean_score: number | string | null
  median_score: number | string | null
  score_n: number
}

export interface TestFormDistributionLike {
  bucket: number
  score_from: number | string | null
  score_to: number | string | null
  attempts: number
}

function num(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/** The one place a state string becomes words. */
export function reliabilityLabel(state: string): string {
  switch (state) {
    case 'OK':
      return 'Computed'
    case 'TOO_FEW_ITEMS':
      return 'Not computable: single-item form'
    case 'NO_COMPLETE_ATTEMPTS':
      return 'Not computable: no complete item matrix'
    case 'TOO_FEW_ATTEMPTS':
      return 'Not computable: too few complete attempts'
    case 'NO_VARIANCE':
      return 'Not computable: no score variance'
    default:
      // An unseen state must read as unknown, never as a reassuring default -
      // the fallback is the one branch nobody tests.
      return 'Unknown state'
  }
}

/** `94.6%` or an em dash. Never `NaN%`, never `0%` for "not measured". */
export function formatPct(value: number | string | null | undefined): string {
  const n = num(value)
  return n === null ? '—' : `${n}%`
}

/** A coefficient to three decimals, or the em dash that means "not computed". */
export function formatCoefficient(value: number | string | null | undefined): string {
  const n = num(value)
  return n === null ? '—' : n.toFixed(3)
}

/**
 * The caveat A4 must show while no form can produce a coefficient.
 *
 * Derived from the rows rather than written as a constant, exactly like
 * `markingCaveat` in ./format: it disappears by itself when the runner starts
 * recording the items it serves, and it cannot rot into a stale claim the way a
 * hardcoded paragraph does.
 *
 * Returns null as soon as ANY form yields a coefficient - a partial capture is a
 * per-form state, not a report-wide warning.
 */
export function reliabilityCaveat(rows: TestFormMetricLike[]): string | null {
  if (rows.length === 0) return null

  const computable = rows.filter((r) => num(r.reliability_coefficient) !== null)
  if (computable.length > 0) return null

  return (
    'No form has a reliability coefficient yet. KR-20 needs every child scored on every ' +
    'item of the form, and the runner records no row for an item it does not serve - so ' +
    'a skipped item and an unserved item are indistinguishable. This is the same capture ' +
    'gap A1 reports for skip rate. Completion and abandonment figures below are unaffected.'
  )
}

/**
 * How abandonment reads. Two numbers, because the median alone is misleading:
 * "median at item 43" means one thing across 13 of 240 attempts and another
 * across 130 of 240.
 */
export function abandonmentSentence(row: TestFormMetricLike): string {
  const point = num(row.abandonment_point)
  const share = num(row.abandonment_share_pct)

  if (point === null) {
    return 'No abandoned attempt reached a recorded item, so there is no abandonment point to report.'
  }

  const where = `Median stop at item ${point} of ${row.items_in_form}`
  const how =
    share === null
      ? 'share unknown'
      : `${row.abandoned_attempts} of ${row.attempts_started} attempts (${share}%)`

  return `${where} · ${how}`
}

/**
 * Attention flags for one form.
 *
 * Only ever derived from the row's own thresholds - nothing here invents a
 * benchmark. `completion_reportable === false` suppresses the belief that a
 * rate is a finding, so the small-sample flag is listed first.
 */
export function attentionFlags(row: TestFormMetricLike): string[] {
  const flags: string[] = []

  if (!row.completion_reportable) flags.push('Small sample')
  if (row.abandonment_flagged) flags.push('High abandonment')

  const coefficient = num(row.reliability_coefficient)
  if (coefficient !== null && !row.reliability_meets_floor) {
    flags.push('Below reliability floor')
  }

  return flags
}

/** Total attempts drawn in a histogram, and the tallest non-empty bucket. */
export function distributionSummary(rows: TestFormDistributionLike[]): {
  total: number
  peak: TestFormDistributionLike | null
} {
  let total = 0
  let peak: TestFormDistributionLike | null = null

  for (const row of rows) {
    total += row.attempts
    if (row.attempts > (peak?.attempts ?? 0)) peak = row
  }

  return { total, peak }
}

/** Ordered CSV columns for the A4 export. */
export const TEST_FORM_CSV_COLUMNS = [
  'test_title',
  'exam_type',
  'family_group',
  'attempts_started',
  'attempts_submitted',
  'abandoned_attempts',
  'completion_rate_pct',
  'abandonment_point',
  'abandonment_share_pct',
  'items_in_form',
  'items_answered_by_all',
  'reliability_coefficient',
  'reliability_state',
  'mean_score',
  'median_score',
  'score_n',
] as const

export type TestFormCsvRow = Record<(typeof TEST_FORM_CSV_COLUMNS)[number], unknown>

/** Flatten a row for export. State stays a raw token so it can be filtered. */
export function testFormCsvRows(
  rows: (TestFormMetricLike & { exam_type?: string | null; family_group?: string | null })[]
): TestFormCsvRow[] {
  return rows.map((r) => ({
    test_title: r.test_title ?? '',
    exam_type: r.exam_type ?? '',
    family_group: r.family_group ?? '',
    attempts_started: r.attempts_started,
    attempts_submitted: r.attempts_submitted,
    abandoned_attempts: r.abandoned_attempts,
    completion_rate_pct: num(r.completion_rate_pct),
    abandonment_point: num(r.abandonment_point),
    abandonment_share_pct: num(r.abandonment_share_pct),
    items_in_form: r.items_in_form,
    items_answered_by_all: r.items_answered_by_all,
    reliability_coefficient: num(r.reliability_coefficient),
    reliability_state: r.reliability_state,
    mean_score: num(r.mean_score),
    median_score: num(r.median_score),
    score_n: r.score_n,
  }))
}
