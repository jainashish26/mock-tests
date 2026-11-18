import type { Metadata } from 'next'

import { PageHeader } from '@/features/creator/components/PageHeader'
import { requireRole } from '@/lib/rbac/require-role'
import { createAdminClient } from '@/lib/supabase/admin'

import { SettingsForm } from './SettingsForm'

export const metadata: Metadata = { title: 'Settings' }
export const dynamic = 'force-dynamic'

/**
 * Admin → Settings: platform-wide controls backed by the singleton
 * `admin_settings` row (PK is the constant true). ADMIN only — the same guard
 * is re-enforced inside the save action.
 */
export default async function AdminSettingsPage() {
  await requireRole(['ADMIN'])

  const adminClient = createAdminClient()
  const { data } = await adminClient
    .from('admin_settings')
    .select('*')
    .eq('id', true)
    .maybeSingle()

  const row = data as {
    maintenance_mode?: boolean | null
    maintenance_mode_message?: string | null
    registration_open?: boolean | null
  } | null

  return (
    <>
      <PageHeader
        title="Settings"
        description="Platform-wide controls — maintenance mode and registration."
      />

      <section
        aria-labelledby="platform-settings"
        className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-6"
      >
        <h2 id="platform-settings" className="text-base font-semibold text-foreground">
          Platform
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          These flags apply to every visitor across the whole platform.
        </p>
        <div className="mt-5">
          <SettingsForm
            initial={{
              maintenanceMode: row?.maintenance_mode ?? false,
              maintenanceMessage: row?.maintenance_mode_message ?? '',
              registrationOpen: row?.registration_open ?? true,
            }}
          />
        </div>
      </section>
    </>
  )
}
