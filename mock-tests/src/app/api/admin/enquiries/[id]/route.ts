import { NextResponse } from 'next/server'
import { logger } from '@/lib/logging/logger'
import { trackEvent } from '@/lib/funnel/track'
import { requireRoleJson } from '@/lib/rbac/require-role-json'
import { applyEnquiryAction } from '@/lib/support/triage-service'
import {
  ACTION_TARGET,
  CONVERT_KINDS,
  ENQUIRY_ACTIONS,
  ENQUIRY_OUTCOMES,
  actionNeedsConversion,
  actionNeedsOutcome,
  conversionError,
  type ConvertKind,
  type EnquiryAction,
  type EnquiryOutcome,
} from '@/lib/support/triage'

/**
 * POST /api/admin/enquiries/[id] - one triage action on one enquiry.
 *
 * WHY THE ACTION IS THE REQUEST AND THE STATUS NEVER IS
 *   Accepting `status` would let any client put the row anywhere, including a
 *   state the clock columns cannot legitimately be in - because writing
 *   `first_response_at` is a side effect of a *transition*, not a field. The
 *   state machine in `admin_enquiry_transition` owns that mapping and refuses
 *   the sequences that would fabricate a response time nobody observed. So this
 *   route asks "what did the admin do", never "what should the row say".
 *
 * EVENT EMISSION
 *   ENQUIRY_FIRST_RESPONDED fires only when the function reports that THIS call
 *   recorded the first response (`response_recorded`). Inferring it from
 *   `action === 'reply'` would fire again on a duplicate click the database
 *   refused, and the funnel would count a reply that never happened. §62 of
 *   12-...md specifies the props as enquiryId and responseMinutes; the minutes
 *   come back from the same transaction that stamped the clock, so the event
 *   and the column cannot disagree, and neither can be back-filled by the
 *   caller.
 *
 *   Events are never allowed to fail the action. An enquiry whose status
 *   changed while the response said 500 would be re-clicked, refused by the
 *   state machine, and read by the operator as a broken tool.
 *
 * A 409 FOR A SEQUENCE REFUSAL, NOT A 400
 *   22023 here always means "the row is not in a state that allows this", not
 *   "your request was malformed" - the malformed cases are caught above without
 *   reaching the database. The distinction matters to the client, which
 *   refreshes the row on a 409 instead of showing a validation error against
 *   values that were perfectly valid.
 */
const NO_STORE = { 'Cache-Control': 'no-store' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function badRequest(message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, ...extra }, { status: 400 })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRoleJson(['ADMIN'])
  if (!auth.ok) return auth.response

  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Unknown enquiry.' }, { status: 404 })

  let body: Record<string, unknown>
  try {
    const parsed = await req.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return badRequest('Expected a JSON object.')
    }
    body = parsed as Record<string, unknown>
  } catch {
    return badRequest('The request body was not valid JSON.')
  }

  const action = body.action
  if (!ENQUIRY_ACTIONS.includes(action as EnquiryAction)) {
    return badRequest('Unknown enquiry action.', { allowed: ENQUIRY_ACTIONS })
  }

  const outcomeRaw = typeof body.outcome === 'string' ? body.outcome : null
  if (actionNeedsOutcome(action as EnquiryAction)) {
    if (!(ENQUIRY_OUTCOMES as readonly string[]).includes(outcomeRaw ?? '')) {
      return badRequest('Resolving or closing needs an outcome.', { allowed: ENQUIRY_OUTCOMES })
    }
  } else if (outcomeRaw !== null) {
    // Refused rather than ignored: an operator who meant to record a refund and
    // had the value silently dropped would believe the enquiry was closed out
    // as refunded when the row still says nothing.
    return badRequest(`The ${action} action does not take an outcome.`)
  }

  const assigneeRaw = typeof body.assignee === 'string' ? body.assignee.trim() : null
  const assignee = assigneeRaw && UUID.test(assigneeRaw) ? assigneeRaw : null
  if (action === 'assign' && assignee === null) {
    return badRequest('The assign action needs an assignee.')
  }

  // Conversion follows the same discipline as outcome, including the refusal to
  // quietly drop a value: a reference typed against the wrong action and
  // silently ignored would leave an operator certain the conversion was recorded
  // when the row holds nothing.
  const convertRefRaw =
    typeof body.convertRef === 'string' ? body.convertRef.trim() : null
  const convertKindRaw =
    typeof body.convertKind === 'string' ? body.convertKind : null
  const needsConversion = actionNeedsConversion(action as EnquiryAction)

  if (needsConversion) {
    const problem = conversionError(convertRefRaw, convertKindRaw)
    if (problem) {
      return badRequest(problem, { allowed: CONVERT_KINDS })
    }
  } else if (convertRefRaw !== null || convertKindRaw !== null) {
    return badRequest(`The ${action} action does not take a conversion reference.`)
  }

  const result = await applyEnquiryAction(
    id,
    action as EnquiryAction,
    outcomeRaw as EnquiryOutcome | null,
    assignee,
    needsConversion
      ? { ref: convertRefRaw as string, kind: convertKindRaw as ConvertKind }
      : null
  )

  if (!result.ok) {
    const status =
      result.code === '42501'
        ? 403
        : result.code === 'P0002'
          ? 404
          : result.code === '22023'
            ? 409
            : 502
    return NextResponse.json({ error: result.message }, { status, headers: NO_STORE })
  }

  const t = result.value
  logger.info('[support] enquiry transitioned', {
    enquiryId: t.enquiry_id,
    action,
    status: t.status,
    outcome: t.outcome,
    // Actor, not enquirer: the admin id is the audit-relevant party here, and
    // the parent's contact details are absent from this line by design.
    actor: auth.userId,
  })

  if (t.response_recorded) {
    await trackEvent({
      event: 'ENQUIRY_FIRST_RESPONDED',
      // The acting admin, not the enquirer. This event measures the support
      // desk's response; and an anonymous form submission has no user id to
      // attribute it to, so using the enquirer would drop the row entirely
      // (toEventRow rejects an event with no identity at all).
      userId: auth.userId,
      path: '/admin/enquiries',
      props: {
        enquiryId: t.enquiry_id,
        responseMinutes: t.first_response_minutes,
      },
    })
  }

  if (action === 'resolve' || action === 'close') {
    await trackEvent({
      event: 'ENQUIRY_RESOLVED',
      userId: auth.userId,
      path: '/admin/enquiries',
      props: {
        enquiryId: t.enquiry_id,
        outcome: t.outcome,
        // null when no first response was ever recorded. The absence is the
        // finding; inventing a duration to fill it is exactly what §62 warns
        // about, and A13 counts these separately rather than excluding them.
        resolutionHours: t.resolution_hours,
        responseRecorded: !t.response_was_missing,
      },
    })
  }

  return NextResponse.json(
    {
      ok: true,
      enquiry: {
        ...t,
        // The status the shared map says this action produces. The client
        // re-derives its available actions from the row it already has, so
        // returning the expected target means the buttons it renders next tick
        // agree with what the database now holds.
        expected_status: ACTION_TARGET[action as EnquiryAction] ?? t.status,
      },
    },
    { status: 200, headers: NO_STORE }
  )
}

/** GET reports nothing about the queue; the collection route owns reads. */
export async function GET() {
  return NextResponse.json(
    { error: 'Use GET /api/admin/enquiries.' },
    { status: 405, headers: { Allow: 'POST', ...NO_STORE } }
  )
}

