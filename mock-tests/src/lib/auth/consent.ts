import { LEGAL_LAST_UPDATED, LEGAL_ROUTES } from '@/lib/seo/site-config';

/**
 * Sign-up consent: copy, versioning and validation for the parent registration
 * form.
 *
 * Kept in `lib` rather than inside the component so the exact wording, the route
 * targets and the recorded consent version have a single definition shared by the
 * UI, the sign-up handler and the OAuth gate.
 *
 * Why this is recorded rather than merely displayed: for the age confirmation and
 * terms acceptance to be worth anything, there has to be an auditable record of
 * what was accepted and when. Supabase stores the values returned by
 * `buildConsentMetadata` in `auth.users.raw_user_meta_data`.
 */

/**
 * Version of the consent wording. Bump this whenever the text or the linked
 * legal documents change materially, so records can be read against the wording
 * that was actually shown.
 */
export const CONSENT_VERSION = LEGAL_LAST_UPDATED;

/** Field names used by the form, the FormData read and the metadata payload. */
export const CONSENT_FIELDS = {
  age: 'consent_age_18',
  terms: 'consent_terms_privacy',
  marketing: 'consent_marketing_updates',
} as const;

/** Route each legal link points at. */
export const CONSENT_LINKS = {
  terms: LEGAL_ROUTES.terms,
  privacy: LEGAL_ROUTES.privacy,
} as const;

export interface ConsentState {
  /** Mandatory: the registrant confirms they are 18 or older. */
  ageConfirmed: boolean;
  /** Mandatory: agreement to the Terms and acknowledgement of the Privacy Policy. */
  termsAccepted: boolean;
  /** Optional: product and exam-date updates by email. */
  marketingOptIn: boolean;
}

export const EMPTY_CONSENT: ConsentState = {
  ageConfirmed: false,
  termsAccepted: false,
  marketingOptIn: false,
};

/** Read consent state out of a submitted form. */
export function consentFromFormData(formData: FormData): ConsentState {
  return {
    ageConfirmed: formData.get(CONSENT_FIELDS.age) === 'on',
    termsAccepted: formData.get(CONSENT_FIELDS.terms) === 'on',
    marketingOptIn: formData.get(CONSENT_FIELDS.marketing) === 'on',
  };
}

/**
 * Validate the mandatory consents.
 *
 * Returns the keys of any unmet requirement so the UI can name exactly what is
 * missing instead of showing a generic "please agree".
 */
export function validateConsent(consent: ConsentState): (keyof ConsentState)[] {
  const missing: (keyof ConsentState)[] = [];
  if (!consent.ageConfirmed) missing.push('ageConfirmed');
  if (!consent.termsAccepted) missing.push('termsAccepted');
  return missing;
}

/** Human-readable message for the unmet requirements. */
export function consentErrorMessage(missing: (keyof ConsentState)[]): string {
  if (missing.length === 0) return '';
  if (missing.length === 2) {
    return 'Please confirm you are 18 or over and accept the Terms of Service and Privacy Policy to continue.';
  }
  return missing[0] === 'ageConfirmed'
    ? 'Please confirm you have reached the age of 18 years old to continue.'
    : 'Please accept the Terms of Service and acknowledge the Privacy Policy to continue.';
}

/**
 * Build the `data` payload passed to `supabase.auth.signUp`, which Supabase
 * persists on the auth user as `raw_user_meta_data`.
 *
 * `consent_at` is the moment of acceptance, not the moment of reading - it is
 * stamped at submit time. The marketing flag is stored even when false so an
 * explicit opt-out is distinguishable from "never asked" (an older account
 * created before this field existed).
 */
export function buildConsentMetadata(consent: ConsentState): Record<string, unknown> {
  return {
    consent_version: CONSENT_VERSION,
    consent_at: new Date().toISOString(),
    age_18_confirmed: consent.ageConfirmed,
    terms_accepted: consent.termsAccepted,
    privacy_acknowledged: consent.termsAccepted,
    marketing_opt_in: consent.marketingOptIn,
    consent_source: 'email_signup',
  };
}

/* ------------------------------------------------------------------ *
 * Cookie hand-off for the OAuth (Google) sign-up path
 * ------------------------------------------------------------------ */

/**
 * `signInWithOAuth` accepts no `data` payload, so there is no way to attach
 * consent metadata at the moment a Google account is created. Instead the signup
 * page writes a short-lived cookie, and `/auth/callback` reads it once a session
 * exists and persists the same metadata via `updateUser`.
 *
 * HONEST LIMITATION: this cookie is written by the browser, so it records what
 * the UI captured - it is not tamper-proof proof of consent. The email path has
 * the same property (the values come from the client). A legally hardened
 * implementation would insert a row into a dedicated `consents` table from an
 * authenticated server action; see the note in SEO.md / handover.
 *
 * Deliberately additive: nothing in the OAuth flow is blocked if the cookie is
 * missing, because `/auth/oauth/[provider]` is shared with the LOGIN page where
 * age confirmation must not be demanded of an existing account holder.
 */
export const CONSENT_COOKIE = 'mt_signup_consent';

/** One hour - long enough to survive the provider round trip, no longer. */
const CONSENT_COOKIE_MAX_AGE = 60 * 60;

/** Write the consent cookie. No-op during SSR (no `document`). */
export function writeConsentCookie(consent: ConsentState): void {
  if (typeof document === 'undefined') return;

  // Only worth persisting once the mandatory pair is satisfied.
  if (validateConsent(consent).length > 0) {
    clearConsentCookie();
    return;
  }

  const payload = {
    v: CONSENT_VERSION,
    at: new Date().toISOString(),
    age: consent.ageConfirmed,
    terms: consent.termsAccepted,
    mkt: consent.marketingOptIn,
  };

  // base64url without pulling in a Buffer dependency in the browser.
  const encoded = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie =
    `${CONSENT_COOKIE}=${encoded}; Path=/; Max-Age=${CONSENT_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

/** Delete the consent cookie. */
export function clearConsentCookie(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${CONSENT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/**
 * Decode and validate a consent cookie on the server.
 *
 * Returns `null` for anything missing, malformed, stale or incomplete - the
 * caller must treat that as "no record", never as consent.
 */
export function parseConsentCookie(
  raw: string | undefined | null
): { metadata: Record<string, unknown>; consent: ConsentState } | null {
  if (!raw) return null;

  let json: string;
  try {
    const padded = raw.replace(/-/g, '+').replace(/_/g, '/');
    json = Buffer.from(padded, 'base64').toString('utf8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const p = parsed as Record<string, unknown>;

  if (p.v !== CONSENT_VERSION) return null;
  if (p.age !== true || p.terms !== true) return null;
  if (typeof p.at !== 'string' || Number.isNaN(Date.parse(p.at))) return null;

  const consent: ConsentState = {
    ageConfirmed: true,
    termsAccepted: true,
    marketingOptIn: p.mkt === true,
  };

  return {
    consent,
    metadata: {
      consent_version: CONSENT_VERSION,
      consent_at: p.at,
      age_18_confirmed: true,
      terms_accepted: true,
      privacy_acknowledged: true,
      marketing_opt_in: consent.marketingOptIn,
      consent_source: 'oauth_signup',
    },
  };
}

