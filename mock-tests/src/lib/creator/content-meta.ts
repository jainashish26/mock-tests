/**
 * Single source of truth for the vocabularies the creator workspace shows and the
 * `/api/creator/*` routes validate against.
 *
 * The enum values below mirror what is actually installed in Postgres
 * (`select enum_range(null::exam_type)`), which is a subset of the values listed in
 * `supabase/migrations/001_enums.sql`. Options that are not valid enum labels were
 * silently breaking inserts, so they are deliberately not offered here.
 */

/**
 * Badge variants used for content statuses. Declared here (rather than imported from
 * the Badge component) so this module stays free of React and can be shared with the
 * `/api/creator/*` route handlers; every value is a valid `Badge` variant.
 */
export type StatusBadgeVariant = 'outline' | 'warning' | 'success' | 'muted'

export const CONTENT_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'PUBLISHED', 'ARCHIVED'] as const
export type ContentStatus = (typeof CONTENT_STATUSES)[number]

/** Content a creator is still allowed to change or delete. */
export const EDITABLE_STATUSES: ContentStatus[] = ['DRAFT', 'PENDING_APPROVAL']

export const STATUS_LABELS: Record<ContentStatus, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending approval',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
}

export const STATUS_BADGES: Record<ContentStatus, StatusBadgeVariant> = {
  DRAFT: 'outline',
  PENDING_APPROVAL: 'warning',
  PUBLISHED: 'success',
  ARCHIVED: 'muted',
}

/** One-line explainer shown next to a status so creators know what they can do. */
export const STATUS_HINTS: Record<ContentStatus, string> = {
  DRAFT: 'Only visible to you. Edit, duplicate or delete it freely.',
  PENDING_APPROVAL: 'Waiting on a moderator. Still editable until it is approved.',
  PUBLISHED: 'Live for students. Duplicate it to make changes.',
  ARCHIVED: 'Hidden from students and locked against edits.',
}

export const QUESTION_TYPES = ['MCQ', 'SHORT_ANSWER', 'WRITING', 'READING_COMPREHENSION'] as const
export type QuestionType = (typeof QUESTION_TYPES)[number]

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  MCQ: 'Multiple choice',
  SHORT_ANSWER: 'Short answer',
  WRITING: 'Writing',
  READING_COMPREHENSION: 'Reading comprehension',
}

interface Option {
  value: string
  label: string
}

export const EXAM_TYPE_OPTIONS: Option[] = [
  { value: 'BENCHMARK', label: 'Benchmark' },
  { value: 'NAPLAN_STYLE_READING', label: 'NAPLAN style — Reading' },
  { value: 'NAPLAN_STYLE_NUMERACY', label: 'NAPLAN style — Numeracy' },
  { value: 'NAPLAN_STYLE_LANGUAGE_CONVENTION', label: 'NAPLAN style — Language convention' },
  { value: 'MATHS_OLYMPIAD', label: 'Maths Olympiad' },
  { value: 'ENGLISH_OLYMPIAD', label: 'English Olympiad' },
  { value: 'SELECTIVE', label: 'Selective entry' },
  { value: 'GRAMMAR', label: 'Grammar' },
  { value: 'VERBAL_REASONING', label: 'Verbal reasoning' },
  { value: 'NUMERICAL_REASONING', label: 'Numerical reasoning' },
  { value: 'SPELLING', label: 'Spelling' },
  { value: 'MENTAL_MATHS', label: 'Mental maths' },
  { value: 'GEOMETRY', label: 'Geometry' },
  { value: 'WORD_PROBLEMS', label: 'Word problems' },
  { value: 'PROBLEM_SOLVING', label: 'Problem solving' },
  { value: 'CRITICAL_THINKING', label: 'Critical thinking' },
  { value: 'VOCABULARY', label: 'Vocabulary' },
]

export const EXAM_TYPE_VALUES = EXAM_TYPE_OPTIONS.map((option) => option.value)

export function examTypeLabel(value: string | null | undefined): string {
  if (!value) return 'Unspecified'
  return EXAM_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? humanise(value)
}

export function statusLabel(value: string | null | undefined): string {
  if (!value) return 'Unknown'
  return STATUS_LABELS[value as ContentStatus] ?? humanise(value)
}

export function statusBadge(value: string | null | undefined): StatusBadgeVariant {
  return STATUS_BADGES[value as ContentStatus] ?? 'outline'
}

export function questionTypeLabel(value: string | null | undefined): string {
  if (!value) return 'Question'
  return QUESTION_TYPE_LABELS[value as QuestionType] ?? humanise(value)
}

/** True while a creator may still edit or delete the row. */
export function isEditable(value: string | null | undefined): boolean {
  return EDITABLE_STATUSES.includes(value as ContentStatus)
}

/**
 * Validates a `?status=` deep link (the dashboard's "awaiting review" shortcut).
 * Anything unrecognised is dropped so the list simply loads unfiltered instead of
 * sending the API an enum label Postgres would reject.
 */
export function parseStatusParam(
  value: string | string[] | null | undefined
): ContentStatus | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  const upper = raw?.trim().toUpperCase()
  if (!upper) return undefined
  return (CONTENT_STATUSES as readonly string[]).includes(upper) ? (upper as ContentStatus) : undefined
}

export function humanise(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
