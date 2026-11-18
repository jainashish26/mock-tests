import { badRequest } from './envelope'

/**
 * Query-parameter parsing for reporting routes.
 *
 * Kept in one place because §12.1 specifies a 400 for a bad filter, and six
 * routes each hand-rolling `searchParams.get()` is six chances to return a
 * 500 instead - or worse, to silently coerce a malformed value into a default
 * and answer a question nobody asked.
 */

export type ParamResult<T> = { ok: true; value: T } | { ok: false; response: Response }

/** UUID shape. Rejecting early keeps malformed ids out of the RPC layer. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Shape check for a uuid arriving in a JSON BODY rather than a query parameter.
 *
 * Exported so write endpoints validate ids the same way read endpoints do. The
 * alternative is each POST route keeping its own copy of the regex, and a subtly
 * different copy is how a malformed id reaches a SECURITY DEFINER body and comes
 * back as a 500 instead of a 400.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

/**
 * Require a `studentId` query parameter.
 *
 * Validation here is shape only. Whether the CALLER may see that student is
 * decided in SQL by `is_parent_of()` / `has_role()` inside the reporting
 * function - not here, and not by trusting the parameter.
 */
export function requireStudentId(reportId: string, url: string): ParamResult<string> {
  const raw = new URL(url).searchParams.get('studentId')

  if (!raw) return { ok: false, response: badRequest(reportId, 'studentId is required') }
  if (!UUID_RE.test(raw)) return { ok: false, response: badRequest(reportId, 'studentId is not a valid id') }

  return { ok: true, value: raw }
}

/**
 * Parse a bounded integer parameter.
 *
 * A missing or unparseable value falls back to `fallback` rather than
 * erroring: `weeks` and date ranges are presentation choices, and rejecting a
 * request because a client omitted an optional filter would be hostile. A
 * value that parses but falls outside [min, max] IS rejected, because that is
 * a client asking for a window the API does not offer - and for the admin
 * aggregates an unbounded range is the runaway-query risk the 366-day cap
 * exists to stop.
 */
export function intParam(
  reportId: string,
  url: string,
  name: string,
  opts: { fallback: number; min: number; max: number }
): ParamResult<number> {
  const raw = new URL(url).searchParams.get(name)

  if (raw === null || raw.trim() === '') return { ok: true, value: opts.fallback }

  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    return { ok: false, response: badRequest(reportId, `${name} must be a number`) }
  }

  const value = Math.trunc(parsed)
  if (value < opts.min || value > opts.max) {
    return {
      ok: false,
      response: badRequest(reportId, `${name} must be between ${opts.min} and ${opts.max}`),
    }
  }

  return { ok: true, value }
}

/**
 * Parse a YYYYMMDD integer date parameter.
 *
 * Used by the admin endpoints, whose SQL functions take integer date keys
 * rather than timestamps. Range is bounded to 00010101..99991231 so the
 * `to_date(...)` call inside the function cannot be handed an unparseable
 * string and raise from within a SECURITY DEFINER body.
 */
export function dateKeyParam(
  reportId: string,
  url: string,
  name: string,
  opts: { fallback: number }
): ParamResult<number> {
  return intParam(reportId, url, name, {
    fallback: opts.fallback,
    min: 10000101,
    max: 99991231,
  })
}

/**
 * Optional `studentId` filter.
 *
 * Same shape validation as requireStudentId, but a missing value is valid and
 * yields null: T7 serves the whole consented roster when no student is named.
 * Authorisation is still decided in SQL, never by trusting this parameter.
 */
export function optionalStudentId(reportId: string, url: string): ParamResult<string | null> {
  const raw = new URL(url).searchParams.get('studentId')

  if (raw === null || raw.trim() === '') return { ok: true, value: null }

  const trimmed = raw.trim()
  if (!UUID_RE.test(trimmed)) {
    return { ok: false, response: badRequest(reportId, 'studentId is not a valid id') }
  }

  return { ok: true, value: trimmed }
}

/** Optional free-text filter, length-bounded. */
export function textParam(
  reportId: string,
  url: string,
  name: string,
  maxLength = 64
): ParamResult<string | null> {
  const raw = new URL(url).searchParams.get(name)
  if (raw === null) return { ok: true, value: null }

  const trimmed = raw.trim()
  if (trimmed.length === 0) return { ok: true, value: null }
  if (trimmed.length > maxLength) {
    return { ok: false, response: badRequest(reportId, `${name} is too long`) }
  }

  return { ok: true, value: trimmed }
}

/**
 * Require a `testId` query parameter.
 *
 * T4 is the only report that takes one, and §12 specifies it as mandatory:
 * `/api/reporting/tutor/item-analysis?testId=` returns 403 unless the tutor
 * assigned THAT test. With no test named there is nothing to authorise against,
 * so a missing value is a 400 rather than a silent whole-bank query - which would
 * also be the one shape of request that could leak item statistics across tests.
 *
 * Shape only, as everywhere else in this module. Whether the caller may see the
 * test is decided in SQL by `tutor_item_analysis()`, never by trusting this value.
 */
export function requireTestId(reportId: string, url: string): ParamResult<string> {
  const raw = new URL(url).searchParams.get('testId')

  if (!raw || raw.trim() === '') {
    return { ok: false, response: badRequest(reportId, 'testId is required') }
  }

  const trimmed = raw.trim()
  if (!UUID_RE.test(trimmed)) {
    return { ok: false, response: badRequest(reportId, 'testId is not a valid id') }
  }

  return { ok: true, value: trimmed }
}

/**
 * Optional `testId` filter for A1.
 *
 * A1 covers the whole bank by default and narrows to one test form on request, so
 * unlike T4 a missing value is valid here. Same shape validation.
 */
export function optionalTestId(reportId: string, url: string): ParamResult<string | null> {
  const raw = new URL(url).searchParams.get('testId')

  if (raw === null || raw.trim() === '') return { ok: true, value: null }

  const trimmed = raw.trim()
  if (!UUID_RE.test(trimmed)) {
    return { ok: false, response: badRequest(reportId, 'testId is not a valid id') }
  }

  return { ok: true, value: trimmed }
}

