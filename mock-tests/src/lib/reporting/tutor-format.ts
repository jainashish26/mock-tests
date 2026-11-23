/**
 * Tutor view derivations - free of Next.js internals.
 *
 * Everything here is a pure function of rows that came back from SQL, so the
 * Node suite can assert it without a database and without dragging the server
 * client in. The IO half lives in ./tutor, the wording half in ./format.
 *
 * WHY THIS EXISTS RATHER THAN STAYING INLINE IN THE PAGES
 *   The tutor drill-down and the tutor dashboard both derive the same four things
 *   from the same rows: how much consent time is left, what share of set work is
 *   done, which assignment is most urgent, and how a movement figure should read.
 *   Written inline in two server components they are two copies that can drift -
 *   and every one of them has a failure mode that renders perfectly:
 *
 *     * `completionPct(0, 0) === 0` would tell a tutor "0% of work done" for a
 *       child who was never assigned anything. Null is the honest answer.
 *     * `movementLabel(null)` must NOT read "0 pp". Null means fewer than two
 *       attempts in a period (§5.4) - absence of evidence, not flat performance.
 *     * Sorting assignments by due date alone puts "no deadline" first or last
 *       depending on the comparison, and hides the overdue item under on-time
 *       ones. Overdue first is the whole point of a chase list.
 *     * `name.charAt(0)` renders an empty avatar circle for a blank username
 *       instead of failing loudly, so the fallback has to be explicit.
 *
 *   The A1 (format.ts) and A4 (test-form-format.ts) precedents exist for exactly
 *   this reason: a claim the UI makes should be assertable in isolation.
 */

export type TutorAssignmentStatus = 'ASSIGNED' | 'STARTED' | 'COMPLETED' | 'OVERDUE'

/** The columns the ordering and status logic actually reads. */
export interface TutorAssignmentLike {
  assignment_status: TutorAssignmentStatus
  is_overdue: boolean
  due_at: string | null
}

const MS_PER_DAY = 86_400_000

/**
 * Whole days from `now` until an ISO timestamp. Negative means already past.
 * Null in, null out - "no expiry recorded" is not "expires today".
 */
export function daysUntil(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.ceil((t - now) / MS_PER_DAY)
}

/**
 * Consent window as the tutor should read it.
 *
 * The countdown only appears inside 30 days: a date eleven months away does not
 * need "334 days left", and showing it would train the eye to ignore the warning
 * that matters. Expired is named as expired rather than as a negative count.
 */
export function consentWindowLabel(
  iso: string | null | undefined,
  now: number = Date.now()
): string | null {
  const days = daysUntil(iso, now)
  if (days === null) return null
  const date = new Date(iso as string).toLocaleDateString()
  if (days <= 0) return `expired ${date}`
  if (days <= 30) return `until ${date} · ${days} day${days === 1 ? '' : 's'} left`
  return `until ${date}`
}

/**
 * Share of set work completed, or NULL when nothing was set.
 *
 * Null is not 0: "0% of work done" implies failure to a tutor looking at a child
 * they have not assigned anything to yet.
 */
export function completionPct(assigned: number, completed: number): number | null {
  if (!Number.isFinite(assigned) || assigned <= 0) return null
  if (!Number.isFinite(completed)) return null
  const pct = Math.round((completed / assigned) * 100)
  return Math.max(0, Math.min(100, pct))
}

/** "3/4 · 75%", or just "0/0" when there is nothing to rate. */
export function completionLabel(assigned: number, completed: number): string {
  const pct = completionPct(assigned, completed)
  return pct === null ? `${completed}/${assigned}` : `${completed}/${assigned} · ${pct}%`
}

/**
 * Overdue first, then by due date ascending, with "no deadline" last.
 *
 * A chase list that opens with on-time work is a list the tutor has to re-sort in
 * their head. Non-mutating: it copies, because the callers pass rows straight out
 * of a loader and two panels read the same array.
 */
export function sortAssignments<T extends TutorAssignmentLike>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.is_overdue !== b.is_overdue) return a.is_overdue ? -1 : 1
    if (!a.due_at && !b.due_at) return 0
    if (!a.due_at) return 1
    if (!b.due_at) return -1
    return a.due_at.localeCompare(b.due_at)
  })
}

/** Single-character avatar. Blank or missing name gets '?', never an empty circle. */
export function initialFor(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim()
  return trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() : '?'
}

export type MovementTone = 'neutral' | 'up' | 'down'

/**
 * How a period-over-period movement reads.
 *
 * Null is rendered as words, not as 0: §5.4 suppresses movement unless BOTH
 * periods have at least two attempts, so null means "too little evidence" and a
 * flat "0 pp" would assert a finding the data refused to make.
 */
export function movementLabel(pp: number | null | undefined): { text: string; tone: MovementTone } {
  if (pp === null || pp === undefined || !Number.isFinite(pp)) {
    return { text: 'not enough attempts', tone: 'neutral' }
  }
  if (pp < 0) return { text: `${pp} pp`, tone: 'down' }
  if (pp > 0) return { text: `+${pp} pp`, tone: 'up' }
  return { text: '0 pp', tone: 'neutral' }
}

/** Tailwind classes for a movement tone, so both pages colour it identically. */
export const MOVEMENT_TONE_CLASS: Record<MovementTone, string> = {
  neutral: 'text-muted-foreground',
  up: 'text-emerald-600',
  down: 'text-destructive',
}
