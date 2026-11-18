import { callReportingFunction } from './connection'
import { asAtFor } from './lag'
import type { ReadinessProjection } from './types'

/**
 * Report P1 - the projection range, and the ONLY thing P1 adds.
 *
 * 11-bi-reporting-design.md §4.4 is explicit: "P1 readiness logic reuses
 * src/lib/report/readiness.ts unchanged. I am not redefining readiness - that
 * would create a second definition and breach MECE. P1 adds exactly one thing
 * the module lacks: a projection with an explicit range."
 *
 * So this module computes nothing. It surfaces what
 * `public.parent_readiness_projection()` (migration 030) already computed, and
 * the band thresholds in that function mirror `bandForScore()` in
 * src/lib/report/readiness.ts exactly - <50 Needs support, <75 Developing,
 * <90 Exceeding, else Strongly exceeding. Two vocabularies for the same child
 * is how a report ends up saying "Developing" in one place and "Band 3" in
 * another. Callers that need the confidence wording import `CONFIDENCE_LABEL`
 * from `@/lib/report/readiness` directly, so there is one source for it.
 *
 * THIS IS NOT A PREDICTIVE MODEL
 *   There is no validated predictive model for these exams and none is
 *   invented. The projection is a transparent linear extrapolation of observed
 *   platform scores, with a range derived from the observed variability of that
 *   child's own attempts. The UI must present it as a band with a confidence
 *   label, never as a forecast percentage.
 *
 * THE THREE GUARDRAILS ARE IN SQL, NOT HERE (B3/B13)
 *   1. Fewer than three completed attempts, or no future exam date => `eligible`
 *      is false and every figure is null. Not a low-confidence number: a number
 *      would be read as a forecast.
 *   2. The range is never narrower than the child's own observed standard
 *      deviation - a model cannot be more certain than the data it was fitted to.
 *   3. Bands plus a named readiness band, never a decimal.
 *
 *   Keeping them in SQL means a UI change cannot quietly drop one.
 */

export type { ReadinessProjection } from './types'
export { noProjectionSentence, projectionBandSentence } from './format'

export interface ParentProjectionResult {
  projection: ReadinessProjection | null
  asAt: string | null
  error: boolean
}

/** Load the P1 projection for one child. Never throws. */
export async function loadParentProjection(
  studentId: string
): Promise<ParentProjectionResult> {
  const [res, asAt] = await Promise.all([
    callReportingFunction<ReadinessProjection>('parent_readiness_projection', {
      p_student_id: studentId,
    }),
    asAtFor('mv_attempt_history'),
  ])

  if (res.error) return { projection: null, asAt, error: true }
  return { projection: res.rows[0] ?? null, asAt, error: false }
}
