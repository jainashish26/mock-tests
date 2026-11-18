import { callReportingFunction } from './connection'
import { asAtFor } from './lag'
import type { MasteryRow } from './types'

/**
 * Report P3 - Curriculum Mastery Map (Phase 2). "Which curriculum areas are weak?"
 *
 * THE NO-CODES RULE IS SATISFIED BY CONSTRUCTION
 *   11-...md 4.4 states that `content_description_code` must be ABSENT from the
 *   P3 response type: codes exist for tutors and admins, but a parent gets plain
 *   English. There is nothing to enforce here, because migration 026 dropped the
 *   VC2 curriculum entirely and re-based coverage on the subject -> topic ->
 *   sub_topic taxonomy that `public.questions` actually carries. There are no
 *   codes in this data model, so `MasteryRow` cannot leak one. That is a
 *   stronger guarantee than filtering a field out of a DTO.
 *
 *   It also removes P3's single biggest schedule risk. The spec sourced plain
 *   English from `dim_curriculum_vc2.parent_facing_label`, an editorial field
 *   flagged as assumption A-02 and called out in 14-...md as the item most
 *   likely to slip the whole phase if unstaffed. Here the label IS the topic
 *   name, which already exists.
 *
 * ONE OWNER FOR ACCURACY
 *   P3 reads `reporting.mv_skill_gap` - the same view P8 ranks from. It does not
 *   recompute per-topic accuracy. If it did, a parent could see 60% on the
 *   mastery map and 62% in a recommendation for the same topic, and would
 *   reasonably stop trusting both.
 *
 * ONE VOCABULARY FOR MASTERY
 *   `mastery_level` thresholds mirror `severityForAccuracy()` in
 *   src/lib/report/readiness.ts (<50 critical, <75 watch, else secure), and
 *   `mastery_label` mirrors the wording ReadinessReportView already renders.
 *   scripts/reporting.test.mts asserts the pairing, so changing one without the
 *   other fails the build rather than silently diverging.
 */

export type { MasteryLevel, MasteryRow } from './types'

export interface ParentMasteryResult {
  topics: MasteryRow[]
  asAt: string | null
  error: boolean
}

/** Load P3 for one child. Never throws. */
export async function loadParentMastery(studentId: string): Promise<ParentMasteryResult> {
  const [res, asAt] = await Promise.all([
    callReportingFunction<MasteryRow>('parent_mastery', { p_student_id: studentId }),
    asAtFor('mv_skill_gap'),
  ])

  if (res.error) return { topics: [], asAt, error: true }
  return { topics: res.rows, asAt, error: false }
}

// Mastery wording and the signal split live in ./format so they can be tested
// in Node without dragging `next/headers` in via ./connection. Re-exported here
// so `@/lib/reporting/parent-mastery` stays the single import path for callers.
export {
  MIN_ITEMS_FOR_SIGNAL,
  masteryCounts,
  masteryHeadline,
  splitBySignal,
  weakTopics,
} from './format'
