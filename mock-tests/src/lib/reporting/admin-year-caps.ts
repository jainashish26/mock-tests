import { callReportingFunction, callReportingWrite } from './connection'
import {
  EXPECTED_YEAR_LEVELS,
  missingYearLevels,
  validateYearLevelCap,
  type CapValidationFailure,
  type YearLevelCap,
  type YearLevelCapDraft,
} from './year-caps'

/**
 * Admin read/write for the per-year-level daily practice limits (decision 4-A).
 *
 * WHY THE CONFIG IS READ THROUGH AN RPC AND NOT `.from()`
 *   `reporting.dim_year_level_cap` is not granted to `authenticated` or `anon` at
 *   all (migration 107 revoked it), so `admin_year_level_caps()` is the only path
 *   from the browser. That is the pattern every other threshold table uses, and the
 *   static gate over this directory fails the build if a `.from()` call appears
 *   here: a direct table read would expose the whole row set regardless of the
 *   role check, and would bypass the `ORDER BY` the wrapper supplies.
 *
 * WHY `error` IS NOT DERIVED FROM `rows.length === 0`
 *   A non-admin gets HTTP 200 and `[]` from `admin_year_level_caps()` — the
 *   authorisation model is designed so refusal and emptiness look identical from
 *   outside (migration 044). Verified live on 2026-11-20: the same RPC called with
 *   the service-role key returned 200 with an empty body against a database holding
 *   all eight configured rows, because `has_role('ADMIN')` cannot resolve
 *   `auth.uid()` without a user JWT.
 *
 *   So an empty read is reported as `error`, not as `caps: []`. Treating it as
 *   emptiness would show "no limits configured" on a fully configured database and
 *   invite the operator to configure limits that already exist — the same class of
 *   mistake as a NULL threshold presenting as a measurement, one level further up.
 */

export type { YearLevelCap, YearLevelCapDraft, CapValidationFailure } from './year-caps'
export {
  CAP_BOUNDS,
  CAP_COLUMN_LABELS,
  CAP_ENFORCEMENT_NOTE,
  EXPECTED_YEAR_LEVELS,
  QUESTION_MULTIPLIER_NOTE,
  describeCap,
  isCapDraftValid,
  missingYearLevels,
  validateYearLevelCap,
} from './year-caps'

export interface YearLevelCapsResult {
  caps: YearLevelCap[]
  /** True when the RPC itself failed, or when it answered in a shape that can
   *  only mean the read was refused. Distinct from "returned no rows". */
  error: boolean
  code?: string
  /** Mandated year levels missing from an otherwise successful read. A short
   *  list here is a data problem, not a permission one, and the UI says which. */
  missingYears: number[]
}

/**
 * Load the configured limits.
 *
 * An empty result is treated as a failure, and that is the whole point.
 *
 * Migration 107 seeds all eight year levels and makes every column NOT NULL, so a
 * successful read by a real admin returning zero rows is not a state that can
 * occur. What *can* occur — and does, verified against the live database — is
 * `admin_year_level_caps()` answering HTTP 200 with `[]` to a service-role caller,
 * because `has_role('ADMIN')` cannot resolve `auth.uid()` without a user JWT. If
 * this returned `{ caps: [], error: false }`, the page would render "no limits are
 * configured" about a fully configured database, and the operator's rational next
 * step would be to configure limits that already exist. Reporting the refusal is
 * the difference between a confusing screen and a wrong one.
 */
export async function loadYearLevelCaps(): Promise<YearLevelCapsResult> {
  const res = await callReportingFunction<YearLevelCap>('admin_year_level_caps', {})

  if (res.error) {
    return { caps: [], error: true, code: res.code, missingYears: [...EXPECTED_YEAR_LEVELS] }
  }

  if (res.rows.length === 0) {
    // 200 + empty, which for this RPC means refused. No code to report, so the
    // UI is told it could not verify rather than that nothing is set.
    return {
      caps: [],
      error: true,
      code: 'empty-refused',
      missingYears: [...EXPECTED_YEAR_LEVELS],
    }
  }

  const missingYears = missingYearLevels(res.rows.map((r) => r.year_level))
  return { caps: res.rows, error: false, missingYears }
}

export interface SaveCapResult {
  ok: boolean
  /** The row as the database now holds it, so the caller never re-derives state
   *  the server already returned. */
  saved?: YearLevelCap
  /** Client-side refusals, produced before any round trip. */
  failures?: CapValidationFailure[]
  /** The Postgres message when the server refused, surfaced verbatim: it names
   *  the field and the range, which is the information an operator needs. */
  error?: string
  code?: string
}

/**
 * Persist one year level's caps.
 *
 * Validation runs locally first so an obviously incoherent draft (a target above
 * its ceiling) never reaches Postgres, and the RPC's own checks still run — the
 * table CHECKs are the guarantee, and this only decides which message the operator
 * reads.
 *
 * The values are sent as `smallint` because that is the argument type. Passed as
 * plain JSON numbers PostgREST coerces fine, but the SQL function has no
 * `integer` overload: `admin_set_year_level_cap(2, 10, 250, 2, 50)` fails with
 * "function does not exist" rather than a type error, which reads like a missing
 * RPC and sends someone looking at grants. The cast is done here once, in the only
 * place that knows the signature.
 */
export async function saveYearLevelCap(draft: YearLevelCapDraft): Promise<SaveCapResult> {
  const failures = validateYearLevelCap(draft)
  if (failures.length > 0) return { ok: false, failures }

  const res = await callReportingWrite<YearLevelCap>('admin_set_year_level_cap', {
    p_year_level: draft.year_level,
    p_max_tests: draft.max_tests,
    p_max_questions: draft.max_questions,
    p_recommended_tests: draft.recommended_tests,
    p_recommended_questions: draft.recommended_questions,
  })

  if (res.error) {
    return {
      ok: false,
      error: res.code === '42501'
        ? 'Only an administrator can change practice limits.'
        : `The database refused this change: ${res.code ?? 'unknown error'}`,
      code: res.code,
    }
  }

  const saved = res.rows[0]
  if (!saved) {
    // The write succeeded but returned nothing. Reporting that as a silent save
    // would be a lie: the row the operator just edited is not confirmed.
    return { ok: false, error: 'The change was accepted but the saved row could not be read back.' }
  }

  return { ok: true, saved }
}
