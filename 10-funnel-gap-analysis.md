# Free-to-Paid Funnel — Gap Analysis & Implementation

**Panel:** behavioural economics · financial UX research · conversion rate optimisation · digital marketing · frontend/backend engineering · QA
**Scope:** the 10-step funnel specification, audited against the codebase in `mock-tests/`
**Status:** conversion layer implemented; residual work listed in §5

---

## 1. Executive summary

The product team had built two excellent things and left a gap between them.

**What was already strong:**

- **Acquisition surface.** `src/app/llms.txt/route.ts`, JSON-LD schema, `sitemap.ts`, `robots.ts` and a 30+ article blog citing primary sources. This is a genuinely well-executed GEO/AEO setup — better than most EdTech competitors — and it directly serves funnel step 1 (AI search and SEO by exam and year).
- **Product surface.** Server-side adaptive engine, async AI writing marking via QStash + DeepSeek, an exam-realistic runner with resume-safe timers, and content gating enforced in Postgres through `can_access_published_test()` (7 access branches, `010_subscriptions.sql`).
- **Payments plumbing.** Stripe Checkout for one-time and subscription modes, signature-verified webhooks with claim-before-work idempotency, refund-driven entitlement revocation, a `subscriptions` table mirrored from Stripe, and a billing portal route.

**What was missing:** everything between them. The specification describes ten steps; **six had no implementation at all**, and the two primitives that eight of the ten depend on — **event instrumentation** and **lifecycle email** — did not exist anywhere in the codebase.

The single most consequential finding:

> **Not one of the six conversion targets in the specification was measurable.** There was no analytics provider, no event store and no funnel state. The 80% / 70% / 20% / 40% / 25% / 50% targets were aspirations with no denominator.

A secondary but legally material finding:

> **`/terms` §6 actively contradicted the funnel's headline promise.** The specification offers a "14-day money-back guarantee". The published terms said refunds were *"handled case by case"* and *"generally considered"* only for errors or faults. Advertising a guarantee the terms retract is misleading conduct under the Australian Consumer Law (s18), and it destroys the guarantee's conversion value — a parent who reads the fine print stops trusting the rest of the page. **This has been rewritten** (see §4.8 and §8).

---

## 2. Stage-by-stage audit

Legend: ✅ implemented · 🟡 partial · 🔴 absent

| # | Stage | Target | Before | Finding |
|---|-------|--------|--------|---------|
| 1 | **Acquire** | Free signup; buy later | 🟡 | SEO/GEO strong. **Referral codes: zero implementation** — no table, no `?ref=` capture, no share surface. A channel the spec explicitly names did not exist. |
| 2 | **Signup** | >80% of visitors | 🟡 | Email+password, Google OAuth, mandatory consent with versioning (`lib/auth/consent.ts`). Solid. Facebook flag present but inert. **Signup redirected to an empty `/parent` dashboard** — no guided path, so the 80% was spent on a dead end. |
| 3 | **First Value** | >70% of signups | 🔴 | **Absent.** No onboarding wizard, no 24-hour diagnostic window, no nudge, no exam-date field. A parent landed on a dashboard with a sidebar form and no reason to use it. |
| 4 | **Readiness Report** | Email bands + gaps + score | 🔴 | **Absent.** No email infrastructure in application code at all (only Supabase Auth SMTP, referenced in docs). No readiness score, no band mapping, no topic-gap rollup. The `notifications` table existed but nothing wrote to it and no page read it. |
| 5 | **Second Session** | Free mock, 7-day window | 🔴 | **Absent.** No surprise grant, no expiry mechanic, no scheduler. |
| 6 | **Natural Paywall** | Email after 2 tests | 🟡 | DB gating excellent; **no UI paywall**, no locked-analytics teaser, no "2 completed tests" trigger, no email. The gate existed but nothing ever told a parent what was behind it. |
| 7 | **Offer** | $150 one-time + guarantee | 🔴 | **Absent.** No offer entity, no per-user window, no Exam Pack, no guarantee surfaced at checkout. `allow_promotion_codes: true` was set but no promotion existed. Terms contradicted the guarantee. |
| 8 | **Onboard** | 3 sessions/week + countdown | 🔴 | **Absent.** No `exam_date` column anywhere in the schema, so no countdown was possible; no study plan; no session goal. |
| 9 | **Expand** | 25% buy a second product | 🔴 | **Absent.** No sibling offer, no writing booster, no cross-sell surface, no second-purchase tracking. |
| 10 | **Renew** | 50% core renewal | 🟡 | `subscriptions` + `/api/billing/portal` existed. **No renewal reminder, no pause affordance, no year-in-review, no churn/cancel distinction in data.** |
| — | **Measurement** | *(implicit)* | 🔴 | **Absent.** No analytics of any kind. Blocking gap for every target above. |

### Root cause

Not a shortage of features — a missing **layer**. The platform could acquire a visitor (step 1) and deliver a test (step 3's raw capability), but had no mechanism to *move a parent between those states over time*. Every step from 4 onward is a **scheduled, stateful, personalised communication**, and the codebase had no state to read, no schedule to run, and no channel to send on.

---

## 3. What was built

All of it is in the repository, type-checks clean, and follows the existing conventions (idempotent migrations, degrade-to-null when credentials are absent, RLS deny-by-default, service-role writes, structured `logger` output).

### 3.1 Measurement backbone

| Artefact | Purpose |
|---|---|
| `supabase/migrations/011_funnel.sql` | `funnel_events` (append-only), `funnel_state` (lifecycle spine), `student_exam_targets`, `offers`, `referral_codes`, `referrals`, `email_log`, `funnel_conversion` view, `advance_funnel_stage()` |
| `src/lib/funnel/events.ts` | Closed catalogue of **58 typed events**, each mapped to one of the 10 funnel steps. Unknown names are rejected at the API boundary. |
| `src/lib/funnel/track.ts` | Server-side writer. Never throws — instrumentation cannot fail a submission or a payment. |
| `src/lib/funnel/state.ts` | Stage machine, monotonic advancement, **`recordAttemptCompleted()`** (the step-6 trigger), `grantSecondSession()`, window classification |
| `src/app/api/events/route.ts` | Public beacon. `user_id` is taken **only** from the session, never the body; batch and payload capped; unknown events dropped with 200 |
| `src/features/monetisation/track-client.ts` | Browser queue with `keepalive` flush, first-party anonymous id, sessionStorage UTM persistence |

**Design note.** Stage advancement is monotonic via `funnel_stage_rank()` inside `advance_funnel_stage()`. A late-arriving webhook or a replayed QStash job cannot demote a paying customer back to `PAYWALL_READY`.

### 3.2 Lifecycle email

| Artefact | Purpose |
|---|---|
| `src/lib/email/provider.ts` | Resend over `fetch` (no new dependency), console fallback in dev, **exactly-once delivery** via `UNIQUE(user_id, template, dedupe_key)`, bounce suppression |
| `src/lib/email/layout.ts` | Table-based shell, preheader discipline, one-CTA rule, RFC-8058 unsubscribe headers |
| `src/lib/email/templates.ts` | **10 templates**: readiness report, second session, paywall, offer, study plan, expansion, renewal reminder, year-in-review, referral welcome, diagnostic nudge |
| `src/lib/funnel/lifecycle.ts` | `decideNextEmail()` state machine + `runLifecycleWorker()`. **One email per user per run** — the ordering is the funnel order. |
| `src/app/api/cron/lifecycle/route.ts` | Authenticated hourly trigger (`CRON_SECRET`, constant-time compare) |
| `src/app/api/funnel/unsubscribe/route.ts` | HMAC-signed one-click unsubscribe |
| `vercel.json` | Cron schedule `0 * * * *` |

**Why a polling worker rather than event-driven sends.** Every trigger in this funnel is *time*-based: the nudge fires 12 hours into a 24-hour window, the offer countdown needs an expiry reminder, the renewal reminder is 14 days before a charge. A webhook can only react to what just happened; a scheduled worker can react to what happened a while ago **and is still unfinished** — which is where most of the recoverable conversion sits.

### 3.3 Readiness engine (step 4)

`src/lib/report/readiness.ts` + `/parent/readiness/[childId]` + `ReadinessReportView`.

- Weighted readiness score per exam (NAPLAN, Scholarship, Selective, Olympiad): a purpose-built paper counts 1.0, a BENCHMARK diagnostic 0.6, and cross-exam transfer decays.
- **Eligibility gating:** Selective only from Year 7 (per spec), Scholarship/Olympiad from Year 5. A Year 3 parent is never shown a meaningless Selective band.
- Topic rollups from `questions.tags`, with a **minimum of two attempts** before a topic may be named as a gap — one sighting is a coincidence, not a weakness.
- Gaps capped at five, strengths at three. Eighteen gaps produces paralysis, not action.
- **Confidence labelling** (`low` / `medium` / `high`) from sample size. A confident band computed from four questions is an anecdote dressed as a measurement, and is exactly the kind of claim that invites an ACL complaint.

### 3.4 Conversion surfaces

| Route | Step | Notes |
|---|---|---|
| `/onboarding` | 3, 8 | Numbered 3-step rail; completed steps stay visible as *done* |
| `/parent/readiness/[childId]` | 4, 6 | Free report in full + five described locked panels |
| `/parent/offer` | 7 | Diagnosis-first, anchored price, guarantee adjacent, server-stored countdown |
| `/parent/refer` | 1, 9 | Two-sided reward, one-tap copy, aggregate-only stats |
| `/r/[code]` | 1 | Named-referrer landing; invalid codes degrade rather than 404 |
| `/api/funnel/exam-target` | 8 | Bounded date validation; advances to `ONBOARDED` |
| `/api/funnel/signup` | 2 | Starts the lifecycle, attributes referral, records signup |

### 3.5 Wiring into existing flows

- `api/parent/child` → `recordStudentAdded()`
- `api/runner/submit` → `recordAttemptForFunnel()` (resolves student → parent via service role, because RLS correctly prevents a student session from reading the link)
- `api/webhooks/stripe` → `recordPurchase()` / `recordRenewal()` / `recordSubscriptionEnd()`. Renewal is gated on `billing_reason === 'subscription_cycle'` so the first invoice is not double-counted.
- `api/checkout` → new `offerSlug` branch; **eligibility re-checked server-side**, returning `410 Gone` when the window has closed
- `auth/signup` → funnel start, then redirect to `/onboarding`


---

## 4. Conversion reasoning behind the specific decisions

This section is the panel's rationale. Each item is a deliberate choice, not a default.

### 4.1 The free report gives away its headline

The readiness email contains the score, the band and the named gaps **in the body**, not behind a click. An email that withholds its own content to farm a click trains the parent to distrust the next four emails — and those four are where the money is. The paywall sits on the *interpretation* (why the gap exists, what to do on Monday), not the *diagnosis*.

### 4.2 The paywall shows what is locked rather than hiding it

Five named panels with a lock icon and a sentence each. **No blur, no grey-out.** Blurring is a dark pattern: it hides what is being sold, so the parent must trust a claim instead of evaluating it, and a parent who feels tricked does not buy — they leave and say so in the school group. A described feature can be wanted; an absent one cannot.

### 4.3 The guarantee sits adjacent to the price

Price raises a question; the guarantee answers it. Separating them — guarantee in the footer, price in the hero — wastes the single most effective objection-handling element on the page. Digital goods are the highest-anxiety purchase there is because they cannot be inspected first, and a guarantee is the only thing that substitutes for inspection.

### 4.4 The countdown is server-stored

`funnel_state.offer_expires_at`, written when the offer is granted. A browser-computed "now + 72h" restarts on every page load, and parents notice. A timer that resets teaches them that urgency is fake, after which they ignore every future deadline — worse than having no deadline at all.

### 4.5 The offer is one-time and enforced at checkout

`canClaimOffer()` is re-checked inside `/api/checkout`, not trusted from the page that rendered the button. Without this a parent bookmarks the offer URL, returns after the window closes and still pays the launch price — which makes the countdown decorative and the "one-time" claim false.

### 4.6 One email per user per worker run

A parent who reaches three milestones in one day gets **one** email, not three (`MIN_HOURS_BETWEEN_EMAILS = 20` plus the dedupe key). Deliverability is a shared resource: a spam complaint from one over-emailed parent degrades inbox placement for every other family on the list.

### 4.7 The pause option is prominent in the renewal email

Counter-intuitive but correct. A parent who *can* pause does not cancel, and a paused subscription resumes; a cancelled one almost never does. Hiding the pause link to protect the renewal rate produces the opposite outcome, because the parent who wanted to pause takes the only exit they were offered. Step 10's 50% target is more likely to be met with an obvious pause than without one.

### 4.8 The terms were rewritten to match the promise

`/terms` §6 now states an unconditional 14-day guarantee, explains why it is being offered on digital content, covers subscriptions and pauses, addresses referral credit on refund, and preserves ACL rights explicitly. `/contact`'s refund FAQ was aligned to it. A guarantee hedged with conditions is not risk reversal — it is a reminder that there is risk.

### 4.9 Referral rewards pay on purchase, never on signup

The marginal cost of a throwaway account is zero, so a signup reward attracts exactly the behaviour you do not want and inflates the metric the programme is judged on. Rewards are also **two-sided** — "they get $20 off" gives the referrer a socially acceptable reason to share, which a one-sided reward does not.

### 4.10 Referral attribution is first-touch and permanent

`referrals.referee_user_id` is `UNIQUE`. Last-touch would let a campaign code steal credit from the parent who actually did the recommending, and the moment referrers notice that, the programme is dead.

### 4.11 Referee identities are never shown to the referrer

Aggregate counts only. The referred families are identifiable individuals whose parents never consented to appear on someone else's dashboard. This is a privacy requirement, not a UX preference.


---

## 5. Residual work

Listed honestly, in priority order. Everything below is additive — the funnel functions without it.

### 5.1 Must do before charging real money

1. **Create the Stripe Price for `launch-150`** and set `offers.stripe_price_id`. Until then `canClaimOffer()` returns null and checkout refuses the offer — the correct failure mode, but no revenue.
   ```bash
   stripe prices create --unit-amount=15000 --currency=aud --product="Complete Exam Pack"
   # then: update public.offers set stripe_price_id='<price_...>' where slug='launch-150';
   ```
2. **Apply `011_funnel.sql` and run `supabase/seed/funnel_offers.sql`.**
3. **Verify the sending domain in Resend** and set `RESEND_API_KEY`. Add SPF, DKIM and a DMARC record — without DMARC the one-click unsubscribe header alone does not satisfy Gmail/Yahoo bulk-sender requirements.
4. **Set `CRON_SECRET` and `UNSUBSCRIBE_SIGNING_KEY`** in Vercel for Production *and* Preview.
5. **Grant the second free mock.** `grantSecondSession()` records the window and sends the email, but the entitlement to a specific paid test is not yet created. Until it is, the email promises a paper the account cannot open — **do not enable step 5 in production before this is wired.** Cleanest implementation: a time-boxed row in `entitlements` for the designated mock test, with `active` flipped off by the worker at expiry.

### 5.2 First sprint after launch

6. **Facebook OAuth.** `NEXT_PUBLIC_SOCIAL_AUTH_FACEBOOK_ENABLED` exists and `lib/auth/oauth.ts` is provider-agnostic; the Meta app has not been created. The spec names Facebook explicitly, and for this demographic (parents, school communities) it meaningfully outperforms email signup.
7. **Admin funnel dashboard** over the `funnel_conversion` view. The view exists; the UI does not. Without it the six targets are only answerable by hand-written SQL.
8. **Study plan generation.** `student_exam_targets` stores the goal and the date and `studyPlanEmail()` renders a week, but the week's contents are not yet derived from the readiness gaps. This is the step-8 deliverable and the main renewal driver.
9. **`/notifications` page.** The `notifications` table predates this work and is still unwritten-to. Surfacing lifecycle events in-app reduces dependence on email deliverability.
10. **Expansion send path.** `expandEmail()` is written and `SECOND_PRODUCT_PURCHASED` is tracked, but no worker branch decides *when* to send. It should fire only after real usage of the first purchase — an upsell at the moment a card clears reads as a cash grab and depresses the renewal that is worth more.

### 5.3 Test coverage to add

The repo currently has one test file (`scripts/consent.test.mts`). The funnel needs:

- `readiness.ts`: band boundaries, eligibility gating by year level, the two-attempt minimum for a named gap, confidence thresholds
- `state.ts`: monotonic stage advancement; `recordAttemptCompleted()` firing `PAYWALL_TRIGGERED` exactly at the threshold and never again
- `launch-offer.ts`: `discountPercent()` derivation, `offerStatus()` transitions, expired-window refusal
- `referral.ts`: code normalisation (pasted URLs, lowercase, hyphens), self-referral rejection, single-attribution on repeat
- `email/provider.ts`: dedupe on the unique constraint, console fallback, implausible-address refusal
- `unsubscribe.ts`: signature verification, expiry, UUID shape rejection, timing-safe comparison
- E2E: signup → onboarding → child → diagnostic → readiness email → second session → paywall → offer → checkout → webhook → `CUSTOMER`


---

## 6. How each target is now measured

Every target has a query. Replace `@start` with the cohort window.

```sql
-- Step 2: signup rate. Denominator is anonymous LANDING_VIEWED; numerator is the
-- subset whose anonymous_id was later joined to a user_id.
select
  count(*) filter (where event = 'LANDING_VIEWED') as visitors,
  count(distinct user_id) filter (where event in ('SIGNUP_COMPLETED','OAUTH_COMPLETED')) as signups
from funnel_events where created_at >= @start;

-- Step 3: first value (>70% of signups complete a diagnostic)
select count(*) filter (where stage_rank >= 4) * 100.0 / nullif(count(*), 0) as pct
from funnel_state;

-- Step 5 -> 7: the spec's "40%+ of users who reach step 5"
select
  count(*) filter (where second_session_offered_at is not null) as reached_step5,
  count(*) filter (where second_session_offered_at is not null
                     and first_purchase_at is not null)         as bought,
  round(100.0 * count(*) filter (where second_session_offered_at is not null
                     and first_purchase_at is not null)
        / nullif(count(*) filter (where second_session_offered_at is not null), 0), 1) as pct
from funnel_state;

-- Step 6 -> 7: offer conversion, with the impression denominator from events
select
  (select count(distinct user_id) from funnel_events
     where event = 'OFFER_VIEWED' and created_at >= @start) as saw_offer,
  count(*) filter (where offer_redeemed_at is not null)     as bought
from funnel_state where offer_made_at is not null and offer_made_at >= @start;

-- Step 9: expansion (25% of payers buy a second product)
select
  count(*) filter (where first_purchase_at is not null) as payers,
  count(*) filter (where expanded_at is not null)       as expanded
from funnel_state;

-- Step 10: renewal, keeping pause distinct from churn
select
  count(*) filter (where event = 'RENEWAL_COMPLETED')      as renewals,
  count(*) filter (where event = 'SUBSCRIPTION_PAUSED')    as paused,
  count(*) filter (where event = 'SUBSCRIPTION_CANCELLED') as cancelled,
  count(*) filter (where event = 'CHURNED')                as churned
from funnel_events where created_at >= @start;

-- Step 1: referral channel quality
select r.code, count(*) as invited,
       count(*) filter (where activated_at is not null) as activated,
       count(*) filter (where converted_at is not null) as converted
from referrals r group by r.code order by converted desc;
```

**The `OFFER_VIEWED` event is why the 40% target is now answerable.** "Users who reached step 5" is a state; "users who saw the offer" is an impression. The two differ, and the difference is diagnostic: eligible-but-never-rendered indicates a routing or grant bug, whereas rendered-but-not-clicked indicates a copy or price problem. Those need completely different fixes, and without the impression event they are indistinguishable.


---

## 7. Panel recommendations beyond the specification

These were not asked for, and are offered as the panel's judgement on where the specification itself is weakest.

1. **The 80% signup target is probably the wrong target.** For a cold SEO or AI-search visitor, 80% is not reachable without either a friction the spec forbids (no card) or a value exchange the current landing page does not make. The realistic path is to let the parent **start the diagnostic before signing up** and gate the *report* rather than the test. The report is the valuable artefact; the test is the sample. That single change typically moves signup conversion more than any volume of copy testing, because it converts a decision ("should I join?") into a completion ("I already did it — now show me the result").

2. **The $297 anchor must be a real price.** The offer is currently anchored against `original_amount_cents = 29700`. That is defensible **only if** $297 is a price a parent could actually pay on the site — i.e. the sum of the individual tests in the pack. An invented anchor is misleading conduct under the ACL. Either publish the per-test prices that sum to $297 in the `products` table, or set `original_amount_cents = offer_amount_cents` and let the UI drop the strike-through (it already does this automatically when the discount is zero).

3. **Step 5's "surprise" is at risk from step 4's email.** If the readiness report mentions a free mock is coming, it is no longer a surprise and the reciprocity effect is lost. The lifecycle worker already sequences them on separate runs with a 20-hour minimum gap — keep it that way, and do not add a "coming soon" teaser to the report email.

4. **Segment the offer by gap severity.** A child at 43% on Fractions needs remediation; one at 71% needs exam technique. `primaryGap` is already passed into `offerEmail()` and `OfferPanel` — the differentiated copy is one conditional away, and it is the cheapest available lift on step 7.

5. **Measure time-to-first-diagnostic, not just completion.** Step 3's 70% is a rate with no clock attached. A family that completes the diagnostic on day 21 has usually already churned mentally. The 24-hour window in the spec is the right instinct; the reported metric should be "% completing within 24h", which `diagnostic_completed_at - signed_up_at` now supports directly.

6. **Do not run step 5 in production until the entitlement is granted.** This is repeated from §5.1 because it is the one item on this list that can actively damage trust rather than merely underperform: an email promising a free paper that the account cannot open is worse than never sending it.

---

## 8. Files added or changed

**Added — schema & seed**
`supabase/migrations/011_funnel.sql` · `supabase/seed/funnel_offers.sql` · `vercel.json`

**Added — instrumentation**
`src/lib/funnel/events.ts` · `track.ts` · `state.ts` · `attempt.ts` · `purchase.ts` · `referral.ts` · `unsubscribe.ts` · `lifecycle.ts`

**Added — email**
`src/lib/email/provider.ts` · `layout.ts` · `templates.ts`

**Added — reporting & pricing**
`src/lib/report/readiness.ts` · `src/lib/pricing/launch-offer.ts`

**Added — API**
`src/app/api/events/route.ts` · `api/cron/lifecycle/route.ts` · `api/funnel/unsubscribe/route.ts` · `api/funnel/signup/route.ts` · `api/funnel/exam-target/route.ts`

**Added — UI**
`src/app/onboarding/page.tsx` · `app/parent/offer/page.tsx` · `app/parent/readiness/[childId]/page.tsx` · `app/parent/refer/page.tsx` (+ `refer.styles.ts`) · `app/r/[code]/page.tsx` (+ `referral.styles.ts`) · `src/features/monetisation/{OfferCountdown,OfferCheckoutButton,OfferPanel,OfferViewTracker,track-client}.tsx` (+ `offer-panel.styles.ts`) · `src/features/report/components/{ReadinessReportView,LockedInsightPanel}.tsx` (+ `readiness.styles.ts`) · `src/features/onboarding/{ExamTargetForm.tsx,onboarding.styles.ts}` · `src/features/referral/{ShareWidget,ReferralCookieSetter,ReferralLandingTracker}.tsx`

**Modified**
`api/webhooks/stripe/route.ts` (funnel hooks on purchase, renewal, cancel) · `api/checkout/route.ts` (`offerSlug` branch + server-side eligibility re-check) · `api/runner/submit/route.ts` (attempt → parent funnel) · `api/parent/child/route.ts` (student added) · `(public)/auth/signup/page.tsx` (funnel start, referral capture, redirect to `/onboarding`) · `(public)/terms/page.tsx` (§6 rewritten as a real 14-day guarantee) · `(public)/contact/page.tsx` (refund FAQ aligned) · `06-env.example` (Resend, cron secret, signing key, offer slug)

