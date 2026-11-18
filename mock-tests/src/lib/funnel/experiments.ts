import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logging/logger'
import { isFunnelConfigured } from './track'

/**
 * Server-side client for A12 experiment assignment and exposure.
 *
 * WHY THE SERVICE CLIENT
 *   `experiment_assign` and `experiment_expose` are service_role only. A browser
 *   that could choose its own arm could manufacture a winning variant - the same
 *   reasoning that keeps funnel_events writes off the client, with more force.
 *
 * ASSIGNMENT vs EXPOSURE IS THE CALLER'S RESPONSIBILITY
 *   `assignVariant` records which arm a subject is in. `recordExposure` records
 *   that they actually SAW it. They are separate calls because they are separate
 *   facts: §5.4 warns that "counting assigned-but-never-shown users biases every
 *   experiment toward the null".
 *
 *   A caller must therefore expose only when the treatment genuinely rendered.
 *   The offer page does exactly this: a control visitor always sees the control
 *   treatment, but a personalised-arm visitor with no click history sees the
 *   default order and was NOT exposed to personalisation.
 *
 * FAILS OPEN
 *   Every failure returns null/false and the page renders its default experience.
 *   An experiment must never be able to break the offer page.
 */

/** The arm this subject is in, assigning stickily on first call. Null if not running. */
export async function assignVariant(
  experimentKey: string,
  subjectKey: string
): Promise<string | null> {
  if (!isFunnelConfigured() || !subjectKey) return null

  try {
    const admin = createAdminClient()
    const { data, error } = await admin.rpc('experiment_assign', {
      p_experiment_key: experimentKey,
      p_subject_key: subjectKey,
    })
    if (error) {
      logger.warn('[experiments] assign failed, rendering default', { experimentKey })
      return null
    }
    return typeof data === 'string' ? data : null
  } catch (err) {
    logger.warn('[experiments] assign threw, rendering default', { experimentKey, err })
    return null
  }
}

/** Record that the subject actually saw their arm. Call only when it rendered. */
export async function recordExposure(
  experimentKey: string,
  subjectKey: string
): Promise<boolean> {
  if (!isFunnelConfigured() || !subjectKey) return false

  try {
    const admin = createAdminClient()
    const { data, error } = await admin.rpc('experiment_expose', {
      p_experiment_key: experimentKey,
      p_subject_key: subjectKey,
    })
    if (error) {
      logger.warn('[experiments] expose failed', { experimentKey })
      return false
    }
    return data === true
  } catch (err) {
    logger.warn('[experiments] expose threw', { experimentKey, err })
    return false
  }
}
