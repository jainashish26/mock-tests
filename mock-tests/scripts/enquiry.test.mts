/**
 * Enquiry ingest rules (backlog item 21, Phase A).
 *
 * WHAT IS UNDER TEST
 *   Only the pure half: `src/lib/support/enquiry-fields.ts` and
 *   `src/lib/support/form-token.ts`. Deliberately no server, no browser and no
 *   database, which is the entire reason those modules are separate from
 *   `src/lib/support/enquiries.ts`. A rule that can only be checked by running
 *   the endpoint is a rule nobody re-checks.
 *
 * WHY THESE PARTICULAR ASSERTIONS
 *   The closed type list and the honeypot are the two defences whose failure is
 *   invisible: an unvalidated `enquiry_type` reaching Postgres would raise, but a
 *   type that *is* in the list is the only way free text enters the reporting
 *   schema, and a honeypot that stopped being checked would simply let bots
 *   through quietly. The token tests exist because a timestamp check that trusts
 *   a client-supplied value is not a check at all.
 *
 * Run with:
 *   npm run test:enquiry
 */
import {
  ENQUIRY_LIMITS,
  ENQUIRY_TYPES,
  ENQUIRY_TYPE_CHOICES,
  HONEYPOT_FIELD,
  contactJsonb,
  isEnquiryType,
  isHoneypotFilled,
  normaliseEnquiry,
  utmJsonb,
} from '@/lib/support/enquiry-fields';
import {
  TOKEN_MAX_AGE_MS,
  TOKEN_MIN_AGE_MS,
  clientIpFrom,
  fingerprintIp,
  issueFormToken,
  ipPepper,
  verifyFormToken,
} from '@/lib/support/form-token';

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n          ' + detail : '')); }
};
const eq = (label: string, actual: unknown, expected: unknown) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + '\n          actual   ' + a + '\n          expected ' + e); }
};

/** The smallest submission that should pass, before per-test mutation. */
function validBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enquiryType: 'billing',
    fullName: 'Alex Parent',
    email: 'Alex@Example.com',
    phone: '',
    message: 'The refund on the pack I bought last Tuesday has not arrived yet.',
    ...over,
  };
}

console.log('\n=== the closed type list ===');
{
  // Every choice the form offers must be a value Postgres will accept. One that
  // is not would surface as a 502 on a support form - the worst place to fail.
  const unbacked = ENQUIRY_TYPE_CHOICES.filter((c) => !ENQUIRY_TYPES.includes(c.value));
  eq('every offered type exists in the database CHECK list', unbacked, []);

  // 'other' is the safety value a human assigns later, not a form option.
  ok(
    "'other' is in the DB list but not offered on the form",
    ENQUIRY_TYPES.includes('other') &&
      !ENQUIRY_TYPE_CHOICES.some((c) => c.value === 'other')
  );

  const rejected = normaliseEnquiry(validBody({ enquiryType: 'FREE TEXT ATTACK' }));
  ok('an unknown type is refused, not defaulted', rejected.ok === false);
  if (!rejected.ok) {
    ok('  and the refusal names the field', rejected.errors.enquiryType !== undefined);
  }

  // A body carrying an object where a string belongs must not throw.
  ok('a non-string type does not throw', normaliseEnquiry(validBody({ enquiryType: { a: 1 } })).ok === false);
  ok('a missing type does not throw', normaliseEnquiry(validBody({ enquiryType: undefined })).ok === false);
  ok('isEnquiryType agrees with the list', ENQUIRY_TYPES.every(isEnquiryType) && !isEnquiryType('OTHER'));
}

console.log('\n=== normalisation ===');
{
  const r = normaliseEnquiry(validBody());
  ok('a good submission passes', r.ok === true);
  if (r.ok) {
    // Lower-casing happens here, not only in citext, so a reply address that
    // looks valid but cannot receive mail never enters the table.
    eq('email is lower-cased', r.value.contact.email, 'alex@example.com');
    eq('name whitespace is collapsed', r.value.contact.fullName, 'Alex Parent');
    eq('an empty phone becomes null, not an empty string', r.value.contact.phone, null);
    eq('surrounding whitespace is trimmed', r.value.contact.messageBody.startsWith('The refund'), true);
  }

  // The one assertion that matters for a paragraph: \n\n must survive, because
  // the alternative is a triage queue of unreadable walls of text.
  const para = normaliseEnquiry(validBody({ message: 'First line.\n\nSecond paragraph.\nThird line.' }));
  if (para.ok) {
    eq('paragraph breaks survive normalisation', para.value.contact.messageBody, 'First line.\n\nSecond paragraph.\nThird line.');
  } else {
    ok('paragraph breaks survive normalisation', false, 'a valid multi-paragraph message was refused');
  }

  const short = normaliseEnquiry(validBody({ message: 'too short' }));
  ok('a message under the minimum is refused', short.ok === false);

  const long = normaliseEnquiry(validBody({ message: 'x'.repeat(ENQUIRY_LIMITS.messageMax + 5000) }));
  ok('an oversized message is truncated rather than rejected', long.ok === true);
  if (long.ok) {
    eq('  to exactly the cap', long.value.contact.messageBody.length, ENQUIRY_LIMITS.messageMax);
  }

  // Control characters are a rendering hazard for whoever opens the triage queue.
  const ctrl = normaliseEnquiry(validBody({ message: 'abc\x00def\x1bghi  and more than twenty chars' }));
  if (ctrl.ok) {
    ok('control characters are stripped from the body', !/[\x00-\x08\x1B]/.test(ctrl.value.contact.messageBody));
  } else {
    ok('control characters are stripped from the body', false, 'submission was unexpectedly refused');
  }

  const badEmail = normaliseEnquiry(validBody({ email: 'not-an-email' }));
  ok('a malformed email is refused', badEmail.ok === false);

  // Collects every problem at once rather than making someone fix them one by one.
  const allBad = normaliseEnquiry({ enquiryType: 'nope', fullName: 'A', email: 'x', message: 'short' });
  if (!allBad.ok) {
    eq('all four fields report together', Object.keys(allBad.errors).sort(), [
      'email',
      'enquiryType',
      'fullName',
      'message',
    ]);
  } else {
    ok('all four fields report together', false);
  }
}

console.log('\n=== honeypot ===');
{
  ok('an absent honeypot field is not a hit', !isHoneypotFilled(validBody()));
  ok('an empty honeypot is not a hit', !isHoneypotFilled(validBody({ [HONEYPOT_FIELD]: '' })));
  ok('a whitespace-only honeypot is not a hit', !isHoneypotFilled(validBody({ [HONEYPOT_FIELD]: '   ' })));
  ok('a filled honeypot is a hit', isHoneypotFilled(validBody({ [HONEYPOT_FIELD]: 'http://spam' })));
  // A non-string is a crafted payload, and treating it as "left blank" would
  // hand a bot a way round the field.
  ok('a non-string honeypot is treated as filled', isHoneypotFilled(validBody({ [HONEYPOT_FIELD]: ['a'] })));

  // The name a human would actually type must not be the trap: if it were, every
  // real submission would be discarded and the channel would be silently dead.
  ok('the honeypot name is not a real form field', ![
    'enquiryType', 'fullName', 'email', 'phone', 'message', 'formToken', 'utm',
  ].includes(HONEYPOT_FIELD));
}

console.log('\n=== the ingest_enquiry contract ===');
{
  const r = normaliseEnquiry(validBody({ phone: '+61 3 5550 1234' }));
  if (r.ok) {
    // ingest_enquiry() reads exactly these four keys. A rename here would
    // otherwise write a contact row of four NULLs: an enquiry nobody can answer.
    eq('contact jsonb carries exactly the keys the SQL reads',
      Object.keys(contactJsonb(r.value.contact)).sort(),
      ['email', 'fullName', 'messageBody', 'phone']);
    eq('phone survives the contract', contactJsonb(r.value.contact).phone, '+61 3 5550 1234');
  } else {
    ok('contact jsonb carries exactly the keys the SQL reads', false, 'valid submission refused');
  }

  eq('no utm becomes null, not an empty object', utmJsonb(null), null);
  eq('an empty utm object becomes null', utmJsonb({}), null);
  eq('a populated utm passes through', utmJsonb({ source: 'google' }), { source: 'google' });
}

console.log('\n=== signed form token ===');
{
  const SECRET = 'test-secret-not-a-real-pepper';
  const T0 = 1_700_000_000_000;
  const reason = (t: unknown, at: number) => {
    const r = verifyFormToken(t, SECRET, { nowMs: at });
    return r.ok ? 'accepted' : r.reason;
  };

  // Minted at T0 rather than "now", so every age below is arithmetic instead of
  // a race against the wall clock. A test that cannot pin the clock cannot pin
  // the expectation.
  const { token, nonce } = issueFormToken(SECRET, T0);

  eq('a token issued and waited out verifies', reason(token, T0 + TOKEN_MIN_AGE_MS + 1000), 'accepted');
  const good = verifyFormToken(token, SECRET, { nowMs: T0 + TOKEN_MIN_AGE_MS + 1000 });
  if (good.ok) eq('  and returns the same nonce', good.nonce, nonce);

  // Exactly at the boundary: min-age is inclusive-of-pass, so one ms short fails.
  eq('the minimum interval boundary refuses by 1ms', reason(token, T0 + TOKEN_MIN_AGE_MS - 1), 'too_fast');
  eq('the minimum interval boundary accepts at exactly N', reason(token, T0 + TOKEN_MIN_AGE_MS), 'accepted');

  // The whole point of signing: the timestamp is not the client's to choose.
  eq('a tampered timestamp is refused', reason(`${nonce}.${T0 + 900_000_000_000}.deadbeef`, T0 + 5000), 'unsigned');
  eq('a token from another secret does not verify', reason(issueFormToken('other-secret', T0).token, T0 + 5000), 'unsigned');
  eq('a truncated signature is refused', reason(token.slice(0, -4), T0 + 5000), 'unsigned');

  // Sub-second submission: exactly the shape of a scripted POST.
  eq('a too-fast submission is refused', reason(token, T0 + 100), 'too_fast');

  // An expired token reports as expired, never as "you went too fast" - the two
  // need different wording in a log, and only one of them is normal.
  eq('an expired token is refused', reason(token, T0 + TOKEN_MAX_AGE_MS + 60_000), 'too_old');

  // A future-dated token can only arrive through clock skew between instances
  // (it is signed, so a client cannot forge it). The negative age falls into the
  // too_fast branch: refused, which is the safe direction. Pinned here so a
  // future refactor that reorders the two checks has to say so deliberately.
  eq('a future-dated token is refused rather than accepted', reason(token, T0 - 60_000), 'too_fast');

  // Every malformed shape must be a clean refusal rather than a throw: a throw
  // here would surface as a 500 on a form a browser could have sent anything to.
  const malformed = [undefined, null, 42, '', 'no-dot', '.123', 'zz.123.sig', `${nonce}.NaN.sig`]
    .map((bad) => reason(bad, T0 + 5000))
    .filter((r) => r !== 'malformed');
  eq('all malformed inputs are refused as malformed', malformed, []);
}

console.log('\n=== ip fingerprint ===');
{
  const SECRET = 'test-secret-not-a-real-pepper';
  const pepper = ipPepper(SECRET);
  eq('the pepper is 64 hex characters', /^[0-9a-f]{64}$/.test(pepper), true);

  // Domain separation: the pepper must not be reusable as, or derivable from, a
  // token signature key by accident of sharing one environment variable.
  const headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' });
  const ip = clientIpFrom(headers);
  eq('the leftmost forwarded address is taken', ip, '203.0.113.7');
  eq('x-real-ip resolves a bare address', clientIpFrom(new Headers({ 'x-real-ip': '198.51.100.4' })), '198.51.100.4');
  // x-real-ip is a single value, so it cannot disagree with a chain the way a
  // leftmost-entry rule can. Precedence is pinned so a refactor that reorders
  // the two lookups has to say so in a failing test first.
  eq(
    'x-real-ip wins over x-forwarded-for when both are present',
    clientIpFrom(new Headers({ 'x-real-ip': '198.51.100.4', 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })),
    '198.51.100.4'
  );
  eq('clientIpFrom returns null with no header', clientIpFrom(new Headers()), null);
  eq('a blank x-real-ip falls through to the chain', clientIpFrom(new Headers({ 'x-real-ip': '  ', 'x-forwarded-for': '203.0.113.9' })), '203.0.113.9');

  const fp = fingerprintIp(ip, pepper);
  ok('the fingerprint is 64 hex, the shape the CHECK constraint requires',
    fp !== null && /^[0-9a-f]{64}$/.test(fp));
  eq('the same address hashes the same way', fingerprintIp('203.0.113.7', pepper), fp);
  ok('a different address hashes differently', fingerprintIp('203.0.113.8', pepper) !== fp);
  // The raw address must not appear in the stored value in any obvious form.
  ok('the raw address is not recoverable from the fingerprint', !String(fp).includes('203.0.113.7'));

  // Unresolvable addresses get NO fingerprint rather than a shared bucket: one
  // proxy would otherwise spend the allowance of every visitor behind it.
  eq('a null address yields no fingerprint', fingerprintIp(null, pepper), null);
  eq('a blank address yields no fingerprint', fingerprintIp('   ', pepper), null);
}

console.log(`\n${'-'.repeat(58)}`);
console.log(`PASSED: ${pass}   FAILED: ${fail}`);
console.log(`${'-'.repeat(58)}\n`);
if (fail > 0) process.exit(1);


