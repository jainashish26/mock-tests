'use client'

import type { ReactNode } from 'react'
import { ENABLED_SOCIAL_PROVIDERS } from '@/lib/auth/oauth'
import { Button } from '@/components/ui/Button'

/**
 * Social sign-in buttons.
 *
 * These are plain anchors pointing at /auth/oauth/[provider], not buttons with
 * onClick handlers, so the flow works with JavaScript disabled and there is no
 * client-side round trip before the provider redirect. The `'use client'`
 * directive is only present because the auth pages that render this are client
 * components — the component itself holds no state.
 *
 * Brand marks are inlined because `lucide-react` ships no brand/logo icons and
 * adding an icon package for one glyph is not worth the dependency. The Google
 * "G" is reproduced unmodified (Google's brand guidelines forbid recolouring or
 * reshaping it) and the label uses an approved string, "Continue with Google".
 */

function GoogleMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.44a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.16 3.57-8.81z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.87-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.72-4.96H1.29v3.09A11.99 11.99 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.28a7.21 7.21 0 0 1 0-4.56V6.63H1.29a11.99 11.99 0 0 0 0 10.74l3.99-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.76c1.77 0 3.35.61 4.6 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.29 6.63l3.99 3.09C6.22 6.87 8.87 4.76 12 4.76z"
      />
    </svg>
  )
}

/**
 * Facebook "f" mark, unmodified, in the official brand blue (#1877F2).
 * Meta's guidelines permit the f-logo in Facebook blue, white or black; blue on
 * our neutral button keeps it consistent with the Google button treatment.
 */
function FacebookMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <path
        fill="#1877F2"
        d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"
      />
    </svg>
  )
}

const PROVIDER_MARKS: Record<string, ReactNode> = {
  google: <GoogleMark />,
  facebook: <FacebookMark />,
}

interface SocialAuthButtonsProps {
  /** Optional destination preserved through the OAuth round trip. */
  next?: string
  /**
   * Where the "or" separator sits relative to the buttons.
   * `after` suits a social-first layout (signup page); `before` suits an
   * email-first layout where the buttons follow the password form (login page).
   */
  divider?: 'before' | 'after' | 'none'
  className?: string
  /**
   * Mandatory-consent gate. Invoked on click; return `false` to cancel the
   * provider redirect so the caller can surface what is missing.
   *
   * Needed because these are plain anchors that leave the page immediately: a
   * consent checkbox placed only inside the email form would be trivially
   * bypassed by signing up with Google instead. Optional, so the login page -
   * where no consent is required - is unaffected.
   *
   * Progressive enhancement only: with JavaScript disabled the anchors still
   * navigate, which is why the consent group is rendered above them and states
   * the requirement in plain text.
   */
  requireConsent?: () => boolean
}

function OrDivider() {
  return (
    <div className="my-6 flex items-center gap-3" role="separator">
      <span className="h-px flex-1 bg-border" />
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        or
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}

export function SocialAuthButtons({ next, divider = 'after', className, requireConsent }: SocialAuthButtonsProps) {
  // Renders nothing at all when no provider flag is on, so this can be dropped
  // into a page unconditionally in environments where social login is dark.
  if (ENABLED_SOCIAL_PROVIDERS.length === 0) return null

  const query = next ? `?next=${encodeURIComponent(next)}` : ''

  return (
    <div className={className}>
      {divider === 'before' ? <OrDivider /> : null}

      <div className="flex flex-col gap-3">
        {ENABLED_SOCIAL_PROVIDERS.map((provider) => (
          <Button key={provider.id} variant="outline" size="lg" className="w-full" asChild>
            <a
              href={`/auth/oauth/${provider.id}${query}`}
              onClick={(event) => {
                // Block the provider redirect until mandatory consent is given.
                if (requireConsent && !requireConsent()) event.preventDefault()
              }}
            >
              {PROVIDER_MARKS[provider.id]}
              {provider.label}
            </a>
          </Button>
        ))}
      </div>

      {divider === 'after' ? <OrDivider /> : null}
    </div>
  )
}
