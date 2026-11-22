import Link from 'next/link'
import { ArrowLeft, BarChart3 } from 'lucide-react'

import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { TutorReportingPanels } from '@/features/report/components/TutorReportingPanels'
import { requireRole } from '@/lib/rbac/require-role'

export const metadata = {
  title: 'Reports | Tutor',
  description: 'Every consented student, the work you set, and what to set next.',
}

export const dynamic = 'force-dynamic'

/**
 * `/tutor/reports` - T1 to T7 plus T4, on one page.
 *
 * WHY THIS ROUTE EXISTS
 *   The sidebar advertised "Reports" and pointed it at `/tutor`, so the control
 *   appeared to do nothing. It also meant a tutor's real report surface lived
 *   *below* a form on the dashboard, which put the least important thing first.
 *
 *   Splitting it gives each surface one job: the dashboard answers "who needs me
 *   today", this page answers "show me the evidence". The panels themselves are
 *   unchanged and still load in parallel - this is a routing fix, not a rewrite.
 */
export default async function TutorReportsPage() {
  await requireRole(['TUTOR'])

  return (
    <DashboardLayout role="TUTOR" userName="Tutor Account">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
            <BarChart3 size={22} className="text-primary" aria-hidden />
            Reports
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Everything below is limited to students whose parent currently consents to you seeing
            it. Each panel names its report ID and its period, so a figure on a call can be traced
            back to a definition.
          </p>
        </div>
        <Link
          href="/tutor"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
        >
          <ArrowLeft size={16} aria-hidden />
          All students
        </Link>
      </div>

      <TutorReportingPanels />
    </DashboardLayout>
  )
}
