import * as React from 'react'

import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { ToastProvider } from '@/components/ui/Toast'
import { createClient } from '@/lib/supabase/server'

export const metadata = {
  title: 'Quiz Master',
  description: 'Create, review and manage tests and questions.',
}

/**
 * Shared chrome for the `/creator` (Quiz Master) area.
 *
 * Role enforcement stays in each page (`requireRole`), because a layout does not
 * re-run on client-side navigation between sibling routes. The layout only
 * supplies the sidebar, the signed-in name, and the toast provider every CRUD
 * screen needs.
 */
export default async function CreatorLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ||
    (user?.user_metadata?.name as string | undefined) ||
    user?.email?.split('@')[0] ||
    'Content Creator'

  return (
    <ToastProvider>
      <DashboardLayout role="CREATOR" userName={displayName}>
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">{children}</div>
      </DashboardLayout>
    </ToastProvider>
  )
}
