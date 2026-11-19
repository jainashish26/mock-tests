'use server'

import { revalidatePath } from 'next/cache'

import { requireRole } from '@/lib/rbac/require-role'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  saveYearLevelCap,
  type SaveCapResult,
  type YearLevelCapDraft,
} from '@/lib/reporting/admin-year-caps'

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

/**
 * Persist one year level's practice limits (decision 4-A).
 *
 * WHY A SERVER ACTION RATHER THAN AN API ROUTE
 *   `updateAdminSettings` above sets the precedent for this page, and the shape
 *   fits: a single writer, no external caller, and no need for the route-level
 *   concern that forced API routes onto the reporting dashboards (those are
 *   chained by cron and CSV export as well as the UI).
 *
 * WHY THE ROLE CHECK IS REPEATED HERE
 *   `requireRole` is the page guard; `admin_set_year_level_cap` then refuses again
 *   in SQL. Neither is redundant. PostgREST exposes every granted function at
 *   `/rest/v1/rpc/<name>`, so a check that lives only in application code can be
 *   walked around by calling the RPC directly — the exact defect migration 044
 *   found. The SQL-side check is the one that actually holds.
 *
 * WHY THE DRAFT TRAVELS AS STRINGS AND IS COERCED HERE
 *   The client keeps raw text so a half-typed field stays editable. Coercion
 *   happens once, at the boundary, and a non-numeric value becomes NaN — which the
 *   shared validator rejects as an out-of-range ceiling rather than letting it
 *   reach Postgres as something stranger.
 */
export async function updateYearLevelCap(
  input: YearLevelCapDraft
): Promise<SaveCapResult> {
  await requireRole(['ADMIN'])

  const draft: YearLevelCapDraft = {
    year_level: Number(input.year_level),
    max_tests: Number(input.max_tests),
    max_questions: Number(input.max_questions),
    recommended_tests: Number(input.recommended_tests),
    recommended_questions: Number(input.recommended_questions),
  }

  const result = await saveYearLevelCap(draft)
  if (result.ok) revalidatePath('/admin/settings')
  return result
}

