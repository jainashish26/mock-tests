import { ApiError, boolOr, enumParam, floatOr, intOr, nullableString } from './api'
import { CONTENT_STATUSES, EDITABLE_STATUSES, EXAM_TYPE_VALUES, QUESTION_TYPES } from './content-meta'

/**
 * Question payload shaping shared by `POST /api/creator/questions` and
 * `PUT /api/creator/questions/:id`.
 *
 * The editor posts JSON, but strings still arrive for every field (that is what form
 * state looks like), so each value is coerced and range-checked here instead of being
 * trusted. Unknown keys are dropped: a creator cannot write server-managed columns
 * such as `success_rate` or `total_attempts`.
 */

const TEXT_FIELDS = [
  'stem',
  'comprehension_text',
  'image_url',
  'correct_answer',
  'explanation',
  'explanation_steps',
  'exam_section',
  'subject',
  'topic',
  'sub_topic',
  'explanation_media',
  'answer_a',
  'answer_b',
  'answer_c',
  'answer_d',
  'answer_e',
] as const

const SKILL_FIELDS = [
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

/** Fields a creator must supply when creating a question. */
const REQUIRED_ON_CREATE = ['type', 'stem', 'exam_type', 'year_level', 'subject'] as const

interface Options {
  /** Only include keys the caller actually sent (used by PUT). */
  partial?: boolean
  /** Restrict the status choices (creators cannot publish directly). */
  allowedStatuses?: readonly string[]
}

export function questionPayload(body: Record<string, unknown>, options: Options = {}): Record<string, unknown> {
  const { partial = false, allowedStatuses = EDITABLE_STATUSES } = options
  const payload: Record<string, unknown> = {}
  const has = (key: string) => body[key] !== undefined

  for (const field of REQUIRED_ON_CREATE) {
    if (!partial && !has(field)) {
      throw new ApiError(400, `${labelFor(field)} is required.`)
    }
  }

  if (has('type') || !partial) {
    const type = enumParam(String(body.type ?? ''), QUESTION_TYPES)
    if (!type) throw new ApiError(400, 'Choose a valid question type.')
    payload.type = type
  }

  if (has('status') || !partial) {
    const status = enumParam(String(body.status ?? 'DRAFT'), allowedStatuses)
    if (!status) {
      // A real status this caller may not use is an authorisation problem (403, the
      // same code the tests routes return); anything else is just an invalid value.
      const isKnownStatus = enumParam(String(body.status ?? ''), CONTENT_STATUSES) !== null
      const restricted = allowedStatuses !== CONTENT_STATUSES
      throw new ApiError(
        isKnownStatus && restricted ? 403 : 400,
        restricted
          ? 'Creators can save a question as a draft or send it for approval - publishing is done by a moderator.'
          : 'Choose a valid status.'
      )
    }
    payload.status = status
  }

  if (has('exam_type') || !partial) {
    const examType = enumParam(String(body.exam_type ?? ''), EXAM_TYPE_VALUES)
    if (!examType) throw new ApiError(400, 'Choose a valid exam type.')
    payload.exam_type = examType
  }

  for (const field of TEXT_FIELDS) {
    if (!has(field)) continue
    payload[field] = nullableString(body[field])
  }

  if (has('exam_id')) payload.exam_id = nullableString(body.exam_id)

  if (has('year_level') || !partial) {
    // `questions.year_level` has CHECK (year_level BETWEEN 2 AND 9) in Postgres, so
    // validating the same range here turns a 23514 into a message a creator can act on.
    const yearLevel = intOr(body.year_level, null, 2, 9, 'Year level')
    if (yearLevel === null) throw new ApiError(400, 'Year level is required (2-9).')
    payload.year_level = yearLevel
  }

  if (has('subject') || !partial) {
    const subject = nullableString(body.subject)
    if (!subject) throw new ApiError(400, 'Subject is required.')
    payload.subject = subject
  }

  if (has('difficulty')) payload.difficulty = intOr(body.difficulty, null, 1, 5, 'Difficulty')
  if (has('correct_answer_score')) {
    payload.correct_answer_score = intOr(body.correct_answer_score, null, 0, 1000, 'Correct answer score')
  }
  if (has('average_time_seconds')) {
    payload.average_time_seconds = intOr(body.average_time_seconds, null, 0, 7200, 'Average time (seconds)')
  }
  if (has('discrimination_index')) {
    payload.discrimination_index = floatOr(body.discrimination_index, null, 0, 1, 'Discrimination index')
  }
  if (has('is_active')) payload.is_active = boolOr(body.is_active, true)

  for (const field of SKILL_FIELDS) {
    if (!has(field)) continue
    // `skill_*` columns are numeric weightings between 0 and 1 (see 002_tables.sql).
    payload[field] = floatOr(body[field], 0, 0, 1, labelFor(field))
  }

  if (has('tags') || !partial) {
    payload.tags = parseTags(body.tags)
  }

  return payload
}

/** Accepts a JSON array, a plain array, or a comma separated string. */
export function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((tag) => String(tag).trim()).filter(Boolean)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed)
        return Array.isArray(parsed) ? parsed.map((tag) => String(tag).trim()).filter(Boolean) : []
      } catch {
        throw new ApiError(400, 'Tags must be a comma separated list or a JSON array.')
      }
    }
    return trimmed
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
  }
  return []
}

function labelFor(field: string): string {
  return field
    .replace(/^skill_/, '')
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
