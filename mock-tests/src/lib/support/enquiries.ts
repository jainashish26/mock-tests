import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logging/logger'
import { normalizeUtm } from '@/lib/funnel/events'
import type { NormalisedEnquiry } from './enquiry-fields'
import { contactJsonb, utmJsonb } from './enquiry-fields'

/**
 * The IO half of the support ingest path.
 *
 * WHY THE SERVICE-ROLE CLIENT IS THE ONLY OPTION
 *   `public.ingest_enquiry()` is revoked from `anon` and `authenticated` and
 *   granted to `service_role` alone — deliberately, because its `p_contact`
 *   argument writes into `enquiry_contacts`, the one table in this schema with
 *   no RLS policy for anyone. 012's own comment calls that lock-down "the single
 *   most important line in the migration". So the only caller can be trusted
 *   server code, and the trustworthiness has to come from somewhere: it comes
 *   from this route being the sole place these two functions are called, from
 *   every field being normalised in `./enquiry-fields` first, and from the
 *   throttle in front of it.
 *
 *   The same reasoning the `/api/funnel/signup` route documents: doing this from
 *   the browser would mean exposing the service key, which is not a trade worth
 *   making to save one request.
 *
 * NOTHING HERE LOGS MESSAGE CONTENT
 *   `logger` writes to stdout, which on Vercel is a searchable log drain. A
 *   parent's refund complaint or privacy request pasted into an info line would
 *   be a second, ungoverned copy of the exact data `enquiry_contacts` exists to
 *   keep in one audited place. So the payloads that reach these functions are
 *   logged by *shape* only - id, type, length - never by value.
 */

/** Whether the ingest path can run at all. Checked once, in the route. */
export function isIngestConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export type ThrottleDecision =
  | { state: 'allowed' }
  | { state: 'throttled'; retryAfterSeconds: number }
  /**
   * The throttle could not be consulted. The route lets the submission through
   * and logs it, because refusing the support channel when a guard rail is
   * missing would turn an outage into an outage plus a parent who cannot reach
   * support. Same fail-open logic `hasFiredEvent()` uses, and the honeypot and
   * token checks still applied before this point.
   */
  | { state: 'unavailable' }

/**
 * Consult (and record) the per-visitor throttle.
 *
 * A null fingerprint means the address could not be resolved: no evidence, so no
 * limit. Bucketing every unresolvable visitor together would let one misconfigured
 * proxy spend the allowance for strangers.
 */
export async function checkEnquiryThrottle(fp: string | null): Promise<ThrottleDecision> {
  if (!fp) return { state: 'allowed' }

  try {
    const admin = createAdminClient()
    const { data, error } = await admin.rpc('enquiry_throttle_check', { p_fp: fp })

    if (error) {
      logger.error('ENQUIRY_THROTTLE_QUERY', '[support] throttle lookup failed', error.message)
      return { state: 'unavailable' }
    }

    // RETURNS TABLE, so PostgREST gives an array of exactly one row.
    const row = Array.isArray(data) ? data[0] : data
    if (!row || typeof row.allowed !== 'boolean') {
      logger.error('ENQUIRY_THROTTLE_SHAPE', '[support] throttle returned an unusable shape')
      return { state: 'unavailable' }
    }

    if (row.allowed) return { state: 'allowed' }
    return {
      state: 'throttled',
      retryAfterSeconds: Number.isFinite(row.retry_after_seconds)
        ? Math.max(1, Math.trunc(row.retry_after_seconds))
        : 3600,
    }
  } catch (err) {
    logger.error('ENQUIRY_THROTTLE_THROW', '[support] throttle threw', err)
    return { state: 'unavailable' }
  }
}

export type IngestResult =
  | { ok: true; enquiryId: string }
  | { ok: false; reason: 'db_error' }

/**
 * Has this submission reference already been recorded?
 *
 * Called BEFORE the throttle, and it is the only thing that makes a retry
 * survivable: `ingest_enquiry()` would happily return the existing id, but by
 * then the 60-second minimum interval has already refused the request, so a
 * parent who double-clicked submit would be told they had sent too many
 * messages about the one message that arrived a second earlier. Telling someone
 * their support request failed when it succeeded is the worst possible answer
 * from a support form, and it is the answer the throttle would give on its own.
 *
 * Returns null on any failure, which makes the route treat the submission as
 * new. That is the safe direction: the cost of a false "not seen" is a duplicate
 * attempt that `ingest_enquiry()` still de-duplicates on write, whereas the cost
 * of a false "already seen" would be silently dropping a genuine message.
 */
export async function findEnquiryIdBySourceRef(sourceRef: string): Promise<string | null> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin.rpc('enquiry_id_for_source_ref', {
      p_source_ref: sourceRef,
    })

    if (error) {
      // Logged and treated as "not recorded": this lookup is a UX refinement,
      // not a correctness gate, and failing it must never lose an enquiry.
      logger.warn('[support] source-ref lookup failed, treating the submission as new', {
        message: error.message,
      })
      return null
    }
    return typeof data === 'string' ? data : null
  } catch (err) {
    logger.warn('[support] source-ref lookup threw, treating the submission as new', { err })
    return null
  }
}


/**
 * Write one enquiry through the single sanctioned path.
 *
 * `sourceRef` is the idempotency key. It is the form token's nonce rather than a
 * fresh uuid per call, so a retried POST returns the id of the enquiry it already
 * created instead of creating a second one. That is what makes double-clicking a
 * submit button safe, and it is the reason `ingest_source_ref` exists at all.
 */
export async function ingestWebEnquiry(args: {
  enquiryType: NormalisedEnquiry['enquiryType']
  contact: NormalisedEnquiry['contact']
  parentUserId: string | null
  sourceRef: string
  rawUtm: unknown
}): Promise<IngestResult> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin.rpc('ingest_enquiry', {
      p_channel: 'web_form',
      p_received_at: null,
      p_enquiry_type: args.enquiryType,
      p_source_ref: args.sourceRef,
      p_parent_user_id: args.parentUserId,
      p_utm: utmJsonb(normalizeUtm(args.rawUtm)),
      p_contact: contactJsonb(args.contact),
    })

    if (error) {
      // Code and message only. Neither contains the body, and the message is
      // Postgres's own text rather than caller input.
      logger.error('ENQUIRY_INGEST', '[support] ingest_enquiry failed', error.message)
      return { ok: false, reason: 'db_error' }
    }

    const enquiryId = typeof data === 'string' ? data : null
    if (!enquiryId) {
      logger.error('ENQUIRY_INGEST_SHAPE', '[support] ingest_enquiry returned no id')
      return { ok: false, reason: 'db_error' }
    }

    logger.info('Enquiry ingested', {
      enquiryId,
      channel: 'web_form',
      enquiryType: args.enquiryType,
      linked: Boolean(args.parentUserId),
      // Length, never content: enough to spot a truncated submission in the
      // logs, not enough to copy the table's purpose into stdout.
      messageChars: args.contact.messageBody.length,
    })

    return { ok: true, enquiryId }
  } catch (err) {
    logger.error('ENQUIRY_INGEST_THROW', '[support] ingest threw', err)
    return { ok: false, reason: 'db_error' }
  }
}
