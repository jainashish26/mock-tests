import type { Metadata } from 'next'

import { PageHeader } from '@/features/creator/components/PageHeader'
import { requireRole } from '@/lib/rbac/require-role'
import { createAdminClient } from '@/lib/supabase/admin'

import { SettingsForm } from './SettingsForm'
import { YearCapsTable } from './YearCapsTable'
import { loadYearLevelCaps } from '@/lib/reporting/admin-year-caps'

export const metadata: Metadata = { title: 'Settings' }
export const dynamic = 'force-dynamic'

/**
 * Admin → Settings: platform-wide controls backed by the singleton
 * `admin_settings` row (PK is the constant true). ADMIN only — the same guard
 * is re-enforced inside the save action.
 *
 * The year-level practice limits on this page are read through the RPC wrapper,
 * not the service-role client, because `has_role('ADMIN')` resolves the caller's
 * JWT — `auth.uid()` is null under the admin client, so a service-role read would
 * return zero rows and the section would render as though nothing were configured.
 * The empty state below distinguishes that from a genuine failure for the same
 * reason: the two look identical in the data and mean completely different things.
 */
export default async function AdminSettingsPage() {
  await requireRole(['ADMIN'])

  const adminClient = createAdminClient()
  const { data } = await adminClient
    .from('admin_settings')
    .select('*')
    .eq('id', true)
    .maybeSingle()

  const capsResult = await loadYearLevelCaps()

  const row = data as {
    maintenance_mode?: boolean | null
    maintenance_mode_message?: string | null
    registration_open?: boolean | null
  } | null

  return (
    <>
      <PageHeader
        title="Settings"
        description="Platform-wide controls — maintenance mode, registration and practice limits."
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

      <section
        aria-labelledby="year-level-caps"
        className="mt-6 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-6"
      >
        <h2 id="year-level-caps" className="text-base font-semibold text-foreground">
          Daily practice limits by year level
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A ceiling per year level, and a recommended target beside it. The ceiling is what
          protects a child from a plan that has fallen too far behind; the recommended target is
          advice about what a normal day should look like.
        </p>

        {capsResult.error ? (
          /**
           * Includes the case where the RPC answered 200 with no rows. That is not
           * rendered as "nothing is configured" — migration 107 seeds all eight
           * levels, and `has_role('ADMIN')` returns empty rather than an error to a
           * caller without a user JWT, so an empty answer is far more likely to mean
           * the read was refused. Saying "no limits are set" in that situation would
           * be a confidently wrong statement about a fully configured database.
           */
          <p role="alert" className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            The stored limits could not be verified
            {capsResult.code && capsResult.code !== 'empty-refused' ? ` (${capsResult.code})` : ''}.
            The table is seeded with all eight year levels, so an empty answer here means the read
            was refused rather than that nothing is configured — the limits are almost certainly
            still in force and unchanged. This usually indicates the page was read without a
            signed-in administrator session.
          </p>
        ) : (
          <>
            {capsResult.missingYears.length > 0 && (
              /**
               * A partial set: some rows exist, one or more mandated levels do not.
               * Distinct from the case above, and a genuine data problem — a student
               * in a missing year level falls through to the fallback cap, which is
               * the silent behaviour this migration exists to remove.
               */
              <p role="alert" className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                No limits are stored for year {capsResult.missingYears.join(', ')}
                {capsResult.missingYears.length > 1 ? 's' : ''}. Students in those year levels fall
                back to twice their weekly goal divided by seven, and overload warnings cannot fire
                for them.
              </p>
            )}
            <div className="mt-5">
              <YearCapsTable caps={capsResult.caps} />
            </div>
          </>
        )}
      </section>
    </>
  )
}
