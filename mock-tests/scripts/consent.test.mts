/**
 * Unit tests for the sign-up consent logic.
 *
 * `parseConsentCookie` performs security-relevant validation - it must reject
 * tampered, stale, truncated or incomplete records rather than treating them as
 * consent - so it is tested directly rather than assumed correct.
 *
 * Run with:
 *   npm run test:consent
 *
 * Dependency-free: uses Node's built-in TypeScript type stripping plus the small
 * `@/` resolver in scripts/ts-register.mjs, so no test framework is required.
 */
import {
  buildConsentMetadata,
  CONSENT_FIELDS,
  CONSENT_VERSION,
  consentErrorMessage,
  EMPTY_CONSENT,
  parseConsentCookie,
  validateConsent,
  type ConsentState,
} from '@/lib/auth/consent';

let pass = 0;
let fail = 0;
const eq = (label: string, actual: unknown, expected: unknown) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + '\n          actual   ' + a + '\n          expected ' + e); }
};
const ok = (label: string, cond: boolean) => eq(label, cond, true);

/** Encode a payload exactly the way the browser-side writer does. */
function encode(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

const FULL: ConsentState = { ageConfirmed: true, termsAccepted: true, marketingOptIn: true };
const NO_MKT: ConsentState = { ageConfirmed: true, termsAccepted: true, marketingOptIn: false };

console.log('\n=== validateConsent ===');
eq('empty consent -> both mandatory missing',
  validateConsent(EMPTY_CONSENT).sort(), ['ageConfirmed', 'termsAccepted'].sort());
eq('age only -> terms missing', validateConsent({ ...EMPTY_CONSENT, ageConfirmed: true }), ['termsAccepted']);
eq('terms only -> age missing', validateConsent({ ...EMPTY_CONSENT, termsAccepted: true }), ['ageConfirmed']);
eq('both mandatory -> none missing', validateConsent(NO_MKT), []);
eq('optional box does not affect validation', validateConsent(FULL), []);

console.log('\n=== consentErrorMessage ===');
ok('names both when both missing',
  consentErrorMessage(validateConsent(EMPTY_CONSENT)).includes('18 or over') &&
  consentErrorMessage(validateConsent(EMPTY_CONSENT)).includes('Terms of Service'));
ok('names age when only age missing', consentErrorMessage(['ageConfirmed']).includes('age of 18'));
ok('names terms when only terms missing', consentErrorMessage(['termsAccepted']).includes('Privacy Policy'));
eq('empty when nothing missing', consentErrorMessage([]), '');

console.log('\n=== CONSENT_FIELDS ===');
eq('age field name', CONSENT_FIELDS.age, 'consent_age_18');
eq('terms field name', CONSENT_FIELDS.terms, 'consent_terms_privacy');
eq('marketing field name', CONSENT_FIELDS.marketing, 'consent_marketing_updates');

console.log('\n=== buildConsentMetadata ===');
const meta = buildConsentMetadata(FULL);
eq('records consent version', meta.consent_version, CONSENT_VERSION);
eq('age flag', meta.age_18_confirmed, true);
eq('terms flag', meta.terms_accepted, true);
eq('privacy flag mirrors terms', meta.privacy_acknowledged, true);
eq('marketing opt-in true', meta.marketing_opt_in, true);
eq('source is email_signup', meta.consent_source, 'email_signup');
ok('timestamp is ISO', typeof meta.consent_at === 'string' && !Number.isNaN(Date.parse(String(meta.consent_at))));

const metaOff = buildConsentMetadata(NO_MKT);
eq('explicit opt-out stored as false, not omitted', metaOff.marketing_opt_in, false);
ok('opt-out key is present', Object.prototype.hasOwnProperty.call(metaOff, 'marketing_opt_in'));

console.log('\n=== parseConsentCookie: valid input ===');
const at = new Date().toISOString();
const good = encode({ v: CONSENT_VERSION, at, age: true, terms: true, mkt: true });
const parsed = parseConsentCookie(good);
ok('accepts a well-formed cookie', parsed !== null);
eq('returns oauth_signup source', parsed?.metadata.consent_source, 'oauth_signup');
eq('returns marketing true', parsed?.metadata.marketing_opt_in, true);
eq('returns age flag', parsed?.metadata.age_18_confirmed, true);
eq('preserves acceptance timestamp', parsed?.metadata.consent_at, at);

const goodNoMkt = encode({ v: CONSENT_VERSION, at, age: true, terms: true, mkt: false });
eq('marketing false survives round trip', parseConsentCookie(goodNoMkt)?.metadata.marketing_opt_in, false);

console.log('\n=== parseConsentCookie: rejection ===');
eq('null input rejected', parseConsentCookie(null), null);
eq('undefined input rejected', parseConsentCookie(undefined), null);
eq('empty string rejected', parseConsentCookie(''), null);
eq('garbage rejected', parseConsentCookie('not-base64-!!!'), null);
eq('valid base64 but not JSON rejected',
  parseConsentCookie(Buffer.from('hello world').toString('base64url')), null);
eq('JSON array rejected', parseConsentCookie(encode([1, 2, 3])), null);
eq('JSON scalar rejected', parseConsentCookie(encode('consent')), null);
eq('stale consent version rejected',
  parseConsentCookie(encode({ v: '1999-01-01', at, age: true, terms: true, mkt: true })), null);
eq('missing version rejected', parseConsentCookie(encode({ at, age: true, terms: true })), null);
eq('age false rejected',
  parseConsentCookie(encode({ v: CONSENT_VERSION, at, age: false, terms: true })), null);
eq('age absent rejected',
  parseConsentCookie(encode({ v: CONSENT_VERSION, at, terms: true })), null);
eq('terms false rejected',
  parseConsentCookie(encode({ v: CONSENT_VERSION, at, age: true, terms: false })), null);
eq('terms absent rejected',
  parseConsentCookie(encode({ v: CONSENT_VERSION, at, age: true })), null);
eq('truthy-but-not-true age rejected',
  parseConsentCookie(encode({ v: CONSENT_VERSION, at, age: 'yes', terms: true })), null);
eq('missing timestamp rejected',
  parseConsentCookie(encode({ v: CONSENT_VERSION, age: true, terms: true })), null);
eq('unparseable timestamp rejected',
  parseConsentCookie(encode({ v: CONSENT_VERSION, at: 'not-a-date', age: true, terms: true })), null);
eq('non-string timestamp rejected',
  parseConsentCookie(encode({ v: CONSENT_VERSION, at: 12345, age: true, terms: true })), null);
eq('truncated base64 rejected', parseConsentCookie(good.slice(0, 8)), null);
// A cookie carrying only the optional flag must never count as consent.
eq('marketing-only cookie rejected',
  parseConsentCookie(encode({ v: CONSENT_VERSION, at, mkt: true })), null);

console.log('\n' + '-'.repeat(58));
console.log('PASSED: ' + pass + '   FAILED: ' + fail);
console.log('-'.repeat(58) + '\n');
process.exit(fail ? 1 : 0);
