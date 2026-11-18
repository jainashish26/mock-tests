/**
 * Display helpers shared by the admin screens.
 *
 * The vocabularies here (attempt statuses, purchase statuses, roles) mirror the
 * Postgres enums from `supabase/migrations`. Lookups fall back gracefully so an
 * unknown or newly added value renders as a readable outline pill instead of
 * crashing the page.
 */

/** Any variant accepted by `@/components/ui/Badge`. */
export type BadgeVariant =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline'
  | 'success'
  | 'warning'
  | 'muted'

/* attempts.status (enum `attempt_status`) */

const ATTEMPT_STATUSES: Record<string, { label: string; variant: BadgeVariant }> = {
  IN_PROGRESS: { label: 'In progress', variant: 'warning' },
  SUBMITTED: { label: 'Submitted', variant: 'secondary' },
  WRITING_PENDING: { label: 'Writing pending', variant: 'warning' },
  COMPLETE: { label: 'Complete', variant: 'success' },
}

export function attemptStatusMeta(status: string | null | undefined): {
  label: string
  variant: BadgeVariant
} {
  if (!status) return { label: 'Unknown', variant: 'outline' }
  return ATTEMPT_STATUSES[status] ?? { label: status.replace(/_/g, ' '), variant: 'outline' }
}

/* purchases.status */

const PURCHASE_STATUSES: Record<string, { label: string; variant: BadgeVariant }> = {
  COMPLETED: { label: 'Completed', variant: 'success' },
  PENDING: { label: 'Pending', variant: 'warning' },
  FAILED: { label: 'Failed', variant: 'destructive' },
  REFUNDED: { label: 'Refunded', variant: 'muted' },
}

export function purchaseStatusMeta(status: string | null | undefined): {
  label: string
  variant: BadgeVariant
} {
  if (!status) return { label: 'Unknown', variant: 'outline' }
  return PURCHASE_STATUSES[status] ?? { label: status.replace(/_/g, ' '), variant: 'outline' }
}

/* app_user_roles.role (enum `user_role`) */

const ROLES: Record<string, { label: string; variant: BadgeVariant }> = {
  STUDENT: { label: 'Student', variant: 'default' },
  PARENT: { label: 'Parent', variant: 'secondary' },
  TUTOR: { label: 'Tutor', variant: 'success' },
  TEST_CREATOR: { label: 'Test creator', variant: 'warning' },
  ADMIN: { label: 'Admin', variant: 'destructive' },
}

export function roleMeta(role: string | null | undefined): { label: string; variant: BadgeVariant } {
  if (!role || role === 'NO_ROLE') return { label: 'No role', variant: 'outline' }
  return ROLES[role] ?? { label: role.replace(/_/g, ' '), variant: 'outline' }
}

/** Roles an admin can assign via `POST /api/admin/users/:id/role`. */
export const ASSIGNABLE_ROLES = ['STUDENT', 'PARENT', 'TUTOR', 'TEST_CREATOR', 'ADMIN'] as const

/* Money, time and score formatting */

const audFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
})

const audCentsFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
})

/** Whole-dollar amounts (KPI cards) — `125000` → `$1,250`. */
export function formatDollars(cents: number): string {
  return audFormatter.format(cents / 100)
}

/** Exact amounts (purchase rows) — `2999` → `$29.99`. */
export function formatCents(cents: number): string {
  return audCentsFormatter.format(cents / 100)
}

/** `3725` → `1h 2m`; `95` → `1m`; `null` → `—`. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—'
  const mins = Math.max(0, Math.round(seconds / 60))
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

/** `score_out_of100` is numeric — `87.5` → `88%`, missing → `—`. */
export function formatScore(score: number | string | null | undefined): string {
  if (score === null || score === undefined || score === '') return '—'
  const value = Number(score)
  if (Number.isNaN(value)) return '—'
  return `${Math.round(value)}%`
}
