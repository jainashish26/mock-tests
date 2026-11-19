import { NextResponse } from 'next/server'
import { requireRoleJson } from '@/lib/rbac/require-role-json'
import { loadEnquiryQueue } from '@/lib/support/triage-service'
import { ENQUIRY_TYPES } from '@/lib/support/enquiry-fields'
import { ENQUIRY_STATUSES, type EnquiryStatus } from '@/lib/support/triage'

/**
 * GET /api/admin/enquiries - the support queue.
 *
 * Filters are validated against the same closed lists the database CHECKs, so
 * a typo in the UI produces a 400 naming the parameter rather than a queue
 * that quietly renders empty. An empty queue and a filtered-to-nothing queue
 * look identical on screen, and only one of them is a fact about the workload.
 *
 * The response carries no contact detail. It cannot: admin_enquiry_queue() has
 * no such column in its RETURNS clause, and the body of a parent's privacy
 * request reaches an operator only through the audited reveal endpoint.
 */
const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(req: Request) {
  const auth = await requireRoleJson(['ADMIN'])
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const status = url.searchParams.get('status')
  const type = url.searchParams.get('type')

  if (status !== null && !(ENQUIRY_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json(
      { error: `Unknown status '${status}'.`, allowed: ENQUIRY_STATUSES },
      { status: 400 }
    )
  }
  if (type !== null && !(ENQUIRY_TYPES as readonly string[]).includes(type)) {
    return NextResponse.json(
      { error: `Unknown enquiry type '${type}'.`, allowed: ENQUIRY_TYPES },
      { status: 400 }
    )
  }

  const limitRaw = Number(url.searchParams.get('limit') ?? 50)
  const offsetRaw = Number(url.searchParams.get('offset') ?? 0)
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 50
  const offset = Number.isFinite(offsetRaw) ? Math.max(Math.trunc(offsetRaw), 0) : 0

  const result = await loadEnquiryQueue({
    status,
    type,
    unansweredOnly: url.searchParams.get('unanswered') === '1',
    limit,
    offset,
  })

  if (!result.ok) {
    const statusOut = result.code === '42501' ? 403 : result.code === '22023' ? 400 : 503
    return NextResponse.json({ error: result.message }, { status: statusOut, headers: NO_STORE })
  }

  return NextResponse.json(
    {
      ok: true,
      rows: result.value.rows,
      counts: result.value.counts,
      limit,
      offset,
      // Tells the client whether another page exists without asking it to know
      // the limit rule: the SQL caps at 200, and a footer link that promised a
      // twenty-first page would be a dead end.
      hasMore: result.value.rows.length === limit && limit === 200,
      statuses: ENQUIRY_STATUSES as readonly EnquiryStatus[],
    },
    { status: 200, headers: NO_STORE }
  )
}
