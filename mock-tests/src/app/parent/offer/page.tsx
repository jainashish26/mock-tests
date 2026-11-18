import type { Metadata } from 'next'
import { requireRole } from '@/lib/rbac/require-role'
import { createClient } from '@/lib/supabase/server'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import {
  OfferLockedPanel,
  OfferOwnedPanel,
  OfferPanel,
  type OfferPanelData,
} from '@/features/monetisation/OfferPanel'
import { OfferViewTracker } from '@/features/monetisation/OfferViewTracker'
import {
  getOfferForUser,
  grantOfferToUser,
  LAUNCH_OFFER_SLUG,
} from '@/lib/pricing/launch-offer'
import { getFunnelState, PAYWALL_ATTEMPT_THRESHOLD } from '@/lib/funnel/state'
import { buildReadinessReport } from '@/lib/report/readiness'
import { formatMoney } from '@/lib/pricing/catalog'
import { topLockedInsight } from '@/lib/funnel/interest'
import { assignVariant, recordExposure } from '@/lib/funnel/experiments'

/**
 * The A12 experiment key for N-7. Kept as a named constant so the offer page and
 * the experiment row cannot drift apart - a typo here would silently assign
 * nobody and leave the experiment reporting zero exposures forever.
 */
const N7_EXPERIMENT_KEY = 'n7_locked_click_personalisation'
import { prioritiseIncludes } from '@/lib/pricing/offer-personalisation'

/**
 * /parent/offer - funnel step 7, the conversion page.
 *
 * The panel order is deliberate and the reasoning lives in `OfferPanel.tsx`. This
 * route is only responsible for deciding *which* panel the family should see and
 * for resolving the numbers that panel renders, so that the price shown here can
 * never disagree with the price Stripe charges.
 *
 * Three mutually exclusive states:
 *   owned   - they have already paid; re-pitching a customer is how you train
 *             them to ignore every future email
 *   locked  - they have not earned the offer yet; explain the path, do not sell
 *   live    - the offer window is open; convert
 */

export const metadata: Metadata = {
  title: 'Your launch offer',
  // Never indexable: a personalised, expiring price must not appear in search
  // results where a cold visitor would see a deadline that does not apply to them.
  robots: { index: false, follow: false },
}

type ChildRow = { id: string; username: string; year_level: number }
type LinkRow = { student_profiles: ChildRow | null }

export default async function OfferPage() {
  const { user } = await requireRole(['PARENT', 'ADMIN'])
  const supabase = await createClient()

  const state = await getFunnelState(user.id)
  const completed = state?.completed_attempts ?? 0
  const eligible = completed >= PAYWALL_ATTEMPT_THRESHOLD

  let resolved = await getOfferForUser(user.id, LAUNCH_OFFER_SLUG)

  // Grant on first arrival when the family has earned it. Granting here as well
  // as in the lifecycle worker means a parent who clicks straight through from
  // the paywall email gets a live window rather than an empty page.
  if (eligible && (resolved.status === 'none' || resolved.status === 'expired')) {
    const granted = await grantOfferToUser(user.id, LAUNCH_OFFER_SLUG)
    if (granted) resolved = { offer: granted, status: 'live' }
  }

  // ---- Personalisation: the child's own headline gap -----------------------
  const { data: links } = await supabase
    .from('parent_student_links')
    .select('student_profiles(id, username, year_level)')
    .eq('parent_user_id', user.id)
    .limit(4)

  const children = ((links ?? []) as unknown as LinkRow[])
    .map((row) => row.student_profiles)
    .filter((child): child is ChildRow => child !== null && child !== undefined)

  const firstChild = children[0] ?? null
  const report = firstChild
    ? await buildReadinessReport(supabase, firstChild.id, { unlocked: false })
    : null

  // ---- State 1: already a customer -----------------------------------------
  if (state?.first_purchase_at && resolved.status !== 'live') {
    return (
      <DashboardLayout role="PARENT" userName="Parent Account">
        <OfferOwnedPanel />
      </DashboardLayout>
    )
  }

  // ---- State 2: not yet eligible -------------------------------------------
  if (!eligible || resolved.status !== 'live' || !resolved.offer) {
    return (
      <DashboardLayout role="PARENT" userName="Parent Account">
        <OfferLockedPanel
          remaining={Math.max(0, PAYWALL_ATTEMPT_THRESHOLD - completed)}
          threshold={PAYWALL_ATTEMPT_THRESHOLD}
        />
      </DashboardLayout>
    )
  }

  // ---- State 3: the live offer ---------------------------------------------
  const offer = resolved.offer
  const gap = report?.gaps[0] ?? null
  const exam = report?.exams.find((item) => item.eligible) ?? null

  // N-7: lead with the benefit the parent actually clicked on the paywall.
  // Returns null on any failure, in which case the offer renders its normal
  // order - personalisation must never be able to break the offer page.
  const rawInsight = await topLockedInsight(user.id)

  // A12: N-7 runs as an experiment rather than a silent rollout, so its effect on
  // checkout completion is measurable instead of assumed.
  const variant = await assignVariant(N7_EXPERIMENT_KEY, user.id)
  const insight = variant === 'personalised' ? rawInsight : null

  // Exposure is recorded only when the arm's treatment ACTUALLY rendered.
  //   control      -> always saw the default order, which IS the control treatment
  //   personalised -> saw the reordered list only if there was a click to act on;
  //                   with no insight they saw the default too, so counting them
  //                   would dilute the arm with people who saw the same thing as
  //                   control and bias the result toward the null (§5.4).
  if (variant === 'control' || (variant === 'personalised' && insight !== null)) {
    await recordExposure(N7_EXPERIMENT_KEY, user.id)
  }

  const baseIncludes =
    offer.includes.length > 0
      ? offer.includes
      : [
          '6 full-length exam papers across NAPLAN, Selective, Scholarship and Olympiad',
          'Unlimited AI writing marks with criterion-level feedback',
          'Time-per-question diagnostics and full question-level review',
          'Progress trend across every attempt',
          'An adaptive weekly study plan that re-targets the weakest topic',
          `A ${offer.guaranteeDays}-day money-back guarantee`,
        ]

  const data: OfferPanelData = {
    offerName: offer.name,
    offerDescription: offer.description,
    slug: offer.slug,
    priceLabel: formatMoney(offer.offerAmountCents, offer.currency),
    originalLabel: formatMoney(offer.originalAmountCents, offer.currency),
    discountPercent: offer.discountPercent,
    guaranteeDays: offer.guaranteeDays,
    expiresAt: offer.expiresAt,
    // Reordered so the clicked benefit leads. Every item is unchanged and still
    // present - this moves a line, it does not add a claim.
    includes: prioritiseIncludes(baseIncludes, insight),
    interestInsight: insight,
    childLabel: firstChild?.username ?? null,
    gapTopic: gap?.topic ?? null,
    gapAccuracy: gap?.accuracy ?? null,
    gapAttempted: gap?.attempted ?? null,
    examLabel: exam?.label ?? null,
  }

  return (
    <DashboardLayout role="PARENT" userName="Parent Account">
      <OfferViewTracker offerSlug={offer.slug} priceCents={offer.offerAmountCents} />
      <OfferPanel data={data} />
    </DashboardLayout>
  )
}
