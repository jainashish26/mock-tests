import { CreatorDashboard } from '@/features/creator/components/CreatorDashboard'
import { PageHeader } from '@/features/creator/components/PageHeader'
import { requireRole } from '@/lib/rbac/require-role'
import { ProductionQueuePanel } from '@/features/report/components/CoveragePanels'


export const metadata = {
  title: 'Quiz Master',
  description: 'Your tests, questions and what is waiting on approval.',
}

export const dynamic = 'force-dynamic'

/**
 * `/creator` - the Quiz Master dashboard.
 *
 * Counts and recent activity come from `/api/creator/stats` and the two list
 * endpoints (loaded in the client component) so the dashboard and the list pages
 * can never disagree about what exists.
 */
export default async function CreatorHomePage() {
  await requireRole(['TEST_CREATOR', 'ADMIN'])

  return (
    <>
      <PageHeader
        title="Quiz Master"
        description="Everything you have created, what is waiting on a moderator, and the quickest way back into it."
      />
      <CreatorDashboard />

      {/*
        TC1 - the authoring queue. Placed below the creator's own inventory
        rather than above it: "what have I got and what is blocked" is the
        question they arrive with, and "what should I write next" is the one
        they ask once that is settled.

        Reads reporting.mv_topic_coverage through a SECURITY DEFINER function,
        so a creator sees catalogue coverage without any grant on the reporting
        schema - the same capability-reduction pattern as the parent reports.
      */}
      <div className="mt-4">
        <ProductionQueuePanel limit={50} />
      </div>

    </>
  )
}
