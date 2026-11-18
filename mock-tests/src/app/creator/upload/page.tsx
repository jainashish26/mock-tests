import { PageHeader } from '@/features/creator/components/PageHeader'
import { UploadQuestionsForm } from '@/features/creator/components/UploadQuestionsForm'
import { requireRole } from '@/lib/rbac/require-role'

export const metadata = {
  title: 'Import questions | Quiz Master',
  description: 'Bulk-import questions from a CSV file.',
}

export const dynamic = 'force-dynamic'

/**
 * `/creator/upload` - bulk CSV import.
 *
 * This page used to be a client component with no role check at all (the API
 * route enforces it, but the screen still rendered for anyone signed in). The
 * guard now runs here too, and the form talks to the API through `creatorApi`.
 */
export default async function UploadQuestionsPage() {
  await requireRole(['TEST_CREATOR', 'ADMIN'])

  return (
    <>
      <PageHeader
        title="Import questions"
        description="Bulk-load a CSV of questions into your bank. Every row becomes a draft that you own."
        backHref="/creator"
        backLabel="Dashboard"
      />
      <UploadQuestionsForm />
    </>
  )
}
