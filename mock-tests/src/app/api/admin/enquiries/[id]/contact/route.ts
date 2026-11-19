import { NextResponse } from 'next/server'
import { logger } from '@/lib/logging/logger'
import { requireRoleJson } from '@/lib/rbac/require-role-json'
import { revealEnquiryContact } from '@/lib/support/triage-service'
import { TASK_REASON_MIN, taskReasonError } from '@/lib/support/triage'

/**
 * POST /api/admin/enquiries/[id]/contact - the audited reveal.
 *
 * WHY AN ENDPOINT AND NOT A FIELD ON THE QUEUE
 *   `enquiry_contacts` has no RLS policy for anyone and no grant to
 *   `authenticated`: the only way its contents can reach a session is through
 *   `read_enquiry_contact(id, task_reason)`, which inserts into
 *   `enquiry_contact_access_log` before it returns. Folding the body into the
 *   queue response would make that audit decorative, because nobody would ever
 *   need to call the audited function - which is precisely how a careful
 *   two-table design quietly becomes a single-table one. The separate endpoint
 *   is the design working, not an extra round trip.
 *
 *   The twelve-character reason is validated here as well as in the column
 *   CHECK so an operator is told what is required before the request instead of
 *   after a 22023, and so the shape of the requirement is one constant
 *   (`TASK_REASON_MIN`) shared with the form.
 *
 * WHAT IS LOGGED
 *   Who revealed what and that they did. Never the content: this response body
 *   contains a parent's phone number and the text of a complaint, and Vercel
 *   stdout is a searchable drain. A log line quoting it would be a second,
 *   ungoverned copy of the exact data the restricted table exists to keep in one
 *   audited place.
 */
const NO_STORE = { 'Cache-Control': 'no-store' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRoleJson(['ADMIN'])
  if (!auth.ok) return auth.response

  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Unknown enquiry.' }, { status: 404 })

  let reason: unknown
  try {
    const body = (await req.json()) as Record<string, unknown>
    reason = body.taskReason
  } catch {
    return NextResponse.json(
      { error: 'A reason is required to read contact details.', minLength: TASK_REASON_MIN },
      { status: 400 }
    )
  }

  const invalid = taskReasonError(reason)
  if (invalid) {
    return NextResponse.json({ error: invalid, minLength: TASK_REASON_MIN }, { status: 400 })
  }

  const result = await revealEnquiryContact(id, (reason as string).trim())

  if (!result.ok) {
    // 403 stays 403 rather than becoming 404: the enquiry exists, and an admin
    // who cannot see contact details at all is being told the truth about their
    // role rather than sent chasing a record that is there.
    const status = result.code === '42501' ? 403 : result.code === 'P0002' ? 404 : 502
    return NextResponse.json({ error: result.message }, { status, headers: NO_STORE })
  }

  logger.info('[support] contact details revealed', {
    enquiryId: id,
    actor: auth.userId,
    // Length, never content - the reason is audited by the database and does
    // not need copying into a log to be accountable.
    reasonChars: (reason as string).trim().length,
  })

  // no-store, twice over: this payload is a child's parent's phone number, and
  // a cached copy is a copy nobody authorised.
  return NextResponse.json({ ok: true, contact: result.value }, { status: 200, headers: NO_STORE })
}
