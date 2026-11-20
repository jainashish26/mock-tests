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
import {
  SLA_META,
  SLA_META_UNKNOWN,
} from '@/lib/support/enquiry-labels';
import type { EnquiryStatus } from '@/lib/support/triage';

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

console.log('\n=== the triage state machine mirrors the SQL guards ===');
{
  const {
    ENQUIRY_STATUSES,
    ENQUIRY_ACTIONS,
    ENQUIRY_OUTCOMES,
    ACTION_TARGET,
    CONVERT_KINDS,
    allowedActions,
    actionNeedsConversion,
    conversionError,
    responseKnowledge,
    actionNeedsOutcome,
    isDone,
    slaCaveat,
    SLA_STATES,
    taskReasonError,
    describeAge,
  } = await import('@/lib/support/triage');

  // Hand-written expectations: the whole point of this block is that the TS
  // must not be allowed to grade its own homework. Each case names the
  // admin_enquiry_transition guard it mirrors.
  const cases: Array<{
    label: string
    row: {
      status: EnquiryStatus
      first_response_at: string | null
      resolved_at: string | null
      converted?: boolean
    }
    expect: string[]
  }> = [
    { label: 'brand new enquiry', row: { status: 'new', first_response_at: null, resolved_at: null },
      expect: ['assign', 'reply', 'triage', 'start', 'resolve', 'close', 'spam', 'convert'] },
    { label: 'triaged, unanswered', row: { status: 'triaged', first_response_at: null, resolved_at: null },
      expect: ['assign', 'reply', 'start', 'resolve', 'close', 'spam', 'convert'] },
    { label: 'in progress, still unanswered', row: { status: 'in_progress', first_response_at: null, resolved_at: null },
      expect: ['assign', 'reply', 'resolve', 'close', 'spam', 'convert'] },
    // The reply button disappears the moment a first response exists, because
    // the SQL raises 22023 on a second one.
    { label: 'waiting on the family (already replied)', row: { status: 'waiting_on_customer', first_response_at: '2026-01-01T00:00:00Z', resolved_at: null },
      expect: ['assign', 'start', 'resolve', 'close', 'spam', 'convert'] },
    // Conversion survives resolution on purpose: a family frequently subscribes
    // days after the conversation ends, and the SQL only refuses spam rows.
    { label: 'resolved', row: { status: 'resolved', first_response_at: '2026-01-01T00:00:00Z', resolved_at: '2026-01-02T00:00:00Z' },
      expect: ['assign', 'reopen', 'convert'] },
    // Closing is what makes the reply guard bite: the SQL refuses a reply after
    // closure rather than back-filling a response time nobody saw.
    { label: 'closed with no reply on record', row: { status: 'closed', first_response_at: null, resolved_at: '2026-01-02T00:00:00Z' },
      expect: ['assign', 'reopen', 'convert'] },
    // No 'convert' here. This is the mirror of 110's refusal to record a
    // conversion against spam - the metric must not be fed by the queue's rubbish.
    { label: 'spam', row: { status: 'spam', first_response_at: null, resolved_at: '2026-01-02T00:00:00Z' },
      expect: ['assign', 'reopen'] },
    // A row that already converted offers withdrawal, never a second conversion.
    { label: 'already converted', row: { status: 'in_progress', first_response_at: null, resolved_at: null, converted: true },
      expect: ['assign', 'reply', 'resolve', 'close', 'spam', 'unconvert'] },
    { label: 'resolved and converted', row: { status: 'resolved', first_response_at: '2026-01-01T00:00:00Z', resolved_at: '2026-01-02T00:00:00Z', converted: true },
      expect: ['assign', 'reopen', 'unconvert'] },
  ];

  for (const c of cases) {
    eq(`allowedActions: ${c.label}`, allowedActions(c.row).slice().sort(), c.expect.slice().sort());
    ok(`allowedActions never offers reply on a finished enquiry: ${c.label}`,
      isDone(c.row.status) ? !allowedActions(c.row).includes('reply') : true);
  }

  eq('responseKnowledge: open with no reply', responseKnowledge({ status: 'in_progress', first_response_at: null }), 'open');
  eq('responseKnowledge: reply recorded', responseKnowledge({ status: 'closed', first_response_at: 'x' }), 'recorded');
  // The state that must not be rendered as "met".
  eq('responseKnowledge: finished with no reply is missing, not recorded',
    responseKnowledge({ status: 'resolved', first_response_at: null }), 'missing');

  eq('only resolve and close take an outcome',
    ENQUIRY_ACTIONS.filter(actionNeedsOutcome), ['resolve', 'close']);

  // ACTION_TARGET must agree with the SQL CASE statement, value for value.
  eq('triage -> triaged', ACTION_TARGET.triage, 'triaged');
  eq('reply -> waiting_on_customer', ACTION_TARGET.reply, 'waiting_on_customer');
  eq('resolve -> resolved', ACTION_TARGET.resolve, 'resolved');
  eq('close -> closed', ACTION_TARGET.close, 'closed');
  eq('reopen -> in_progress', ACTION_TARGET.reopen, 'in_progress');
  eq('spam -> spam', ACTION_TARGET.spam, 'spam');
  eq('assign moves nothing', ACTION_TARGET.assign, null);
  eq('start -> in_progress', ACTION_TARGET.start, 'in_progress');
  // Neither conversion action moves the status: the SQL keeps it where it was.
  eq('convert moves nothing', ACTION_TARGET.convert, null);
  eq('unconvert moves nothing', ACTION_TARGET.unconvert, null);

  console.log('\n=== conversion references (110) ===');
  // Only convert asks for a reference. If unconvert ever did, the withdraw
  // button would dead-end an operator trying to undo a mistake.
  eq('only convert takes a conversion reference',
    ENQUIRY_ACTIONS.filter(actionNeedsConversion), ['convert']);
  eq('conversion never needs an outcome',
    ENQUIRY_ACTIONS.filter(actionNeedsOutcome).includes('convert'), false);
  eq('an empty reference is refused', conversionError('', 'subscription') !== null, true);
  eq('a whitespace reference is refused, matching the CHECK that trims',
    conversionError('   ', 'subscription') !== null, true);
  eq('a reference with no kind is refused', conversionError('sub_1', '') !== null, true);
  eq('an unknown kind is refused', conversionError('sub_1', 'merch') !== null, true);
  eq('a valid subscription conversion is accepted',
    conversionError('sub_1Nk000', 'subscription'), null);
  // The exact list the database CHECK allows, and the order the UI renders.
  eq('kinds match the 110 CHECK exactly',
    CONVERT_KINDS.slice().sort(), ['invoice', 'other', 'purchase', 'subscription']);
  // 110 bounds the column at 200 after trimming; the form must refuse the same
  // input rather than round-tripping a 400 the operator cannot act on.
  eq('a 201-character reference is refused',
    conversionError('x'.repeat(201), 'purchase') !== null, true);
  eq('a 200-character reference is accepted',
    conversionError('x'.repeat(200), 'purchase'), null);

  ok('every action has a target and every target is a real status',
    ENQUIRY_ACTIONS.every((a: string) => ACTION_TARGET[a as keyof typeof ACTION_TARGET] === null
      || ENQUIRY_STATUSES.includes(ACTION_TARGET[a as keyof typeof ACTION_TARGET] as never)));
  ok('every outcome is one the database CHECK accepts',
    ENQUIRY_OUTCOMES.every((o: string) => ['answered', 'refunded', 'escalated', 'no_action', 'spam', 'duplicate', 'withdrawn'].includes(o)));

  console.log('\n=== SLA wording and the audit gate ===');
  // An unconfirmed SLA must say so: this is the A-15/Q-5 gap made visible.
  ok('an unconfirmed calendar SLA produces a caveat',
    slaCaveat({ sla_basis: 'calendar', sla_minutes: 1440, sla_business_days: null, sla_is_confirmed: false }) !== null);
  eq('the calendar caveat names the window in hours, not raw minutes',
    slaCaveat({ sla_basis: 'calendar', sla_minutes: 1440, sla_business_days: null, sla_is_confirmed: false })
      ?.includes('24 continuous hours'), true);
  eq('a confirmed SLA stops hedging',
    slaCaveat({ sla_basis: 'business', sla_minutes: null, sla_business_days: 1, sla_is_confirmed: true }), null);

  // 109 / decision 1-B. Under the business basis there is no minute window at
  // all, so the caption must change with it. These are the assertions the old
  // `numeric(sla_minutes, 1440)` default made impossible to write, because that
  // default manufactured a calendar window out of a NULL.
  const biz = slaCaveat({ sla_basis: 'business', sla_minutes: null, sla_business_days: 1, sla_is_confirmed: false }) ?? '';
  ok('the business-day caveat speaks in business days', biz.includes('1 business day'));
  ok('it never claims a continuous-hours window under a day-based clock',
    !biz.includes('continuous hours'));
  ok('a NULL minute count is not turned into "0 continuous hours"',
    !biz.includes('0 continuous hours'));
  eq('the window pluralises when the promise is wider than a day',
    (slaCaveat({ sla_basis: 'business', sla_minutes: null, sla_business_days: 3, sla_is_confirmed: false }) ?? '')
      .includes('3 business days'), true);
  // Q-5 was ANSWERED by 1-B. Repeating that calendar-or-business is unresolved
  // would contradict the recorded decision on the operator's own screen.
  ok('the caveat no longer calls the basis an open question',
    !biz.toLowerCase().includes('open question'));

  console.log('\n=== every SLA state the database can return has a label ===');
  // The card used to fall back to SLA_META.within for an unrecognised state, so
  // adding a state to the SQL without adding it here would have made the queue
  // print "comfortably inside the response window" for a condition it did not
  // understand. Defaulting the unknown to good news is the failure direction
  // these two assertions exist to keep shut.
  for (const s of SLA_STATES) {
    ok(`SLA_META covers '${s}'`, Boolean(SLA_META[s]));
  }
  ok('each state has a chip and a substantive explanation, not a placeholder',
    SLA_STATES.every((s) => {
      const m = SLA_META[s];
      return Boolean(m && m.text && m.tone && typeof m.why === 'string' && m.why.length > 40);
    }));
  ok('unknown_calendar is not worded the same as the reassuring states',
    SLA_META.unknown_calendar.text !== SLA_META.within.text
      && SLA_META.unknown_calendar.text !== SLA_META.met.text);
  ok('the fallback for an unseen state is never the reassuring one',
    SLA_META_UNKNOWN.text !== SLA_META.within.text
      && SLA_META_UNKNOWN.text !== SLA_META.met.text);
  ok('SLA_STATES has no duplicate the labels could disagree about',
    new Set(SLA_STATES).size === SLA_STATES.length);

  // 012's CHECK is length(trim(task_reason)) >= 12; the UI must agree or it
  // sends requests the database will reject.
  eq('blank reason refused', taskReasonError('') !== null, true);
  eq('whitespace-only reason refused', taskReasonError('   ') !== null, true);
  eq('11 characters refused', taskReasonError('a'.repeat(11)) !== null, true);
  eq('exactly 12 characters accepted', taskReasonError('a'.repeat(12)), null);
  eq('padding does not count toward the 12', taskReasonError('   ' + 'a'.repeat(11) + '   ') !== null, true);

  eq('119 minutes reads as just under two hours', describeAge(119), '2.0 h');
  eq('45 minutes reads in minutes', describeAge(45), '45 min');
  eq('49 hours reads in days', describeAge(2940), '2 d');
  eq('null is never silently zero', describeAge(null), 'unknown');
  eq('a negative age is unknown, not a negative duration', describeAge(-5), 'unknown');
}

console.log(`\n${'-'.repeat(58)}`);
console.log(`PASSED: ${pass}   FAILED: ${fail}`);
console.log(`${'-'.repeat(58)}\n`);
if (fail > 0) process.exit(1);


