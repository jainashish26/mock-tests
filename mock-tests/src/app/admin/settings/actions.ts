'use server'

import { revalidatePath } from 'next/cache'

import { requireRole } from '@/lib/rbac/require-role'
import { createAdminClient } from '@/lib/supabase/admin'

export interface AdminSettingsInput {
  maintenanceMode: boolean
  maintenanceMessage: string
  registrationOpen: boolean
}

export interface AdminSettingsResult {
  ok: boolean
  error?: string
}

/**
 * Persists the singleton `admin_settings` row (primary key is the constant
 * `true`). Uses the service-role client because the table has no INSERT RLS
 * policy — only SELECT (public) and UPDATE (ADMIN) — so an upsert through the
 * session client would fail when the row doesn't exist yet. The ADMIN check is
 * re-enforced server-side via requireRole.
 */
export async function updateAdminSettings(
  input: AdminSettingsInput
): Promise<AdminSettingsResult> {
  await requireRole(['ADMIN'])

  const adminClient = createAdminClient()
  const { error } = await adminClient.from('admin_settings').upsert(
    {
      id: true,
      maintenance_mode: input.maintenanceMode,
      maintenance_mode_message: input.maintenanceMessage.trim(),
      registration_open: input.registrationOpen,
    },
    { onConflict: 'id' }
  )

  if (error) {
    console.error('[admin-settings] upsert failed:', error.message)
    return { ok: false, error: error.message }
  }

  revalidatePath('/admin/settings')
  return { ok: true }
}
