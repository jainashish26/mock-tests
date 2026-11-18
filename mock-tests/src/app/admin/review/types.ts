/**
 * Shared vocabulary for the admin review screens.
 *
 * Kept free of React so both the server pages (which build the items) and the
 * client components (which render and mutate them) can import it.
 */

/** Matches the `[entity]` segment accepted by `/api/admin/review/[entity]/[id]`. */
export type ReviewEntity = 'tests' | 'questions'

/** What the review API does: `approve` publishes, `reject` returns to draft. */
export type ReviewActionType = 'approve' | 'reject'

/** One row in a review list, flattened server-side for the client table. */
export interface ReviewItem {
  id: string
  /** Test title, or a trimmed preview of the question stem. */
  title: string
  /** `content_status` enum label. */
  status: string
  /** Raw `exam_type` value; the client renders it through `examTypeLabel`. */
  examType: string | null
  /** Short meta chips rendered under the title (years, time limit, …). */
  details: string[]
  /** Only set for tests — used by the approve confirmation copy. */
  questionCount?: number
  createdAt: string
  updatedAt: string
}

export const ENTITY_COPY: Record<ReviewEntity, { singular: string; plural: string }> = {
  tests: { singular: 'test', plural: 'tests' },
  questions: { singular: 'question', plural: 'questions' },
}
