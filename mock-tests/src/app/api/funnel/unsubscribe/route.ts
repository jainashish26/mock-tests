import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logging/logger'
import { verifyUnsubscribeToken } from '@/lib/funnel/unsubscribe'
import { suppressEmail } from '@/lib/email/provider'
import { trackEvent } from '@/lib/funnel/track'

/**
 * GET/POST /api/funnel/unsubscribe - one-click list unsubscribe.
 *
 * POST is what Gmail, Yahoo and Outlook call when a recipient clicks the
 * unsubscribe control in the mail client itself. It must:
 *   - accept no authentication (Google's infrastructure is the caller)
 *   - return 200 on success and on repeat, because a non-2xx response makes the
 *     provider treat the list as broken and can affect deliverability
 *   - never leak whether a user id exists
 *
 * GET is the same action reached from the in-email link, rendering a short HTML
 * confirmation so the parent knows it worked. Silently redirecting to the
 * homepage would leave them unsure, and an unsure parent unsubscribes from
 * everything or marks the mail as spam instead.
 *
 * The token is HMAC-signed (see lib/funnel/unsubscribe.ts) so a third party
 * cannot suppress another family's emails by guessing a uuid.
 */

/** Suppress lifecycle email for one parent. Idempotent. */
async function applySuppression(userId: string): Promise<boolean> {
  try {
    const admin = createAdminClient()
    const { error } = await admin
      .from('funnel_state')
      .update({ email_suppressed: true, updated_at: new Date().toISOString() })
      .eq('user_id', userId)

    if (error) {
      // The row may not exist yet for a parent who never triggered a lifecycle
      // write. Insert a suppression-only row so the preference is still stored.
      if (error.code === '25P01' || error.code === '42P01') {
        logger.warn('[unsubscribe] no funnel_state row; recording preference only', {
          message: error.message,
        })
      } else {
        logger.error('UNSUBSCRIBE', '[unsubscribe] update failed', error.message)
        return false
      }
    }

    await suppressEmail(userId, 'one-click unsubscribe')
    await trackEvent({ event: 'EMAIL_UNSUBSCRIBED', userId })
    return true
  } catch (err) {
    logger.error('UNSUBSCRIBE', '[unsubscribe] threw', err)
    return false
  }
}

function parseParams(url: URL) {
  return {
    userId: url.searchParams.get('u'),
    expires: url.searchParams.get('e'),
    signature: url.searchParams.get('s'),
  }
}

/** Minimal confirmation page. Inline styles because it is a standalone response. */
function confirmationPage(message: string, ok: boolean): string {
  return `<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>Email preferences updated</title></head>
<body style="margin:0;padding:48px 20px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="max-width:460px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;text-align:center;">
<div style="font-size:40px;line-height:1;margin-bottom:16px;">${ok ? '&#9989;' : '&#9888;&#65039;'}</div>
<h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">${ok ? 'You are unsubscribed' : 'That link did not work'}</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#64748b;">${message}</p>
<a href="/" style="display:inline-block;padding:12px 28px;border-radius:9999px;background:#194bfb;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">Back to MockTests Pro</a>
</div></body></html>`
}

export async function POST(req: Request) {
  const { userId, expires, signature } = parseParams(new URL(req.url))
  const verified = verifyUnsubscribeToken(userId, expires, signature)

  // Always 200 to the provider. Revealing that a token was invalid tells an
  // attacker the endpoint is probing signatures, and a non-2xx harms
  // deliverability for every other recipient.
  if (!verified.valid || !verified.userId) {
    logger.warn('[unsubscribe] rejected an invalid token')
    return new NextResponse(null, { status: 200 })
  }

  await applySuppression(verified.userId)
  return new NextResponse(null, { status: 200 })
}

export async function GET(req: Request) {
  const { userId, expires, signature } = parseParams(new URL(req.url))
  const verified = verifyUnsubscribeToken(userId, expires, signature)

  if (!verified.valid || !verified.userId) {
    return new NextResponse(
      confirmationPage(
        'This unsubscribe link is invalid or has expired. You can change your email preferences from your account settings, or contact support and we will remove you manually.',
        false
      ),
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }

  const ok = await applySuppression(verified.userId)

  return new NextResponse(
    confirmationPage(
      ok
        ? 'You will not receive further emails from us. Your account, your children\'s profiles and every report stay exactly as they are - this only stops the emails.'
        : 'We could not save that preference just now. Please try again in a moment, or contact support and we will remove you manually.',
      ok
    ),
    {
      status: ok ? 200 : 500,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // Never cache an unsubscribe confirmation.
        'Cache-Control': 'no-store',
      },
    }
  )
}
