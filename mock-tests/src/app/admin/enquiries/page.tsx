import type { Metadata } from 'next'
import { requireRole } from '@/lib/rbac/require-role'
import { PageHeader } from '@/features/creator/components/PageHeader'
import { EnquiryQueue } from './client'

export const metadata: Metadata = {
  title: 'Support Queue — Admin',
  description: 'Inbound enquiries, their response clock, and the audited contact reveal.',
}
export const dynamic = 'force-dynamic'

/**
 * Admin → Support queue.
 *
 * Rendered through the page-level requireRole rather than only the route
 * guards, because a dashboard page that fetches its own data should not be a
 * shell that 403s after painting. The layout does not re-run role checks on
 * client navigation, so the check is here, exactly as the writing-prompts and
 * review pages do it.
 *
 * The page itself performs no database read: every row and every count comes
 * from /api/admin/enquiries, so the same SECURITY DEFINER functions, the same
 * has_role('ADMIN') check inside them, and the same absence of contact columns
 * apply whether the data arrives by server render or by fetch. Two paths to one
 * authority is the point - there is no route that reaches an enquirer's message
 * body without the access audit firing.
 */
export default async function AdminEnquiriesPage() {
  await requireRole(['ADMIN'])

  return (
    <>
      <PageHeader
        title="Support queue"
        description="Every enquiry the web form has received, oldest unanswered first, with the response clock beside it."
      />
      <div className="mt-4">
        <EnquiryQueue />
      </div>
    </>
  )
}
