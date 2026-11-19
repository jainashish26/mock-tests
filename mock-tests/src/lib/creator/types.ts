/**
 * Typed contracts for the `/api/creator/*` endpoints.
 *
 * Field names are snake_case because that is what the routes return (they map
 * 1:1 onto the Postgres columns) and what the request bodies send. Keeping the
 * wire shape means components never translate between two naming conventions.
 *
 * Every shape below was checked against the route handlers and the live
 * `questions` / `tests` / `test_sections` / `test_questions` schemas.
 */

import type { ContentStatus, QuestionType } from '@/lib/creator/content-meta'

/* -------------------------------------------------------------------------- */
/* Shared list plumbing                                                        */
/* -------------------------------------------------------------------------- */

export interface ListResponse<T> {
  data: T[]
  count: number
  page: number
  pageSize: number
}

export type SortDir = 'asc' | 'desc'

/**
 * Sort keys accepted by `parseSort()` in `src/lib/creator/api.ts`.
 *
 * The route maps each key onto a real column and falls back to `updated` when it
 * does not recognise one, so an unknown key silently changes the ordering rather
 * than erroring - the UI must only offer keys that exist on the table it lists.
 */
export type SortKey =
  | 'updated'
  | 'created'
  | 'title'
  | 'stem'
  | 'difficulty'
  | 'status'
  | 'exam_type'
  | 'type'
  | 'subject'
  | 'topic'
  | 'year_level'
  | 'time_limit_mins'

export interface ListParams {
  page?: number
  /** Read by `parsePagination()` as `pageSize` (or `per_page`); capped at 100. */
  pageSize?: number
  search?: string
  status?: ContentStatus | ''
  exam_type?: string
  sort?: SortKey
  dir?: SortDir
}

export type TestListParams = ListParams

export interface QuestionListParams extends ListParams {
  type?: QuestionType | ''
  year_level?: number | ''
}

/**
 * Every list filter the creator UI can send, minus pagination (which the list
 * hook owns). Superset of both routes' filters, so one hook serves both lists.
 */
export type ContentFilters = Omit<QuestionListParams, 'page' | 'pageSize'>

/* -------------------------------------------------------------------------- */
/* Tests                                                                       */
/* -------------------------------------------------------------------------- */

export interface TestRow {
  id: string
  title: string
  exam_type: string | null
  year_level_min: number | null
  year_level_max: number | null
  time_limit_mins: number | null
  is_free: boolean
  status: ContentStatus
  created_by?: string | null
  created_at: string | null
  updated_at: string | null
  /** Added by `GET /api/creator/tests` (counted from `test_questions`). */
  question_count?: number
  approved_by?: string | null
  published_at?: string | null
}

/** Row from `test_sections`; note the column is `name`, not `section_name`. */
export interface TestSectionRow {
  id: string
  test_id: string
  name: string
  section_order: number
  time_limit_mins: number | null
  /** NOT NULL in the schema: a section declares how many questions it holds. */
  question_count: number
  created_at?: string | null
}

/** The trimmed question payload embedded in `GET /api/creator/tests/:id`. */
export interface TestQuestionSummary {
  id: string
  stem: string | null
  type: QuestionType | null
  status: ContentStatus | null
  subject: string | null
  topic: string | null
  year_level: number | null
  difficulty: number | null
  correct_answer: string | null
  explanation: string | null
  exam_type: string | null
  answer_a: string | null
  answer_b: string | null
  answer_c: string | null
  answer_d: string | null
  answer_e: string | null
}

/** One `test_questions` mapping with its question joined in. */
export interface TestQuestionEntry {
  question_id: string
  section_name: string | null
  base_difficulty: number | null
  question_order: number | null
  question: TestQuestionSummary | null
}

export interface TestDetail {
  test: TestRow
  sections: TestSectionRow[]
  questions: TestQuestionEntry[]
  editable: boolean
}

export interface DuplicateTestResponse {
  id: string
  test: TestRow
  sections_copied: number
  questions_copied: number
}

export interface TestInput {
  title?: string
  exam_type?: string
  year_level_min?: number | null
  year_level_max?: number | null
  time_limit_mins?: number | null
  is_free?: boolean
  status?: ContentStatus
}

export interface TestSectionInput {
  name?: string
  section_order?: number
  time_limit_mins?: number | null
  question_count?: number
}

/* -------------------------------------------------------------------------- */
/* Questions                                                                   */
/* -------------------------------------------------------------------------- */

/** Full `questions` row as returned by `select('*')`. */
export interface QuestionRow {
  id: string
  type: QuestionType | null
  stem: string | null
  comprehension_text?: string | null
  image_url?: string | null
  /** `text` column in the live schema (not jsonb). */
  correct_answer?: string | null
  explanation?: string | null
  explanation_media?: string | null
  explanation_steps?: unknown
  tags: string[] | null
  status: ContentStatus
  created_by?: string | null
  created_at: string | null
  updated_at: string | null
  exam_id?: string | null
  exam_type?: string | null
  exam_section?: string | null
  year_level?: number | null
  subject?: string | null
  topic?: string | null
  sub_topic?: string | null
  answer_a?: string | null
  answer_b?: string | null
  answer_c?: string | null
  answer_d?: string | null
  answer_e?: string | null
  difficulty?: number | null
  difficulty_dynamic?: number | null
  discrimination_index?: number | null
  average_time_seconds?: number | null
  is_active?: boolean
  correct_answer_score?: number | null
  /* Skill weightings, all numeric in 0..1 (see question-fields.ts). */
  skill_grammar?: number | null
  skill_spelling?: number | null
  skill_vocabulary?: number | null
  skill_reading?: number | null
  skill_writing?: number | null
  skill_algebra?: number | null
  skill_word_problems?: number | null
  skill_geometry?: number | null
  skill_statistics?: number | null
  skill_mental_maths?: number | null
  skill_problem_solving?: number | null
  skill_numerical_reasoning?: number | null
  skill_verbal_reasoning?: number | null
  skill_logical_reasoning?: number | null
  skill_critical_thinking?: number | null
  /* Server-managed analytics; never sent back to the API. */
  total_attempts?: number | null
  correct_attempts?: number | null
  success_rate?: number | null
  avg_time_taken_seconds?: number | null
  most_common_wrong_answer?: string | null
  skip_rate?: number | null
  flag_count?: number | null
}

export interface QuestionDetail {
  question: QuestionRow
  editable: boolean
  tests: Array<Pick<TestRow, 'id' | 'title' | 'status'>>
  mappings: Array<{ test_id: string; section_name: string | null; question_order: number | null }>
}

export interface DuplicateQuestionResponse {
  id: string
  question: QuestionRow
}

/** Result of `POST /api/creator/upload-questions` (bulk CSV import). */
export interface UploadQuestionsResult {
  total: number
  inserted: number
  errors: Array<{ row: number; message: string }>
}

/**
 * Body accepted by `questionPayload()` in `src/lib/creator/question-fields.ts`.
 * Unknown keys are dropped server-side, so this is the safe-to-send subset.
 */
export interface QuestionInput {
  type?: QuestionType
  status?: ContentStatus
  stem?: string
  comprehension_text?: string | null
  image_url?: string | null
  correct_answer?: string | null
  explanation?: string | null
  explanation_media?: string | null
  explanation_steps?: string | null
  exam_id?: string | null
  exam_type?: string | null
  exam_section?: string | null
  subject?: string | null
  topic?: string | null
  sub_topic?: string | null
  year_level?: number | null
  difficulty?: number | null
  correct_answer_score?: number | null
  average_time_seconds?: number | null
  discrimination_index?: number | null
  is_active?: boolean
  answer_a?: string | null
  answer_b?: string | null
  answer_c?: string | null
  answer_d?: string | null
  answer_e?: string | null
  tags?: string[] | string | null
  skill_grammar?: number | null
  skill_spelling?: number | null
  skill_vocabulary?: number | null
  skill_reading?: number | null
  skill_writing?: number | null
  skill_algebra?: number | null
  skill_word_problems?: number | null
  skill_geometry?: number | null
  skill_statistics?: number | null
  skill_mental_maths?: number | null
  skill_problem_solving?: number | null
  skill_numerical_reasoning?: number | null
  skill_verbal_reasoning?: number | null
  skill_logical_reasoning?: number | null
  skill_critical_thinking?: number | null
}

/* -------------------------------------------------------------------------- */
/* Stats                                                                       */
/* -------------------------------------------------------------------------- */

export interface StatusCounts {
  total: number
  draft: number
  pending: number
  published: number
  archived: number
  /** draft + pending: the content a creator may still change. */
  editable: number
}

export interface CreatorStats {
  tests: StatusCounts
  questions: StatusCounts
  editableStatuses: ContentStatus[]
  generatedAt: string
}
/* -------------------------------------------------------------------------- */
/* Writing prompts (AI Practice Lab bank, managed by Quiz Master / admin)      */
/* -------------------------------------------------------------------------- */

export type WritingPromptType = 'narrative' | 'persuasive'

export interface WritingPromptRow {
  id: string
  year_level: number
  territory: string
  type: WritingPromptType
  text: string
  status: ContentStatus
  created_by?: string | null
  created_at: string | null
  updated_at: string | null
}

export interface WritingPromptListParams extends ListParams {
  type?: WritingPromptType | ''
  year_level?: number | ''
}

/** Body accepted by `writingPromptPayload()`; unknown keys are dropped server-side. */
export interface WritingPromptInput {
  year_level?: number | null
  territory?: string
  type?: WritingPromptType
  text?: string
  status?: ContentStatus
}
