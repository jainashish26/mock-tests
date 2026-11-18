import { envelope, reportJson, type ReportEnvelope } from '@/lib/reporting/envelope'
import { requireReportingRole } from '@/lib/reporting/route-auth'

/**
 * S3 - the post-test completion screen.
 *
 * THERE IS DELIBERATELY NO DATABASE READ IN THIS HANDLER.
 *
 * A query that cannot run cannot leak. The student role additionally has no
 * column grant on any score field (migration 015), so even a regression here
 * returns nothing sensitive. This is the spec's own worked example
 * (13-...md §12.3) and the reasoning is the point: the strongest possible
 * defence for a child-facing endpoint is to give it nothing to defend.
 *
 * The payload CONTENT is fixed - the same two fields for every caller, with no
 * branch on identity anywhere in this file. Only the envelope timestamp is
 * generated per request, and it is generated per request deliberately: a
 * module-level constant would freeze `refreshLagMinutes` at server start, so
 * the badge would silently count up for the lifetime of the process and
 * eventually read as stale data that never existed.
 */

interface CompletionDto {
  status: 'completed'
  message: string
}

function completionEnvelope(): ReportEnvelope<CompletionDto> {
  return envelope<CompletionDto>({
    reportId: 'S3',
    data: { status: 'completed', message: 'Nice work — you finished!' },
    // S3 has no upstream view, so its data is by definition current: the
    // message is a constant, not a query result. Lag is genuinely zero.
    asAt: new Date().toISOString(),
    state: 'ok',
  })
}

export async function GET() {
  const auth = await requireReportingRole('S3', ['STUDENT'])
  if (!auth.ok) return auth.response

  // no-store, not a TTL: this is per-session feedback and must never be
  // served from a shared cache to a different child.
  return reportJson(completionEnvelope(), { status: 200 })
}

