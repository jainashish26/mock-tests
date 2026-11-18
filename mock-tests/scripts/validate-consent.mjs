// Verifies the parent sign-up consent UI in the built HTML.
//
// Guards a legal requirement, so it runs as part of 
// `npm run verify`. The two
// mandatory confirmations must stay present, required, unpre-checked, correctly
// labelled and linked to the real /terms and /privacy-policy routes - and the
// login pages must NOT start demanding sign-up consent from existing users.
//
// Run with:  node scripts/validate-consent.mjs   (requires a prior build)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const app = join(process.cwd(), '.next', 'server', 'app', 'auth');
const read = (f) => readFileSync(join(app, f), 'utf8');
const clean = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

let pass = 0, fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? ' -> ' + detail : '')); }
};

const signup = read('signup.html');
const login = read('login.html');
const studentLogin = read('student-login.html');

console.log('\n=== /auth/signup ===');

const boxes = [...signup.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)].map((m) => m[0]);
console.log('checkbox inputs found: ' + boxes.length);
check('exactly 3 checkboxes', boxes.length === 3, String(boxes.length));

const byName = (n) => boxes.find((b) => b.includes('name="' + n + '"'));
const age = byName('consent_age_18');
const terms = byName('consent_terms_privacy');
const mkt = byName('consent_marketing_updates');

check('age checkbox present', Boolean(age));
check('terms checkbox present', Boolean(terms));
check('marketing checkbox present', Boolean(mkt));

if (age) {
  check('age is required', /required/.test(age), age.slice(0, 140));
  check('age not pre-checked', !/checked=/.test(age));
  check('age has id for label', /id="consent_age_18"/.test(age));
}
if (terms) {
  check('terms is required', /required/.test(terms), terms.slice(0, 140));
  check('terms not pre-checked', !/checked=/.test(terms));
  check('terms has id for label', /id="consent_terms_privacy"/.test(terms));
}
if (mkt) {
  check('marketing is NOT required', !/required/.test(mkt), mkt.slice(0, 140));
  check('marketing not pre-checked', !/checked=/.test(mkt));
  check('marketing marked Optional', signup.includes('Optional'));
}

// Exact copy requested.
const plain = clean(signup);
check('age copy verbatim',
  plain.includes('By checking this box, you confirm you have reached the age of 18 years old.'),
  '');
check('terms copy verbatim',
  plain.includes('By checking this box, you agree to the Terms of Service , and acknowledge our Privacy Policy .') ||
  plain.includes('By checking this box, you agree to the Terms of Service, and acknowledge our Privacy Policy.'),
  '');

// Links
const termsLink = signup.match(/<a[^>]*href="\/terms"[^>]*>([\s\S]*?)<\/a>/);
const privacyLink = signup.match(/<a[^>]*href="\/privacy-policy"[^>]*>([\s\S]*?)<\/a>/);
check('links to /terms', Boolean(termsLink));
check('links to /privacy-policy', Boolean(privacyLink));
if (termsLink) {
  check('/terms link text is "Terms of Service"', clean(termsLink[1]) === 'Terms of Service', clean(termsLink[1]));
  check('/terms opens in new tab', /target="_blank"/.test(termsLink[0]), termsLink[0].slice(0, 120));
  check('/terms has noopener noreferrer', /rel="noopener noreferrer"/.test(termsLink[0]));
}
if (privacyLink) {
  check('/privacy-policy link text is "Privacy Policy"', clean(privacyLink[1]) === 'Privacy Policy', clean(privacyLink[1]));
  check('/privacy-policy opens in new tab', /target="_blank"/.test(privacyLink[0]));
}

// Labels are real <label for=...> so the whole sentence is clickable/accessible.
check('label bound to age input', /<label[^>]*for="consent_age_18"/.test(signup));
check('label bound to terms input', /<label[^>]*for="consent_terms_privacy"/.test(signup));
check('label bound to marketing input', /<label[^>]*for="consent_marketing_updates"/.test(signup));
check('fieldset + legend present', /<fieldset/.test(signup) && /<legend/.test(signup));
check('Required badge shown', signup.includes('Required'));

// The old passive, unlinked sentence must be gone.
check('old passive agreement text removed',
  !plain.includes('By creating an account, you agree to our Terms of Service and Privacy Policy.'));

// Consent sits above the submit button.
const consentPos = signup.indexOf('consent_age_18');
const submitPos = signup.indexOf('Create Free Account');
check('consent rendered before submit button', consentPos > 0 && submitPos > consentPos,
  'consent@' + consentPos + ' submit@' + submitPos);

console.log('\n=== regression: other auth pages must NOT require sign-up consent ===');
for (const [name, html] of [['login', login], ['student-login', studentLogin]]) {
  check(name + ': no age checkbox', !html.includes('consent_age_18'));
  check(name + ': no terms checkbox', !html.includes('consent_terms_privacy'));
  check(name + ': still has social buttons or form', /<form|Continue with/.test(html));
}

// The login page must still be able to reach sign-up.
check('login links to /auth/signup', login.includes('/auth/signup'));

console.log('\n' + '-'.repeat(58));
console.log('PASSED: ' + pass + '   FAILED: ' + fail);
console.log('-'.repeat(58) + '\n');
process.exit(fail ? 1 : 0);
