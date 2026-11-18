import { callReportingFunction } from './connection'
import { asAtFor } from './lag'
import type { CoverageGapRow, ProductionQueueRow } from './types'

/**
 * Reports A3 (Curriculum Coverage Gaps) and TC1 (Content Coverage & Production
 * Queue) - Phase 2.
 *
 * A3 asks "where is coverage too thin?" and decides commissioning. TC1 asks
 * "what content needs writing?" and decides authoring priority. §4.5 gives them
 * the same owning metrics, so both read `reporting.mv_topic_coverage` and cannot
 * disagree about the same sub-topic.
 *
 * THE UNCONFIGURED THRESHOLD IS THE MOST IMPORTANT THING IN THIS MODULE
 *   `reporting.coverage_thresholds.min_items_per_subtopic` is NULL in the live
 *   database, and 11-...md 5.4 marks it `[config]` - a business decision that
 *   was never made. Because mv_topic_coverage guards its TOO_FEW branch on that
 *   value being non-null, `coverage_status` can only ever be ADEQUATE or
 *   NONE_PUBLISHED. Measured against the live catalogue, all 85 sub-topics
 *   report ADEQUATE - including sub-topics with a single published item.
 *
 *   So `coverage_status` is NOT a verdict while the threshold is unset, and
 *   `ADEQUATE` must never be rendered as "coverage is fine". Every row carries
 *   `threshold_configured`, and `coverageCaveat()` turns it into the sentence the
 *   UI is required to show. Migrations 042/043 back this: 042 adds an A15 check
 *   that FAILS until the threshold is set, and 043 stops both reports returning
 *   an empty result that would read as a clean bill of health.
 *
 *   No threshold is invented anywhere in this stack. Sorting thinnest-first is
 *   not a policy about what counts as too few; it puts the scarcest coverage in
 *   front of the person who has to decide.
 */

export type { CoverageGapRow, ProductionQueueRow } from './types'

export interface AdminCoverageResult {
  gaps: CoverageGapRow[]
  asAt: string | null
  error: boolean
  code?: string
}

export interface CreatorQueueResult {
  queue: ProductionQueueRow[]
  asAt: string | null
  error: boolean
  code?: string
}

/** Load A3. ADMIN only, enforced in SQL. */
export async function loadCoverageGaps(examType?: string | null): Promise<AdminCoverageResult> {
  const [res, asAt] = await Promise.all([
    callReportingFunction<CoverageGapRow>('admin_coverage_gaps', {
      p_exam_type: examType ?? null,
    }),
    asAtFor('mv_topic_coverage'),
  ])

  if (res.error) return { gaps: [], asAt, error: true, code: res.code }
  return { gaps: res.rows, asAt, error: false }
}

/**
 * Load TC1. TEST_CREATOR or ADMIN.
 *
 * Authorisation is enforced TWICE: by `requireReportingRole` in the route, and
 * by `has_role()` inside `creator_coverage_queue()` itself. The second is not
 * redundant - PostgREST exposes every granted function directly at
 * `/rest/v1/rpc/<name>`, so a route-level check alone would leave the function
 * callable by anyone who bypasses the route. Migration 044 added the internal
 * check after finding this one had been written route-only.
 */
export async function loadProductionQueue(limit = 50): Promise<CreatorQueueResult> {
  const [res, asAt] = await Promise.all([
    callReportingFunction<ProductionQueueRow>('creator_coverage_queue', {
      p_limit: Math.min(Math.max(Math.trunc(limit) || 50, 1), 500),
    }),
    asAtFor('mv_topic_coverage'),
  ])

  if (res.error) return { queue: [], asAt, error: true, code: res.code }
  return { queue: res.rows, asAt, error: false }
}

// Coverage wording lives in ./format so it can be tested in Node without
// dragging `next/headers` in via ./connection. Re-exported here so
// `@/lib/reporting/admin-coverage` stays the single import path for callers.
export {
  coverageCaveat,
  coverageStatusLabel,
  draftAgeNote,
  thresholdMissing,
} from './format'
