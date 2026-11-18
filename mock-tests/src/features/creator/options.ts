import {
  CONTENT_STATUSES,
  EDITABLE_STATUSES,
  EXAM_TYPE_OPTIONS,
  QUESTION_TYPES,
  questionTypeLabel,
  statusLabel,
} from '@/lib/creator/content-meta'
import type { SortDir, SortKey } from '@/lib/creator/types'

/**
 * Option lists for the creator filters, sorts and forms.
 *
 * Everything is derived from `content-meta.ts`, which is the same vocabulary the
 * `/api/creator/*` routes validate against - so a value offered in the UI can
 * never be rejected by the API as an unknown enum label.
 */

export interface SelectOption {
  value: string
  label: string
}

/** Prepends an "All …" choice, which the routes read as "no filter". */
function withAll(allLabel: string, options: SelectOption[]): SelectOption[] {
  return [{ value: '', label: allLabel }, ...options]
}

export const STATUS_OPTIONS: SelectOption[] = CONTENT_STATUSES.map((status) => ({
  value: status,
  label: statusLabel(status),
}))

/** Statuses a creator may move content into (publishing stays with moderators). */
export const EDITABLE_STATUS_OPTIONS: SelectOption[] = EDITABLE_STATUSES.map((status) => ({
  value: status,
  label: statusLabel(status),
}))

export const EXAM_TYPE_SELECT_OPTIONS: SelectOption[] = EXAM_TYPE_OPTIONS

export const QUESTION_TYPE_OPTIONS: SelectOption[] = QUESTION_TYPES.map((type) => ({
  value: type,
  label: questionTypeLabel(type),
}))

/**
 * Year levels the platform serves.
 *
 * `questions.year_level` carries `CHECK (year_level BETWEEN 2 AND 8)` and
 * `student_profiles.year_level` the same, so offering anything else would only
 * produce a 23514 from Postgres after the API had already accepted it.
 */
export const YEAR_LEVELS = Array.from({ length: 7 }, (_, index) => index + 2)

/**
 * `questions.subject` is free text (no enum in Postgres), so the editor offers
 * these as suggestions via a datalist rather than pretending it is a closed set.
 */
export const SUBJECT_SUGGESTIONS = [
  'Mathematics',
  'English',
  'Numeracy',
  'Reading',
  'Writing',
  'Language Convention',
  'Science',
  'General Ability',
]

export const statusOptions = (allLabel = 'All statuses'): SelectOption[] => withAll(allLabel, STATUS_OPTIONS)
export const examTypeOptions = (allLabel = 'All exam types'): SelectOption[] =>
  withAll(allLabel, EXAM_TYPE_SELECT_OPTIONS)
export const questionTypeOptions = (allLabel = 'All types'): SelectOption[] =>
  withAll(allLabel, QUESTION_TYPE_OPTIONS)
export const yearLevelOptions = (allLabel = 'All years'): SelectOption[] =>
  withAll(
    allLabel,
    YEAR_LEVELS.map((year) => ({ value: String(year), label: `Year ${year}` }))
  )

/* Sort keys must be members of the API's `SORTABLE` whitelist. */

export const DEFAULT_SORT: SortKey = 'updated'
export const DEFAULT_DIR: SortDir = 'desc'

export const TEST_SORT_OPTIONS: SelectOption[] = [
  { value: 'updated', label: 'Last updated' },
  { value: 'created', label: 'Date created' },
  { value: 'title', label: 'Title (A–Z)' },
  { value: 'status', label: 'Status' },
  { value: 'exam_type', label: 'Exam type' },
  { value: 'time_limit_mins', label: 'Time limit' },
]

export const QUESTION_SORT_OPTIONS: SelectOption[] = [
  { value: 'updated', label: 'Last updated' },
  { value: 'created', label: 'Date created' },
  { value: 'stem', label: 'Question (A–Z)' },
  { value: 'difficulty', label: 'Difficulty' },
  { value: 'status', label: 'Status' },
  { value: 'type', label: 'Question type' },
  { value: 'subject', label: 'Subject' },
  { value: 'topic', label: 'Topic' },
  { value: 'year_level', label: 'Year level' },
]

/* Skill weighting columns accepted by `questionPayload()` (all 0..1 floats). */

export const SKILL_FIELDS = [
  'skill_grammar',
  'skill_spelling',
  'skill_vocabulary',
  'skill_reading',
  'skill_writing',
  'skill_algebra',
  'skill_word_problems',
  'skill_geometry',
  'skill_statistics',
  'skill_mental_maths',
  'skill_problem_solving',
  'skill_numerical_reasoning',
  'skill_verbal_reasoning',
  'skill_logical_reasoning',
  'skill_critical_thinking',
] as const

export type SkillField = (typeof SKILL_FIELDS)[number]

/** `skill_word_problems` → `word problems`. */
export function skillLabel(field: SkillField): string {
  return field.replace(/^skill_/, '').replace(/_/g, ' ')
}

/** Skill fields grouped so the editor can show a maths set and an English set. */
export const MATHS_SKILLS: SkillField[] = [
  'skill_algebra',
  'skill_word_problems',
  'skill_geometry',
  'skill_statistics',
  'skill_mental_maths',
  'skill_problem_solving',
  'skill_numerical_reasoning',
]

export const ENGLISH_SKILLS: SkillField[] = [
  'skill_grammar',
  'skill_spelling',
  'skill_vocabulary',
  'skill_reading',
  'skill_writing',
  'skill_verbal_reasoning',
  'skill_logical_reasoning',
  'skill_critical_thinking',
]
