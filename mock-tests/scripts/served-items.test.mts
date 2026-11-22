/**
 * Served-item ledger tests (migration 122's client half).
 *
 * WHY THESE ASSERTIONS
 *   The ledger decides whether exposure data is complete, and every way it can
 *   fail is silent: re-reporting an id inflates `served` and drags A1's skip rate
 *   toward zero; dropping a failed batch makes a viewed item look unserved and
 *   restores the exact gap 122 exists to close; overwriting `pending` on a new
 *   navigation discards everything not yet accepted.
 *
 *   None of those produce an error, a warning or a type failure. They produce a
 *   plausible report.
 *
 * Run with:
 *   npm run test:served
 *
 * Dependency-free, matching scripts/expansion.test.mts.
 */
import {
  createServedLedger,
  markServedSent,
  noteServed,
  pendingServed,
  servedCount,
} from '@/lib/runner/served';

let pass = 0;
let fail = 0;
const eq = (label: string, actual: unknown, expected: unknown) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + '\n          actual   ' + a + '\n          expected ' + e); }
};

const q = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

console.log('\n=== a fresh ledger has nothing to send ===');
{
  const l = createServedLedger();
  eq('nothing pending', pendingServed(l), []);
  eq('nothing seen', servedCount(l), 0);
  // A flush on an empty ledger must not POST an empty body: the route rejects it
  // with a 400 and the runner would log a sync error for a non-event.
  markServedSent(l, []);
  eq('marking an empty batch sent is a no-op', pendingServed(l), []);
}

console.log('\n=== viewing an item queues it exactly once ===');
{
  const l = createServedLedger();
  noteServed(l, q(1));
  eq('one pending', pendingServed(l), [q(1)]);
  noteServed(l, q(1));
  eq('viewing it again does not duplicate it', pendingServed(l), [q(1)]);
  eq('seen counts distinct ids only', servedCount(l), 1);

  noteServed(l, [q(2), q(3)]);
  eq('an array is appended in order', pendingServed(l), [q(1), q(2), q(3)]);
  eq('an array with a repeated id de-duplicates', (() => {
    noteServed(l, [q(3), q(4), q(4)]);
    return pendingServed(l);
  })(), [q(1), q(2), q(3), q(4)]);
}

console.log('\n=== only what the server accepted leaves the queue ===');
{
  const l = createServedLedger();
  noteServed(l, [q(1), q(2)]);
  markServedSent(l, [q(1)]);
  eq('the sent id is cleared, the other stays', pendingServed(l), [q(2)]);

  // A navigation arrives while that request is in flight.
  noteServed(l, q(3));
  eq('an id noted mid-flight joins the queue', pendingServed(l), [q(2), q(3)]);

  markServedSent(l, [q(2), q(3)]);
  eq('an empty queue after a full accept', pendingServed(l), []);
  eq('seen is not reset by sending', servedCount(l), 3);

  noteServed(l, q(1));
  eq('a re-visit of a REPORTED id is not re-sent', pendingServed(l), []);
}

console.log('\n=== a failed batch is retried, never dropped ===');
{
  const l = createServedLedger();
  noteServed(l, [q(1), q(2)]);
  // The POST failed, so markServedSent is never called - the batch must survive.
  const retry = pendingServed(l);
  eq('the failed batch is still pending', retry, [q(1), q(2)]);

  noteServed(l, q(3));
  eq('a later navigation adds to the same retry batch', pendingServed(l), [q(1), q(2), q(3)]);

  markServedSent(l, pendingServed(l).slice());
  eq('the retry eventually drains', pendingServed(l), []);
}

console.log('\n=== junk input cannot poison the ledger ===');
{
  const l = createServedLedger();
  noteServed(l, null);
  noteServed(l, undefined);
  noteServed(l, '');
  noteServed(l, []);
  eq('empty and nullish input is ignored', pendingServed(l), []);
  eq('nothing marked seen', servedCount(l), 0);
}

console.log(`\n${'-'.repeat(58)}`);
console.log(`PASSED: ${pass}   FAILED: ${fail}`);
console.log(`${'-'.repeat(58)}\n`);
if (fail > 0) process.exit(1);
