import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { getUserRole } from '@/lib/rbac/get-user-role'
import type { UserRole } from '@/types'

/**
 * Shared plumbing for the `/api/creator/*` routes.
 *
 * Every creator route needs the same three things: a signed-in user that holds the
 * TEST_CREATOR (or ADMIN) role, JSON errors the client UI can actually render, and
 * input that is normalised before it reaches PostgREST. Keeping it here means the
 * route handlers stay short and behave consistently.
 */

export { EDITABLE_STATUSES } from './content-meta'

export class ApiError extends Error {
  status: number
  details?: unknown

  constructor(status: number, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.details = details
  }
}

export interface CreatorContext {
  user: { id: string; email?: string }
  role: UserRole
  supabase: Awaited<ReturnType<typeof createClient>>
}

/**
 * Resolves the signed-in creator. Throws `ApiError` (never `redirect()`) so the
 * client receives a JSON error it can show in a toast instead of an HTML login page.
 */
export async function requireCreator(): Promise<CreatorContext> {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    throw new ApiError(401, 'Your session has expired. Please sign in again.')
  }

  const role = await getUserRole(user.id)

  if (role !== 'TEST_CREATOR' && role !== 'ADMIN') {
    throw new ApiError(403, 'Your account does not have content-creator access.')
  }

  return { user, role, supabase }
}

/** True when an admin is acting, or the creator owns the row. */
export function canManage(
  ctx: Pick<CreatorContext, 'user' | 'role'>,
  row: { created_by: string | null } | null | undefined
): boolean {
  if (!row) return false
  if (ctx.role === 'ADMIN') return true
  return row.created_by === ctx.user.id
}

/** Turns anything thrown inside a route handler into a consistent JSON response. */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { error: err.message, ...(err.details ? { details: err.details } : {}) },
      { status: err.status }
    )
  }

  console.error('[creator-api]', err)
  return NextResponse.json(
    { error: 'Something went wrong on our side. Please try again in a moment.' },
    { status: 500 }
  )
}

/** Maps a PostgREST/Postgres error onto a message a creator can act on. */
export function supabaseErrorMessage(
  error: { code?: string; message?: string },
  fallback: string
): string {
  switch (error.code) {
    case '23503':
      return `${fallback} Other records still reference it.`
    case '23505':
      return `${fallback} A record with the same unique values already exists.`
    case '23514':
      return `${fallback} One of the values is outside its allowed range.`
    case 'PGRST116':
    case 'PGRST204':
      return `${fallback} The record was not found.`
    case '42501':
      return `${fallback} Your role is not allowed to make this change.`
    default:
      return error.message ? `${fallback} ${error.message}` : fallback
  }
}

/**
 * Reads the `id` route param for both the Next 14 and Next 15/16 handler signatures.
 *
 * Next 15+ hands route handlers a *Promise* of the params object, so `params.id`
 * stays `undefined` until it is awaited - which made every creator `:id` route
 * (edit, delete, duplicate) answer "A content id is required." Both shapes work here.
 */
export async function routeId(params: unknown): Promise<string> {
  const maybePromise = params as { then?: unknown } | null | undefined
  const resolvedParams =
    typeof maybePromise?.then === 'function'
      ? ((await (params as Promise<Record<string, unknown>>)) ?? {})
      : ((params as Record<string, unknown>) ?? {})

  const raw = resolvedParams.id
  const value = typeof raw === 'string' ? raw : raw === undefined || raw === null ? '' : String(raw)

  if (!value) throw new ApiError(400, 'A content id is required.')
  return value
}

export interface Pagination {
  page: number
  pageSize: number
  from: number
  to: number
}

export function parsePagination(url: URL, defaultPageSize = 20, maxPageSize = 100): Pagination {
  const page = clampInt(url.searchParams.get('page'), 1, 1, 10_000)
  const pageSize = clampInt(
    url.searchParams.get('pageSize') ?? url.searchParams.get('per_page'),
    defaultPageSize,
    1,
    maxPageSize
  )
  return { page, pageSize, from: (page - 1) * pageSize, to: page * pageSize - 1 }
}

/**
 * Strips the characters PostgREST treats as syntax inside an `or(...)` filter, so a
 * search term can never reshape the query or trigger a parse error.
 */
export function cleanSearchTerm(raw: string | null, maxLength = 80): string {
  if (!raw) return ''
  return raw
    .replace(/[(),\\%_"]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

/** Validates an enum query param instead of trusting it. */
export function enumParam(raw: string | null, allowed: readonly string[]): string | null {
  const value = raw?.trim().toUpperCase()
  if (!value) return null
  return allowed.includes(value) ? value : null
}

/**
 * Whitelist of `?sort=` keys mapped onto real column names.
 *
 * Keys that do not exist on the table being listed simply fall back to `updated`
 * in PostgREST terms (the UI only offers valid ones), so this stays a safe,
 * closed map rather than a column name taken from the query string.
 */
const SORTABLE = {
  updated: 'updated_at',
  created: 'created_at',
  title: 'title',
  stem: 'stem',
  difficulty: 'difficulty',
  status: 'status',
  exam_type: 'exam_type',
  type: 'type',
  subject: 'subject',
  topic: 'topic',
  year_level: 'year_level',
  time_limit_mins: 'time_limit_mins',
} as const

export type SortKey = keyof typeof SORTABLE

export function parseSort(
  url: URL,
  fallback: SortKey = 'updated'
): { column: string; ascending: boolean } {
  const requested = (url.searchParams.get('sort') || fallback) as SortKey
  const column = SORTABLE[requested] ?? SORTABLE[fallback]
  const ascending = url.searchParams.get('dir') === 'asc'
  return { column, ascending }
}

/** Trims every string value in a payload so blank space is never stored as content. */
export function normaliseStrings<T extends Record<string, unknown>>(payload: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    out[key] = typeof value === 'string' ? value.trim() : value
  }
  return out as T
}

/** Empty string -> null, because Postgres would otherwise store '' as content. */
export function emptyToNull(value: unknown): string | null {
  if (typeof value !== 'string') return (value ?? null) as string | null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Reads a request body as a plain object. Accepts JSON (what the rewritten editors
 * send) as well as `multipart/form-data` and `application/x-www-form-urlencoded`
 * posts, so an existing form submission keeps working.
 */
export async function parsePayload(req: NextRequest): Promise<Record<string, unknown>> {
  const contentType = req.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    try {
      const body = await req.json()
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new ApiError(400, 'Expected a JSON object.')
      }
      return body as Record<string, unknown>
    } catch (err) {
      if (err instanceof ApiError) throw err
      throw new ApiError(400, 'The request body was not valid JSON.')
    }
  }

  try {
    const form = await req.formData()
    const body: Record<string, unknown> = {}
    for (const key of new Set(form.keys())) {
      const values = form.getAll(key)
      body[key] = values.length > 1 ? values : values[0]
    }
    return body
  } catch {
    throw new ApiError(400, 'The request body could not be read.')
  }
}


/** Trims a payload string; returns null when it carries no content. */
export function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return String(value)
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** Coerces a payload value to an integer inside [min, max], or throws a readable error. */
export function intOr(
  value: unknown,
  fallback: number | null,
  min: number,
  max: number,
  label: string
): number | null {
  if (value === null || value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new ApiError(400, `${label} must be a whole number.`)
  }
  if (parsed < min || parsed > max) {
    throw new ApiError(400, `${label} must be between ${min} and ${max}.`)
  }
  return parsed
}

/** Accepts booleans and the strings forms HTML checkboxes post. */
export function boolOr(value: unknown, fallback = false): boolean {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value === 'boolean') return value
  const text = String(value).trim().toLowerCase()
  if (text === 'true' || text === '1' || text === 'on' || text === 'yes') return true
  if (text === 'false' || text === '0' || text === 'off' || text === 'no') return false
  return fallback
}

/** Coerces a payload value to a float inside [min, max], or throws a readable error. */
export function floatOr(
  value: unknown,
  fallback: number | null,
  min: number,
  max: number,
  label: string
): number | null {
  if (value === null || value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new ApiError(400, `${label} must be a number.`)
  if (parsed < min || parsed > max) {
    throw new ApiError(400, `${label} must be between ${min} and ${max}.`)
  }
  return parsed
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}


