import { requireRole } from '@/lib/rbac/require-role'
import { WritingPromptsManager } from './client'

export const metadata = {
  title: 'Writing Prompts — Quiz Master',
  description: 'Add, edit and manage the AI Practice Lab writing prompt bank.',
}

/**
 * Writing-prompt management for the Quiz Master (TEST_CREATOR) and ADMIN.
 * Role enforcement lives here (the layout does not re-run on client navigation).
 */
export default async function WritingPromptsPage() {
  await requireRole(['TEST_CREATOR', 'ADMIN'])
  return <WritingPromptsManager />
}