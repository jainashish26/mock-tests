import * as React from 'react'

import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { ToastProvider } from '@/components/ui/Toast'
import { createClient } from '@/lib/supabase/server'

export const metadata = {
  title: 'Admin — MockTests Pro',
  description: 'Moderate content, manage users and monitor the platform.',
}

/**
 * Shared chrome for the `/admin` area — mirrors `creator/layout.tsx`.
 *
 * Role enforcement stays in each page (`requireRole`), because a layout does not
 * re-run on client-side navigation between sibling routes. The layout only
 * supplies the sidebar, the signed-in name, and the toast provider every
 * moderation action needs.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ||
    (user?.user_metadata?.name as string | undefined) ||
    user?.email?.split('@')[0] ||
    'Administrator'

  return (
    <ToastProvider>
      <DashboardLayout role="ADMIN" userName={displayName}>
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">{children}</div>
      </DashboardLayout>
    </ToastProvider>
  )
}
