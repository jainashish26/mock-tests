'use client'

import { useEffect } from 'react'
import { trackView } from '@/features/monetisation/track-client'

/**
 * Records a referral landing (funnel step 1).
 *
 * `valid` distinguishes a working share link from a broken or guessed one. That
 * number is operationally important: a high invalid rate means links are being
 * mangled in transit - usually by a messaging app stripping the path, or a parent
 * copy-pasting the code without the URL - and the fix is a shorter share format,
 * not better copy.
 */
export function ReferralLandingTracker({ code, valid }: { code: string; valid: boolean }) {
  useEffect(() => {
    trackView('REFERRAL_LANDED', { referralCode: code, valid })
  }, [code, valid])

  return null
}
