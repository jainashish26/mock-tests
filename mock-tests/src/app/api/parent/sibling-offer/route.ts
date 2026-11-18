import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/rbac/require-role'
import { getSiblingOfferForUser, siblingOfferPayload } from '@/lib/pricing/sibling-offer'

/**
 * GET /api/parent/sibling-offer - may this family see the Second Child Pack?
 *
 * Called by the add-child form the moment a second child is created (N-5).
 * Returns display strings derived server-side from the offers row; the
 * client never receives an amount it could influence, and eligibility is
 * re-checked at checkout anyway (canClaimSiblingOffer) - this endpoint is
 * a rendering hint, not an authority.
 *
 * Ineligible families get { eligible: false, offer: null } and render
 * nothing. The reason is for logs, not copy: a parent is never told "you
 * have not bought enough" - the pitch simply does not appear.
 */

/** Next.js control-flow errors must propagate rather than become 500s. */
function isControlFlowError(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest
  if (typeof digest !== 'string') return false
  return (
    digest.startsWith('NEXT_REDIRECT') ||
    digest.startsWith('NEXT_NOT_FOUND') ||
    digest.startsWith('NEXT_HTTP_ERROR_FALLBACK')
  )
}

export async function GET() {
  let user: { id: string }
  try {
    ;({ user } = await requireRole(['PARENT']))
  } catch (err) {
    if (isControlFlowError(err)) throw err
    return NextResponse.json({ error: 'Authentication failed.' }, { status: 401 })
  }

  const view = await getSiblingOfferForUser(user.id)

  return NextResponse.json(
    {
      eligible: view.eligible,
      childCount: view.childCount,
      offer: view.eligible && view.offer ? siblingOfferPayload(view.offer) : null,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}