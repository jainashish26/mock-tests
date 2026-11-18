import { callReportingFunction } from './connection'
import type { ExperimentResultRow } from './types'

/**
 * Report A12 - Experiment Results. "Did this change work?"
 *
 * A12 is the merged owner of the brief's duplicated "pricing experiment outcomes"
 * and "A/B test results" (conflict X-9): one question, one statistic, one owner.
 *
 * WHAT MAKES THIS REPORT TRUSTWORTHY
 *   * Counts EXPOSURES, not assignments. §5.4: "Counting assigned-but-never-shown
 *     users biases every experiment toward the null." In the seeded N-7
 *     experiment 100 parents are assigned and only 8 exposed - reporting 100
 *     would halve the apparent effect.
 *   * Conversions are counted only AFTER exposure. A checkout that predates the
 *     exposure cannot have been caused by it.
 *   * Wilson/Newcombe intervals, not Wald, because conversion rates sit near 0
 *     and 1 where Wald is unreliable.
 *   * `p_value_experiment`, never `p_value` - the latter already means item
 *     difficulty (risk R-11).
 *   * Below the minimum sample the verdict is INSUFFICIENT_DATA and the reason
 *     says explicitly that this is not evidence of no difference.
 *   * Every verdict carries a reasoning string. It is a recommendation a human
 *     can disagree with, never an automatic action.
 *
 * NO SUBJECT IDENTIFIERS
 *   The payload is per-arm aggregates only. `experiment_assignments` and
 *   `experiment_exposures` have SELECT revoked from authenticated and anon, so a
 *   browser cannot enumerate who is in which arm even if it wanted to.
 */

export type { ExperimentDecision, ExperimentResultRow } from './types'

export interface AdminExperimentsResult {
  rows: ExperimentResultRow[]
  error: boolean
  code?: string
}

/** Load A12. ADMIN only, enforced in SQL. Never throws. */
export async function loadExperimentResults(): Promise<AdminExperimentsResult> {
  const res = await callReportingFunction<ExperimentResultRow>('admin_experiment_results', {})
  if (res.error) return { rows: [], error: true, code: res.code }
  return { rows: res.rows, error: false }
}

/** Group rows by experiment, preserving the control-first ordering from SQL. */
export function groupByExperiment(
  rows: ExperimentResultRow[]
): Array<{ key: string; name: string; status: string; arms: ExperimentResultRow[] }> {
  const map = new Map<string, { key: string; name: string; status: string; arms: ExperimentResultRow[] }>()

  for (const row of rows) {
    let entry = map.get(row.experiment_key)
    if (!entry) {
      entry = {
        key: row.experiment_key,
        name: row.experiment_name,
        status: row.status,
        arms: [],
      }
      map.set(row.experiment_key, entry)
    }
    entry.arms.push(row)
  }

  return [...map.values()]
}
