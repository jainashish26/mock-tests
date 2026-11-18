import Link from 'next/link'
import { Upload } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/features/creator/components/PageHeader'
import { QuestionManager } from '@/features/creator/components/QuestionManager'
import { parseStatusParam } from '@/lib/creator/content-meta'
import { requireRole } from '@/lib/rbac/require-role'

export const metadata = {
  title: 'Question Bank | Quiz Master',
  description: 'Search, create, duplicate and delete questions.',
}

export const dynamic = 'force-dynamic'

/**
 * `/creator/questions` - the question bank CRUD workspace.
 *
 * New route: the bank used to be reachable only as a tab on the dashboard (and
 * the sidebar linked at `/creator`), so questions had no addressable list page.
 */
export default async function QuestionBankPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireRole(['TEST_CREATOR', 'ADMIN'])

  // `?status=PENDING_APPROVAL` comes from the dashboard's "awaiting review" card.
  const { status } = await searchParams
  const initialStatus = parseStatusParam(status)

  return (
    <>
      <PageHeader
        title="Question Bank"
        description="Every question you have written. Filter by status, type, exam type or year level, then edit, duplicate or delete."
        backHref="/creator"
        backLabel="Dashboard"
        actions={
          <Button asChild variant="outline" size="sm" className="min-h-10 gap-1.5">
            <Link href="/creator/upload">
              <Upload size={16} />
              Import CSV
            </Link>
          </Button>
        }
      />
      <QuestionManager initialStatus={initialStatus} />
    </>
  )
}
