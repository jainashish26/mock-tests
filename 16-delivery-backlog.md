# Delivery Backlog — Bottleneck-First

> **Role**: senior scrum master view. Ordering principle is **unblocking leverage**, not
> feature appeal: an item ranks above another when it releases more downstream work per
> unit of effort. Every status below was **verified against the live database and the
> working tree**, not read from the planning docs — several doc claims are stale.
>
> Companion to `14-bi-reporting-assurance-roadmap.md`. Where this document contradicts
> the roadmap, this one reflects measured reality.

---

## 1. Verified state (supersedes the roadmap's status columns)

> ### ✅ Done since the backlog was written (sample data + A11)
>
> **Sample dataset seeded** (as business owner, logged in `SAMPLE_DATA.md`):
> 300 `auth.users`, 200 students, 100 parents, 200 links, **1,299 attempts**
> (48 abandoned), **12,505 responses**, **~570 funnel events**, **58 `funnel_state`
> rows**. Deterministic (md5-derived, never `random()`), idempotent, every row in a
> reserved UUID prefix family, sample auth users unable to sign in or receive mail
> (`.invalid` TLD, empty password, unconfirmed). Teardown script included.
> Attempt scores are **derived from the seeded responses**, and `funnel_state` is
> **derived from the seeded events**, so neither pair can drift.
>
> **This unblocked P2 percentile** — cohorts now reach 26–33 students against the
> n≥20 floor, where before there were 3 students in total.
>
> **A11 Conversion Funnel shipped** (item 7):
>
> | Piece | Status |
> |---|---|
> | 🔴 **`mv_funnel_stage` ranked every stage as 0** | **Fixed (054).** `funnel_stage_rank_upper()` matched lower-case funnel *steps* against upper-case *stages*, so every row hit `ELSE 0` — and `funnel_by_stage` filters `stage_rank > 0`, meaning **A11 returned zero rows for every date range it had ever been given.** The broken ranker was dropped; the canonical `funnel_stage_rank()` (mirrored by `state.ts`) is used instead. |
> | Funnel only available fragmented | **Fixed (055).** `p_segment_by` added, defaulting to the unsegmented headline funnel. The old signature always grouped by channel×campaign×device, splitting 58 signups into a dozen 4–7 visitor cells. |
> | Small segments published as findings | **Fixed (055).** `min_segment_visitors` set to 20, matching X-4's in-product floor. |
> | An empty stage blanked everything below it | **Fixed (056).** Chained with `LAG` over populated stages, and `prev_stage` is returned and rendered so the reader knows what each rate is measured against. |
> | `free_to_paid_rate`, `checkout_abandonment_rate`, `time_to_first_value_hours` | **Added (057).** Denominator is `PAYWALL_TRIGGERED` per §5.4; abandonment is *derived* (started−completed), not event-counted; TTFV is a **median**. All figures count distinct visitors, not events. |
> | API + UI | `/api/reporting/admin/funnel` (+CSV) and `FunnelPanel` on `/admin/reports`, showing drop-off beside every percentage and "too small" instead of a suppressed rate. |
>
> Verified end to end against the seeded funnel: 58 → 41 → 28 → 28 → 18 → 12 → 8 → 5 → 5,
> free→paid 41.67% (5 of 12), checkout abandonment 37.50% (3 of 8) with a 24.00 h
> median, activation 48.28% (28 of 58) with a **25.02 h median time-to-first-value** —
> which matches the seed's own 1510−9 minute gap exactly, so the metric is right
> and not merely plausible.
>
> **C9 (device split) is NOT met and cannot be yet**: `funnel_events` captures no
> device or user-agent, so `device_class` is always `'unknown'`. The panel states
> this rather than rendering a one-row breakdown that looks like a finding.
> Fixing it means capturing device at ingest — a tracker change, not a report change.
>
> ### ✅ Both flagged limitations removed, and N-7 shipped
>
> **C9 (device split) — FIXED, not worked around.** The earlier diagnosis was
> wrong in an instructive way: `/api/events` *already* derived a device and wrote
> `props.device`. But the events the beacon sends have **no `EVENT_STAGE` entry**,
> so they never reach `mv_funnel_stage`. Every event that *does* carry a stage is
> written server-side by `trackEvent()`, which had no access to the classifier.
> Device was captured only on the events that do not participate in the funnel.
>
> Fix: extracted `classifyDevice` into `src/lib/funnel/device.ts` (one definition,
> shared with the beacon), added `device` to `TrackEventInput`, and made
> `trackEvent`/`trackEvents` inherit the visitor's last known device when the call
> site has no `Request` — the normal case for the lifecycle worker and cron. The
> lookup tries `user_id` then `anonymous_id`, so it survives the signup transition
> where a new `user_id` has no history but the `mt_aid` cookie does. Scoped to
> stage-bearing events only, so high-volume `ITEM_ANSWERED` batches pay nothing;
> both lookup paths use existing partial indexes. Signup passes device explicitly
> because it is the first stage event of every journey.
>
> Verified: **mobile 124 / desktop 72 / tablet 7** stage rows, zero `unknown`, and
> a complete device-segmented funnel. A second `FunnelPanel segment="device"` on
> `/admin/reports` makes C9 visible rather than API-only, with `showOutcomes={false}`
> because the outcome rates are whole-funnel measures and must not appear
> device-specific.
>
> **Teardown — VERIFIED BY EXECUTION.** Run inside a transaction and rolled back
> against the live database holding both sample and real rows. All eight tables
> came back clean: every sample row removed, every real row preserved (1 attempt,
> 68 responses, 3 students, 8 auth users, …). That proves validity, FK ordering and
> predicate precision at once. Results recorded in the script header and
> `SAMPLE_DATA.md`.
>
> **N-7 locked-click personalisation — SHIPPED.** `PAYWALL_LOCK_CLICKED` was
> write-only; its own component header calls it "the most valuable single datum in
> the funnel". `topLockedInsight()` now reads it back (most-clicked, ties to most
> recent) and the offer page **reorders its existing benefit list** so the clicked
> benefit leads, with a short acknowledgement line. It deliberately invents no
> copy and changes no price, guarantee or window — reordering is honest
> personalisation; fabricating a per-insight headline risks promising something the
> product does not do. Fails open: any lookup error renders the normal offer.
> A completeness test asserts **every** locked insight maps to a real benefit, so
> adding a sixth cannot silently personalise nothing.
>
> ### ✅ A12 Experiment Results shipped (item 8)
>
> Greenfield - no experiment tables or functions existed. Built to 5.4 rather than invented:
>
> - **059 schema**: experiments, experiment_assignments, experiment_exposures, experiment_thresholds. Assignment is **persisted**, not recomputed from live weights - editing a split mid-flight would otherwise move users between arms and corrupt every prior observation.
> - **060 statistics**: normal_cdf (A&S 26.2.17), wilson_bounds, newcombe_diff_bounds, two_proportion_p_value. **Wilson/Newcombe, not Wald** - conversion rates sit near 0 and 1 where Wald is unreliable. Named p_value_experiment, never p_value (R-11 collision with item difficulty).
> - **061/062/063 results + rule**: per-arm rates, differences, intervals, p, and a verdict **with a reasoning string**. The rule was extracted into experiment_decision() so every branch is testable without seeding hundreds of exposures; the results function calls it, so there is one definition.
> - **API + UI**: /api/reporting/admin/experiments (+CSV) and ExperimentsPanel - a **forest plot**, as 13 requires: "a two-bar chart answers neither" question. Intervals crossing zero are dashed with a hollow marker, so the distinction survives greyscale.
> - **N-7 wired**: the offer page assigns an arm and records exposure **only when the treatment actually rendered** - a personalised-arm visitor with no click history saw the default order and is correctly not counted.
>
> Primitives verified against textbook values: normal_cdf(1.96)=0.975, Wilson 0/10 -> [0, 0.2775], Wilson 50/100 -> [0.4038, 0.5962], z-test 60v40 -> p=0.004678. **All six decision branches tested directly**, including the subtle one: a 0.1pp lift at n=10M is significant but returns EXTEND, because statistically detectable is not the same as worth shipping.
>
> Seeded N-7 demonstrates the core distinction: **100 assigned, 8 exposed** -> 4 per arm -> control 75%, personalised 50%, -25pp but CI [-65.5, +32.0] -> **INSUFFICIENT_DATA**. A four-user arm must not be called a loss.
>
> Also fixed: the baseline export convention missed experiment_assign/experiment_expose (no role prefix) and experiment_thresholds was absent from the config export - the same staleness class as 058. Both covered now (064) with validator checks by name. Baseline regenerated: **141,798 chars, 54/54 checks**.
>
> ### ✅ Tutor surface built (D-B resolved)
>
> Owner confirmed the malformed-row reading and the 12-month consent default.
>
> - **067 foundation** — `tutor_student_links` + `consent_records`, `is_tutor_of()`
>   and `has_live_tutor_consent()`. Access requires **both** a link and a current
>   consent, so a parent can revoke without removing the tutor and re-grant without
>   re-adding them. Consent is evaluated at query time (`revoked_at IS NULL AND
>   expires_at > now()`), so revocation and expiry are immediate with no job.
> - **068/070 P10** — parent-facing list / grant / revoke. Grant by tutor email
>   (a parent cannot be asked for a UUID); resolution happens inside the
>   SECURITY DEFINER function *after* authorisation, and unknown-address vs
>   not-a-tutor return one generic error so it cannot enumerate accounts. Revocation
>   is an UPDATE, never a DELETE — the record is the audit trail.
> - **069 T1/T2/T3** — overview, skill gaps, at-risk list. T2 reads the same
>   `mv_skill_gap` as P3/P8 so tutor and parent see identical accuracy. T1 returns
>   raw scores and the TS applies `bandForScore()` — §5.4 forbids T1 defining its
>   own banding. Movement is NULL below two attempts per period, never 0. Every
>   at-risk row names its rule and explains it (TU1), and the thresholds are
>   labelled unvalidated.
> - **Tutor-only, deliberately.** These do not admit ADMIN: admin row-level student
>   access must be pseudonymous, audited and reason-required (AC-30…34), and a tutor
>   endpoint would bypass that.
> - **UI** — `TutorReportingPanels` on `/tutor`, `ConsentPanel` (P10) on the parent's
>   child page, placed with the reports rather than buried in settings.
>
> **Verified**: all five consent states (no link / link-only / live / revoked /
> expired) behave correctly; **AC-21…26 pass (7 assertions)**; T3's rules were
> proven to fire under controlled conditions rather than left untested because the
> sample happened not to trigger them.
>
> **071** also replaced the export's prefix convention with "every public SECURITY
> DEFINER function" after it missed `tutor_*` — the third patch of the same
> mechanism. **072** revoked anon EXECUTE from the two tutor predicates after A15
> caught them (same default-privilege trap as 044/047/048).
>
> ### ✅ T5 and T7 added (073–076)
>
> - **T5 Assignment Tracker** — `mv_assignment_progress` (hourly 06:00–22:00) +
>   `public.tutor_assignments(status)`. Four-column partition
>   COMPLETED/OVERDUE/STARTED/ASSIGNED, plus a separate `due_state` because
>   `due_at` is nullable and "no due date" must never render as "on time".
>   Gated on consent even though §4.5 lists the gate only for T2/T3/T7 — a revoked
>   consent should hide a child's *activity*, not just their scores.
> - **T7 Recommendations** — `public.tutor_recommendations(studentId?)`. The P8
>   metric was **extracted**, not copied: `reporting.recommendations_scored()` is
>   now the single definition of `expected_impact_score`, the 5-response floor and
>   B12's cap of three, and `parent_recommendations()` delegates to it unchanged.
>   A pgtap assertion fails if parent and tutor ever disagree.
>
> **Two bugs the new tests caught, both real:**
>
> 1. **075 — attempt attribution.** `assignments` has no unique key on
>    `(student_id, test_id)` and no attempt back-reference, so joining on that pair
>    matched *every* attempt to *every* assignment of the same test. One completion
>    marked the whole set done: the tutor's chase list would claim work was handed
>    in which was never started. Each attempt is now attributed to exactly one
>    assignment — the latest `assigned_at <= attempt.created_at`.
> 2. **076 — stale `due_at`.** 073 claimed overdue was computed at read time, but it
>    read `due_at` *from the materialised view*, so recomputing from a stale input
>    still gave a stale answer. The MV now holds only immutable keys and attempt
>    facts; `assigned_at`/`due_at` come from the live table. The assertion moves a
>    due date into the past *without* refreshing and requires OVERDUE.
>
> **Not built, stated rather than faked:** T7's "Assign" action and T5's "Remind".
> `public.tests` is empty, there is no practice-set entity to map a subject/topic
> recommendation onto, and tutors hold no INSERT policy on `assignments`. The UI
> documents the absence instead of shipping a dead button.
>
> **Still outstanding on the tutor surface:** T4 (needs A1 item statistics),
> T6 (needs writing-mark capture and `fact_writing_mark`).
>
> Baseline now **173,566 chars, 68/68 checks**, 48 public functions, 13 cron jobs.
>
> ### ✅ A1 + T4 + the tutor write path (077–087) — content layer unblocked
>
> The content layer went from empty to **54 tests (53 published), 1,900 questions,
> 174 sections, 1,300 attempts**. That unblocked three things I had explicitly
> withheld rather than faked.
>
> **A1 Item Statistics + T4 Item Analysis** — one metric, two scopes. §5 X-6 makes
> A1 the *owner* of `p_value` / `point_biserial` / `distractor_analysis` and T4 "the
> same metric restricted to tests the tutor assigned and to that tutor's consented
> students". Both call `reporting.item_statistics()`; A1 materialises it nightly over
> everybody, T4 calls it live over the tutor's consented set. Same pattern as P8/T7.
> §12's scatter (difficulty × discrimination, point size = n, **flagged by shape as
> well as colour**) is hand-rolled server SVG like MasteryHeatmap.
>
> **T7 Assign + T5 Remind** — `tutor_assign_test()` and `tutor_remind()`, both
> SECURITY DEFINER because tutors hold *no* policy on `assignments` (not even
> SELECT); T5 reads through a definer function precisely so no browser grant exists.
> Assign validates live consent, PUBLISHED status, future due date and year band.
> Remind is rate-limited **structurally** via `email_log`'s unique
> `(user_id, template, dedupe_key)` index — one per assignment per day, with the
> suppression reported back so the control never looks broken.
> `tutor_assignable_tests()` resolves a subject/topic recommendation to published
> tests that actually contain questions on it, ordered by coverage.
>
> **Four defects found and fixed while building this:**
>
> 1. **078 — the answer key was inferred from the marking.** 077 derived `is_key`
>    with `bool_or(is_correct)`, which is circular: it makes the key a function of
>    the column being audited, so a mis-marked item can never be detected. It
>    returned `is_key = true` for **all four options of every item**. Now read from
>    `questions.correct_answer`.
> 2. **078 — non-deterministic JSON.** `jsonb_agg(... ORDER BY n DESC)` had no
>    tiebreaker, so tied options reordered between calls. The X-6 parity assertion
>    caught **19 of 75 items** differing between the nightly MV and a live call on
>    byte-identical data — a report that cannot be cached, diffed or reproduced.
> 3. **083/084 — `tutor_remind` looked up the wrong identity column.** It queried
>    `auth.users WHERE id = student_id`, but the auth account lives in
>    `student_profiles.auth_user_id`; **zero** rows share an id with `auth.users`.
>    Every reminder would have returned "no email on record" — a write action that
>    looks implemented and quietly never does anything. 084 then fixed a
>    self-inflicted counter bug where two different facts were written into one
>    variable.
> 4. **086 — the config export silently omitted `item_thresholds`.** Its table list
>    was hand-maintained, so a baseline restore would have rebuilt it on DEFAULTs and
>    quietly reverted every flag band. That is the **fourth** time a hand-kept list in
>    this export missed a new object (058, 066, 071), so the mechanism was fixed:
>    `*_thresholds` names and `CHECK (id = 1)` singletons are now discovered from the
>    catalog.
>
> **THE MARKING DEFECT — the most important finding of this tranche.** Building A1
> exposed that `responses.is_correct` does not reflect the answer key. It is TRUE for
> **54.3%** of answers that match `questions.correct_answer` and **54.0%** of answers
> that do not: marking is statistically independent of correctness, and 6,528 of
> 12,499 MCQ responses (52.2%) contradict the key. The pattern is consistent with a
> sample generator that simulated per-student ability and then marked that fraction
> of responses correct *without comparing them to the key*.
>
> Not fixed, deliberately — `is_correct` is the marking system of record and
> overwriting it from the key would fabricate a marking history and destroy the
> evidence. Instead it is made impossible to overlook: A15 **FAILs**
> `marking_key_disagreement` (079), every A1/T4 row carries `marking_reliable =
> false`, and both endpoints attach a caveat derived from it (080) — data-driven, so
> it clears itself when marking is fixed. It affects far more than A1: P3 mastery,
> T1 levels, T2 gaps, T3 at-risk and T7/P8 recommendations all read this column.
> **275 of 340 items are flagged**; that is the honest output of correct rules on
> unreliable marking, and the thresholds must not be tuned to hide it.
>
> **Point-biserial, verified rather than assumed.** §5 calls the item-excluded rest
> score "the most commonly botched item statistic". Measured here: naive (item
> included) averages **0.330**, corrected **0.194**, and the naive version is higher
> for **323 of 328** items — using the attempt total would have hidden almost every
> discrimination failure from the 0.20 band. A pgtap assertion now guards it. I also
> tested whether the low values were attenuation from short adaptive forms (0.081 at
> 1–5 items vs 0.205 at 12+); filtering those changed 157→153 flags, so I did **not**
> add a config knob that measurably does nothing.
>
> **One gate fixed, not worked around.** `funnel-coverage` counted a *comment*
> mentioning `ITEM_FLAGGED` as wiring it, failing the staleness check — so
> documenting a gap made the suite claim the gap was closed. The only ways to satisfy
> that are deleting the explanation or writing it vaguely, both of which make the
> code worse. The scanner now strips comments (SQL and TS) before matching.
>
> Baseline now **201,197 chars, 78/78 checks**, 54 public functions, 14 cron jobs,
> pgtap **74 assertions**.
>
> ### ✅ The marking defect, fixed at the source (088–092 + re-seed)
>
> Investigation first: the defect is **confined to the sample-data seed**. The seed
> drew the answer from md5 seed `'ans:'` and the verdict from a *different* seed
> `'r:'` and never compared either to `questions.correct_answer`. Production marking
> in `src/lib/scoring/score-attempt.ts` derives `is_correct` from the question and
> was always correct. So the fix belongs in the generator, and the A15 wording that
> said "fix the marking source" was corrected to say so — an operator sent to audit
> a correct scoring path would have wasted a day.
>
> **Fixed by inverting the dependency**: ability now drives *which option is chosen*
> (key with probability `p(correct)`, else a uniform distractor from the question's
> real option set), so `is_correct` is *derived from* the answer and the two cannot
> disagree. The probability model is untouched, so score spread, tenure trend and the
> difficulty gradient all survive. Naively setting `is_correct = (answer = key)`
> would have made every item exactly 25% and every student identical.
>
> Re-seeded (targeted: sections 3–5 + 8, identities and funnel untouched). Result:
> **0 disagreements across 17,604 letter-keyed responses**; A15 flipped FAIL → OK and
> `marking_reliable` flipped to `true` **with no code change** — which is the payoff
> for having made both data-driven rather than hardcoded warnings. `KEY_BEATEN`
> dropped 78 → 0 and A1's defect count 275 → 7, all now `NO_DISCRIMINATION`.
>
> Three more defects surfaced by running the pgtap suite end-to-end for the first
> time (`plan(74)` verified against a static count of 74):
>
> 5. **091 — `load_response_facts(true)` never deleted anything.** It upserted on
>    `(attempt_id, item_id)`, so after the re-seed the fact table held **25,570 rows
>    against 17,643 sources — 7,927 orphans (45%)** carrying the *old* `test_id`.
>    758 of 1,280 attempts appeared to span two tests, which corrupted A1's
>    "item × test form" grain, leaked the wrong test's items into T4's scope, and made
>    point-biserial differ between A1 and T4 for 73 of 75 items. **The X-6 parity
>    assertion caught it at 146 mismatched rows**; after the fix, 0. A "full" reload
>    that cannot remove rows that no longer exist is not full — this would also bite
>    on a withdrawn question or a restore from an older snapshot.
> 6. **092 — my own transcription error in 091.** Retyping the `dim_item` upsert I
>    wrote `q.discrimination_index` twice, loading `difficulty_dynamic` from the wrong
>    column. Both columns are NULL today so nothing was corrupted, but
>    `difficulty_dynamic` is exactly what a future calibration job would populate.
>    Caught by diffing the deployed definition against the intended one — noted as a
>    gap, since no test can see column-to-column provenance in an upsert.
> 7. **`throws_ok` arity.** I used the 3-arg form, whose third parameter is the
>    expected *error message*, not a description — so five assertions compared my
>    prose against the real message and failed. Now 4-arg, which also pins the exact
>    wording of each refusal.
>
> **088** also extracted the marking audit into `reporting.marking_disagreement()`
> (it had been duplicated in A15 and in `item_statistics`) and widened it from
> `type='MCQ'` to *any* letter-keyed item, bringing 738 `READING_COMPREHENSION`
> questions and 5,105 more responses under audit. **090** applied the evidence floor
> to `dead_distractors`, which was populated for 922 items — 918 of them below the
> floor — so the drill-down was telling admins "option E never chosen" for items with
> six responses.
>
> Two operational notes worth keeping:
> - **`safe_refresh` respects the A14 blackout, evaluated in Australia/Melbourne.**
>   A rebuild attempted at 07:30 UTC was silently skipped as `skipped_blackout`
>   because that is 18:33 in Melbourne, inside the weekday 16:00–21:00 peak. Manual
>   maintenance must suspend the blackout (and restore it in an exception handler)
>   rather than bypass `safe_refresh`, or `refresh_log` — and therefore A15's lag
>   check — goes stale.
> - **The re-seed traded per-item depth for catalogue breadth.** Attempts now span 47
>   tests instead of 11 and touch 1,750 questions instead of 340, but median
>   responses per item fell to ~9 against a floor of 20, so only **16** items clear
>   `enough_evidence`. That is A1 correctly declining to invent a difficulty from nine
>   observations. To populate A1 for a demo, raise attempt volume in seed §3 — do not
>   lower `min_responses_per_item`, which would make every report noisier.
>
> Baseline now **201,944 chars, 79/79 checks**, 25 reporting functions, 54 public
> functions, 14 cron jobs. pgtap **74 assertions**, of which the 23 new ones were
> executed end-to-end and pass.
>
> ### ✅ P2 percentile shipped + T3 LOW_ENGAGEMENT investigated and fixed (093/094)
>
> **T3 investigation — the backlog's suspicion was wrong, and the real defects
> were elsewhere.** Measured against the live database: `fact_test_attempt` and
> `public.attempts` agree EXACTLY on last completed attempt for all six
> consented students, and all six completed an attempt the day of the check.
> The rule correctly did not fire. The "~1% by chance" argument assumed the
> consented six were a random sample of the 200; they are the seed's first six
> students, who carry recent activity. But reading the rule against its spec
> (11-…md §4.5, AL-17) exposed three real defects, all fixed in **094**:
>
> 1. **Zero-attempt students were structurally invisible** — the function was
>    driven from the grouped fact table, so the most disengaged student
>    possible could never appear. Now driven from the consented set.
> 2. **The "active exam target" condition was missing.** Now enforced, read
>    live from `student_exam_targets`. That table has 0 rows today, so the rule
>    legitimately returns nothing on the sample until parents set targets —
>    spec behaviour, not a regression, and proven to fire under fixtures.
> 3. **"No session" meant "no completed attempt"** — a child practising daily
>    without finishing was flagged. Activity now includes started sessions.
>
> **P2 shipped (093)**, built to §4.4/§10 rather than invented:
>
> - `reporting.percentile_from_scores()` owns the mid-rank convention (one
>   definition, hand-checkable); `mv_percentile_cohort` computes at grain
>   **student × family_group × year_level**. DOCUMENTED DEVIATION: the spec's
>   "test form" dimension does not exist in the live `dim_test` and was not
>   invented; A-21's `family_group` collapse is used. If a form dimension ever
>   lands, the grain changes in the MV and nowhere else.
> - Floors are config (`percentile_thresholds`: 20 / 50 / 12 months), exported
>   automatically by the 086 discovery convention. Suppression (<20), quartile
>   band (20–49) and point (≥50) live in the MV; the wrapper's RETURNS clause
>   has **no raw percentage field**, so no code path can render a bare figure.
> - **B1 is enforced in SQL**: `parent_percentile()` raises 42501 (→403) unless
>   a completed scored attempt exists — checked against LIVE `public.attempts`,
>   because P1 readiness resolves from live tables and a nightly-MV gate would
>   403 a child whose readiness report already renders. Authorisation is
>   checked FIRST, so an unlinked caller always gets 0 rows and cannot probe
>   student existence by the error shape.
> - `personal_progress_delta` is borrowed from P4's `mv_attempt_history` on
>   every row (MECE); cohort context (size, explicit window dates, "platform
>   cohort" disclaimer) is mandatory in the payload.
> - Refresh **chained onto `rpt-load-attempt-facts`** after the fact load, so
>   the cohort can never be rebuilt from pre-load facts. Initial population
>   suspended and restored the blackout inside an exception handler.
> - API `/api/reporting/parent/percentile` (AC-19 → 403, AC-20 → `data:null`,
>   `meta.suppressed:true`, `meta.cohort.size:n`) + `PercentilePanel` on the
>   parent child page beside P4, with the B1 refusal rendered as "complete a
>   first test", not an error.
>
> **Verified live**: 365 cohort rows — **33 suppressed** (exactly the two
> below-floor cohorts, OLYMPIAD y6=19 and SELECTIVE y6=14), 332 band rows,
> **0 point rows** (every real cohort is under 50, so no point percentiles
> exist yet — correct, not a bug). Hand-checks: 1..21 score 11 → 50; 16 below
> + 5 tied → 88.0952; fixture n=21 → 45.2381 → band 2.
>
> **Tests**: 26 new pgtap assertions (DA-06 ×4 hand-computed, DA-07 ×3,
> DA-08 ×2, AC-19/19b/20 ×4, band/point/size ×3, catalog ×3, T3 ×7), suite now
> `plan(100)` verified against a static count of 100, then the WHOLE suite
> executed end-to-end via psql (`npm run test:db`; `SUPABASE_DB_URL` now in
> `.env.local`, gitignored): **100 ok / 0 not ok**, clean ROLLBACK, exit 0.
> One intermediate failure during development was a WRONG HAND EXPECTATION in
> the test itself (expected band 3 at n=21, actual mid-rank 45.2381 → band 2)
> — corrected before the green run. `npm run test:db` is now cross-platform
> (`scripts/run-db-tests.mjs`: reads `.env.local`, fails on any `not ok` TAP
> line — verified to exit 1 on an injected failing assertion), and CI runs it
> as a secret-gated "Database assurance" step (`SUPABASE_DB_URL` repository
> secret; warns and skips until an operator adds it). Node: reporting 186 pass
> (15 new P2 wording tests), gates 8, consent 46, funnel 5, readiness green,
> `tsc` exit 0, lint ratchet unchanged (60/16). Baseline regenerated:
> **210,513 chars, 84/84 checks**, 24 tables · 12 MVs · 26 functions ·
> 73 indexes · 14 cron jobs.
>
> **Fixture lessons worth keeping** (each cost a run): the sample seed reserves
> UUID prefix families **5a/5b/5c/5d/5e/5f/59** — test fixtures must live
> outside them (this suite now uses 6a/6c/6d); `public.attempts.student_id`
> AND `parent_student_links.student_id` both FK to `student_profiles`, so a
> fixture student needs a public identity, not just a reporting dimension row;
> `consent_records.purpose` is CHECK-constrained to `'TUTOR_REPORTING'`;
> `fact_test_attempt` scores are CHECK-bounded 0–100.
>
> Operational note: pgtap is now persistently installed in `extensions`
> (verified: `public.has_role` unshadowed, count 1). The suite's
> `CREATE EXTENSION IF NOT EXISTS` is a no-op against it.

> ### ✅ N-5 sibling offer + N-8 one-tap re-purchase shipped (step 9 "Expand")
>
> The last 🔴 Absent funnel step now has surfaces, a checkout path, fulfilment
> and measurement. Built to 15-…md N-5/N-8 and the seeded commercial shape
> ("the same, for the second child" - consistency framing, $99 anchored
> against $150, saving shown as a derived number, **no countdown**: the
> sibling offer has no window and none was invented).
>
> **Catalogue first — the live DB had NO offers and NO products.** Applied the
> project's own `seed/funnel_offers.sql` (3 offers), added
> `seed/expansion_catalog.sql`: a "Complete Exam Pack" product whose bundle is
> **derived** (every PUBLISHED premium test - today exactly 2), and
> `offers.config.productId` as the fulfilment mapping. Stripe **test-mode**
> prices created and written back by `scripts/setup-offer-prices.mjs`
> (idempotent, refuses live keys without `--allow-live`): launch-150 $150,
> sibling-pack $99, writing-booster $69.
>
> **🔴 Latent fulfilment defect found and fixed.** Offer checkouts set
> `offerSlug` metadata but never `productId`, and the webhook's one-time path
> requires `productId` to grant entitlements - a paid offer session would have
> recorded revenue and granted NOTHING. Now: checkout carries
> `config.productId` for both offer kinds, the webhook resolves it server-side
> as a fallback, and `canClaimOffer`/`canClaimSiblingOffer` **refuse an offer
> with no fulfilment mapping** rather than take money.
>
> **The mechanism:**
> - `sibling-rules.ts` (pure) + `sibling-offer.ts` (IO shell, fail closed):
>   eligible = live priced offer + CUSTOMER stage + **≥2 children** +
>   redemptions < `per_user_limit` (3). Redemptions counted from
>   `SECOND_PRODUCT_PURCHASED` events with `props.offerSlug='sibling-pack'` -
>   the same source A11 reads, not a drift-prone counter.
> - **N-5**: `/api/parent/child` fires `SIBLING_ADDED` on the 2nd+ child and
>   returns `childCount`; the form fetches `/api/parent/sibling-offer` and
>   renders `SiblingOfferCard` at the moment of success (`SIBLING_OFFER_VIEWED`).
> - **N-8**: `SiblingRepurchaseCard` on the parent dashboard, server-decided
>   eligibility (nothing renders for ineligible families), one tap → Stripe
>   Checkout with the family's saved customer (`CROSSSELL_VIEWED`).
> - Checkout re-checks eligibility server-side (410 on refusal); the shared
>   button's 410 copy is now surface-aware ("window closed" would be a lie for
>   a windowless offer).
> - Coverage gate: the three events left `EXPECTED_UNWIRED` (direction-2
>   check), so the allowlist stays truthful.
>
> **Verified**: new `expansion.test.mts` **12/12** (every rule branch, reason
> precedence, limit boundary); all suites green (consent 46, reporting 186,
> funnel 5, gates 8, readiness ✓); `tsc` exit 0; lint ratchet unchanged;
> `next build` exit 0; pgtap **100/100 in a fresh environment**; and a **live
> probe 10/10** against the real catalogue - sample parent (2 children, no
> purchase) → `not_customer` + checkout refusal; purchase stamped → eligible,
> `canClaimSiblingOffer` returns the priced, mapped $99 offer with no
> countdown; funnel state **restored exactly**.
>
> **Bug found en route**: both `.env.local` parsers used `value[-1]` (Python
> syntax, `undefined` in JS), so quoted values kept their quotes. The Stripe
> script failed loudly; `run-db-tests.mjs` had been silently masked by a
> session env var. Fixed in both, and the DB suite re-verified with no env set.
>
> **Still open in step 9**: the expansion **email** send path (worker branch
> deciding when `expandEmail()` fires - gap-analysis item 10) and the
> writing-booster surface. The booster is priced but deliberately has no
> fulfilment mapping or surface yet; checkout refuses it.

> ### ✅ App-schema captured + step-9 expansion email shipped
>
> **Application-schema reconciliation (was remaining item 1).** With a direct
> psql connection available, the app half got the same treatment the reporting
> layer already had: `pg_dump --schema-only --no-owner --schema=public`
> (ACLs included) into `supabase/migrations/app_baseline/public_schema.sql` —
> **36 tables · 57 functions · 96 policies · 0 public triggers** — plus the two
> custom `auth.users` triggers in `auth_triggers.sql`. `scripts/
> validate_app_baseline.py` (**33/33**) pins live parity and the presence of
> every table the funnel/monetisation/consent flows depend on. Verified drift
> findings (README updated): **`attempt_expiry_guard` no longer exists** (the
> backlog's claim was stale — superseded by hosted history); `005`/`010` are
> confirmed superseded and must never be applied to a live-shaped database.
> What remains for TRUE `db reset` safety is restructuring the top-level
> migration sequence — deliberately NOT done blind, because the Supabase CLI
> and Docker are unavailable here to verify a reset; restore procedure is
> documented instead.
>
> **Step-9 expansion email (gap-analysis item 10 — the last unwired piece of
> "Expand").** `expandEmail()` had existed unwired because "no worker branch
> decides when to send". Now one does, with the four gates the spec demands:
>   1. **≥72h since first purchase** — "an upsell at the moment a card clears
>      reads as a cash grab".
>   2. **Real usage**: a linked child COMPLETED an attempt after the purchase
>      (live query, fails closed) — the template footer promises exactly this,
>      so the code now keeps the promise the copy makes.
>   3. **Sibling eligibility from the same authority checkout uses**
>      (`getSiblingOfferForUser`) — the email can never pitch what checkout
>      would refuse.
>   4. **One send per family, structurally**: `email_log` unique slot
>      (`expand` / `kind:SIBLING`), not a flag code could forget.
> Worker plumbing: `listExpansionCandidates()` (purchasers, not yet expanded,
> own bounded budget of 50, acquisition sequence ordered first so customers
> can never starve it); `decideNextEmail` routes purchasers to the expansion
> branch instead of returning null. No funnel event invented for the send —
> email_log is the record and `SECOND_PRODUCT_PURCHASED` (already wired)
> measures the outcome, so send→purchase conversion is answerable day one.
> NEXT_PACK / WRITING_BOOSTER variants stay undecided until they have
> fulfilment mappings and surfaces — an email must never outsell checkout.
>
> **Verified live by rolled-back probe (8/8)**: purchase 1h ago → no email;
> 4 days ago + usage → `expansion_sibling` due, template `expand`, dedupe
> `kind:SIBLING`, subject names the real product, body carries the real $99;
> purchase stamped after every attempt → **usage gate refuses**; funnel state
> restored exactly. Full battery re-run: typecheck 0, all six Node suites
> (46/186/5/8/12 + readiness), lint ratchet unchanged, `next build` 183/183,
> pgtap 100/100.

> ### ✅ Bug-hunt tranche: verified non-bugs, 8 FK indexes, error surfaces, repo hygiene
>
> **Concerns from SPRINT_ANALYSIS verified as ALREADY FIXED / not bugs** (each
> re-checked against live code rather than trusted from the doc):
> - "Missing middleware.ts" → **stale.** Next.js 16 renamed the convention to
>   `proxy.ts`; the file exports the session-refresh handler + matcher and the
>   build output lists `ƒ Proxy (Middleware)`. Route protection is
>   `requireRole` per page plus RLS underneath — defence in depth as designed.
> - "Student report page renders TestReportView" → **stale.** It is the S3
>   zero-metric completion screen (no DB read at all; three independent layers
>   hold the 015 rule), and the student dashboard renders S1/S2 from
>   `student_today` — the hardcoded streak/progress mocks are gone.
> - "Hardcoded 15 AUD in checkout" → **fixed.** Prices resolve from the
>   Stripe catalog / offers rows; the client only ever sends identifiers.
>
> **Real defects fixed:**
> 1. **095 — eight covering FK indexes** (advisor: `unindexed_foreign_keys`,
>    15 findings). Indexed the hot paths: `test_questions.question_id`
>    (RESTRICT delete scans + the UNIQUE leads with test_id),
>    `questions.created_by`, `funnel_events.student_id`, `tests.created_by`,
>    `tests.approved_by`, `assignments.assigned_by` (T5 + hourly MV),
>    `entitlements.purchase_id` (refund path), `purchases.product_id`
>    (revenue-by-product; the composite leads with user_id). Seven audit-column
>    FKs on tiny/near-static tables **deliberately skipped with rationale in
>    the migration header** — findings now 15 → 7, and the remaining seven are
>    accepted, not forgotten. `app_baseline/public_schema.sql` re-dumped and
>    re-validated (33/33) so the capture stays truthful.
> 2. **`src/app/error.tsx` + `src/app/not-found.tsx` added** (concern #5).
>    The error boundary logs the real error and renders ONLY the digest —
>    an exception string never reaches a parent or child. The 404 offers two
>    exits (home, test store) instead of a dead end.
> 3. **Three tracked `.backup` files deleted** (concern #3) — stale Sept-2026
>    copies of redesigned pages; `*.backup`/`*.bak`/`*.orig` now gitignored.
>
> **Not done, deliberately**: blanket Zod adoption (concern #15). Zod is not a
> dependency, every route validates manually today, and a sweep of ~25 routes
> onto a new validation library is its own reviewed tranche, not a drive-by.
>
> **Verified**: typecheck 0 · `next build` compiled (error/404 routes included)
> · lint ratchet unchanged · all six Node suites green · unindexed-FK count
> re-measured at exactly the 7 documented skips.

> ### ✅ Database reset via psql — PROVEN end-to-end on a scratch project
>
> **Answer to the standing question: yes.** `supabase db reset` is "fresh DB +
> ordered SQL + seed", and the kit in `supabase/reset/` + `scripts/
> reset-via-psql.mjs` does exactly that with psql alone. Proven on scratch
> project `fkezorhwhxkkdtwcthdl` ($0/mo, created with owner approval, paused
> after): **all steps green, 17/17 parity checks** (schema, content 54
> tests/1,900 questions, sample data, 14 cron jobs) and — the behavioural
> proof — **`assurance.sql` 100/100, exit 0 on the rebuilt database**.
>
> **The proof earned its keep: four restore gaps found and fixed**, each now
> versioned: (1) **reporting function ACLs are not captured by
> `pg_get_functiondef`** — a naive restore left EVERY reporting function
> PUBLIC-executable (`anon` could run `safe_refresh`; verified on scratch) —
> `reset/10_reporting_function_acls.sql` replicates live's lock-down;
> (2) test/question **content** existed only via the Python+service-key
> seeder — now `reset/13_content_data.sql` + placeholder FK-anchor identities
> (`12`), real credentials never copied; (3) the **tutor fixtures the suite
> hardcodes were live-only** — now `seeds/002_tutor_fixtures.sql`, idempotent
> (proven a no-op on live); (4) `dim_date`/`dim_test_family` row data the
> baseline excludes (`reset/08`/`09`). Plus the structural findings encoded in
> the runner: the public↔reporting **dependency cycle** (two-pass tolerant
> apply + CREATE OR REPLACE heal), capture-order vs dependency-order inside
> the function/view files (iterative heal), the `search_path` requirement of
> captured viewdefs, constraint-index duplicates, and the `citext` dependency.
> The runner **refuses the production ref with no override flag**.
>
> Not claimed: `supabase_migrations` history bookkeeping (CLI `db push`
> workflow) and the bare-Postgres local path (`local_stubs.sql` written, not
> exercised — local PG password unavailable). Full record in
> `supabase/reset/README.md`.

> ### ✅ DeepSeek writing-marking pipeline — configured, corrected, PROVEN live
>
> **The credentials arrived and the pipeline was completed, not just wired.**
> The QStash handler existed but would have under-delivered: hardcoded
> `deepseek-chat`, hardcoded base URL, a generic one-line rubric instead of the
> business-authored `DeepSeek Writing Prompt.txt`, and an empty
> `DEEPSEEK_API_KEY` meant nothing could ever grade. Now:
>
> | Piece | Status |
> |---|---|
> | **Model mapping (verified live)** | The API **rejects** the marketing name `DeepSeek-V4.1-Flash-1017`; supported ids are `deepseek-flash` / `deepseek-v4-pro`, and `deepseek-chat` is an alias routing to flash. `.env.local` pins `DEEPSEEK_MODEL=deepseek-flash`; base URL + timeout env-driven (`05-...env-vars.md` §6 updated). |
> | **The real rubric, versioned** | `src/lib/writing/prompt.ts` — all five weighted categories with sub-splits, band descriptors, the narrative/persuasive technique lists, strengths, improvements **with estimated score gains + grammar rewrites**, polished rewrite, practice exercise; strict-JSON contract. Two documented adaptations: year level parameterised from `student_profiles.year_level` (the source addresses VCE Y10-12; grading a Year 4 against senior-secondary expectations is a child-safety/refund hazard) and prose→JSON output. `WRITING_RUBRIC_PROMPT_VERSION` stamped into every evaluation. |
> | **One core, two entry points** | Grading extracted to `src/lib/writing/grade-writing.ts`; the QStash handler (`/api/jobs/writing-eval`) is now thin, and a new **CRON-protected sweeper** (`/api/cron/writing-backlog`, `*/15 * * * *` in `vercel.json`, shared `src/lib/cron/auth.ts`, bounded 10/run oldest-first because every grade is a paid call) grades anything left `WRITING_PENDING`. This closes the real gap: `QSTASH_TOKEN`/signing keys are empty, so nothing was ever enqueued — without the sweeper an essay would sit pending forever. Opposite not-configured policies on purpose: QStash path releases the attempt (student UX), sweeper leaves it pending (never silently complete an ungraded essay). |
> | **🔴 Latent defect found by the live proof** | The old handler merged the `Writing` average into `section_scores` and *then* called `scoreAttempt`, which **recomputes and overwrites `section_scores`** — the essay average was silently erased on every grading since the feature was built. Fixed by ordering: score first, merge after (caught by E2E assertion, not by reading). |
> | **Charter §9 in-app notification** | On completion the linked parent(s) get a `WRITING_GRADED` notification — deliberately NOT the student (a mark is a result; 015 removed student results access) and deliberately score-free in the message (list-view context rule). First rows ever written to `notifications`. |
> | **Timeouts grounded in measurement** | Live round trips measured **18–58 s**; `DEEPSEEK_TIMEOUT_SECONDS=90` and `maxDuration` exported on both routes (Vercel's default would cut mid-call, and QStash would retry into the same wall). |
> | **E2E proof against the live DB** | Disposable fixture (prefix `6e`, real essay with seeded errors, sample student): graded **76/100**, 5 category totals summing exactly to the headline, 15 persuasive techniques detected, 5 strengths, 6 improvement lines, 1,195-char polished rewrite, practice exercise, attempt → COMPLETE with `Writing: 76` merged, exactly 1 parent notification with no score, second run `already_graded` (no double-charge), single evaluation row, **all fixture rows deleted after**. 25/25 assertions. |
>
> Regression state after the tranche: typecheck ✓, `npm run test` 6/6 suites ✓,
> validate 36 ✓, lint ratchet ✓, schema validators 84/84 + 33/33 ✓,
> **live pgtap 100/100 rolled back ✓**, production build ✓.
>
> **Still open (decision-gated):** ~~QStash credentials for the fast path~~ —
> **DONE (2026-11-19): QStash connected via the Upstash MCP.** EU user
> (`eu-central-1`, free plan) token + both signing keys are in `.env.local`
> (gitignored), region-matched to the SDK's default `https://qstash.upstash.io`
> base URL. **Proven both halves live:** publish through the app's own SDK +
> token returned a real `messageId` and QStash logs show `CREATED → ACTIVE →
> DELIVERED (200)`; and the receiver gate — untestable while the keys were
> empty — passed a validly signed POST (HS256, issuer `Upstash`, body-hash
> claim, minted with the real current key) through to the handler (500 on a
> nonexistent attempt, i.e. past the gate), while a garbage signature was
> rejected 503 and an unsigned one 403. DLQ left empty, probes deleted.
> Two findings recorded in `05-...env-vars.md` §3: **loopback destinations are
> rejected at publish time** (so the `localhost` callback URL can never
> enqueue — local submissions fall to the sweeper, safe by design), and
> **token/signing keys are per-region** — mixing regions would publish fine
> but fail every verification. For production: push the commit, set
> `QSTASH_TOKEN`/`QSTASH_CURRENT_SIGNING_KEY`/`QSTASH_NEXT_SIGNING_KEY` +
> `QSTASH_WRITING_EVAL_ENDPOINT` (public HTTPS app URL) in Vercel alongside
> `DEEPSEEK_*` + `CRON_SECRET` + `SUPABASE_DB_URL` (GitHub secret). No WRITING
> questions exist in live content yet (0 rows), so the CMS must author writing
> items before students ever hit this path; **item 17 (writing-mark extension:
> `fact_writing_mark`, criteria columns, `model_version` NOT NULL) remains the
> BI-side follow-up** — until then the criterion-level detail lives in
> `writing_evaluations.raw_response` (model, rubric version, usage,
> category_scores, techniques, practice exercise), which is exactly the
> capture item 17 will formalise. **Security:** the DeepSeek API key *and an
> Upstash account API key* were shared in chat — rotate both when convenient;
> app credentials live only in gitignored `.env.local`, never in the repo.

> ### ✅ Vercel production deployment — LIVE (2026-11-19)
>
> **https://mock-tests-eight.vercel.app** — project `mock-tests` under team
> `mock-exams1` (Hobby), deployed via Vercel CLI 66 from `mock-tests/` after
> the get-started.md playbook (CLI + vercel-labs agent-skills installed;
> Vercel MCP not visible in-session, CLI covered everything).
>
> | Piece | State |
> |---|---|
> | **Git integration** | `jainashish26/mock-tests` connected (needed GitHub login-connection + Vercel GitHub App install on the repo); **`rootDirectory` was `null` and silently broken** — git builds would have run at the repo root (docs folder, no package.json); patched to `mock-tests` via API. Push-to-`main` now deploys production. |
> | **Env vars** | 34 vars × production + preview, bulk-added from `.env.local` via CLI. `SUPABASE_DB_URL` deliberately **excluded** (zero references in `src/`; CI-only via GitHub secrets). The 4 URL vars point at the canonical production domain. The anon key needed `--type config` (CLI credential heuristic vs NEXT_PUBLIC exposure prompt). |
> | **Deployment Protection** | Was ON (`all_except_custom_domains`) — would have 401'd **Stripe webhooks and QStash deliveries**. Disabled via API (`ssoProtection: null`). |
> | **Crons** | Registered: `/api/cron/lifecycle` `0 0 * * *`, `/api/cron/writing-backlog` `30 0 * * *` (UTC). **Hobby forces daily-only schedules** — the intended `*/15` sweeper was rejected at deploy validation. Acceptable because the QStash fast path grades within seconds; the sweeper is only the safety net. Pro plan restores sub-daily crons. |
> | **Hobby compute ceiling** | Function `maxDuration` is capped at **60 s** on Hobby — the writing routes export 120/300 which Hobby clamps. Measured DeepSeek round trips run 18–58 s: the QStash handler fits (barely, with retries as backstop), the **daily sweeper cannot grade its 10-essay batch inside 60 s** — on Hobby it will grade ~1–2 per invocation before timeout. Pro plan (or lowering the batch size) needed if essay volume grows. |
> | **Upload hygiene** | First CLI upload was **418 MB** (QuestionBank 404 MB!). `.vercelignore` now excludes QuestionBank/MockExams/supabase/scripts — not needed by `next build` (verified: `build` = plain `next build`, blog content is TSX). |
> | `vercel link` side effect | It appended `VERCEL_OIDC_TOKEN` to `.env.local` — removed (CLI re-downloads per session; file is gitignored anyway). |
>
> Supersedes the "For production: push the commit, set ... in Vercel" ask in
> the QStash section above — done, all of it.

> ### ⏭ Remaining, in priority order
>
> 1. **`supabase db reset` CLI compatibility (optional)** - the psql reset is
>    PROVEN (above); what remains is cosmetic: restructuring top-level
>    migrations so the CLI's own reset/push works, which needs Docker + CLI to
>    verify and only matters if the team adopts the local-CLI workflow.
> 2. **D-B tutor semantics — RESOLVED AND BUILT.** Owner confirmed the reading and the 12-month default. Foundation (067), P10 consent management (068/070), T1/T2/T3 (069) all shipped; AC-21…26 pass. See below.
> 3. **Grow N-7 exposure** - the experiment is live but 4 per arm is far below the 200 floor, so it cannot reach a verdict on current traffic. A traffic problem, not a code one.
> 4. **P2 point percentiles need n≥50 cohorts** - the report is live and honest
>    (bands at 20–49, suppression below 20); point figures appear as real
>    cohorts grow. Raise attempt volume in seed §3 for a demo — do not lower
>    `min_cohort_for_point`.
> 5. **T3 LOW_ENGAGEMENT — RESOLVED (094).** See the investigation above. The
>    rule now fires only with an active exam target; `student_exam_targets` is
>    empty on the sample, so an empty at-risk list for that rule is correct
>    until targets exist. Setting exam targets is a P9 onboarding action, not
>    an engineering gap.
> 6. **Step-9 email — SHIPPED (this tranche).** Remaining in expand/renew:
>    writing-booster surface + fulfilment mapping, NEXT_PACK decision logic,
>    and the step-10 renewal sequence (RENEWAL_REMINDER_SENT / pause affordance
>    / year-in-review) - each needs a commercial decision or new surface before
>    engineering, and each is deliberately NOT invented ahead of one.

> ### ✅ Closed since this backlog was written
>
> | Item | Resolution |
> |---|---|
> | **D-A** coverage threshold | **Set to 10** (migration 046), derived as 2 × `MIN_ITEMS_FOR_SIGNAL` so a child can be re-tested on fresh items and P4 trend measures learning, not memorisation. A3 now classifies **82 of 85** sub-topics `TOO_FEW` — the honest state of the bank. A15's FAIL cleared. |
> | **D-C** GST treatment | **Declared, not assumed** (migration 046). `reporting.product_tax_treatment` + `net_ex_gst()`; 4 product lines declared GST-inclusive 10%, matching `STRIPE_AUTOMATIC_TAX=false` and the Terms. Unknown product keys **raise** rather than silently defaulting. |
> | **D-D** A14 vs blackout | **Narrow exemption** (migration 046). `refresh_blackout_exempt` table; only `mv_platform_health` exempt, auditable and reversible without a migration. Verified refreshing during an active blackout. |
> | **P1-3** CI | **`.github/workflows/ci.yml`** — typecheck, lint ratchet, all 5 Node suites, validators, build. |
> | **P1-4** static gates | **`scripts/static-gates.test.mts`** — 8 assertions: no `.from()` in reporting, no `fact_*` in request paths, no service-role client, no PII in DTOs, no result keys in funnel props, explicit RPC allowlist. |
> | **P1-2/5** pgtap + AC suite | **pgtap installed in `extensions`**; `supabase/tests/assurance.sql` — **27/27 passing**, covering AC-01…05, AC-40a-c, AC-09/12, AC-17/18, AC-27…31, grant hygiene, PR-01/07, DA-01/11. |
> | **PR-07** | 12 reporting tables lacked forced RLS; migration 049 remediated all. Safe because `postgres`/`service_role` have `BYPASSRLS` — verified, not assumed. |
>
> ### 🔴 New defects found and fixed while doing it
>
> 1. **`score` + `band` in `READINESS_REPORT_EMAILED` props** — a second instance of the analytics-boundary breach, in a place the first audit missed. Caught by the new static gate. Removed.
> 2. **`funnel_events` confidentiality rested on having *no* RLS policies** while SELECT was granted to `authenticated`/`anon`. Not an active leak (default-deny), but one ordinary "let users read their own events" policy from full exposure. SELECT revoked (047).
> 3. **`email_log` — same pattern, worse payload.** `recipient` (PII) plus `payload` containing the child's full score, band and topic gaps. Found by the *new A15 check on its first run*. SELECT revoked (048).
> 4. **Installing pgtap into `public` broke live RLS.** Its `has_role(name) → text` shadowed `has_role(user_role) → boolean`. Detected, reverted, and isolated to `extensions` with a guard (050). The roadmap's own `CREATE EXTENSION pgtap` instruction, run literally, causes this.
>
> **A15 is now fully green** — every FAIL/WARN cleared; only the honest `NOT_IMPLEMENTED` Stripe check remains.
>
> ### ⏭ Still open, in priority order
>
> 1. **Application-schema reconciliation** — the *reporting* layer is now baselined and validated (below), but the app schema still drifts: `005_rls_policies.sql` and `010_subscriptions.sql` exist locally yet were never applied, and `attempt_expiry_guard` was applied with no local file. `supabase db reset` is therefore still unsafe. The same export approach would capture it; it needs the same care around policies and grants.
> 2. **D-B** tutor access semantics — still needs a human answer; gates 9 reports.
> 3. **P2 measurement loop** (A11 → A12 → N-7/N-5/N-8) — unblocked and ready to start.
>
> ### ✅ P1-1 re-baseline — reporting layer DONE
>
> Python (`C:\Python314\python.exe`) removed the tooling blocker. With no `pg_dump`,
> `psql`, CLI or connection string available, the export runs over PostgREST through
> three **bounded, read-only** functions (051/052) behind one service-role-only
> public entry point (053). They accept a whitelisted part name and **execute no
> caller-supplied SQL** — deliberately not an `exec_sql(text)` surface, which would
> be a critical vulnerability introduced to solve a tooling problem.
>
> `scripts/rebaseline_schema.py` wrote **10 files / 119,826 chars** to
> `supabase/migrations/baseline/`, and `scripts/validate_baseline.py` confirms
> **44/44 checks**, including exact object parity with the live catalog:
> **20 tables · 9 materialised views · 1 view · 15 functions · 63 indexes · 11 cron jobs**,
> plus the coverage threshold value, both grant revocations, `search_path` pins,
> `SECURITY DEFINER`, forced RLS and identity columns.
>
> Config rows and cron schedules are exported explicitly because a schema dump
> carries neither — and their absence disables features silently rather than
> raising. ETL-populated tables are deliberately excluded so today's data is not
> baked into a schema baseline.
>
> **Side effect worth noting:** bringing the SQL into version control made
> `DAILY_TARGET_MET`/`MISSED` discoverable by the funnel-coverage scanner, which
> immediately failed its "no allowlist entry has since been wired" check. The
> allowlist was corrected — the drift detector working exactly as designed.

> ### ✅ Item 21 Phase A + B — support channel + triage queue (103/104)
>
> Two verified commits: `e764c96` (ingest) and `ff42ccc` (triage). The only
> backlog item that is simultaneously a live product gap and a BI report:
> `/contact` was mailto-only, `public.enquiries` had 0 rows, and 012's ingest
> function, restricted contact table and audited drill-down were unreachable —
> while the Terms promise a 14-day refund and `/contact` promises a reply within
> one business day. A promise with no record behind it is not a promise.
>
> **Phase A — `POST /api/enquiries` + a form on `/contact`.** Four independent
> filters in ascending cost order: honeypot (discarded with a 200 that looks like
> success, because a refusal names which field caught it), a server-signed form
> token (a client-supplied fill-time proves nothing), a per-address DB throttle,
> and the closed `enquiry_type` list enforced before Postgres sees it — that list
> is the only way topic text reaches the reporting schema, so validating it is
> structural, not tidiness. The token is fetched by the client so `/contact`
> stays **static** (the build confirms it beside a dynamic `/api/enquiries`). The
> mailto stays: a support channel that needs JavaScript is not a support channel
> for everyone, and it is the exit the throttled copy points at.
>
> Three findings that changed the shape of the work:
>
> 1. **A third privilege-escalation-class defect, measured not assumed.**
>    `public.enquiries` still carried `anon:INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER`.
>    Worse than a confidentiality gap: a direct anon INSERT satisfies the CHECKs,
>    so a bot could create an enquiry with **no contact row** — a ticket nobody can
>    answer — breaking 012's two-table-transaction rule by privilege rather than by
>    policy. Closed in 103, but **deliberately narrower than 047/048**: SELECT is
>    kept, because 012 shipped an explicit scoped "Parent can view own enquiries"
>    policy that the privacy design depends on. Revoking it would kill a feature to
>    fix nothing. Live-verified: `enquiries` → `anon:SELECT authenticated:SELECT`,
>    the three others → nothing.
> 2. **No rate limiting existed anywhere**, and `05-…md §7` recommended four env
>    vars that **no file in `src/` reads** — now stated in the doc instead of left
>    to be discovered. The first working limit is DB-backed because Vercel isolates
>    instances and an in-memory counter that resets per cold start limits nothing.
>    Keys are a peppered SHA-256 of the client address; the raw address is never
>    stored, and an unsalted hash is reversible by enumeration.
> 3. **A retry must not be billed as a new submission.** `ingest_enquiry()` was
>    already idempotent, but the 60-second interval fired first and would have
>    answered a double-clicked submit with "you have sent several messages" about
>    the message that landed two seconds earlier. Fixed with
>    `enquiry_id_for_source_ref`, consulted **before** the throttle; the nonce in
>    the signed token doubles as the idempotency key.
>
> **IP trust was checked, not assumed:** Vercel documents that it populates
> `X-Forwarded-For` from the TCP connection and **overwrites any incoming value**
> to prevent IP spoofing, so at this edge the header is the platform's, not the
> caller's. Two boundary conditions are recorded in `clientIpFrom()`: a CDN in
> front would collapse every visitor into one bucket, and local dev sets neither
> header. `x-real-ip` is read first because it is a single value, so there is no
> leftmost-entry rule to get wrong.
>
> **Live probe 56/56** against the hosted database (committed as
> `scripts/enquiry-e2e.mjs`; RFC 5737 reserved addresses; teardown by fingerprint,
> never a blanket delete): honeypot writes nothing · a forgery and a too-fast POST
> return an identical sentence · a good submission yields exactly one `enquiries`
> row + one `enquiry_contacts` row + one `ENQUIRY_CREATED` event carrying no
> contact detail, no message text and **no funnel stage** · the retry returns the
> same reference with one row and one event · the throttle 429s a second
> same-address POST while another address is unaffected · the stored keys match
> the fingerprints the probe computes, so a derivation change breaks loudly
> instead of leaking state between runs · and anon is refused on INSERT and on all
> five RPCs.
>
> **Phase B — the triage queue.** Without it A13 is a volume counter that can
> never report a breach: `first_response_at`, `resolved_at`, `status` and
> `outcome` had **no writer at all** — the exact "mechanics without measurement"
> failure this document criticises. Added `admin_enquiry_queue` /
> `admin_enquiry_transition` / `admin_enquiry_counts`, `/admin/enquiries`,
> `POST /api/admin/enquiries/[id]` and the audited contact reveal.
>
> **The decision that matters: a first response is never inferred.** Stamping
> `first_response_at` at resolution time records the click, not the answer — days
> apart — and makes every historical response look fast. `12-…md §62` warns about
> precisely that. So `reply` alone stamps it, and only once; resolving with no
> recorded reply leaves it NULL and returns `response_was_missing`, rendered as
> "not recorded" and counted apart; `reply` **after** closure is refused (22023)
> rather than back-filled; `reopen` clears `resolved_at`, because a stale
> resolution clock on an open enquiry computes hours against a moment that no
> longer describes anything. Clients send an **action**, never a status, so the
> machine lives in one `CASE` — mirrored by `lib/support/triage.ts` so the UI
> cannot offer a button the database will refuse, with 41 hand-written
> expectations asserting the mirror.
>
> **Three bugs the tests caught, not the reader:**
> 1. **UNITS.** `EXTRACT(EPOCH FROM interval)` is **seconds**. Three `*_minutes`
>    columns returned seconds — a 2000-minute fixture reported 120000.
>    `sla_state` stayed *correct*, because its comparisons divide by 60 inside the
>    `CASE`, which is exactly why this would have shipped: the visible thing was
>    right and only the numbers beside it were wrong. It also silently corrupted
>    `unrecorded_open`, which compares that column against the SLA in minutes.
>    Caught by hand-computing an expected age.
> 2. **`RETURNS TABLE` + plpgsql.** Every output column becomes a variable, so the
>    `UPDATE`'s bare `outcome` was ambiguous with the OUT parameter and Postgres
>    refused the function outright (42702). Aliased, with the reason recorded in
>    the file so nobody "simplifies" it back.
> 3. **A return type cannot be changed** by `CREATE OR REPLACE` (42P13), so adding
>    `resolution_hours` needed a `DROP` — and the dependency check that justifies a
>    `DROP` in a migration was **run** over five catalog vectors (views/MVs,
>    triggers, RLS policies, other function bodies, `cron.job`), all zero, rather
>    than asserted in the comment.
>
> **The attribution writer was built, measured, and removed.** The plan promised
> to stamp `converted_order_id` so `enquiry_to_customer_rate` would be real. It
> does not ship. `converted_order_id` FKs to `public.purchases`, and a
> **subscription** payment never creates one — it writes to `subscriptions`.
> Attributing only where a purchases row exists would credit one-time packs and
> systematically exclude the Unlimited monthly and annual plans that `/pricing`
> presents as the primary product: not imprecise, **biased**, and it would read
> as a measurement. Doing it properly needs a schema decision — relaxing 012's
> `enquiries_converted_has_order` CHECK, or a purchases row per subscription
> period — so it is recorded as an open question in 104 §4 instead of decided
> here, and the metric reports `NOT_IMPLEMENTED` the way A15 already does for
> `stripe_reconciliation`. **Question Q-13 (renumbered from a `Q-11` tag that three
> unrelated questions were sharing — decision 8): what does a
> "converted enquiry" reference when the order is a subscription?**
> **Answered 2026-11-20 by decision 2-A:** relax 012's `enquiries_converted_has_order`
> CHECK and add `converted_ref`, so a conversion can point at a subscription, a
> purchase, or an external order id without the CHECK deciding which products are
> allowed to be attributed. Until that migration ships, `NOT_IMPLEMENTED` remains
> the correct output — the alternative is a number that is not imprecise but
> biased, and a biased number is worse to act on than a missing one.
>
> **The SLA is declared, not assumed** (the D-C precedent). `/contact` publishes
> "one business day" and nothing states calendar-or-business (A-15/Q-5), so config
> carries `sla_basis` and `sla_is_confirmed`, defaulted to 1440 **calendar**
> minutes and explicitly unconfirmed, and the queue prints a caveat beside every
> figure until someone `UPDATE`s the flag. Confirming it is not a migration.
>
> **⚠ Superseded by decision 1-B (2026-11-20) — the shipped default is now the
> knowingly-wrong one.** Q-5 was answered **B**: the clock is **business days**,
> sub-decision 1a = due at the close of the next business day, which needs a
> holiday calendar but no opening-hours window. So `sla_basis='calendar'` is the
> *interim* state, not the answer, and a first response that lands over a weekend
> or a Victorian public holiday is currently measured against the wrong clock —
> which reads as *better* performance than was promised, the safe direction, but
> is still a number nobody agreed to. The fix is migration **109** (105–108 were all
> spent on other decisions first):
> `reporting.dim_public_holiday_vic` + `business_day_deadline()` + an
> `unknown_calendar` state that refuses to compute when a holiday year is missing.
> See D2 below for why the existing `dim_date.is_vic_public_holiday` cannot be
> reused for it.
>
> **Verified (Phase B):** typecheck 0 · lint ratchet unchanged 60/16 · build 0 ·
> all 8 Node suites green (**94** enquiry assertions, +41) · 104 applied **from
> the file** with psql exit 0, so repo and database are literally identical · the
> state machine exercised in rolled-back live transactions against
> hand-computed expectations: five SLA states, counts before and after a reply
> (`unrecorded_open` 1→0), and **seven refusals each matched to its SQLSTATE**
> (second reply 22023 · reply-after-close 22023 · resolve-without-outcome 22023 ·
> assign-without-assignee 22023 · unknown action 22023 · unknown id P0002 ·
> non-admin 42501) · a PARENT JWT gets 0 rows and 0 counts, the same shape for
> every id, so the error cannot probe which enquiries exist.
> `ENQUIRY_FIRST_RESPONDED` and `ENQUIRY_RESOLVED` are wired and left the funnel
> allowlist (wired 51→53, unwired 18→16) — the direction-2 check doing its job.
>
> **Not claimed:** the new admin routes' HTTP layer has no live click-through,
> because the sample auth users cannot sign in by design and no authenticated
> admin session exists. The functions beneath them are tested in the database;
> the routes are proven by typecheck and build. A real end-to-end needs a working
> admin account.
>
> **Two stale claims above, corrected while in here:** **C9 (device split) is
> DONE** — `lib/funnel/device.ts`, the seed assigns a device per parent, and
> `FunnelPanel segment="device"` is mounted on `/admin/reports`; the line saying
> it "cannot be yet" was wrong. **D-B tutor semantics is RESOLVED and built**
> (067–070), not open.
>
> ### ⏭ Remaining in item 21, in order
>
> 1. **Phase C — A13 itself.** `reporting.fact_enquiry` + `mv_enquiry_daily` at
>    the §12 grain `(date_key, channel, enquiry_type, status)`;
>    `load_enquiry_facts` with **delete-then-upsert** (091's lesson: an
>    upsert-only "full" reload left 45% orphan rows); `admin_enquiry_tracker()`
>    with the 366-day cap enforced in SQL; a chained cron; API + CSV; and
>    `EnquiryPanel` — stacked bar by channel/type plus a first-response line
>    against a **drawn SLA reference** (`13-…md §503`). It must surface
>    `unrecorded` as its own figure, use the **median** for `resolution_hours`,
>    keep `support_theme` to the `enquiry_type` enum (§5.8: *"never present a
>    keyword count as a theme"*), report `enquiry_to_customer_rate` as
>    `NOT_IMPLEMENTED`, and show the SLA caveat. Deviation to record:
>    **`reporting.dim_parent` and `reporting.dim_campaign` do not exist**, so
>    `fact_enquiry` keeps `parent_user_id` plus raw normalised UTM — the same
>    treatment as P2's missing test-form dimension, and it preserves the spec's
>    real guarantee that the fact is buildable from `public.enquiries` alone with
>    no join path to a message body.
> 2. **Phase D — assurance.** pgtap AC-35/36/37, PR-02 (no reporting object may
>    reach `enquiry_contacts`), AC-38 extended to the new functions, the
>    `plan(100)` bump, and the static-gate RPC allowlist once Phase C adds
>    `admin_enquiry_tracker()`.
>    **Already closed while in here, because a red assurance check left red is a
>    lie by omission:** both baselines were regenerated from live and both
>    validators pass — `schema:validate` **84/84** (counts bumped `24 12 1 26 73
>    14` → `25 12 1 26 74 14`: one reporting table `enquiry_thresholds`, one index
>
>    `idx_enquiry_throttle_seen`; MVs, views, reporting functions and cron
>    unchanged, because every triage function lives in `public`) and
>    `schema:validate:app` **41/41**, up from 33, after capture-to-live parity was
>    restored at **39 tables · 62 functions · 109 policies**.
>    That check had gone **red** from this work and from objects 096–102 added
>    without a re-capture — it read 30/33 with all three parity lines failing.
>    Eight new assertions were added rather than merely re-running the old ones:
>    the three restricted/throttle tables and the five functions the support
>    channel cannot work without (`ingest_enquiry`, `read_enquiry_contact`,
>    `enquiry_throttle_check`, `admin_enquiry_queue`, `admin_enquiry_transition`),
>    because a restore that had the tables but not the functions would give a
>    form that accepts a complaint into a table nobody can ever read, and a
>    missing `enquiry_throttle` would leave the route's fail-open path accepting
>    everything with no abuse control at all. `app_baseline/README.md`'s counts
>    were updated from the measured 36/57/96.
> 3. **Then the rest of P5:** 17 (writing-mark extension → P6/T6/A5/A6/A7),
>    19 (A2/A4 → T4, still blocked on a pathway column that does not exist), and
>    14–16 (Stripe revenue), which is the largest remaining block now D-C is
>    declared.

> ### ✅ Item 21 — the eleven open business questions, answered (2026-11-20)
>
> Every one of these was blocking at least one estimated task, and none of them
> cost engineering time to settle. Recorded here because the answers are now
> load-bearing: code, config and later estimates all read off this table.
>
> | # | Question | **Decision** | What it commits to |
> |---|---|---|---|
> | **1** | Is the SLA clock calendar or business days? | **B — business days.** Sub-decision **1a**: due at the *close of the next business day*, which needs only a holiday calendar, not an opening-hours window. | New `reporting.dim_public_holiday_vic`; `sla_basis='business_day'`; `business_day_deadline()`; `sla_state` gains an `unknown_calendar` state so a missing holiday year refuses to compute rather than guessing. **D2 below is now load-bearing.** **Done — migration 109**, and it was not the migration the row describes: see *Decision 1, as built* below. |
> | **2** | May a converted enquiry point at a non-`purchases` order? | **A — yes.** Relax `enquiries_converted_has_order` and add `converted_ref`. | **Done — migration 110.** Subscription payments create no `purchases` row, so the old CHECK made "converted" unreachable for the majority of revenue. `converted_ref` + `converted_ref_kind` (purchase/subscription/invoice/other), the CHECK widened but still refusing a timestamp with nothing behind it, and `convert`/`unconvert` actions so a conversion is *recorded* by an admin rather than inferred from a matching account. |
> | **3** | Inbound email channel? | **A — Resend inbound, built dormant.** | **Built — migration 114 + `POST /api/webhooks/resend-inbound`.** Ships dark behind two independent switches: `RESEND_INBOUND_SIGNING_SECRET` unset → 503, and `enquiry_thresholds.inbound_email_enabled` false (the default) → nothing stored. **It captures and does not convert**: with no domain there has never been a real payload, so writing a parser now would guess at a wire format and auto-create enquiry rows from the guess. The first genuine message is what should shape the converter. |
> | **4** | Per-year test/question ceilings? | **A — 10/15/15/15/20/20/25/25 tests for Years 2–9, questions = tests × 25**, as a **ceiling**, with a separate **recommended target** of at least 2 tests/day. Stored in DB, not env vars. | **Done — migrations 107 + 108.** `dim_year_level_cap` seeded for all 8 levels with NOT NULL ceilings and NOT NULL recommended targets (2 for Years 2–5, 3 for 6–9; questions = × 25), plus `daily_target_basis` — a per-year-level toggle deciding which of the two clamps a child's daily target, **defaulting to the recommended target**, and editable at `/admin/settings`. `plan_overload_flag` measures against the ceiling in both modes, so choosing the protective clamp does not soften the alert. |


> | **5** | Adaptive engine? | **B — yes, roadmap.** | A design note, not code this quarter. |
> | **6** | VC2 skill dependency? | **C — retired.** Keep A-9's assumed mapping. | **Done (documentation).** `14-…md` §19 now answers Q-10 in place and §20.5 points the surviving mapping at Q-11/7-A. Migration `026` dropped VC2; only `dim_skill_area` exists. The "biggest schedule risk" framing is corrected rather than deleted. |
> | **7** | Skill → exam mapping for A-9? | **A — invent it as config, labelled editorial and unvalidated.** | **Built — migration 113.** 26 rows across the 10 unmapped skills, each with a required rationale, `is_validated=false` and `applied_to_readiness=false`. readiness.ts now *reads* the mapping on every report but scores from a row only once `applied_to_readiness` is set, so the proposal is live for review without being able to move a child's band. The label is the guarantee: a derived mapping presented as fact is how an unvalidated number becomes a parental decision. |
> | **8** | Q-11 identifier collisions? | **B — renumber.** | **Done.** `Q-11` turned out to name **three** different questions, not two, and none was in the canonical register (which stops at Q-10): the skill→exam mapping stays **Q-11**, the `family_group` prerequisite becomes **Q-12** and is **closed by the data** (17/17 populated, verified live), and the converted-enquiry reference becomes **Q-13** (answered 2-A). Both stale cross-references corrected in place. |
> | **9** | Checkout-abandon window? | **A — 60 minutes.** | **Done, and it was not a config change.** Migration 105: `checkout_abandon_minutes` is 60 and NOT NULL, **and `funnel_outcomes` now reads it** — it previously read nothing, and abandonment was `started AND NOT completed in window`, which counted a parent 90 seconds into a checkout as abandoned. Verified: live abandoned is **1 either way** (4 starts, 3 completed <60 min, 0 late), so no historical figure moves, while the synthetic cases now behave correctly. Recorded as a **deviation**: the register described this as "near-zero-risk config". |
> | **10** | Paywall threshold? | **A — stays 2 in code.** | **Done — no change.** `PAYWALL_ATTEMPT_THRESHOLD = 2` in `src/lib/funnel/state.ts` stays; backlog §2 row **D-E closed** accordingly. A12 remains the right venue to test 1-vs-2 rather than editing a constant the gift sequence depends on. |

> | **11** | Domain / productionisation? | **B — stay on the Vercel URL.** Retire the fictional addresses in favour of the new working form. | **Built.** Noindex on `*.vercel.app`, dead `mocktestspro.com.au` contact addresses deleted, `NEXT_PUBLIC_SITE_URL` mismatch fixed (D1). |
>
> #### Two defects found while grounding these answers, not while fixing them
>
> **D1 — the SEO origin was unreachable by configuration, and the validator
> enforced it.** `site-config.ts` read `NEXT_PUBLIC_SITE_URL`; every environment
> sets `APP_URL`/`NEXT_PUBLIC_APP_URL`. The variable named in the code existed
> nowhere, so the fallback chain always landed on a hardcoded
> `https://mocktestspro.com.au` — a placeholder domain from the original brief
> that was **never purchased**. Production was emitting canonicals, OG URLs,
> JSON-LD entity URLs, a sitemap reference and a robots.txt `Host:` for a domain
> that does not resolve. `scripts/validate-seo.mjs` asserted that literal in five
> places, so the one check positioned to notice was positioned to *prevent*
> noticing: any build emitting the real origin would have failed.
>
> The same addresses were the **default outbound `From:`** in
> `lib/email/provider.ts`. Not cosmetic: Resend cannot verify a domain nobody
> owns, so the promise in the highest-intent lifecycle email — the 14-day
> money-back guarantee — told families to write to a mailbox that has never
> existed, and a privacy policy naming an unreachable privacy contact is an
> Australian Privacy Principles problem (APP 1.4).
>
> **D2 — `reporting.dim_date.is_vic_public_holiday` is false for all 2,557 rows**
> and `is_school_term` true for all of them: column defaults that were never
> populated. Harmless while nothing read them. Decision 1 makes the holiday
> calendar load-bearing for a customer-facing SLA promise, so a business-day clock
> built on that column would have treated ANZAC Day and Christmas as ordinary
> Tuesdays. Fixed by a dedicated, provenanced holiday table rather than by
> back-filling a date dimension whose other consumers do not expect it to change.
>
> #### 11-B, as built — and the part that is not a switch
>
> Indexing is **derived from the origin, not flagged**, so the eventual domain
> cutover cannot be forgotten:
>
> - `SITE_URL` now resolves `NEXT_PUBLIC_SITE_URL` → `NEXT_PUBLIC_APP_URL` →
>   Vercel's own `NEXT_PUBLIC_VERCEL_URL` → `http://localhost:3000`. The last
>   resort is loopback on purpose: a canonical pointing at localhost in a
>   production build is *loudly* wrong and gets fixed, while one pointing at a
>   plausible-looking dead domain looks fine forever.
> - `INDEXABLE` is false for a `*.vercel.app` or loopback origin and true for any
>   other host, overridable with `NEXT_PUBLIC_INDEXABLE`. **Setting
>   `NEXT_PUBLIC_SITE_URL` to the real domain therefore turns proper indexing on
>   by itself** — which is the production item below.
> - Why the app must decide at all: Vercel's automatic `x-robots-tag: noindex`
>   covers *preview* deployments only. A **production** deployment served from
>   `*.vercel.app` is fully indexable unless the app says otherwise, and this app
>   is deployed to production on exactly such a host.
> - `robots.txt` inverts to `Disallow: /` for every named crawler and drops the
>   sitemap reference; `sitemap.xml` returns an empty `<urlset>`. Both matter:
>   `Disallow` alone does not keep a URL out of the index (the noindex meta never
>   gets read), while a sitemap that still lists the pages is a statement of
>   intent to be indexed, which Google settles by crawling anyway.
> - `CONTACT.supportEmail`/`privacyEmail` are now read from `SUPPORT_EMAIL` /
>   `PRIVACY_EMAIL` with **no default**. Every surface that used them degrades to
>   the web form through one shared component (`components/legal/ContactChannel`),
>   because eleven hand-edited sentences across three pages is how one page ends up
>   advertising a mailbox another has stopped naming.
>
> **🔑 PRODUCTION ITEM — flip indexing on at the domain cutover.** When the real
> `.com.au` domain is bought and the site productionised:
>
> 1. Set `NEXT_PUBLIC_SITE_URL=https://<real-domain>` in Vercel (production).
>    Nothing else is required — `INDEXABLE`, `BRAND_HOST_LABEL`, every canonical,
>    the hostname printed on the OG card, `robots.txt` and the sitemap all follow it.
> 2. Set `SUPPORT_EMAIL` / `PRIVACY_EMAIL` once monitored mailboxes exist. Both
>    then reappear automatically in the privacy policy, terms, footer, `/contact`,
>    JSON-LD and the outbound `From:`; until then all of those point at the form.
> 3. Add the domain to Supabase Auth redirect URLs and to Resend's verified senders
>    (`provider.ts` now refuses to select Resend without a resolvable sender).
> 4. Register the sitemap in Search Console, and 301 the `*.vercel.app` origin so
>    any early organic footprint transfers instead of competing with itself.
> 5. Re-run `node scripts/validate-seo.mjs` against the new origin. It prints the
>    origin and indexability it expects and every assertion is conditional on
>    them, so the same script verifies both configurations rather than freezing one.
>
> **Verification, both directions.** Today's config: build green, validator
> **2502/2502**, and `/` + `/contact` + articles emit `noindex, nofollow` with
> `Disallow: /` for all 28 named crawlers and a 110-byte empty sitemap. Simulated
> cutover (`NEXT_PUBLIC_SITE_URL=https://mocktests.example.au` + both mailboxes,
> **no code change**): validator **2500/2500**, indexing turns on by itself, and
> 35 `mailto:` links appear — every one of them an address that resolves to a
> configured mailbox.
>
> **Two findings worth keeping, because both were nearly shipped:**
>
> 1. *Page-level `robots` beats the layout's.* Six surfaces declared it
>    themselves — `/blog`, `/contact`, `/privacy-policy`, `/terms`, and the two
>    that a single-line grep **missed** because they were written across several
>    lines: every blog article and every category hub. Fixing only the layout
>    would have noindexed the marketing pages while leaving the entire organic
>    surface asking to be indexed. The build validator caught it — `/` said
>    `noindex, nofollow` and the articles still said `index, follow`.
>    `INDEXABLE_ROBOTS` is now the single place indexing may be granted, and
>    static gate *"no page grants indexing"* pins it.
> 2. *A green check that cannot fail is not a check.* Both new static gates were
>    proven by injecting the two defects into throwaway probe files: with them
>    present the suite reported **17 passed / 2 failed**, naming both, and
>    returned to **19/0** once removed. A CRLF bug found while writing them was
>    also fixed rather than accepted — a gate that fails because it is blind looks
>    exactly like a working gate right up to the defect it does not catch.
>
> #### D3 — found while executing decision 9: the generated baseline was not deterministic
>
> Regenerating the schema baseline rewrote **48 lines of `06_grants.sql` with no
> change of content** — every added line had an identical removed line. Cause:
> `reporting.export_baseline('grants')` aggregated with
> `ORDER BY r.relname, r.priv`, which leaves the tie unresolved whenever one table
> grants the same privilege to two roles. That is every reporting table, since all
> are readable by both `reporting_ro` and `postgres`.
>
> This is not cosmetics. The baseline is the artifact that makes a restore
> reproducible, and `schema:validate` is the test that proves it. A file that
> reshuffles itself every run trains the reviewer to skim grant churn — and grant
> churn is exactly where a widened `anon` grant, or a `reporting_ro` SELECT quietly
> dropped, would arrive looking like noise. Non-determinism in a security-relevant
> generated file removes the signal rather than weakening it.
>
> Fixed in migration 106 by ordering on the role **name**, not its oid: oids are
> not preserved across a restore, so a name is the only key that means the same
> thing on both sides of a comparison. Verified rather than assumed:
>
> - every other baseline part hashed **identical** before and after; only `grants`
>   changed, and with the **same 19,798 characters** — a pure permutation,
> - the emitted statement set equals the live ACL set exactly (**342 = 342**),
> - two consecutive calls, and two consecutive generator runs, now return
>   byte-identical output — the whole baseline directory hash is unchanged by a
>   third regeneration.
>
> **The mistake made while fixing it is worth recording too.** The first attempt
> rewrote the whole function by hand from the catalog's `prosrc` and referenced
> `(aclexplode(...)).grantee` inside a `CASE`, which Postgres rejects as "argument
> of CASE/WHEN must not return a set". Because plpgsql compiles each `RETURN QUERY`
> lazily, `CREATE OR REPLACE` **accepted the broken body**, and it was the
> verification query — not the apply — that found it. Had the check been "does it
> run in production later", live would have been left with an exporter that throws
> on `grants`. Two lessons: snapshot before you change a generator, and verify by
> comparing output, not by confirming the statement was accepted.
>
> #### 4-A-follow — seeding the ceilings changed what the ceiling *does*, so it became a setting
>
> Decision 4-A is implemented (migrations 107 + 108). Implementing it surfaced
> something the register could not have known, and it was worth stopping for rather
> than shipping: the answer turned out to be a control, not a number.
>
> `mv_student_daily_target.effective_cap` is
> `COALESCE(cap.max_tests_per_day, 2 * ceil(weekly_sessions_goal / 7))`, and
> `daily_target_units = LEAST(required_daily, effective_cap)`. So while the caps sat
> NULL — the state since migration 013 — the fallback gave a typical
> 3-sessions-a-week plan an effective cap of **2**. Seeding Year 2 to 10 therefore
> **raises** what a behind-plan Year 2 child can be told to do, from 2 to as many as
> 10 full papers in a day.
>
> That is rule B7 working as written ("the student keeps seeing the cap"), not a
> defect. But the numbers came from a conversation about **limits**, and a limit of
> 10 papers a day for a seven-year-old is not a limit in the protective sense — it
> is a permission. Meanwhile the recommended target, which is the number that
> actually reads like advice (2–3/day), is stored and displayed and **clamps
> nothing**.
>
> **Answered: a per-year-level toggle, defaulting to the recommended target**
> (migration 108). `daily_target_basis` is `'recommended' | 'ceiling'`, NOT NULL with
> a CHECK, editable per row at `/admin/settings` beside the numbers it governs.
>
> The load-bearing detail, and the reason this is not merely a new column:
> **`plan_overload_flag` is measured against the ceiling in both modes.** Had the
> alert tracked whatever the active clamp happened to be, choosing the protective
> default would have made "this plan is infeasible" fire for almost every child who
> is a little behind — and an alert that always fires is an alert that gets
> dismissed, which is worse than none, because the genuinely impossible plans hide
> inside it. `overload_ceiling` is therefore its own exposed column, so a surface
> can say "today: 2, the plan needs 7, the bound is 10" instead of leaving a target
> quietly slipping with no way to tell recovery from impossibility.
>
> Proven against the live database rather than asserted: synthetic Year 2 students
> inside a transaction that was rolled back, the MV refreshed once per mode.
>
> | mode | plan | needs | clamp | child sees | ceiling | parent alert |
> |---|---|---|---|---|---|---|
> | recommended | A | 6/day | **2** | 2 | 10 | false |
> | recommended | B | 14/day | **2** | 2 | 10 | **true** |
> | ceiling | A | 6/day | **10** | 6 | 10 | false |
> | ceiling | B | 14/day | **10** | 10 | 10 | **true** |
>
> The clamp moves with the setting, the alert does not (`alerts_that_changed = 0`
> across both modes), and no child is ever shown more than the clamp. After the
> rollback: MV rows 0, every row still `'recommended'`, synthetic students gone.
>
> Nothing in production changed on the day this shipped, because
> `dim_practice_plan` has zero `is_current` rows — which is also why the default
> could be chosen on its merits rather than to avoid disturbing anyone.

>
> #### D4 — the schema captures were stored with inconsistent line endings, and it made a 31-line change look like 13,929
>
> Regenerating `app_baseline/public_schema.sql` for migration 107 produced a
> **13,929-line diff in which 31 lines were the actual change.** Diffing
> line-ending-insensitively showed the truth: the previously committed capture held
> 6,909 CRLF terminators *plus 241 stray CR bytes*, while a clean `pg_dump -f`
> produces LF throughout. Git was storing one convention and the generator emitting
> another, so every line "changed" every time anyone regenerated anything.
>
> Two separate causes, both real:
>
> 1. `core.autocrlf` is `true` on this machine and there was no `.gitattributes`.
>    Git therefore converts these files between LF (object database) and CRLF
>    (working tree) invisibly. A fresh `pg_dump -f` writes LF; the file it replaces
>    had been smudged to CRLF; the two differ on every line while being identical in
>    substance. Hand-written source survives this. **A file whose entire purpose is
>    to be diffed does not.**
> 2. The earlier capture had been written **without `-f`** — through a shell
>    redirect or an equivalent pipe — which is how mixed terminators reach a file
>    that `pg_dump` writing to its own output stream would have kept consistent.
>
>    **A claim made in the first draft of this note was too strong, and correcting
>    it matters more than the tidiness of leaving it.** I wrote that the redirect had
>    also re-encoded the committed capture's UTF-8, turning `§` into `Â§`. Measured,
>    that is false: the section sign occurs **3 times in both** the old blob and the
>    new one, so the committed capture's text was never corrupted. The mojibake was
>    real — it appeared in *this session's* redirect attempt, which is exactly why
>    `-f` was required — but it was never in the file being replaced. Line-ending
>    damage: in the committed file. Encoding damage: in my draft capture. Saying
>    "the redirect corrupted the capture" would have been one clean story with a
>    false fact inside it, and the false fact was the sort nobody would think to
>    re-check.
>
> **Fixed with `.gitattributes` marking both capture directories `-text`** (store
> byte-exact, never smudge), so a future capture differs only where the database
> differs. The one-time whole-file diff is unavoidable and is not hidden: it is the
> cost of correcting a parent blob that was committed in the damaged form.
>
> Deliberately *not* done: no `merge=` or `diff=` driver is declared. Naming a
> driver that is not configured in git makes git **fail** every conflicting change
> to those files instead of falling back to a three-way merge — trading a review
> nuisance for a broken workflow, which is the wrong direction.
>
> Practical instruction, now that the cause is known: **capture with `pg_dump -f`,
> never a redirect.** A redirect silently re-encodes and re-terminates, and the
> damage only shows up as an unreadable diff much later, on someone else's review.
>
> **A note on how this was found, because it nearly wasn't.** The first explanation
> I reached for — that the old capture had been console-width-wrapped, splitting
> long SQL lines — was wrong, and it would have gone into this document as fact. It
> was falsified by measuring maximum line length in both blobs (644 and 643: both
> full of long lines, no wrapping anywhere). The actual cause only appeared once the
> comparison printed `repr()` of the differing lines, which shows a trailing `\r`
> that rendered as nothing at all. A plausible reading of a rendered diff was not
> evidence; byte counts were.
>
> #### Three findings from building it, all verified rather than assumed
>
> 1. **`admin_year_level_caps()` answers HTTP 200 with `[]` to a service-role
>    caller.** Confirmed against the live REST endpoint: 200, empty body, on a
>    database holding all eight configured rows — because `has_role('ADMIN')`
>    resolves `auth.uid()`, and the service role has none. The page already reads
>    through the session client for that reason, but the shape is dangerous: an
>    empty array and an unconfigured table are the same value, so any future
>    refactor to the obvious-looking `createAdminClient()` (already used two lines
>    above it for `admin_settings`) would print "no limits are configured" about a
>    fully configured database and invite the operator to configure limits that
>    exist. `loadYearLevelCaps()` therefore reports an empty read as a **failure**,
>    and `EXPECTED_YEAR_LEVELS` makes "complete" a defined thing (2–9) rather than
>    "whatever came back". Pinned by gates and tests: dropping Year 9 from the
>    mandated set turns the suite red **35→34** and the reporting suite red
>    **214→211**.
> 2. **The client component imported the I/O module and the build died.**
>    `YearCapsTable.tsx` reached for `@/lib/reporting/admin-year-caps`, which pulls
>    `./connection` → `next/headers`, which a client component cannot load. The two
>    modules sit side by side with near-identical exports, so choosing the wrong one
>    is the obvious mistake — caught only because Turbopack fails the whole graph.
>    The pure/impure split is what makes it catchable at all: the fix was to import
>    the pure module and cross the boundary only through the server action.
> 3. **The gate written to catch "a setting nobody reads" could not fail.** It
>    checked `/daily_target_basis/.test(mvText)` across the whole 27 KB views
>    capture. Renaming every occurrence to `daily_target_basis_UNUSED` left it
>    **green** — the substring still matched, inside the renamed token. So the check
>    designed specifically for the `checkout_abandon_minutes` failure mode could not
>    detect that failure mode, and would have reported success for as long as the
>    column existed under any name at all.
>
>    It now isolates the MV's own statement and asserts behaviour rather than
>    vocabulary: two `cap.daily_target_basis = 'ceiling'` branches (one per
>    `unit_kind`), the recommended columns used, the ceiling columns used,
>    `LEAST(required_daily, effective_cap)` applied, the alert measured against
>    `overload_ceiling` and **provably not** against `effective_cap`, and
>    `v_student_today` free of all of it. Three mutations each trip exactly one gate
>    — renaming the setting, pointing the clamp at the ceiling column, measuring the
>    alert against the clamp — and all restore to **49/49**.
>
>    Same lesson as D1's validator, arriving from the other side: asserting that a
>    name appears somewhere in a file is not asserting that anything uses it.
>    Writing a gate is cheap; trying to break it is the work.
>
> Also measured while writing the seed, because "questions = tests × 25" deserved a
> check against reality: published tests have a **median of 35 items** (min 0, max
> 90; only 6 of 59 are exactly 25). So 25 is a policy floor, not a measurement. An
> earlier draft of this note, and of the admin-screen copy, claimed that made the
> question ceiling "bind sooner than the test ceiling for a typical paper" — which
> is wrong in a way worth recording: `unit_kind` selects exactly one of the two
> columns per plan, so the two ceilings never compete at all. The multiplier is
> unchanged and the claim is corrected in the copy as well as here, because a
> justification that is wrong is still load-bearing when someone later decides
> whether to trust the number.
>
> ### Decision 1, as built — migration 109 (2026-11-21)
>
> The row above describes the migration as "add a holiday table, set
> `sla_basis`, add `business_day_deadline()`". Three of those four things were
> already in the database or turned out not to be the work. What the work
> actually was: **`sla_basis` was decorative.**
>
> **D4 — the SLA basis column was read by nothing.** `admin_enquiry_queue()`
> decided every state from `EXTRACT(EPOCH …)/60 <= th.first_response_sla_minutes`.
> The function body never mentioned `sla_basis`. So the plan recorded in this
> file — "seed the calendar, flip the flag" — would have changed **no number
> anywhere**, and nothing would have complained: the flag was set, the calendar
> was loaded, the queue looked healthy, and every figure was still measured on the
> old clock. It is the same defect class as `checkout_abandon_minutes` before 105,
> which decision 9 had just surfaced — configuration that exists but is not
> consulted. That repetition is the actual finding: **Phase B verified that the
> config row existed and that the states computed correctly given it. It never
> verified that every declared column was read.** A green suite can therefore
> certify a dead setting, and this is the second time in two decisions it has.
>
> **Four more defects, all found before writing code rather than after:**
>
> 1. **`admin_enquiry_counts().unrecorded_open` compared `age_minutes >
> sla_minutes`.** Once the business basis makes `sla_minutes` genuinely NULL, that
> comparison yields NULL, the FILTER never matches, and "reply not recorded" reads
> **zero** on the one screen whose purpose is to surface it. A zero that means "not
> computed" is the most misleading figure a queue can show. Now derived from
> `sla_state`, so the state machine owns "past the window" in either basis.
> 2. **`EnquiryCard` fell back to `SLA_META.within`** for any unrecognised state.
> Adding `unknown_calendar` to the SQL without adding a label would have rendered
> "open and comfortably inside the response window" on rows that have **no
> window at all** — the new failure mode dressed as good news. The fallback is now
> a loud, deliberately awkward chip, and a test asserts no unknown state can ever
> resolve to `met` or `within`.
> 3. **`triage-service` defaulted `sla_minutes` to 1440.** Under a business-day
> basis that manufactures a 24-hour calendar window out of a NULL, and the header
> would have printed "Measured as 24 continuous hours" beside a deadline measured
> in days. Default removed; NULL now propagates to the caption, which is the only
> place that can phrase it correctly.
> 4. **`slaCaveat()` still said calendar-or-business "is still an open question
> (A-15 / Q-5)".** Q-5 was answered by this very decision. Shipping that string
> would have contradicted the recorded decision on the operator's own screen, so
> the caveat now states the basis and leaves only the *sign-off* provisional —
> which is still true, because `sla_is_confirmed` was deliberately not flipped.
>
> **The source is shorter than the decision assumed.** The official iCal feed
> carries 144 events spanning **2019-01-01 to 2028-12-26**. There is no 2029 or
> 2030 data anywhere, and the AFL Grand Final Friday is explicitly undetermined
> until the fixture is published. So the calendar is generated from the rules of
> the Public Holidays Act 1993 (Vic) rather than pasted, and the generator was
> **proven against the feed before it was trusted**: for 2024–2028 it reproduces
> 66 of the feed's 70 dates exactly. The four differences are the two AFL Fridays,
> where the feed's own *unconfirmed* rows are dated Saturday 2027-09-25 and
> Saturday 2028-09-30 — the Grand Final day, not the Friday before it. Every
> confirmed year (2024, 2025, 2026) matches the rule. Copying the feed forward
> would therefore have seeded the wrong weekday, which is the one case where the
> source is worse than the derivation.
>
> That proof is not left as a comment. **The migration re-runs the diff on every
> apply and aborts if the generator drifts** from the published calendar, so a
> later edit to a rule fails loudly instead of seeding a plausible wrong year.
>
> **Two design choices worth keeping.** `business_day_deadline()` returns NULL
> when any year in the scanned window is not *complete* — completeness measured
> against the generator, so a year holding twelve of thirteen holidays refuses to
> compute exactly like a missing one. Partial years are the dangerous case: a
> missing year is obvious, a short one quietly makes every deadline a day strict
> while the figures still look sourced. And "close of business" is the end of the
> calendar day rather than an invented 17:00, because no working hours were ever
> supplied for this promise; end-of-day can only be more generous than the promise,
> never less.
>
> **D5 — the baseline exporter could not see the new table.**
> `reporting.export_baseline_config()` discovers config tables by two rules: a
> `*_thresholds` name, or a `(id = 1)` singleton CHECK. A 97-row reference table
> matches neither, so `07_config.sql` shipped without it — and that file is the
> only reason a restored database has any configuration at all. The failure is
> silent and total: an empty calendar, every year incomplete, every deadline
> `unknown_calendar` forever. The right direction to fail in, but still a feature
> gone with no error anywhere. Added to the exporter's non-derivable list in 109,
> and the regenerated capture was diffed to confirm **no previously-captured table
> was lost**.
>
> **Also corrected:** `sla_basis` accepts `'business'`, not the `'business_day'`
> written in the decision row above; the shipped value wins over the prose.
>
> **Verified (109):** applied from the file with psql exit 0 · **112/112 pgtap**
> (AC-41…AC-52 new, `plan(100)`→`plan(112)`) · all 8 Node suites green,
> **109 enquiry assertions** (was 94) · `schema:validate` 84/84 and
> `schema:validate:app` 41/41 after regenerating both baselines · typecheck 0 ·
> build 0 · lint ratchet unchanged 60/16 · `validate:seo` 2502/0 · 97 rows seeded
> across 2024–2030, 29 provisional, **0 non-provisional from 2029**, 6 substitutes ·
> the state machine exercised as a real ADMIN inside a rolled-back transaction with
> all six states observed, including the case that proves the flip matters: an
> enquiry received **Mon 2 Nov 2026 is due Wed 4 Nov** because Melbourne Cup falls
> on the Tuesday — `met` under the business clock, `breached` under the old one.
> A 365-day property test asserts every 2026 deadline lands on a genuine business
> day, and DST is checked in both directions so the deadline is a Melbourne wall
> clock rather than a fixed UTC hour.
>
> **One caution for anyone running these gates:** `validate:seo` scans the
> prerendered HTML under `.next`. Run concurrently with a build and it reports
> phantom failures that swing between runs (11, then 33, then 0). This session hit
> exactly that and nearly chased a defect that did not exist. Run the gates
> sequentially.
>
> ### Decision 2, as built — migration 110 (2026-11-21)
>
> Two findings worth keeping, because both are the kind that pass silently.
>
> **The CHECK I wrote to enforce the new rule did not enforce it.** The natural
> wording was `converted_ref IS NULL OR (converted_ref_kind IN (…) AND length(…)
> BETWEEN 1 AND 200)`. When the kind is NULL, `NULL IN (…)` is NULL, `NULL AND
> true` is NULL, and **a CHECK only rejects on false** — so the exact row the rule
> existed to refuse, a reference with no stated type, was accepted by the
> constraint written to stop it. Caught by the apply-time self-test, which is the
> reason that self-test exists, and now pinned as AC-56 with the reasoning in the
> comment so nobody re-simplifies it back to the broken form.
>
> **The first version of that test also passed for the wrong reason, in three
> different places.** It counted any `check_violation` as the guard working —
> but `enquiries` carries six other CHECKs, and one probe actually failed on
> `enquiries_resolved_has_outcome` rather than the constraint under test. Every
> probe now records the SQLSTATE *and* the constraint name via `GET STACKED
> DIAGNOSTICS`, because "some rule objected" is not the same claim as "this rule
> objected". The same discipline caught a second thing: `pgtap`'s
> `throws_ok(text,text,text)` in this build takes the expected **message** in the
> middle argument, not the SQLSTATE, so five correctly-working constraints
> reported five failures. A test whose failure looks like a passing property and
> whose success looks like a broken one is the worst possible instrument, and it
> was replaced rather than reworded until green.
>
> **Conversions are recorded, never inferred.** The tempting shortcut — an enquiry
> with a `parent_user_id` whose owner later subscribed is a conversion — was
> declined for the same reason 104 refuses to back-fill `first_response_at`: it
> would manufacture the metric's most interesting number from a correlation
> nobody observed. `convert` is an explicit admin action, `unconvert` exists
> because a field that cannot be corrected is a field that will be entered
> carelessly, a second `convert` corrects the reference without moving the
> original timestamp, and spam rows are refused so the rate cannot be fed by the
> queue's own rubbish. The card therefore shows *what* a row converted to, since
> a withdraw button with nothing to look at is a guess.
>
> **Verified (110):** applied from file, psql exit 0, its own self-test green ·
> **123/123 pgtap** (`plan(112)`→`123`; AC-53…AC-63) · enquiry suite **125**
> assertions (was 109) · all 8 Node suites green · `schema:validate` 84/84 and
> `:app` 41/41 after regenerating both baselines · typecheck 0 · build 0 ·
> lint ratchet unchanged 60/16 · live probe as ADMIN: subscription conversion
> stored and visible as `converted=true` in the queue, re-convert corrects without
> re-firing the event, unconvert leaves no orphan kind, and a bare
> `converted_at` is still rejected by the original constraint.
>
> ### Phase C — A13 Enquiry & Support Tracker shipped (2026-11-21, migrations 111 + 112)
>
> The reason item 21 exists. 104 gave enquiries a middle and an end, 109 gave the
> first question a clock and 110 gave the second one a column subscriptions can
> use; 111/112 turn those into the report the brief specifies — `day × channel ×
> enquiry type × status`, refreshed hourly — exposed at
> `GET /api/reporting/admin/enquiries` (JSON + `?format=csv`) and rendered as
> `EnquiryPanel` under A12 on `/admin/reports`.
>
> **One deviation from the plan I set out with, and it matters.** The original
> intent was a watermark-and-upsert loader like every other fact table here. That
> would have been wrong: an enquiry is a mutable record, not an event, so keying
> the watermark on `received_at` would load each row once and freeze it at
> `status='new'` forever — the report would have claimed a 100% breach rate across
> all history while the admin queue showed those same enquiries resolved. AC-66
> pins the property that would have broken. 111 rebuilds the table instead, which
> is cheap on the smallest table in the schema and correct without depending on an
> `updated_at` trigger staying switched on.
>
> **Three more config columns were decorative, and are now not.** 104 created
> `resolution_sla_hours`, `min_enquiries_for_rate` and
> `conversion_attribution_days`; 109 caught `sla_basis` being read by nothing; 112
> found these three in the same state. All three now change what the report says.
> Three of the four "settings" on this one config row were inert — which is the
> real finding, and it now has a rule attached: *a column in a config singleton is
> only allowed if something reads it.*
>
> **Two bugs caught by writing the check before trusting the code.**
> `CREATE OR REPLACE VIEW` on a new name produces a **plain** view, not a
> materialised one: the panel would have looked perfect, and `safe_refresh()`
> would have failed on the first hourly cron with *"is not a materialized view"*.
> Separately, the summary windowed on `received_at >= now() - 90 days` while the
> series windowed on a calendar day — the two disagreed by up to a day on the same
> data, and since one feeds the headline and the other the chart, the disagreement
> would have been invisible. Both windows now key on `date_key`, and 112's
> apply-time check asserts the series total equals the summary total so it cannot
> come apart silently again.
>
> **What the report refuses to say.** The breach rate's denominator is
> `met + breached`, never all enquiries — dividing by the total would let a gap in
> the holiday calendar *improve* the score. Unmeasurable and unrecorded rows are
> counted and named on screen. Below `min_enquiries_for_rate` the panel states the
> count and says the sample is too small to be a trend, rather than printing
> "50.0%" from four enquiries. An empty window returns NULL and renders
> "Nothing has been measured in this window yet", never 0%, because 0% reads as
> "we never miss a deadline". Conversion is never inferred from a matching
> account, and the panel says so where a zero would otherwise be read as "enquiries
> do not convert".
>
> **Verified (Phase C):** both migrations applied from file, psql exit 0, each
> with its own apply-time self-test · **129/129 pgtap** (`plan(123)`→`129`;
> AC-64…AC-69 covering the `CONCURRENTLY` unique index, Melbourne-vs-UTC day
> keying, rebuild-reflects-updates, cascade on delete, and unrecorded responses
> staying out of the median) · reporting suite **233** (was 219, +14 asserting the
> wording of every uncertain state) · all 8 Node suites green · static-gate RPC
> allowlist extended deliberately for the two new wrappers · `schema:validate`
> 84/84, `schema:validate:app` 41/41 after re-capturing **both** baselines (the
> app one is a separate `pg_dump -f`; `schema:rebaseline` does not refresh it, and
> the counts in its README are now corrected to 66 functions / 15 jobs) ·
> typecheck 0 · build 0 with `/api/reporting/admin/enquiries` present in the route
> table · lint ratchet unchanged 60/16 · a seven-row fixture probe reproducing all
> six SLA verdicts plus a conversion, with **13 hand-computed expectations**
> asserted in-database (notably 50.0% from 4 measured of 7 total, and
> `rate_is_reportable=false`).
>
> **Not yet done for A13.** The panel has not been exercised in a browser as a
> signed-in admin — the endpoint and server component compile and the data layer
> is verified, but the existing `enquiry-e2e.mjs` probe covers the queue and does
> not yet know about the report. Support-theme text mining stays out of scope per
> §5.8 (MVP uses the `enquiry_type` enum only).
>
> ### Decision 7, as built — migration 113 (2026-11-21)
>
> **The count in the register was wrong, and it was the register that was wrong.**
> Q-11 and decision 7 both say "11 skill values"; `SKILL_EXAM_TYPES` holds **ten**.
> Rather than pick a number, the coverage assertion is driven off the code's own
> list, and 113's self-check names the ten skills explicitly — so a future
> eleventh one fails loudly at the gate instead of quietly falling through to the
> weakest weight, which is the exact bug that created Q-11 in the first place. The
> seed is 26 rows: ten skills, several mapping to more than one exam.
>
> **Two flags, not one.** `is_validated` means the business accepts the assertion;
> `applied_to_readiness` means it may score a child. They ship false and are set
> independently, because collapsing "we think this is reasonable" into "this is
> now a parental number" is the specific failure this whole decision was about.
> Approving GEOMETRY need not wait on SPELLING.
>
> **Read but not yet honoured — and that is a deliberate third state.** 109's
> finding was that a config column nothing queries is invisible. So `readiness.ts`
> loads the mapping on every report and consults it; only the *effect* is gated.
> The load fails closed to an empty mapping, so a database error reproduces
> pre-113 weighting rather than producing a report where half the skill evidence
> vanished — the mapping cannot make a score worse by being unavailable.
>
> **Applied rows score 0.8, not 1.** An inference is weaker evidence than a paper
> built for that exam; at 1.0 an editorial row would outrank a purpose-built
> Selective test in a Selective readiness score.
>
> **One gap worth recording rather than hiding.** `readiness_skill_exam_map()` is
> called through `supabase.rpc(...)` in readiness.ts, not through
> `callReportingFunction(...)`, so the static gate that requires every reporting
> RPC to be explicitly allowlisted does **not** see it. Measured: the gate's regex
> matches only `callReportingFunction|callReportingWrite`, and there are **14**
> `.rpc(` call sites across `src` — 13 of them predating this work. Widening the
> gate to catch them was not done here, because that change would make 13
> pre-existing sites fail the suite in the same commit that adds one, and reviewing
> them deserves its own pass. But the gate is narrower than its name implies, and
> that is worth knowing before it is trusted as complete.
>
> ### Decision 5, as designed — adaptive pathway note (5-B, 2026-11-21, no schema)
>
> Deferred by choice: this is the design note, not the build. One finding in it is
> not deferrable, so it is recorded here where the next person will meet it.
>
> **The product already promises what the engine does not do.** `src/app/platform`
> renders "Adaptive Testing — Questions that adjust difficulty in real-time", and
> the same page lists "adaptive difficulty" among what the platform provides; the
> charter calls the adaptive engine a Sprint 3 objective, and the readiness
> report's locked surface names `adaptivePlan` as one of the things an unlock buys.
> Nothing in the repository selects an item on a child's performance. What looks
> like the feature is `responses.difficulty_served`, which is written from
> `test_questions.base_difficulty` at save time — an authored per-test attribute
> (`record.difficulty || 2`, so it defaults to 2 when the uploader leaves it
> blank) and the *same value for every child who sits that test*. Recording which
> difficulty an item was written at is not adaptivity; it is a label. That gap
> between a static field and a dynamic claim is the same class of problem this
> backlog has spent five decisions chasing: a column, a field or a sentence that
> asserts something the system does not do. **Recommendation: soften the copy or
> build the selector.** Both are cheaper than a parent discovering it the third
> way, and a paywall that lists `adaptivePlan` among the unlocks makes that
> discovery likely rather than hypothetical.
>
> **What the engine must actually decide.** One question: given a child mid-section,
> which item next? The charter bounds it — objective items only (MCQ and short
> answer), adaptivity within a section, never across sections. That boundary is
> load-bearing for reporting: cross-section adaptivity would change what a section
> score *means* over time, and every longitudinal figure in A1-A8 would be comparing
> children who sat different tests under the same label.
>
> **Inputs that exist today.** `difficulty_served` per response, item statistics
> (`mv_item_statistics`: observed accuracy and discrimination per item), topic and
> skill tags, the child's running section accuracy, and `dim_item`'s year-level and
> exam-type columns. Enough for a *within-section* step: pick the next item one
> difficulty band up after two consecutive correct, one band down after two
> consecutive incorrect, clamped to the items actually available for that topic.
>
> **Inputs that do not, and are the reason this is a note.**
> *No calibration of the difficulty scale.* `difficulty_served` is an author's
> estimate; nothing has checked it against observed accuracy at scale, and the
> known `is_correct` contradiction (A-12, 52% of MCQ responses disagreeing with
> `correct_answer`) means the observed half is not yet trustworthy. An engine that
> steps down on failure is tuning a thermostat against a thermometer that has not
> been checked.
> *No exposure accounting.* If the same 12 items for a topic are all that qualify,
> adaptivity will cycle them, and repeated exposure inflates accuracy in a way that
> reads as learning. This is the same measurement-validity problem Q-7 raised for
> mastery, unsolved there.
> *No stability requirement decided.* A child who sees difficulty bounce per item
> experiences the test as unfair; a path that only ever rises feels punitive. Both
> are product decisions about feel, not parameters to fit.
>
> **What must be true before it is built, in order.** (1) Resolve A-12 so accuracy
> is trustworthy. (2) Publish an item-calibration view — observed accuracy and
> discrimination per item with an exposure floor, the same `min_attempts` discipline
> A1 already applies — and check whether the authored `difficulty_served` buckets
> actually rank. If they do not, the fix is to the scale, not the engine. (3) Decide
> exposure policy with the item bank's size in hand. (4) Only then the selector,
> behind a flag, with the *first* adaptation being observable in a report: if the
> engine changed a child's path, A1/A8 must be able to show it, otherwise a score
> drop after a rule change will be read as the child getting worse.
>
> **Deliberate non-goals.** No new schema in this note (5-B), no IRT or Elo model
> (both need exposure and calibration data that does not exist), and no use of
> writing marks as a signal — criterion-marked prose is not comparable item-to-item
> in the way a step function assumes.
>
> ### Phase D — contact privacy and audit assurance (2026-11-21, migration 115)
>
> An earlier line here said the assurance work "landed alongside the migrations
> that needed it". That was wrong and is corrected: AC-35/36/37 and the AC-38
> extension were listed as Phase D and **had never been written**. Checked before
> claiming it — `enquiry_contacts`, `read_enquiry_contact` and the audit log had
> zero mentions anywhere in the suite, which held 136 assertions. So the privacy
> story this backlog item exists to deliver was, at that moment, unasserted.
>
> **Writing the assertion found a real defect, on its first run.** AC-37 asks
> whether the audit trail can be edited. It could: `service_role` held INSERT,
> SELECT, **UPDATE and DELETE** on `enquiry_contact_access_log` — not from any
> grant in this project's migrations but from the platform default of ALL on the
> app schema for the service credential. The consequence is specific: the entire
> privacy guarantee for enquiry contacts is "details live where no app role can
> read them, and the one door writes down who opened it". If the credential the
> backend runs as can quietly delete those writings, the door exists and the
> ledger does not — while every sentence in 12-...md still reads as true. This is
> also the least visible class of gap, because nothing in the application ever
> needs those privileges: an audit trail's guarantees are exercised only when
> something has already gone wrong, which is precisely when nobody has tested
> them. 115 revokes UPDATE/DELETE from service_role (keeping INSERT and SELECT,
> since a table nobody can write to is a different bug) and verifies the only
> writer, `read_enquiry_contact`, is `SECURITY DEFINER` owned by postgres — so it
> audits as the owner and is unaffected. AC-36 proving a reveal still logs after
> the revoke is the check that this hardened the guarantee instead of disabling
> it.
>
> **Two roadmap inaccuracies found while asserting against reality.** AC-37 names
> a table `admin_access_audit`; no such table exists — the real one is
> `enquiry_contact_access_log`. The assertions are written against the actual
> name, because a corrected sentence in a document nobody executes protects
> nothing. And the roadmap's implied "no app role touches the log" was, as above,
> not the live state.
>
> **AC-38 is stated as two claims rather than one count,** because the policy is
> genuinely narrower than "nothing executable": `admin_enquiry_summary`,
> `admin_enquiry_series` and `readiness_skill_exam_map` *are* executable by
> `authenticated` by design and self-gate on `has_role('ADMIN')` inside. So 38a
> asserts nothing added by item 21 is reachable anonymously, and 38b asserts the
> inbound capture writer is service-role-only. Both report the offending name, not
> a number — "3 functions leaked" is not actionable at 3am and
> "record_inbound_email leaked" is.
>
> **Non-admin reveals are asserted to fail loudly.** `read_enquiry_contact` raises
> `not authorised` *before* writing the log, which is what makes the follow-on
> assertion true: a refused attempt leaves no audit row, so the log count remains
> an accurate record of accesses rather than of attempts. An earlier draft used
> pgtap's `throws_ok(call, text, text)`, which in this build compares its third
> argument against the error **message**, so the correctly-refusing function
> reported as failing — the same trap AC-55..AC-59 hit and why those are probes.
> Replaced with a `GET STACKED DIAGNOSTICS` probe asserting SQLSTATE and message
> exactly, rather than reworded until green.
>
> **Verified (Phase D):** 115 applied, exit 0, self-test green · **149/149 pgtap**
> (`plan(136)`→`149`; AC-35a/b, AC-36a/b/c, AC-37, AC-38a/b, AC-39a/b, AC-40,
> PR-02a/b) · live check after the revoke: `service_role` UPDATE=false DELETE=false
> INSERT=true, `authenticated` all false · both baselines re-captured,
> `schema:validate` 84/84 and `:app` 41/41 · grants file grew 21,491→22,026 chars
> as expected · nothing previously captured was lost.
>
> **Follow-up recorded, not done here.** Measured rather than assumed, because the
> first draft of this paragraph guessed at two table names that do not exist:
> `service_role` **does** hold UPDATE and DELETE on `public.email_log` and on
> `public.processed_webhook_events` (the webhook idempotency ledger - editable
> means a delivery can be made to look never-received, which is the same class of
> problem as an editable audit trail). It holds **nothing at all** on
> `reporting.refresh_log`, so the platform default is not uniform across schemas
> and the pattern cannot be assumed either way. Each of the two remaining tables
> needs its own check that no legitimate retention job prunes or updates it before
> revoking, so they are not batched into a security migration under a "while I'm
> here" banner — that is how nightly cleanup jobs break.
>
> ### Post-ship review found two more — migrations 116 and 117 (2026-11-21)
>
> After Phase D I queried the privilege matrix for the objects this item had just
> added, rather than trusting that the migrations said what I meant them to say.
> Two things came back that every green suite had missed.
>
> **116: I gave the read-only role the ability to rebuild the warehouse.** 111
> granted EXECUTE on `reporting.load_enquiry_facts` to `reporting_ro`. That role
> has no write privilege on any table, which is the entire reason it exists — but
> the function is `SECURITY DEFINER` and postgres-owned, so it truncates and
> reinserts *as the owner*, whatever the caller may do. The grant didn't widen
> read access; it bypassed the model that makes the role safe to hand to a
> dashboard. One call empties `fact_enquiry`, and on a report whose headline is
> "are enquiries answered in time" an empty table is indistinguishable from a
> quiet night. Cost of the fix: one revoke. AC-75 asserts it as a scan over every
> `load_*` rather than naming this function, so the next fact table can't repeat
> it; AC-76a/b assert the owner and the hourly job can still do the work, because
> hardening that breaks the pipeline is not hardening.
>
> **The claim worth keeping is how it was written.** 111's header argues at length
> that the loader follows the house watermark pattern, and the GRANT was written to
> match that belief. Measured afterwards: all five existing reporting loaders return
> `false` for `reporting_ro`. It was never the convention. A long comment
> describing what was *assumed* about a codebase reads exactly like one describing
> what was checked, and nothing in the suite could tell them apart.
>
> **117: the backup was a way of producing a different production.**
> `supabase/reset/10_reporting_function_acls.sql` exists precisely because
> `pg_get_functiondef` omits ACLs — without it, a baseline restore recreates every
> reporting function PUBLIC-executable. But it was generated by hand from live
> once, and nothing regenerates it: `schema:rebaseline` does not touch it. So
> every reporting function added since that capture, 111's loader among them, is
> absent from it — meaning on a restored database `anon` can call a postgres-owned
> definer function that truncates the warehouse. **Live is completely correct
> here**, which is exactly why no live-state check could ever have caught this: the
> defect exists only on the machine rebuilt from the backup.
>
> Fixed by making the file generated rather than hand-appended —
> `export_baseline_function_acls()`, called by the capture step, mirroring the
> config-table capture's own pattern of deriving from live state. Appending one
> line would have fixed today and reproduced the bug with the next migration,
> because the failure was never in the file, it was in nobody re-making it.
>
> **Two bugs in my own first attempt, both caught before commit.** The generator
> emitted `p.oid::regprocedure::text`, which omits the schema when the function is
> on the current `search_path` — and the function's own `search_path` *is*
> reporting. Unqualified revoke targets resolve against whatever the restore
> harness happens to set, so a lock-down script would depend on ambient state.
> Same class as the bug 033 fixed for the refresh-lag check. And the header
> comment mentioned `export_baseline_config`, which tripped the self-test that
> forbids capture tooling leaking into the restore script — the check was right,
> the prose got in the way, and the wording moved rather than the assertion being
> weakened.
>
> **Verified (116/117):** both applied, psql exit 0, self-tests green · generated
> ACL script executed against live, exit 0, 29 functions, signatures qualified ·
> **155/155 pgtap** (`plan(149)`→`155`; AC-75, AC-76a/b, AC-77..AC-79) · all 8 Node
> suites green · `schema:validate` 84/84 after recounting (reporting functions
> 30→31) and `:app` 41/41 after re-dumping the app baseline · typecheck 0 · build 0 ·
> lint unchanged 60/16 · ACL file now contains `load_enquiry_facts` where it
> contained nothing about it before.
>
> ### The drift detector had itself drifted — migrations 118, 119 (2026-11-21)
>
> Continuing the thread 117 opened, I read the *rest* of the restore harness
> rather than only the file I had just fixed. The parity checks at the end of
> `scripts/reset-via-psql.mjs` — the step whose stated job is to prove a rebuilt
> database matches live — had hand-tuned literals that had aged badly: 57 public
> functions against a live 69, 24 reporting tables against 28, 14 cron jobs
> against 15. **The instrument measuring drift was the most drifted thing in the
> pipeline**, and every restore since would have reported those as failures,
> training whoever reads it to scroll past the line that matters.
>
> Worse, it could not have caught 117 even when current: it counted objects and
> never inspected a single grant. A restore that recreated every reporting
> function PUBLIC-executable would pass all 17 checks, because the functions were
> indeed there.
>
> **118 makes the expectations generated.** `export_baseline_parity()` derives
> every schema count from live and `schema:rebaseline` writes
> `baseline/parity.json`; the harness reads that file. Regenerating the baseline
> and regenerating its expectations are now the same act, which is the only
> arrangement under which they cannot disagree. `privilege_parity_checks()` adds
> seven reachability invariants asked of whichever database runs them — including
> **no reporting function carries the default PUBLIC ACL**, which is the check
> that actually detects an ACL file that failed to apply. The migration refuses
> to write a manifest if live itself violates any invariant: a reference standard
> live misses can only ever blame the restore.
>
> Seed contents (54 tests, 1900 questions) deliberately stayed literal. Deriving
> them from live would grade a content-losing restore against a live database
> that had also lost the content — a check that can only agree with whatever
> happened.
>
> **119 corrected a belief 117 had encoded.** 117 excluded three functions from
> the ACL script as "live-only, absent from any reset target". Checked against
> the capture: `export_baseline_config` and `export_baseline_function_acls` are
> **both present in 02_functions.sql** — they are restored, and were not revoked.
> The exclusion was an assumption about the capture rather than a fact taken from
> it, in the one file whose purpose is to keep the capture honest. Coverage is now
> every reporting function with no exclusions, applied tolerantly: over-covering
> costs a skippable error on a name a target lacks, under-covering is a silent
> privilege widening. Coverage is asserted exactly (`named == catalog`), so the
> two cannot drift apart.
>
> **The new invariant exposed a flaw in my own older assertion.** PR-02a — "no
> reporting function reads enquiry_contacts" — failed, because 119's parity
> checker mentions the table as an argument to `has_table_privilege()` and reads
> no rows. The check was flagging *talking about* a table as *reaching* it.
> Tightened to an access pattern (`FROM|JOIN|UPDATE|INSERT INTO` + the table),
> and verified against the two functions that legitimately do touch it before
> trusting the new wording. Then added PR-02c as a control: the same pattern must
> still fire on real readers. Without that, a typo in the regex would match
> nothing, PR-02a would pass forever, and the guarantee would be gone while the
> suite stayed green — the failure mode this whole line of work keeps finding.
>
> **Verified (118/119):** both applied, psql exit 0, self-tests green (119's
> refuses to bless a live that violates its own invariants) · **156/156 pgtap** ·
> all 8 Node suites green · `schema:validate` 84/84 and `:app` 41/41 after
> recounting (reporting functions 31→33) · both baselines, `parity.json` and the
> ACL file regenerated · harness syntax checked, `readFileSync` import confirmed
> present · **11/11 parity metrics agree between the two independent
> implementations** (the harness's own SQL strings, extracted from the real
> source file, versus the database function) — that cross-check is itself new,
> and it is what stops the two formulations drifting apart unnoticed.
>
> **What remains unproven, stated plainly.** The full scratch rebuild has not been
> re-run since these changes. It needs the `mocktests-reset-proof` project's
> direct connection string, which is not in `.env.local` (only the live URL is)
> and is not obtainable through the tools I have. Correcting a claim from the
> draft of this paragraph: the harness HAS been proven end-to-end before — a full
> reset on 2026-11-19 with 17/17 parity checks and the assurance suite green on
> the rebuilt database, recorded in `supabase/reset/README.md`. So this is not a
> story of an untested mechanism; it is a story of a mechanism that was tested,
> then left to age, which is the failure 118 was written to prevent. What is
> untested is 108–119 against a real restore.
>
> **Sequence complete.** Decisions **1–11** are all addressed, Phases **A, B, C and
> D** have shipped, and the remaining work is operational rather than undecided:
> flipping `sla_is_confirmed` once a human has read the first real numbers,
> reviewing the 113 mapping rows, and enabling the `RESEND_INBOUND_SIGNING_SECRET`
> plus `inbound_email_enabled` pair once a mail domain actually exists.
> Decisions **1, 2, 4, 6, 8, 9, 10 and 11 are done**, and **Phase C (A13) has
> shipped.** Remaining: Phase D (the pgtap assurance items listed for this backlog
> entry, most of which landed alongside 109-112 rather than after them).
>
> **Migration numbering note, recorded because the plan changed under it four
> times:** the original sequence reserved 105 for the business-day calendar.
> Decision 9 landed first and took 105; D3 took 106; decision 4-A's seed took 107;
> the clamp policy that followed from it took 108. The SLA work is therefore
> **109**, and earlier references in this section and in `14-…md` §19 to
> "migration 105" for holiday calendars should be read as 109. Renumbering a plan
> four times is fine; the moment that becomes dangerous is when a number is
> referenced as though it were applied and is not, which is why each step is stated
> with what actually took it.

>
> ### ✅ A4 Test-Form Metrics shipped, and the assurance it needed (2026-11-22, migration 121)
>
> Closes the **A4 half of backlog item 19** — the last report in the programme that
> had real data behind it and no code. Item 17 (writing marks) is deliberately NOT
> built yet and the reason is measured, not assumed: `writing_evaluations` holds
> **0 rows**, no student has ever sat one of the 6 published writing tests
> (`writing_responses = 0`), and A5/A6/A7 would therefore render three empty
> screens. One AI-practice session has been graded (deepseek-flash, rubric v1.0,
> 55 s), so the pipeline works; the gap is content and assignment, not engineering.
> Item 14–16 (Stripe revenue) is in the same position: `purchases` and
> `entitlements` are both empty, so A8/A9/A10 would be empty too.
>
> **What was built** — `reporting.test_form_metrics`, `test_form_score_distribution`,
> a pure `reporting.kr20`, a `test_form_thresholds` config row, three
> ADMIN-gated public wrappers, `/api/reporting/admin/test-form-metrics` (+CSV), and
> `TestFormMetricsPanel` on `/admin/reports` under A1.
>
> **The honest part, which is most of the work.** KR-20 needs a complete
> item × person matrix and this runner does not produce one: it serves ~12–21 items
> from a pool of up to 90 and **writes no row for an unserved item**, so a skip and
> an unserved item are indistinguishable — the same capture gap A1 reports. Measured
> before writing anything: **0 items are answered by every submitted attempt, on
> every one of the 16 forms.** So the coefficient is computed only over attempts
> that answered the form's full item set, and returns NULL with one of five states
> (`TOO_FEW_ITEMS`, `NO_COMPLETE_ATTEMPTS`, `TOO_FEW_ATTEMPTS`, `NO_VARIANCE`, `OK`)
> when it cannot. The three shortcuts that would have produced a number — scoring
> unserved items wrong, using the pairwise-present subset, or switching to partial
> Cronbach's α — were each rejected in the migration header with the reason.
> `items_answered_by_all` is returned beside the coefficient so the gap is visible
> and shrinks as capture improves.
>
> **The apply-time self-test caught a real bug on its first run.** The first draft
> computed the coefficient with no attempt-floor gate, so a form with fewer than
> `min_attempts_for_reliability` complete attempts produced a number while its state
> said `TOO_FEW_ATTEMPTS` — exactly the "never a coefficient from 5 attempts" rule in
> §5. The gate now lives with the formula in one `LATERAL`, and an assertion fails
> if a state and a coefficient can ever disagree again.
>
> **Verified by execution, not inspection:**
> `psql -f supabase/migrations/121_test_form_metrics.sql` on live → exit 0 and
> `121 self-test ok` (so repo and database are literally the same file) ·
> **pgtap 162/162**, including six new assertions AC-80…85 that exist for the
> restore, not for live (form-per-row identity, the state/coefficient invariant, the
> floor's VALUE surviving, the KR-20 textbook value, and both ACL directions) ·
> all **9 Node suites, 577 assertions** · typecheck 0 · lint ratchet **tightened
> 60 → 57** · build 0 · `schema:validate` **84/84** after regeneration
> (29 tables, 38 live / 37 captured functions — the difference is `export_baseline`,
> which declines to capture itself, per 120) · `schema:validate:app` **41/41** after a
> fresh `pg_dump -f` capture · SEO **2502** · consent **36**.
>
> **And the scratch rebuild is finally green again — the item the backlog has
> carried as unproven since migration 108.** `npm run db:reset -- --fresh` against
> `mocktests-reset-proof`: **25 steps ok, 4 skipped by flag, 16/16 parity checks
> PASS, all 8 privilege invariants hold, `RESET COMPLETE`.** Two things made that
> possible and both are worth recording: `00_fresh_schemas.sql` (the pipeline was
> additive end to end, so a second run on the same project died on 303
> `already exists` errors that the tolerance auditor correctly refused to excuse),
> and a working **IPv4 route** — the direct `db.<ref>.supabase.co` host resolves
> AAAA-only here and times out, while `aws-0/aws-1-ap-southeast-2.pooler.supabase.com`
> works with `postgres.<ref>` as the user. The old `.env.local` password was stale,
> which is why earlier sessions concluded the database was unreachable: the tooling
> was fine, the credential was not.
>
> **Live output sanity-checked against the facts:** Language Conventions Y7 —
> 240 started, 227 submitted, 13 abandoned (94.6%, and 240 = 227 + 13), median stop
> at item 43 of 90, mean 53.2; histogram over 227 attempts totals exactly `score_n`
> and is unimodal. 6 forms report `TOO_FEW_ITEMS` (single-item speed tests), 5 report
> `NO_COMPLETE_ATTEMPTS`.
>
> **Recorded deviations:** (1) A4 is a live function, not a nightly MV as §4's
> refresh column says — it aggregates 1,300 attempts in single-digit ms, and a stale
> "can I unpublish this form this morning" answer is worse than no MV; the trigger to
> change is stated in the migration. (2) `abandonment_point` takes the average
> position from `public.test_questions.question_order`, because neither
> `fact_item_response` nor `public.responses` has a position column.
>
> **Two bookkeeping facts, stated rather than tidied away:** migration 121 was
> applied through the MCP tooling in four parts, so `schema_migrations` holds four
> rows under that name (the first, an empty placeholder, was removed once its
> no-op nature was confirmed). And the app-schema capture had drifted further than
> anyone had measured — it held 69 functions against 75 live, which the re-capture
> corrects.
>
> **Stale-claim sweep, done in the same pass.** Four shipped comments still asserted
> that `responses.is_correct` disagrees with the answer key for "52% of MCQ
> responses" and that every accuracy figure in A1/P3/T1/T2/T3/T7 was therefore
> measuring nothing. It is **0 disagreements across 17,604 MCQ responses**, and
> `marking_reliable` is true for all 1,750 items — so the caveats those comments
> describe are correctly silent. All four now say how the caveat is DERIVED
> (`marking_reliable` from SQL) and record the measurement instead of quoting a
> percentage that rots.
>
> **Still open on A4, deliberately:** T4 and A1 own item-level metrics, so A4 does
> not restate them; and the reliability column will stay NULL until the runner
> records served items. That is one change — record `served_items` per attempt — and
> it unblocks A1's skip rate, A4's KR-20 and A2/A4's pathway work at once. It is
> now the single highest-value capture change in the programme.

> ### ✅ Served-item capture shipped (2026-11-22, migration 122)
>
> The item the entry above called the single highest-value capture change. Every
> accuracy report was missing half its input: `responses` records what a child DID,
> nothing recorded what they were GIVEN. A skipped item and an unserved item were
> the same absence, which is why A1 skip rate read 0.0% for all 1,750 items and
> A4 KR-20 was uncomputable on all 16 forms.
>
> **What shipped.** `public.attempt_items_served` - one row per item DISPLAYED,
> primary key `(attempt_id, question_id)`, INSERT-only, forced RLS, and NO SELECT
> policy at all (a child's own exposure history is not theirs to read back; the
> reporting layer reads it through the fact table). `POST /api/runner/served`
> resolves the attempt through `my_attempt_context`, proves the items belong to that
> test, and inserts ON CONFLICT DO NOTHING so retries, resumed attempts and racing
> tabs converge. `reporting.fact_item_served` + `load_served_facts()`
> (INSERT-missing, PK-guarded, hourly at :20).
>
> **The runner side is a ledger, not a watermark.** With the grid navigator a child
> can jump from question 2 to question 40, so highest-index-reached would claim 38
> items were served that they never saw. The client keeps a `seen` set and a
> `pending` queue (`src/lib/runner/served.ts`, pure and unit-tested): a reported id
> is never re-sent, an unaccepted id stays pending and rides the next navigation,
> and a pagehide beacon plus a pre-submit flush catch the tail.
>
> **Two defects the new assertions caught.**
>
> 1. AC-75 failed on a grant this migration had just written - no reporting loader
>    may be executable by the read-only role. Its comment says it exists so the next
>    fact table added with the same well-meaning grant fails there, and it did, on
>    the first run. The subtler half: fixing it required naming `reporting_ro` in
>    the REVOKE, because grants are additive and `REVOKE ... FROM PUBLIC` does not
>    undo a grant made to a specific role - so the first fix left the privilege in
>    place on re-apply.
> 2. My own pgtap fixture would have passed vacuously. It took `LIMIT 1` from
>    `student_profiles` and then looked for that student attempts; the first profile
>    had sat nothing, so every assertion would have compared NULLs. Rewritten to
>    pick an attempt first and derive its owner, with the JWT claim set to it. A
>    test that cannot find its subject must fail, not agree.
>
> **Verified:** `psql -f 122` exit 0 with `122 self-test ok` (repo == database) -
> pgtap 169/169 including AC-86..90, which impersonate a student with a real role
> switch and JWT claim - 10 Node suites, 595 assertions - typecheck 0 - lint ratchet
> unchanged at 57 - `schema:validate` 84/84 and `schema:validate:app` 41/41 after
> re-capture.
>
> **Not done here, deliberately:** A1 `skip_rate` and A4 `items_answered_by_all`
> still use the old definitions. Changing a metric and its input in one commit makes
> it impossible to say which one moved a number, so consumption is the next item -
> and it is now a report change with no capture work behind it.
>
> ### ✅ Sample fixtures for the empty tables (2026-11-22, seeds 003-005)
>
> Three tables the remaining backlog needed were empty for the plain reason that
> nothing writes to them yet. They are now seeded, deterministically, in the same
> reserved-prefix style as 001 and removable by 999.
>
> | Seed | Fills | Unblocks |
> |---|---|---|
> | 003 | `attempt_items_served` + `fact_item_served` | A1 skip rate (denominator), A4 KR-20 input |
> | 004 | 36 writing attempts + essays + `writing_evaluations` + 6 practice sessions | item 17: P6/T6/A5/A6/A7 |
> | 005 | 24 purchases, 48 entitlements, 8 subscriptions | N-5/N-8 expansion, `has_entitlement` |
>
> **A real defect fell out of writing 003, in the migration it was feeding.** The
> served table was deliberately insert-only with **no SELECT policy** - and
> `ON CONFLICT DO NOTHING`, which every beacon uses to be idempotent, must READ the
> conflicting row. With no SELECT policy PostgreSQL refuses the insert and reports
> *"new row violates row-level security policy"*, blaming the INSERT policy for a
> missing SELECT one. A plain insert succeeded while the identical ON CONFLICT insert
> was refused; pgtap AC-86 caught it, and nothing else would have - the HTTP path
> cannot be exercised without a signed-in student. Fixed in 122 with an owner-scoped
> SELECT policy, and asserted in the migration's own self-test so a future
> "least-privilege" edit cannot remove it again.
>
> **Two flavours of the same lesson about fixtures.** AC-86 and AC-89 both failed the
> moment the sample data existed, because each assumed an empty database: AC-86 did a
> bare insert that now hit a duplicate, and AC-89 asserted the loader "inserts >= 1"
> row when everything was already loaded. Both were rewritten to assert the property
> (the policy permits the write; the fact contains the row) rather than a count that
> only holds before anyone seeds. A test that passes only on an empty database is a
> test that stops testing anything the day the product has data.
>
> **What the fixtures deliberately still do not do:**
> - A8/A9/A10 still render empty. They read `fact_order`/`fact_subscription`, which
>   items 14-15 have not built; seeding `purchases` cannot substitute for ingestion,
>   and `provider = 'sample'` keeps those rows from ever being mistaken for Stripe's.
> - A1's `skip_rate_pct` is still 0.0% and `skip_rate_reliable` still false: the
>   denominator now exists but the report has not been taught to use it.
> - KR-20 is still uncomputable, and the reason is upstream of capture: **no item is
>   ANSWERED by every attempt of its form** in the 001 data, so there is no complete
>   matrix. Verified: 4 shared served items, 0 complete matrices. Fixing it means
>   regenerating 001's responses around a common core (which changes every derived
>   score) or a dedicated cohort - not inventing answers inside a served seed.
>
> **Measured shape:** 20,322 served rows over 1,279 attempts, **86.6% answered /
> 13.4% skipped**, 46 items served to every submitted attempt of their form; 36 marks
> (18 narrative, 18 persuasive) averaging 71.6/72.3/70.8 with category sums that
> never exceed their maxima; A6's length-score correlation is +0.189 narrative /
> −0.410 persuasive, so that report has real variance to plot.
>
> **Verified:** all three seeds run from file and re-run to zero inserts (004/005) or
> an identical rebuild (003) · pgtap **170/170** · 10 Node suites 595 · `schema:validate`
> 84/84 · `schema:validate:app` 41/41 after re-capture · seeds added to the reset
> harness under `--with-sample-data`.

> **Separate, pre-existing history drift found while applying 105–107, and it is
> wider than it first looked.** The live
> `supabase_migrations.schema_migrations` table keys history on a **timestamp**
> version (`20261119214132`) plus a name, while every local file is named
> `107_year_level_caps.sql` — a sequence number where a timestamp should be. The
> CLI derives its version from the filename, so it cannot reconcile *any* of these
> files against the remote history, not merely the two that look worst.
>
> The visible symptom is narrower and still worth fixing: migrations 096–102 were
> recorded with their file names (`101_year_level_to_9`), but the two support
> migrations were recorded as `enquiry_ingest` and `enquiry_source_ref_lookup` —
> matching neither a filename nor each other, since the repo has
> `103_enquiry_ingest.sql` and `104_enquiry_triage.sql`. So two different kinds of
> drift are in play: a naming convention the CLI cannot read at all, and within it
> an inconsistency that hides which file produced which row.
>
> There is no Supabase CLI in this environment, so migrations are applied through
> the MCP tool, which takes a free-form name — and a name typed at the moment of
> applying need not match the file, which is how the second kind arises. Neither
> affects the running system: the schema is correct, and `schema:validate` compares
> live structure to the captured baseline rather than trusting history. But history
> is the only thing that answers "is this file already in?", and right now that
> answer is reconstructable only by reading object definitions.
>
> Recorded rather than fixed: rewriting applied history to rename rows is riskier
> than annotating it, and adopting timestamp filenames properly means renaming 100+
> files and re-baselining, which is its own decision. 105, 106 and 107 were
> consistent with whatever convention was to hand, which is not a solution —
> whichever way this is resolved, it should be resolved once and then followed.














| Area | Roadmap says | **Measured** |
|---|---|---|
| Student access breach (R-01) | "Critical — live right now" | **Closed.** `015` applied; no student SELECT policy on `attempts`/`responses`. Only INSERT/UPDATE for students; SELECT gated on `may_read_results()`. |
| VC2 mapping (R-02, A-02) | "High — gates 8 reports, biggest schedule risk" | **Retired.** Migration `026` dropped VC2. Only `dim_skill_area` exists. P3/A3/TC1 shipped without it. |
| Year-level caps (Q-4, R-05) | "Unset — overload protection inactive" | **Resolved.** `dim_year_level_cap` has 7 rows. |
| `funnel_conversion` view | "exists as a view and nothing surfaces it" | **Does not exist.** A11 must build it, not just surface it. |
| N-3 annual-saving copy | "single outstanding copy check" | **Done.** `BillingToggle` already renders `$120 saved`, percentage only as fallback. |
| Contact channel | "build POST /api/enquiries + web form" | **Not built.** `/contact` is mailto-only; `enquiries` table applied but 0 rows. |
| Migration `010` | "fixed in repo, not applied" | **Absent from history.** `subscriptions` exists; `exam_targets` does not — targets live in `funnel_state`. Low impact, but history is inconsistent. |

**Phase status**: Phase 0 effectively complete. Phase 1 — all 10 reports shipped, **§15 test
suite not started**. Phase 2 — P3/A3/TC1 shipped, remainder pending. Phase 3 — nothing built.

### The three findings that change the critical path

1. **There is no CI.** `.github/workflows` does not exist. Four Node suites (173 assertions)
   run only when someone remembers to run them.
2. **`pgtap` is not installed.** The entire §15 in-database suite — DA-01…19, AC-01…40,
   PR-01…07, PF-01…08 — has nowhere to run. That is ~12 engineering days of *already
   estimated* test work across three phases with no host.
3. **29 of 45 migrations exist only in the database.** Local folder has 16 files.
   `supabase db reset` destroys the whole reporting layer. No work can be reviewed as a
   diff or reproduced in CI.

Together these mean the project has **no automated safety net**, in a product that has
already produced **three privilege-escalation defects**: inherited `reporting_ro`
(roadmap §20.3), column grants that cannot separate parent from student (§20.4), and
anon-executable reporting RPCs found this session. All three were invisible to the build.

**That is the dominant risk, and it outranks every feature below.**

---

## 2. P0 — Decisions (zero engineering effort, unblock whole phases)

These are the cheapest unblocks in the programme. Each is a one-line answer that releases
days of work. Nothing else should be scheduled ahead of asking them.

| # | Decision needed | Unblocks | Cost of delay |
|---|---|---|---|
| **D-A** | Value for `reporting.coverage_thresholds.min_items_per_subtopic` | A3 + TC1 can *classify* coverage instead of only ordering it. Clears the standing A15 **FAIL**. | **CLOSED before this table was written.** Migration 046 set it to **10**, derived as 2 × `MIN_ITEMS_FOR_SIGNAL`; verified live on 2026-11-20. This row is stale as a *question* and is left visible rather than deleted so the sequence — a decision worth minutes sat here labelled outstanding — stays on the record. |
| **D-B** | **Q-2** — confirm tutor access semantics ("all reports for consented students; no unlinked students; no billing") | The entire tutor surface: **9 reports** (P10, T1, T2, T3, T5, T7, P6, T6, later T4) | Largest report-count block in the programme. Cannot start consent schema without it. |
| **D-C** | **Q-7 / A-18** — GST treatment per product line | All revenue reporting (A8, A9, A10) and reconciliation | Flagged **High**: `gross/1.10` misstates revenue if any line is GST-free. Building first guarantees rework. **Corrected 2026-11-20 — there is no `/1.10` to rework.** Revenue maths goes through `reporting.net_ex_gst()`, which reads `reporting.product_tax_treatment` per `product_key`; a catalog scan of every function whose body mentions revenue/gross/amount found **zero** hard-coded GST divisors. Four rows are seeded, all `inclusive @ 10.00`, including `writing_booster` declared before its first sale. So D-C is now **a product/accounting question with a one-`UPDATE` answer per line**, not a schema risk — the remaining exposure is whether `inclusive@10%` is *correct* for each line (education services can be GST-free in some configurations), which is an accountant's call and is still outstanding. The table being wired is what makes that call cheap; it was not obvious from the roadmap's wording, and the difference matters for scheduling. |
| **D-D** | Should A14 be exempt from the refresh blackout? | A14 freshness during peak | `mv_platform_health` stops refreshing exactly when the platform is busiest (weekends 09:00–13:00, weekdays 16:00–21:00 Melbourne) — i.e. when "is it coping?" matters most. |
| **D-E** | Confirm **D-2** (paywall threshold stays 2) and **D-4** (marketing percentiles gated on n≥200) | Removes two open conversion questions | **CLOSED 2026-11-20 by decision 10-A.** `PAYWALL_ATTEMPT_THRESHOLD = 2` in `src/lib/funnel/state.ts` stays. No code change, which is the point: the question was whether to *act*, and the answer was not to. D-4 (percentiles at n≥200) remains blocked on sample size, not on a decision. |

**Scrum note (superseded for D-A)**: the standing advice to "raise D-A at the next
standup" was overtaken by events — it was answered and shipped in migration 046 as
`min_items_per_subtopic = 10`. What the note got right is general and still worth
keeping: **a decision measured in minutes can block a delivered report for longer
than the engineering would have taken**, and the expensive part is not the answer
but the asking. D-E closed the same way in this session, for the same reason.


---

## 3. P1 — Assurance pipeline (build this before any new feature)

**Why this ranks above revenue, tutor and conversion**: every later phase budgets ~4 days
of tests. Without a host those days are unspendable, and the three access-control defects
already found prove that "the build is green" currently means nothing about correctness.
Item 1 is also a hard prerequisite for item 2 running in CI.

| # | Item | Est. | Unblocks | Definition of done |
|---|---|---|---|---|
| **1** | **Re-baseline migrations into the repo.** `pg_dump --schema-only --no-owner --no-privileges` for `public` + `reporting`, plus explicit capture of the three things a dump drops: **11 `pg_cron` jobs**, **`reporting_ro` grants + every `REVOKE FROM PUBLIC` / `GRANT TO authenticated` pair**, and **config rows** (`coverage_thresholds`, `funnel_thresholds`, `dim_year_level_cap`, `platform_capacity`, `refresh_blackout`). | ~1 d | CI, code review as diffs, local dev, onboarding, disaster recovery | `supabase db reset` on a clean instance reproduces a working reporting layer; the README's warning can be deleted |
| **2** | **Install `pgtap` + deterministic fixture seed + DB test runner.** 200 students × 6 year levels × 4 families × 12 months, with **hand-computed** expected values for a subset (a fixture whose expectation came from the same SQL proves stability, not correctness). | ~2 d | The whole §15 suite; safe tutor-consent work; every later phase's test budget | `npm run test:db` runs pgtap against a reset database and is green |
| **3** | **CI workflow** running typecheck, lint, the four Node suites, and item 2's DB suite on every PR. | ~0.5 d | Everything. Converts all existing tests from optional to enforced | A PR that breaks an assertion cannot merge |
| **4** | **Cheap static gates** (no fixtures needed, highest value per hour): **PR-01** PII-column grep over `information_schema`; **PF-02** assert no dashboard route touches a `fact_*` table; **the anon-RPC check** already living in A15, mirrored into CI so it fails a PR rather than a nightly report. | ~0.5 d | Prevents recurrence of all three known escalation classes | Each gate demonstrably fails on an injected violation |
| **5** | **AC-01…AC-08 + AC-39/AC-40** as executable tests, not a pasted migration. AC-40 (a child can still sit a test end-to-end) is the half that gets skipped and the half that takes the product down. | ~1 d | Confidence to change any RLS policy — mandatory before tutor consent | Both the negative (student cannot read scores) and positive (student can complete a test) assertions run in CI |
| **6** | **Greyscale chart diff + axe-core scan** (A11Y-01…09). The heatmap already ships decals; this makes the property *tested* rather than asserted. | ~0.5 d | Every chart in Phases 2–3 (tutor heatmap, item stats, distributions) | CI renders each chart to greyscale and diffs; zero serious/critical axe violations |

**Sequencing within P1**: 1 → 2 → 3, then 4/5/6 in parallel. Item 4 can start immediately
alongside 1 because it needs no fixtures.

**Phase 1 cannot be declared done until items 2–5 are green.** Its stated exit criterion is
"all §15 tests green"; today that criterion is unmeasurable.

---

## 4. P2 — Measurement loop (highest business leverage, and wrongly parked in Phase 3)

**The sequencing insight**: A11/A12 sit in Phase 3 behind Stripe ingestion, but **neither
needs Stripe**. Funnel and experiment reporting read `funnel_events` only. They can be
pulled forward at zero dependency cost.

This matters because the funnel is now **fully instrumented and entirely unread**. This
session wired the last declared-but-unemitted events; `PAYWALL_LOCK_CLICKED` captures which
insight a parent clicked and its own file header calls it "the most valuable single datum in
the funnel" — and it is still write-only. That instrumentation is a sunk cost returning
nothing until A11 exists.

Doc `15-…md` §2.2 states it plainly: *"You cannot optimise a funnel you cannot see. Every
lever above needs this first."* Decision **D-6** already approved measurement-first.

| # | Item | Est. | Unblocks |
|---|---|---|---|
| **7** | **A11 funnel reporting** — build `funnel_conversion` (it does not exist), stage conversion, segments, device derivation | ~4 d | Every conversion decision. Turns the completed instrumentation into a return |
| **8** | **A12 experiments + exposure logging** | ~3 d | The 1-vs-2 paywall question (**D-2**) becomes a measured experiment instead of a constant someone edits |
| **9** | **N-7 locked-click personalisation** — read back `PAYWALL_LOCK_CLICKED` on the offer page | ~1 d | Conversion lift from data already collected. Cheapest revenue item available |
| **10** | **N-5 sibling offer at add-child** + **N-8 one-tap re-purchase** | ~3 d | ARPPU and lowest-CAC revenue. Step 9 "Expand" is 🔴 Absent in `10-funnel-gap-analysis.md` |

**Order matters**: 7 → 8 → then 9/10 measured against a baseline. Building 9/10 first
reproduces the current problem — mechanics without measurement.

---

## 5. P3 — Tutor surface (largest report-count unblock)

**Blocked by D-B and by P1 items 2/5.** `tutor_student_links` and `consent_records` do not
exist — verified. Consent is an access-control feature, and the roadmap's own warning
applies: *"a tutor dashboard without consent is a privacy incident."* Shipping it before
AC-21…24 are executable would repeat the pattern that produced three escalation defects.

| # | Item | Est. | Unblocks |
|---|---|---|---|
| **11** | Consent foundation: `tutor_student_links`, `consent_records`, **P10** consent UX, revocation with immediate effect | ~4 d | All 8 remaining tutor reports |
| **12** | **AC-21…AC-26** consent tests (live/unexpired/unrevoked; no billing; no unlinked students) | ~1 d | Safe to ship item 11 at all |
| **13** | **T1, T2, T3, T5, T7** + tutor heatmap | ~5 d | Tutor value proposition |

**Note**: T2 consumes P3's `mastery_level`, which now exists — one fewer dependency than the
roadmap assumed.

---

## 6. P4 — Revenue reporting

**Blocked by D-C (GST).** Building before that answer guarantees rework of the
highest-consequence numbers in the system.

| # | Item | Est. | Unblocks |
|---|---|---|---|
| **14** | Stripe ingestion: charges, refunds, disputes, balance transactions; fee + GST handling | ~5 d | A8, A9, A10; clears A15's `NOT_IMPLEMENTED` stripe check |
| **15** | Nightly reconciliation + gap blocking; `fact_order`, `fact_subscription` | ~7 d | **A8, A9**; DA-04/DA-05 become testable |
| **16** | **A10** cohort retention & LTV (+ manual spend entry for CAC) | ~3 d | Channel decisions. Until spend exists, CAC/ROAS stay `null` with an explicit "not recorded" state (R-07) |

---

## 7. P5 — Content, marking and item analytics

| # | Item | Est. | Unblocks / note |
|---|---|---|---|
| **17** | Writing mark extension: criterion capture, `fact_writing_mark`, `model_version NOT NULL` | ~4 d | **P6, T6, A5, A6, A7** (5 reports) |
| **18** | Anchor set tooling + human moderation | ~6 d | R-04 is **High**: AI marks are unvalidated with no moderation. Consider labelling marks *provisional* until anchors exist — a copy change available today |
| **19** | **A1** item stats, **A2** adaptive health, **A4** test-form metrics | ~4 d | **T4** must follow A1 (single-owner rule). A2 renders an empty state until an adaptive engine exists — `attempts` has no pathway column; flagged, not invented |
| **20** | **P5** question review | ~3 d | Needs **authored misconception content** — editorial, not engineering. The surviving fragment of A-02 |
| **21** | Enquiry form + `POST /api/enquiries` → **A13** | ~2.5 d | Also a live product gap: paying customers currently have **mailto-only** support. `enquiries` has 0 rows |
| **22** | Partitioning (`pg_partman`), retention automation, alerting | ~3 d | Scale. Defer until volume justifies it |

---

## 8. Explicitly deferred — do **not** build these yet

Listing these as pending work would be a planning error. Each is blocked by data or a
decision, not by engineering, and building early ships a broken-looking screen.

| Item | Why not now |
|---|---|
| **P2 percentile** | **3 current students** against an n≥20 floor. Would render suppressed on every screen. Revisit when a real cohort exists. |
| **Marketing percentile claims (X-1)** | Needs n≥200. Below that it is an ACL s18 misleading-conduct exposure the moment anyone checks. |
| **`dim_curriculum_vc2` pipeline + creator tagging UI (4 d)** | **Obsolete.** VC2 was dropped in `026`. Delete this line from the roadmap and retire R-02. |
| **`PAYWALL_DISMISSED`** | No dismissible paywall surface exists. Adding a control purely to fire an event is inventing UI. Documented in the funnel-coverage allowlist. |
| **Apply migration `010`** | `subscriptions` already exists and exam targets live in `funnel_state`. Reconcile the history record during P1 item 1; do not re-apply blind. |
| **76-problem lint baseline** | 60 pre-existing errors, none introduced recently. Deserves its own cleanup ticket; blocks nothing. |

---

## 9. Dependency chain (critical path)

```
D-A (coverage threshold) ─────────────► A3 / TC1 classification   [minutes]

P1: 1 migrations ─► 2 pgtap/fixtures ─► 3 CI ─► {4 gates, 5 AC, 6 a11y}
                                             └─► gates EVERY item below

D-B (tutor semantics) ───┐
                         ├─► 11 consent ─► 12 AC tests ─► 13 T1/T2/T3/T5/T7
P1: 2 pgtap + 5 AC ──────┘

D-C (GST) ─────────────────► 14 Stripe ─► 15 recon ─► 16 A10

7 A11 ─► 8 A12 ─► {9 N-7, 10 N-5/N-8}    [no Stripe dependency — pull forward]

17 writing capture ─► 18 anchors ─► P6/T6/A5/A6/A7
19 A1 ─► T4
```

**Two independent tracks run in parallel once P1 lands**: the measurement track (7→10) and
the tutor track (11→13). They share no tables. That is the fastest route to both conversion
lift and the largest report-count gain.

## 10. Suggested sprint sequence

| Sprint | Focus | Exit |
|---|---|---|
| **S+1** | All P0 decisions asked; **P1 items 1, 3, 4** | Migrations in repo, CI enforcing existing tests, static gates live |
| **S+2** | **P1 items 2, 5, 6** | §15 AC/PR/PF suites executable; **Phase 1 formally closed** |
| **S+3** | **7 A11**, then **8 A12** | Funnel visible; instrumentation starts paying for itself |
| **S+4** | **9, 10** measured against the S+3 baseline; start **11** if D-B answered | First evidence-based conversion change |
| **S+5** | **12, 13** tutor; **14** Stripe if D-C answered | Tutor surface live with consent tests green |

## 11. Top three risks to raise at the next review

1. **No CI + no in-DB tests + migrations outside version control.** Three privilege-escalation
   defects have already shipped invisibly. This is a *delivery capability* gap, not a backlog
   item to trade against features.
2. **D-C (GST) unanswered while revenue work is planned.** Building A8/A9 on an unconfirmed
   tax assumption misstates the most consequential numbers in the business.
3. **Tutor consent scheduled without executable access tests.** The roadmap itself calls an
   unconsented tutor dashboard a privacy incident. P1 item 5 is a hard gate, not a nice-to-have.

---

## 12. One-paragraph summary for stakeholders

Phase 1's reports are shipped but its **exit criteria are unmeasurable** — there is no CI, no
in-database test runner, and 29 of 45 migrations exist only in the hosted database. Three
privilege-escalation defects have already passed a green build, so the next sprint should buy
*assurance capability*, not features. Two decisions (tutor access semantics, per-product GST)
and one config value (the coverage threshold) unblock nine reports, all revenue reporting, and
two already-delivered reports respectively, at near-zero engineering cost. The roadmap's
largest stated schedule risk — the unstaffed VC2 mapping — **no longer exists**, and A11/A12
can be pulled forward out of Phase 3 because they never depended on Stripe. Do that, and the
funnel instrumentation completed this session starts returning value instead of sitting
write-only.



