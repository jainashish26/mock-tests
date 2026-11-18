import Link from 'next/link'
import { Upload } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/features/creator/components/PageHeader'
import { TestManager } from '@/features/creator/components/TestManager'
import { parseStatusParam } from '@/lib/creator/content-meta'
import { requireRole } from '@/lib/rbac/require-role'

export const metadata = {
  title: 'My Tests | Quiz Master',
  description: 'Create, search, duplicate and delete your test papers.',
}

// Reads the signed-in user's role, so it must never be statically cached.
export const dynamic = 'force-dynamic'

/**
 * `/creator/tests` - the test CRUD workspace.
 *
 * The page only guards the role and renders the heading; all data access happens
 * client-side through `/api/creator/tests` so search, filters, sorting,
 * pagination and row actions stay in sync without full page reloads.
 */
export default async function MyTestsPage({
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
        title="My Tests"
        description="Build test papers, duplicate published ones to make changes, and delete drafts you no longer need."
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
      <TestManager initialStatus={initialStatus} />
    </>
  )
}
