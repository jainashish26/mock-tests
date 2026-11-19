import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'
import type { EnquiryAction, EnquiryOutcome, SlaFacts } from './triage'

/**
 * The IO half of the admin support queue.
 *
 * WHY THE USER-SCOPED CLIENT AND NOT THE ADMIN ONE
 *   Every function here is SECURITY DEFINER and authorises the *caller* with
 *   `has_role('ADMIN')`, which reads `auth.uid()`. The service-role client sends
 *   no user JWT, so `auth.uid()` is NULL, `has_role` is false, and the queue
 *   answers with zero rows while the counts answer with zeroes - a screen that
 *   reports an empty inbox because the implementation quietly asked the wrong
 *   question. `connection.ts` documents the identical trap for the reporting
 *   layer; the same rule applies here, and it is why this module never imports
 *   createAdminClient.
 *
 *   Authorisation therefore happens twice: in the route's requireRole, and
 *   inside the database. Neither alone is enough, and the second is the one that
 *   still holds if a route is ever rewritten badly.
 */

export interface EnquiryQueueRow extends SlaFacts {
  enquiry_id: string
  channel: string
  enquiry_type: string
  status: string
  outcome: string | null
  received_at: string
  first_response_at: string | null
  resolved_at: string | null
  assigned_to: string | null
  parent_user_id: string | null
  converted: boolean
  utm_source: string | null
}

export interface EnquiryCounts {
  open_total: number
  breached: number
  at_risk: number
  unrecorded_open: number
  oldest_age_minutes: number
  sla_minutes: number
  sla_is_confirmed: boolean
}

export type Coded<T> =
  | { ok: true; value: T }
  | { ok: false; code: string | undefined; message: string }

const CODE_FORBIDDEN = '42501'
const CODE_INVALID = '22023'
const CODE_NOT_FOUND = 'P0002'

/**
 * PostgREST hands bigint columns back as numbers *or* strings depending on
 * width, and an unguarded Number(null) is 0 while Number(undefined) is NaN -
 * which then serialises as null and renders as "Open: null". Every count in
 * this module goes through here so the shape is decided once.
 */
function numeric(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

async function rpc<T>(
  fn: string,
  args: Record<string, unknown>
): Promise<{ rows: T[]; error?: { code?: string; message?: string } }> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc(fn, args)
    if (error) return { rows: [], error: { code: error.code, message: error.message } }
    if (data === null || data === undefined) return { rows: [] }
    return { rows: (Array.isArray(data) ? data : [data]) as T[] }
  } catch (err) {
    logger.error('ENQUIRY_RPC', `[support] ${fn} threw`, err)
    return { rows: [], error: { message: 'unreachable' } }
  }
}

export interface QueueFilters {
  status?: string | null
  type?: string | null
  unansweredOnly?: boolean
  limit?: number
  offset?: number
}

export async function loadEnquiryQueue(
  filters: QueueFilters = {}
): Promise<Coded<{ rows: EnquiryQueueRow[]; counts: EnquiryCounts }>> {
  const limit = Math.min(Math.max(numeric(filters.limit, 50), 1), 200)
  const offset = Math.max(numeric(filters.offset, 0), 0)

  const [queue, counts] = await Promise.all([
    rpc<EnquiryQueueRow>('admin_enquiry_queue', {
      p_status: filters.status ?? null,
      p_type: filters.type ?? null,
      p_unanswered: filters.unansweredOnly === true,
      p_limit: limit,
      p_offset: offset,
    }),
    rpc<EnquiryCounts>('admin_enquiry_counts', {}),
  ])

  if (queue.error) {
    return { ok: false, code: queue.error.code, message: queue.error.message ?? 'queue failed' }
  }

  const c = counts.rows[0]
  return {
    ok: true,
    value: {
      rows: queue.rows,
      counts: {
        open_total: numeric(c?.open_total),
        breached: numeric(c?.breached),
        at_risk: numeric(c?.at_risk),
        unrecorded_open: numeric(c?.unrecorded_open),
        oldest_age_minutes: numeric(c?.oldest_age_minutes),
        // Falls back to the migration default rather than 0: a header that
        // reads "SLA 0 minutes" would report every open enquiry as breached.
        sla_minutes: numeric(c?.sla_minutes, 1440),
        sla_is_confirmed: c?.sla_is_confirmed === true,
      },
    },
  }
}

export interface TransitionResult {
  enquiry_id: string
  status: string
  outcome: string | null
  first_response_at: string | null
  first_response_minutes: number | null
  resolved_at: string | null
  resolution_hours: number | null
  response_recorded: boolean
  response_was_missing: boolean
}

/**
 * Apply one triage action.
 *
 * `response_recorded` and `first_response_minutes` come straight back from the
 * transaction that decided them, which is what lets the caller emit
 * ENQUIRY_FIRST_RESPONDED with the right number. Re-reading the row afterwards
 * would be a second, later truth - and in the gap between the two, another
 * admin may have moved it.
 */
export async function applyEnquiryAction(
  enquiryId: string,
  action: EnquiryAction,
  outcome: EnquiryOutcome | null,
  assignee: string | null
): Promise<Coded<TransitionResult>> {
  const { rows, error } = await rpc<TransitionResult>('admin_enquiry_transition', {
    p_enquiry_id: enquiryId,
    p_action: action,
    p_outcome: outcome,
    p_assignee: assignee,
  })

  if (error) {
    const code = error.code
    if (code === CODE_FORBIDDEN) return { ok: false, code, message: 'Not permitted.' }
    if (code === CODE_NOT_FOUND) return { ok: false, code, message: 'No such enquiry.' }
    // 22023 is the state machine refusing a sequence: a second first response,
    // an outcome-free resolution, a reply after closure. Those messages are
    // written for an operator and explain what to do instead, so they are
    // returned rather than flattened into a generic failure.
    if (code === CODE_INVALID) {
      return { ok: false, code, message: error.message ?? 'That action is not available here.' }
    }
    logger.error('ENQUIRY_TRANSITION', '[support] transition failed', error.message)
    return { ok: false, code, message: 'The change could not be saved.' }
  }

  const row = rows[0]
  if (!row) {
    logger.error('ENQUIRY_TRANSITION_SHAPE', '[support] transition returned no row')
    return { ok: false, code: undefined, message: 'The change could not be saved.' }
  }
  return { ok: true, value: row }
}

export interface ContactPayload {
  full_name: string | null
  email: string | null
  phone: string | null
  message_body: string | null
}

/**
 * Read a restricted contact record, through the function that audits it.
 *
 * The reason is not optional here and is not optional in the database:
 * `read_enquiry_contact` writes to `enquiry_contact_access_log` before it
 * returns, and the column CHECK demands twelve characters. That is the whole
 * design of the restricted table - an admin may read a parent's complaint, but
 * there is a durable record of who looked and why. Handing the detail back to a
 * caller that supplied no reason would be the bypass the table exists to
 * prevent, so the reason is validated before the call rather than relying on
 * Postgres to catch it and hoping the message is legible.
 */
export async function revealEnquiryContact(
  enquiryId: string,
  taskReason: string
): Promise<Coded<ContactPayload>> {
  const { rows, error } = await rpc<ContactPayload>('read_enquiry_contact', {
    p_enquiry_id: enquiryId,
    p_task_reason: taskReason,
  })

  if (error) {
    // Logged with the code only. The failure message can quote the value it
    // tripped on, and this is the one path whose inputs are PII.
    logger.error('ENQUIRY_CONTACT_READ', '[support] contact read failed', error.code ?? 'unknown')
    return {
      ok: false,
      code: error.code,
      message:
        error.code === CODE_FORBIDDEN
          ? 'Not permitted to read contact details.'
          : 'The contact details could not be read.',
    }
  }

  const row = rows[0]
  if (!row) return { ok: false, code: CODE_NOT_FOUND, message: 'No contact record for that enquiry.' }
  return { ok: true, value: row }
}

