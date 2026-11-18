import { TestEditor } from '@/features/creator/components/TestEditor'
import { requireRole } from '@/lib/rbac/require-role'

export const metadata = {
  title: 'Edit test | Quiz Master',
  description: 'Edit a test paper, its sections and its questions.',
}

export const dynamic = 'force-dynamic'

/**
 * `/creator/tests/:id` - the test editor.
 *
 * The page only guards the role; the editor loads through
 * `GET /api/creator/tests/:id`, which enforces ownership and returns `editable`
 * so published/archived tests render read-only. `:id === "new"` is handled by the
 * editor as a create form.
 */
export default async function TestEditorPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(['TEST_CREATOR', 'ADMIN'])
  const { id } = await params

  return <TestEditor testId={id} />
}
