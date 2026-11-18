import { QuestionEditor } from '@/features/creator/components/QuestionEditor'
import { requireRole } from '@/lib/rbac/require-role'

export const metadata = {
  title: 'Edit question | Quiz Master',
  description: 'Edit a question, its answers, classification and skill weightings.',
}

export const dynamic = 'force-dynamic'

/**
 * `/creator/questions/:id` - the full question editor.
 *
 * The page only guards the role; the editor loads the row through
 * `GET /api/creator/questions/:id`, which enforces ownership and returns
 * `editable` so published/archived questions render read-only. `:id === "new"`
 * is handled by the editor as a create form.
 */
export default async function QuestionEditorPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(['TEST_CREATOR', 'ADMIN'])
  const { id } = await params

  return <QuestionEditor questionId={id} />
}
