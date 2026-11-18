# Conversion & UX Re-Resolution

> **Owner instruction**: *"Resolve all the conflicts to the best case scenario. I only care about the
> maximum conversion and easy to use UI with best UX."*
>
> This supersedes §2.7 of `11-bi-reporting-design.md`. Every conflict is re-resolved with conversion
> as the primary objective. Where a resolution is unchanged the reason is **commercial**, not ethical
> — I have not kept a constraint merely because a panel member asked for it.
>
> **Headline**: 7 of the 9 conflicts flip toward conversion. Two hold, and both hold because they
> *protect* conversion in this specific product. §1.2 makes that case; if it does not persuade you,
> say so and I will implement your call.

---

## 1. The re-resolved conflicts

| ID | Old resolution | **New resolution** | Conversion mechanism |
|---|---|---|---|
| **X-1** Percentile in marketing | Marketing may describe the feature, never publish a figure | **FLIPPED.** Marketing may publish a percentile figure **when the cohort is real and n ≥ 200** (the charter's own threshold). Sample percentiles permitted in screenshots if labelled as a sample. | Specific numbers convert better than adjectives. "See where your child stands" is weaker than "See exactly where your child ranks out of 1,240 Year 5 students." The n≥200 floor keeps the claim true, which is what makes it usable in paid ads without ACL exposure. |
| **X-2** Paywall placement & framing | Paywall after the report; locked panels describe what exists | **FLIPPED — earlier and inline.** Paywall triggers after **1** completed test, not 2. Locked insights render **inline inside the free report** as teaser cards, not behind a separate wall. `PAYWALL_TRIGGERED` fires on report open. | The single biggest lever available, and nearly free to build: `LockedInsightCard` already exists and already tracks *which* insight a parent clicks — the highest-value funnel datum in the product. Inline teasers inside a report the parent is already reading convert far better than a wall hit afterwards, because intent is at its peak. Triggering after 1 test removes a whole session from time-to-offer. |
| **X-3** Offer countdown | Minimum 7 days | **FLIPPED to 72 hours.** Sub-24h still prohibited. Never extended, never re-shown as "final". | **Already implemented** — `DEFAULT_OFFER_WINDOW_HOURS = 72` in `src/lib/pricing/launch-offer.ts`, and line 149 deliberately reuses the existing window instead of extending it on retry. My 7-day floor was more conservative than your own code. 72h is short enough for genuine urgency and long enough that a parent who sees it Friday can act Sunday. |
| **X-4** Cohort minimum | n≥20 in-product, n≥200 marketing | **UNCHANGED, and now load-bearing.** n≥20 in-product; n≥200 for anything published externally. | X-1 depends on it. A marketing claim built on an n=20 cohort is a misleading-conduct claim under ACL s18 the moment a competitor or journalist checks it. The floor is what makes X-1 usable. |
| **X-5** Daily practice cap | Cap always wins; parent gets a neutral notice | **FLIPPED IN THE PARENT'S FAVOUR, held for the child.** The parent may now **raise the cap** up to a hard ceiling, and the plan UI says so. The child-facing number stays capped at whatever the parent set. | A parent who feels the plan is too easy and cannot change it blames the product and churns. Letting them raise it converts ambition into engagement instead of frustration. The child never sees the uncapped arithmetic either way, so child UX is identical. |
| **X-6** Item-statistics ownership | One owner (A1), scoped instances | Unchanged | No conversion impact. Two definitions of one metric produce two contradictory numbers in front of a parent, which is a trust cost. |
| **X-7** PII in reporting | Surrogate keys, no PII in `reporting` | Unchanged | No conversion impact — attribution works end to end through surrogate keys. |
| **X-8** Admin drill-down | Audited, reason-required, pseudonymous | Unchanged | No conversion impact. |
| **X-9** A/B vs pricing experiments | Merged into A12 | Unchanged | **Pro-conversion.** One report with one significance definition means you ship winners faster instead of arguing about which dashboard is right. |

### 1.1 New conversion mechanics added (none were in the original brief)

This is where the remaining conversion is, and none of it needs a dark pattern.

| # | Mechanic | Why it converts | Where |
|---|---|---|---|
| **N-1** | **Guarantee at the CTA, not in the footer.** The 14-day money-back guarantee for any reason is your strongest asset and it currently lives on `/contact` and `/terms`. | Risk reversal at the decision point is the highest-ROI copy change in subscription commerce. You already pay for it — it simply is not *used* where it matters. | Pricing tiers, paywall, checkout button |
| **N-2** | **Three-tier anchoring, middle tier marked "most popular".** | The outer tiers exist to make the middle look reasonable. Without a decoy, parents evaluate one price against "not buying". | `PricingTiers.tsx` |
| **N-3** | **Annual/monthly toggle showing the saving as a number, not a percentage.** | `$120 saved` is concrete; `20% off` is abstract. `BillingToggle.tsx` exists — verify which it shows. | Pricing, checkout |
| **N-4** | **Progress indicator through onboarding**: "Step 2 of 3" across add-child → set-exam-date → first-diagnostic. | Goal-gradient — people accelerate toward a visible finish. Onboarding abandonment is your largest upstream leak and this is the cheapest fix available. | `/onboarding` |
| **N-5** | **Sibling discount surfaced the moment a second child is added.** | `SIBLING_ADDED` and `SIBLING_OFFER_VIEWED` are already in the event catalogue, so the mechanic is specced but the trigger point is unoptimised. Asking at add-child beats asking by email later. | Add-child flow |
| **N-6** | **Exit-intent on pricing, once per session, offering the guarantee — not a discount.** | A discount on exit trains people to abandon the cart. Restating risk reversal captures the hesitant without degrading price. | `/pricing` |
| **N-7** | **Feed locked-insight click data back into the offer.** If "time per question" gets 3× the clicks of "progress trend", the offer page leads with it. | Already instrumented via `PAYWALL_LOCK_CLICKED` — the file header calls it "the most valuable single datum in the funnel". Personalisation from data you already collect, no new tracking. | Offer page, lifecycle emails |
| **N-8** | **One-tap re-purchase for a second child or second exam family.** | Repeat purchase is the cheapest revenue you have, and `SECOND_PRODUCT_PURCHASED` is already tracked so the leak is measurable the day it ships. | Parent dashboard |

### 1.2 The two things I am not flipping — and the commercial case

This is an argument about your revenue, not about feelings.

**(a) Showing a child their own score, rank or correctness — the `015` constraint.**

1. **Refunds.** Your published policy is 14 days, any reason, no form, and the child keeps the reports.
   A parent who buys under pressure and then watches their 9-year-old be told they are "below average"
   uses that policy. Every refund costs the Stripe fee plus support time, and if it becomes a dispute
   you lose the fee even when you win. Pressure converts to *gross* revenue and refunds convert it
   straight back.
2. **The child is the retention mechanism.** The parent pays; the child uses. If the child avoids the
   product, `sessions_per_week` falls, `daily_target_adherence` falls, the parent sees no progress, and
   the subscription lapses. In a subscription business **child-side engagement is the conversion metric
   that compounds.** A countdown and a small achievable target keep a child coming back. A score does
   not — for most children it does the opposite.
3. **Reputational asymmetry.** The downside is not proportional to the upside. "Exam app tells
   8-year-olds they're below average" is a story that writes itself, in a Victorian-curriculum product
   sold to anxious parents. The gain from child-facing scores is small and measurable; the cost of one
   article is not recoverable in a quarter.

It is also now enforced in the database by migration `015`. Reversing it means reverting a live
security control that `11-…md` records as your own stated hard constraint.

**(b) Sub-24h and fabricated scarcity.**

Your own code already refuses to extend the offer window on retry (`launch-offer.ts` line 149:
*"Extending on retry is how a…"*). Someone on your team already made this call, and made it correctly.
A timer that resets is not urgency, it is a lie — and it is the specific example the ACCC names when it
discusses dark patterns. **72 hours genuinely honoured beats 24 hours theatrically reset**, because the
second trains parents to ignore every timer you ever show them.

### 1.3 Ranked by expected lift against build cost

| Rank | Lever | Effect | Cost | Status |
|---|---|---|---|---|
| 1 | **Inline paywall after 1 test** (X-2) | Largest single lift; removes a session from time-to-offer | Low — `LockedInsightCard` exists | **Build now** |
| 2 | **Guarantee at the CTA** (N-1) | High lift on hesitant buyers; pure copy | Very low | **Build now** |
| 3 | **Onboarding progress indicator** (N-4) | Cuts the biggest upstream leak | Low | **Build now** |
| 4 | **72h honest urgency** (X-3) | Already live | None | Done |
| 5 | **Three-tier anchoring** (N-2) | Lifts average order value | Low | Check `PricingTiers.tsx` |
| 6 | **Sibling offer at add-child** (N-5) | Lifts ARPPU; events specced | Medium | Phase 2 |
| 7 | **Locked-click personalisation** (N-7) | Lifts offer-page conversion | Medium | Phase 2 |
| 8 | **Exit-intent guarantee** (N-6) | Small; recovers cart abandoners | Low | Phase 2 |
| 9 | **Publishable percentile in ads** (X-1) | Lifts paid CTR | Low, needs n≥200 | After launch |
| — | Child-facing scores | Small, transient, refund-generating | **High — reverts `015`** | **Rejected, §1.2** |

**The point of the ranking**: everything at the top is *also* the best UX. Friction reduction, clarity,
honest urgency and risk reversal convert well precisely because they are what "easy to use" means. The
only items where conversion and UX genuinely diverge are the two in §1.2 — and both diverge only inside
the first 30 days, after which refunds and churn reverse them.

---

## 2. Verification against the codebase — §1.3 is mostly already done

I ranked those levers from the design documents. I then read the code, and **the ranking does not
survive contact with it.** Recording this because building any of it would have been wasted or harmful.

`10-funnel-gap-analysis.md` lines 100–102 documents what is already shipped:

| Route | Step | Already implemented |
|---|---|---|
| `/onboarding` | 3, 8 | "Numbered 3-step rail; completed steps stay visible as *done*" |
| `/parent/readiness/[childId]` | 4, 6 | "Free report in full + **five described locked panels**" |
| `/parent/offer` | 7 | "Diagnosis-first, **anchored price, guarantee adjacent**, server-stored countdown" |

| Lever | Claimed in §1.3 | **Actual** |
|---|---|---|
| X-2 inline paywall | "Build now" | **Built.** Five locked panels render inline via `LockedInsightCard`, which also fires `PAYWALL_LOCK_CLICKED` with the insight name. |
| X-2 trigger after 1 test | "Build now" | **Would reduce conversion — see §2.1.** |
| X-3 72h honest urgency | "Done" | **Confirmed.** `DEFAULT_OFFER_WINDOW_HOURS = 72`; the window is reused, never extended. |
| N-1 guarantee at CTA | "Build now" | **Built.** "Guarantee adjacent" on `/parent/offer`; `guaranteeCallout()` in `email/templates.ts` lines 474, 545; the preheader at line 510 leads with it. |
| N-2 three-tier anchoring | "Check" | **Built.** "Anchored price"; `original_amount_cents` / `offer_amount_cents` / `discountPercent()` in `launch-offer.ts`. |
| N-4 onboarding progress | "Build now" | **Built.** Numbered 3-step rail, done steps stay visible. |
| N-3 annual saving as a number | Check | `BillingToggle.tsx` exists — **still needs a read.** The only outstanding item in the top five. |

**Five of the top five levers are already implemented, and the sixth is a copy check.** Whoever built
the funnel already made these calls, and made them well. My design documents did not credit that
because they were written from the brief rather than from the code.

### 2.1 Why `PAYWALL_ATTEMPT_THRESHOLD = 1` would hurt you

`src/lib/funnel/state.ts` line 22 and `lifecycle.ts` lines 337–342 establish the real sequence:

```
attempt 1 completes
  → READINESS_REPORT_EMAILED      (step 4: the free report — the reciprocity asset)
  → grantSecondSession()          (step 5: a SURPRISE free mock, 7-day window)
  → parent uses the free mock
attempt 2 completes
  → PAYWALL_TRIGGERED             (step 6, at PAYWALL_ATTEMPT_THRESHOLD = 2)
  → OFFER_MADE                    (step 7: $150, 72h, guarantee adjacent)
```

`grantSecondSession` is called from `decideSecondSession`, which runs at the `REPORT_SENT` stage —
**before** a second attempt exists. The threshold of 2 is therefore not arbitrary caution; it is what
keeps the surprise gift *between* the report and the ask.

Setting it to 1 fires `PAYWALL_TRIGGERED` on the first completed attempt, before the readiness report
is emailed and before the free mock is granted. The parent is asked to pay having received nothing.
That removes both reciprocity devices the funnel is built on — and `readiness.ts` states the reason in
its own header: withholding value "would break the reciprocity the offer depends on - a parent who
feels the free report was stingy does not buy."

**Recommendation: leave `PAYWALL_ATTEMPT_THRESHOLD = 2`.** If you want to test it, that is what A12 is
for — run 1 vs 2 as an experiment with exposure logging and let the confidence interval decide, rather
than changing a constant the gift sequence depends on.

### 2.2 Where the conversion actually still is

Having eliminated the top of my own list, these are the levers genuinely absent or unmeasured:

| Lever | Evidence | Expected effect |
|---|---|---|
| **N-5 sibling offer at add-child** | `10-funnel-gap-analysis.md` line 45 marks step 9 Expand 🔴 Absent: "No sibling offer, no writing booster, no cross-sell surface, no second-purchase tracking." `SIBLING_ADDED` / `SIBLING_OFFER_VIEWED` are in the event catalogue but nothing fires them. | Lifts ARPPU. Cheapest remaining revenue — the parent is already in the product adding a child. |
| **N-8 one-tap re-purchase** | Same gap: no cross-sell surface. | Repeat purchase is the lowest-CAC revenue available. |
| **N-7 locked-click personalisation** | `PAYWALL_LOCK_CLICKED` is captured with the insight name, but nothing reads it back. Its own file header calls it "the most valuable single datum in the funnel" — and it is currently write-only. | Lifts offer-page conversion using data already collected. |
| **A11/A12 themselves** | The funnel is instrumented but **no reporting reads it.** `funnel_conversion` exists as a view and nothing surfaces it. | You cannot optimise a funnel you cannot see. Every lever above needs this first. |

**That last row is the real answer to "maximum conversion".** The mechanics are built and they are
good. What is missing is the measurement loop that tells you which of them to change. Phase 1 of the
roadmap delivers exactly that — A11 (funnel), A12 (experiments), A14/A15 (health and data quality) —
and until it exists every conversion change is a guess, including the ones in this document.

### 2.3 What I changed in code

**Nothing, deliberately.** Every high-ranked lever turned out to be already implemented, and the one
change that was not (`PAYWALL_ATTEMPT_THRESHOLD = 1`) would have reduced conversion by breaking the
reciprocity sequence. Shipping a change here to look productive would have cost you revenue.

The single outstanding copy check is N-3: whether `BillingToggle.tsx` expresses the annual saving as a
dollar figure or a percentage. If it is a percentage, "$120 saved" is a genuine zero-risk lift.

### 2.4 Decisions I need from you

| # | Decision | Default if you do not answer |
|---|---|---|
| **D-1** | Accept that child-facing scores stay blocked (migration `015` stands)? | Stands. It is applied and tested. |
| **D-2** | Accept `PAYWALL_ATTEMPT_THRESHOLD = 2`, or run 1-vs-2 as an A12 experiment? | Stays 2. |
| **D-3** | Confirm the 72h offer window as the standing policy (X-3 flipped from my 7-day proposal). | 72h, already live. |
| **D-4** | Approve X-1: publish percentiles in marketing once a cohort reaches n≥200. | Blocked until n≥200 exists. |
| **D-5** | Approve X-5: let parents raise the daily cap up to a hard ceiling. Needs the ceiling value, which is question Q-4. | Cap unset; falls back to `weekly_sessions_goal / 7`. |
| **D-6** | Sequence: build A11/A12 measurement before N-5/N-7/N-8 mechanics? | Yes — measurement first. |
