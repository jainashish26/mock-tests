/**
 * Shared exam-target vocabulary for funnel step 8.
 *
 * Lives in `lib` rather than in the API route because both the route (which
 * validates) and `/onboarding` (which renders the choices) need it. Exporting a
 * constant from a Next.js `route.ts` is also fragile: route files are statically
 * analysed for their HTTP verb exports, and extra exports can trip that analysis.
 *
 * Deliberately a fixed list with an "Other" escape hatch rather than free text.
 * A dropdown makes the choice costless and keeps `target_exam` values consistent
 * enough to group by, which matters because the readiness report and the sibling
 * cross-sell both aggregate on it.
 */
export const KNOWN_EXAMS = [
  'NAPLAN',
  'NSW Selective High School',
  'Victoria Selective Entry',
  'Queensland Academy',
  'Scholarship - EduTest',
  'Scholarship - ACER',
  'Scholarship - AAS',
  'Maths Olympiad - AMC',
  'Other',
] as const

export type KnownExam = (typeof KNOWN_EXAMS)[number]

/** Sessions per week the funnel spec targets ("3 sessions a week"). */
export const DEFAULT_WEEKLY_SESSIONS = 3

/** Earliest sensible exam date: tomorrow. */
export const MIN_DAYS_AHEAD = 1

/** Latest: three years. Beyond that a countdown is meaningless to a parent. */
export const MAX_DAYS_AHEAD = 365 * 3

/**
 * Map a chosen exam name onto the platform's `exam_type` enum where one fits.
 *
 * Scholarship exams sit under SELECTIVE because the enum has no scholarship
 * member and adding one is a migration; the free-text `target_exam` column is the
 * authoritative label for anything user-facing.
 */
export function examTypeFor(label: string): string | null {
  if (label === 'NAPLAN') return 'NAPLAN_STYLE'
  if (label.includes('Olympiad')) return 'OLYMPIAD'
  if (
    label.includes('Selective') ||
    label.includes('Academy') ||
    label.includes('Scholarship')
  ) {
    return 'SELECTIVE'
  }
  return null
}

/**
 * Parse and bound an ISO date. Returns null when it is not usable.
 *
 * An unbounded date field is how a countdown ends up reading "-400 days" on a
 * dashboard, and a parent who sees that once stops trusting the numbers that
 * matter.
 */
export function parseExamDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim())
  if (!match) return null

  const [, year, month, day] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day))

  // Reject the JS Date rollover: 2026-02-31 would otherwise silently become
  // 3 March and be stored as a date the parent never chose.
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  ) {
    return null
  }

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)

  const daysAhead = Math.floor((date.getTime() - startOfToday.getTime()) / 86_400_000)
  if (daysAhead < MIN_DAYS_AHEAD || daysAhead > MAX_DAYS_AHEAD) return null

  return `${year}-${month}-${day}`
}

/** Whole days from today to an ISO date, for countdowns and event props. */
export function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const target = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(target.getTime())) return null
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - startOfToday.getTime()) / 86_400_000)
}
