/**
 * Offer personalisation from the paywall's locked-insight clicks (lever N-7).
 *
 * WHY THIS IS THE CHEAPEST CONVERSION LEVER AVAILABLE
 *   `15-conversion-and-ux-resolution.md` §2.2 lists N-7 as "lifts offer-page
 *   conversion using data already collected". `PAYWALL_LOCK_CLICKED` records
 *   which locked insight a parent clicked, and its own component header calls
 *   that "the most valuable single datum in the funnel" - it reveals what the
 *   parent actually wants rather than what a feature matrix assumes they want.
 *
 *   Until now the event was write-only: captured, never read. This module is the
 *   read side.
 *
 * WHAT IT DOES, AND DELIBERATELY DOES NOT DO
 *   It REORDERS the existing benefit list so the benefit matching the clicked
 *   insight leads. It does not invent copy, does not add claims, and does not
 *   change the price, the guarantee or the offer window. Reordering is honest
 *   personalisation: every benefit shown was already true and already listed.
 *
 *   Fabricating a new headline per insight would risk promising something the
 *   product does not do, which is an ACL problem rather than a conversion win.
 *
 * PURE MODULE
 *   No database or Next.js imports, so the matching rules are unit-testable
 *   without a server. The lookup lives in src/lib/funnel/interest.ts.
 */

/** The locked insight titles, as rendered by ReadinessReportView. */
export const LOCKED_INSIGHT_TITLES = [
  'Time per question',
  'Question-level review',
  'Progress trend',
  'Adaptive study plan',
  'Further AI writing marks',
] as const

export type LockedInsightTitle = (typeof LOCKED_INSIGHT_TITLES)[number]

/**
 * Insight title -> lowercase substrings that identify its matching benefit.
 *
 * Substrings rather than exact strings because the benefit list is prose and is
 * edited for copy reasons; an exact-match table would silently stop matching the
 * first time someone improved a sentence. Several alternatives per insight for
 * the same reason.
 *
 * Note 'Time per question' and 'Question-level review' both match the combined
 * "Time-per-question diagnostics and full question-level review" bullet. That is
 * correct - one benefit genuinely delivers both - not a collision to resolve.
 */
const INSIGHT_MATCHERS: Record<string, string[]> = {
  'Time per question': ['time-per-question', 'time per question'],
  'Question-level review': ['question-level review', 'question review'],
  'Progress trend': ['progress trend', 'trend across'],
  'Adaptive study plan': ['adaptive weekly study plan', 'study plan'],
  'Further AI writing marks': ['ai writing marks', 'writing marks'],
}

/** True when the value is one of the known locked insight titles. */
export function isLockedInsight(value: unknown): value is LockedInsightTitle {
  return typeof value === 'string' && (LOCKED_INSIGHT_TITLES as readonly string[]).includes(value)
}

/**
 * Move the benefit matching `insight` to the front, preserving every other item
 * and its relative order.
 *
 * Returns the original array unchanged when there is no insight or no match -
 * an unrecognised value must not reshuffle the list arbitrarily, and must never
 * drop a benefit. Moves rather than copies, so no benefit appears twice.
 */
export function prioritiseIncludes(includes: string[], insight: string | null): string[] {
  if (!insight) return includes

  const matchers = INSIGHT_MATCHERS[insight]
  if (!matchers) return includes

  const index = includes.findIndex((line) => {
    const lower = line.toLowerCase()
    return matchers.some((m) => lower.includes(m))
  })

  // Not found, or already first: nothing to do.
  if (index <= 0) return includes

  const reordered = [...includes]
  const [matched] = reordered.splice(index, 1)
  return [matched, ...reordered]
}

/**
 * A short, truthful acknowledgement of what the parent asked to see.
 *
 * Returns null when there is nothing to acknowledge, so the panel renders its
 * normal opening rather than an empty personalised slot.
 */
export function interestLine(insight: string | null): string | null {
  if (!insight || !isLockedInsight(insight)) return null
  return `You asked to see ${insight.toLowerCase()} - it is included below.`
}
