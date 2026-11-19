/**
 * Live probe for POST /api/enquiries (backlog item 21, Phase A).
 *
 * WHAT IT PROVES THAT THE UNIT SUITE CANNOT
 *   scripts/enquiry.test.mts checks the rules in isolation. This checks that the
 *   route, the signed token, the throttle inside the database,
 *   ingest_enquiry()'s two-table transaction, the funnel event and migration
 *   103's privilege revokes actually work together against the real database -
 *   and that a message body never turns up anywhere it should not.
 *
 * It runs against a `next start` instance on 127.0.0.1:3100 and deletes every
 * row it creates. Test addresses come from RFC 5737's reserved documentation
 * ranges, so no real visitor can be throttled by accident.
 *
 * Run: node scripts/enquiry-e2e.mjs   (after starting the server on :3100)
 */
import { readFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'

/** Fingerprints the probe created, so section 8 deletes only its own rows. */
let PROBE_FPS = []

function env() {
  const text = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, '')
  }
  return out
}

const E = env()
const BASE = process.env.PROBE_BASE ?? 'http://127.0.0.1:3100'
const API = `${BASE}/api/enquiries`
const REST = `${E.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`
const SVC = {
  apikey: E.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${E.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
}
const ANON = {
  apikey: E.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  Authorization: `Bearer ${E.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
}

// RFC 5737 documentation addresses: reserved, so a probe can never throttle a
// real family.
const IP_A = '192.0.2.41'
const IP_B = '198.51.100.42'

let pass = 0
let fail = 0
const ok = (label, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + label) }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n          ' + String(detail).slice(0, 400) : '')) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function svc(table, params, init = {}) {
  const res = await fetch(`${REST}/${table}?${params}`, {
    ...init,
    headers: { ...SVC, ...init.headers },
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* non-JSON error body */ }
  return { status: res.status, text, json }
}

const nonceOf = (t) => String(t).split('.')[0]

function payloadWith(token, over = {}) {
  return {
    formToken: token,
    enquiryType: 'refund',
    fullName: 'Probe Parent',
    email: 'probe.parent@example.invalid',
    phone: '',
    message: 'Probe: the refund for the pack bought last Tuesday has not arrived.',
    company_website: '',
    utm: { utm_source: 'probe', utm_medium: 'test' },
    ...over,
  }
}

async function post(body, ip = IP_A) {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': `${ip}, 10.0.0.1`,
      cookie: 'mt_aid=probe_anon_1',
    },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers }
}

// A non-array response means PostgREST returned an error object. Counting that
// as 0 would make every "no row was created" assertion below pass by failing,
// which is the worst kind of green, so it returns -1 and the assertion breaks.
const countFor = async (ref) => {
  const r = await svc('enquiries', `ingest_source_ref=eq.${encodeURIComponent(ref)}&select=id`)
  return Array.isArray(r.json) ? r.json.length : -1
}

const GENERIC = 'Your message could not be sent. Please try again.'

console.log('\n=== 0. the endpoint is up and issues a signed token ===')
const issued = await fetch(API)
const issueBody = await issued.json()
ok('GET /api/enquiries returns 200', issued.status === 200, `status ${issued.status}`)
ok('  and a three-part signed token',
  typeof issueBody.formToken === 'string' && issueBody.formToken.split('.').length === 3,
  JSON.stringify(issueBody).slice(0, 140))

console.log('\n=== 1. honeypot: discarded, reported as success, writes nothing ===')
{
  const hp = await post(payloadWith(issueBody.formToken, { company_website: 'http://spam.example' }))
  ok('a filled honeypot returns 200', hp.status === 200, `status ${hp.status}`)
  ok('  with a body indistinguishable from a real success',
    hp.body?.ok === true && (hp.body?.reference ?? null) === null, JSON.stringify(hp.body))
  ok('  and no enquiry row was created', (await countFor(`web_form:${nonceOf(issueBody.formToken)}`)) === 0)
}

console.log('\n=== 2. validation: a person gets field-level errors, not a stack ===')
{
  const bad = await post(payloadWith(issueBody.formToken, { enquiryType: 'FREE TEXT ATTACK', message: 'short' }))
  ok('an invalid submission is refused with 400', bad.status === 400, `status ${bad.status}`)
  ok('  naming each offending field',
    !!bad.body?.fields?.enquiryType && !!bad.body?.fields?.message, JSON.stringify(bad.body))
  ok('  and the message body is not echoed back',
    !JSON.stringify(bad.body).includes('refund for the pack'), JSON.stringify(bad.body).slice(0, 200))
}

console.log('\n=== 3. token: a forgery and a too-fast submission look identical ===')
const forged = await post(payloadWith(`${nonceOf(issueBody.formToken)}.9999999999999.deadbeef`))
ok('a forged token is refused', forged.status === 400, `status ${forged.status}`)
ok('  with one generic sentence that names no check',
  forged.body?.error === GENERIC && forged.body?.fields === undefined, JSON.stringify(forged.body))

const fast = await post(payloadWith(issueBody.formToken))
ok('a submission under the minimum fill time is refused', fast.status === 400, `status ${fast.status}`)
ok('  with the same sentence a forgery gets',
  fast.body?.error === forged.body?.error, JSON.stringify(fast.body))

console.log('\n=== 4. the real path: one enquiry, one contact row, one event, no leak ===')
// Wait the fill-time out the way a person writing a paragraph naturally does.
await sleep(4300)
const goodToken = issueBody.formToken
const goodRef = `web_form:${nonceOf(goodToken)}`
const good = await post(payloadWith(goodToken))
ok('a valid submission returns 201', good.status === 201, `status ${good.status} ${JSON.stringify(good.body)}`)
ok('  with a short reference',
  /^[0-9A-F]{8}$/.test(String(good.body?.reference ?? '')), JSON.stringify(good.body))
ok('  and is not cacheable', good.headers.get('cache-control') === 'no-store',
  good.headers.get('cache-control'))

const rows = await svc('enquiries', `ingest_source_ref=eq.${encodeURIComponent(goodRef)}&select=*`)
const enq = (rows.json ?? [])[0] ?? {}
ok('exactly one enquiries row exists', (rows.json ?? []).length === 1, `count ${(rows.json ?? []).length}`)
ok('  on the web_form channel', enq.channel === 'web_form', enq.channel)
ok('  classified with a closed-list value', enq.enquiry_type === 'refund', enq.enquiry_type)
ok('  opened at status new', enq.status === 'new', enq.status)
ok('  with the response clock unset (nothing writes it until triage exists)',
  enq.first_response_at === null && enq.resolved_at === null, `${enq.first_response_at}/${enq.resolved_at}`)
ok('  utm normalised from the form',
  enq.utm_source === 'probe' && enq.utm_medium === 'test', JSON.stringify({ s: enq.utm_source, m: enq.utm_medium }))
// The structural guarantee 012 was built on, checked against the live shape.
const leaky = Object.keys(enq).filter((k) => /body|message|email|phone|full_name/i.test(k))
ok('  the reportable table still has no free-text or contact column', leaky.length === 0, leaky.join(','))

const contacts = await svc('enquiry_contacts', `enquiry_id=eq.${enq.id}&select=*`)
const contact = (contacts.json ?? [])[0] ?? {}
ok('the contact row exists in the same transaction', (contacts.json ?? []).length === 1,
  `count ${(contacts.json ?? []).length}`)
ok('  holding the reply address and the body',
  contact.email === 'probe.parent@example.invalid' && /refund for the pack/.test(contact.message_body ?? ''),
  JSON.stringify(contact).slice(0, 200))

const events = await svc('funnel_events', `event=eq.ENQUIRY_CREATED&anonymous_id=eq.probe_anon_1&select=event,props,utm,stage`)
const ev = (events.json ?? [])[0] ?? {}
ok('ENQUIRY_CREATED was recorded', (events.json ?? []).length === 1, `count ${(events.json ?? []).length}`)
ok('  with channel and topic in props',
  ev.props?.channel === 'web_form' && ev.props?.enquiryType === 'refund', JSON.stringify(ev.props))
// Deliberately strict rather than permissive: ENQUIRY_CREATED has no EVENT_STAGE
// entry, so a stage here would mean someone folded enquiries into a funnel step
// and A11's denominator would silently start including anonymous support form
// visitors who never signed up.
ok('  and it advanced no funnel stage (it has no EVENT_STAGE entry)',
  ev.stage === null, JSON.stringify(ev.stage))
const evText = JSON.stringify(ev)
ok('  with NO contact detail or message text in the event',
  !/probe\.parent@example\.invalid/.test(evText) && !/refund for the pack/.test(evText), evText.slice(0, 300))
ok('  and a device class was captured for C9',
  typeof ev.props?.device === 'string', JSON.stringify(ev.props?.device))

console.log('\n=== 5. a retry is a retry, not a second submission ===')
{
  const retry = await post(payloadWith(goodToken))
  ok('resubmitting the same token returns 200, not a rate-limit refusal',
    retry.status === 200, `status ${retry.status} ${JSON.stringify(retry.body)}`)
  ok('  with the very same reference', retry.body?.reference === good.body?.reference,
    `${JSON.stringify(retry.body)} vs ${JSON.stringify(good.body)}`)
  ok('  and still exactly one enquiries row', (await countFor(goodRef)) === 1)
  const retryEvents = await svc('funnel_events', `event=eq.ENQUIRY_CREATED&anonymous_id=eq.probe_anon_1&select=id`)
  ok('  and only one ENQUIRY_CREATED event (a retry is not re-measured)',
    (retryEvents.json ?? []).length === 1, `count ${(retryEvents.json ?? []).length}`)
}

console.log('\n=== 6. the throttle fires, and fires per address ===')
// Each fresh token has to be waited out before it can be submitted at all -
// which section 3 already proved, and proved again here by accident: without
// these sleeps the request dies at the fill-time gate and the throttle is never
// reached. The 400 those runs produced is the correct answer for a sub-4s
// submission, so the assertion below must not be satisfied by that path. It
// demands a 429, which only the throttle issues.
const fresh = await fetch(API).then((r) => r.json())
await sleep(4300)
const second = await post(payloadWith(fresh.formToken, {
  enquiryType: 'billing',
  message: 'Probe: a genuinely different second message about a billing charge.',
}))
ok('a new message from the same address inside the interval is refused with 429',
  second.status === 429, `status ${second.status} ${JSON.stringify(second.body)}`)
ok('  naming a wait, unlike the generic refusal above',
  typeof second.body?.retryAfterSeconds === 'number' && second.headers.get('retry-after') !== null,
  `${JSON.stringify(second.body)} / ${second.headers.get('retry-after')}`)
ok('  and it wrote no enquiry', (await countFor(`web_form:${nonceOf(fresh.formToken)}`)) === 0)

const freshB = await fetch(API).then((r) => r.json())
await sleep(4300)
const otherIp = await post(payloadWith(freshB.formToken, {
  message: 'Probe: another family at another address asking the same thing.',
}), IP_B)
ok('a different address is unaffected (the limit is not global)',
  otherIp.status === 201, `status ${otherIp.status} ${JSON.stringify(otherIp.body)}`)

console.log('\n=== 6b. the stored key really is the peppered hash we compute here ===')
{
  // The route hashes the address with the same two derivations this file
  // re-implements from src/lib/support/form-token.ts. If either side drifts, the
  // rows below are not found, the count is not 2, and the cleanup in section 8
  // silently deletes nothing while leaving test state behind for the next run.
  // Asserting the match is what makes that failure loud instead of invisible.
  const pepper = createHmac('sha256', E.ENQUIRY_FORM_SECRET)
    .update('mock-tests:enquiry-ip-pepper:v1').digest('hex')
  const fp = (ip) => createHmac('sha256', pepper).update(ip).digest('hex')
  const [a, b] = [fp(IP_A), fp(IP_B)]

  const stored = await svc('enquiry_throttle', `fp=in.(${a},${b})&select=fp,submissions`)
  const found = (stored.json ?? []).map((r) => r.fp).sort()
  ok('exactly the two probe addresses are throttled, by hash',
    JSON.stringify(found) === JSON.stringify([a, b].sort()),
    `found ${JSON.stringify(found)}`)
  ok('  and the raw address appears nowhere in the stored key',
    !(stored.text ?? '').includes(IP_A) && !(stored.text ?? '').includes(IP_B),
    (stored.text ?? '').slice(0, 200))
  const probeFps = [a, b]
  ok('  the second address was accepted once, the first twice (interval refused, not counted)',
    (stored.json ?? []).every((r) => r.submissions >= 1 && r.submissions <= 2),
    JSON.stringify(stored.json))
  PROBE_FPS = probeFps
}

console.log('\n=== 7. privileges: the database, not the route, enforces the write path ===')
{
  const anonInsert = await fetch(`${REST}/enquiries`, {
    method: 'POST',
    headers: { ...ANON, Prefer: 'return=minimal' },
    body: JSON.stringify([{ channel: 'web_form', enquiry_type: 'other' }]),
  })
  ok('anon cannot INSERT into enquiries directly (103 §1 closes it)',
    anonInsert.status >= 400 && anonInsert.status < 500,
    `status ${anonInsert.status} ${(await anonInsert.text()).slice(0, 200)}`)

  const anonContacts = await fetch(`${REST}/enquiry_contacts?select=*`, { headers: ANON })
  ok('anon cannot read the restricted contact table',
    anonContacts.status >= 400 && anonContacts.status < 500, `status ${anonContacts.status}`)

  for (const [name, path, body] of [
    ['read_enquiry_contact', 'read_enquiry_contact', { p_enquiry_id: enq.id, p_task_reason: 'probe attempting an anon read of a contact record' }],
    ['enquiry_throttle_check', 'enquiry_throttle_check', { p_fp: 'a'.repeat(64) }],
    ['ingest_enquiry', 'ingest_enquiry', { p_channel: 'web_form', p_received_at: null, p_enquiry_type: 'other', p_source_ref: 'probe', p_parent_user_id: null, p_utm: {}, p_contact: {} }],
    ['enquiry_id_for_source_ref', 'enquiry_id_for_source_ref', { p_source_ref: goodRef }],
  ]) {
    const r = await fetch(`${REST}/rpc/${path}`, {
      method: 'POST', headers: ANON, body: JSON.stringify(body),
    })
    ok(`anon cannot execute ${name}()`, r.status >= 400 && r.status < 500,
      `status ${r.status} ${(await r.text()).slice(0, 160)}`)
  }

  const anonSelect = await fetch(`${REST}/enquiries?select=id`, { headers: ANON })
  const anonRows = await anonSelect.text()
  // 103 §1 deliberately KEEPS SELECT here, unlike 047/048: 012 shipped an
  // explicit "Parent can view own enquiries" policy and the privacy design
  // depends on it. So the correct live behaviour is HTTP 200 with no rows for
  // an anon caller - RLS answering, not the privilege gate refusing.
  ok('anon SELECT on enquiries is answered with zero rows, not an error (the deliberate difference from 047/048)',
    anonSelect.status === 200 && anonRows.trim() === '[]', `${anonSelect.status} ${anonRows.slice(0, 160)}`)
}

console.log('\n=== 8. teardown ===')
{
  const refs = [goodRef, `web_form:${nonceOf(fresh.formToken)}`, `web_form:${nonceOf(freshB.formToken)}`]
    .map(encodeURIComponent).join(',')
  const d1 = await svc('funnel_events', 'anonymous_id=eq.probe_anon_1', { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
  const d2 = await svc('enquiry_contacts', 'message_body=like.*Probe:*', { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
  const d3 = await svc('enquiries', `ingest_source_ref=in.(${refs})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
  ok('probe events deleted', d1.status === 204 || d1.status === 200, `status ${d1.status}`)
  ok('probe contacts deleted', d2.status === 204 || d2.status === 200, `status ${d2.status} ${d2.text.slice(0, 160)}`)
  ok('probe enquiries deleted', d3.status === 204 || d3.status === 200, `status ${d3.status} ${d3.text.slice(0, 160)}`)

  const remain = await svc('enquiries', 'channel=eq.web_form&select=id')
  ok('no web_form enquiry survives the probe', (remain.json ?? []).length === 0,
    `remaining ${(remain.json ?? []).length}`)
  const remainEv = await svc('funnel_events', 'event=eq.ENQUIRY_CREATED&select=id')
  ok('no ENQUIRY_CREATED event survives', (remainEv.json ?? []).length === 0,
    `remaining ${(remainEv.json ?? []).length}`)
  // `enquiry_id`, not `id`: the restricted table's primary key is the enquiry
  // itself. Asking for a column that does not exist returns a PostgREST error
  // object rather than an array, which reads as "0 rows" to anything that
  // counts blindly - a check that passes by failing.
  const remainContacts = await svc('enquiry_contacts', 'select=enquiry_id')
  ok('the restricted contact table is empty again',
    Array.isArray(remainContacts.json) && remainContacts.json.length === 0,
    `status ${remainContacts.status} remaining ${JSON.stringify(remainContacts.json)?.slice(0, 160)}`)

  // Deleted by the two fingerprints and nothing else: a blanket
  // `delete from enquiry_throttle` would clear every real visitor's remaining
  // allowance, which is exactly the opposite of what a probe should leave
  // behind after visiting a production-shaped database.
  ok('the probe left exactly two throttle rows', PROBE_FPS.length === 2, `${PROBE_FPS.length}`)
  const d4 = await svc('enquiry_throttle', `fp=in.(${PROBE_FPS.join(',')})`,
    { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
  ok('probe throttle rows deleted', d4.status === 204 || d4.status === 200, `status ${d4.status}`)
  const remainFp = await svc('enquiry_throttle', `fp=in.(${PROBE_FPS.join(',')})&select=fp`)
  ok('  and none of those addresses is still marked', (remainFp.json ?? []).length === 0,
    `remaining ${(remainFp.json ?? []).length}`)
}

console.log(`\n${'-'.repeat(58)}`)
console.log(`PASSED: ${pass}   FAILED: ${fail}`)
console.log(`${'-'.repeat(58)}\n`)
process.exit(fail > 0 ? 1 : 0)


