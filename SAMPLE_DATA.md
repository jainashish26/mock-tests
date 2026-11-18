# SAMPLE DATA — what is fake, and what to replace

> **Everything described here is synthetic.** It was created on 2026-11-15 to
> unblock reporting work that could not be built or tested against an empty
> database. It is not real usage, not real students, and must not inform any
> business decision about actual customers.
>
> Seed: `mock-tests/supabase/seeds/001_sample_dataset.sql`
> Teardown: `mock-tests/supabase/seeds/999_cleanup_sample_dataset.sql`
> These are **seeds, not migrations** — they will never replay automatically on a
> deploy.

## Why it exists

Before seeding, the database held **3 students, 1 attempt, 68 responses and 3
funnel events**. At that volume nothing could be verified:

| Blocked | Why |
|---|---|
| **P2 percentile** | Requires a cohort of n≥20; below that the value is suppressed by design. With 3 students the report could not exist at all. |
| **P4 trend** | Needs several attempts per child spread over months. |
| **P3 mastery / P8 recommendations** | Both refuse to state a verdict below 5 responses per topic. |
| **A11 funnel conversion** | Needs volume across stages *and* drop-off. A funnel where everyone reaches every stage hides any bug in the stage logic. |
| **A14 platform health** | Concurrency and duration metrics are meaningless on one attempt. |

`14-bi-reporting-assurance-roadmap.md` §15.1 makes the same point: *"the database
is empty — every table has 0 rows… fixtures are the product."*

## What was created

| Table | Rows | Identifying marker |
|---|---|---|
| `auth.users` | **300** (200 students + 100 parents) | `email LIKE '%@sample.invalid'`; `raw_user_meta_data->>'sample' = 'true'` |
| `public.student_profiles` | **200** | `id::text LIKE '5a000000-%'`; `username LIKE 'sample.student.%'` |
| `public.app_user_roles` | **300** (200 STUDENT + 100 PARENT) | `user_id::text LIKE '5f000000-%'` or `'5b000000-%'` |
| `public.parent_student_links` | **200** (2 children per parent) | `id::text LIKE '5c000000-%'` |
| `public.attempts` | **1,299** (48 left `IN_PROGRESS` = abandoned) | `id::text LIKE '5d000000-%'` |
| `public.responses` | **17,575** | `id::text LIKE '5e000000-%'` |
| `public.funnel_events` | **~570** across 19 event types | `id::text LIKE '59000000-%'`; `props->>'sample' = 'true'` |
| `public.funnel_state` | **58** (one per signed-up parent) | `user_id::text LIKE '5b000000-%'` |
| `public.experiment_assignments` | **100** (N-7 arms, 45 control / 55 personalised) | `subject_key LIKE '5b000000-%'` |
| `public.experiment_exposures` | **8** (only parents who reached the offer) | `subject_key LIKE '5b000000-%'` |
| `auth.users` (tutors) | **2** | `email LIKE 'sample.tutor.%@sample.invalid'`; id prefix `57000000-` |
| `public.tutor_student_links` | **6** (2 tutors × 3 students) | `id::text LIKE '58000000-%'` |
| `public.consent_records` | **6**, all ACTIVE, 12-month expiry | `tutor_user_id::text LIKE '57000000-%'` |
| `sample_data` schema | 1 helper function | whole schema is dropped by teardown |

The sample tutors exist so the consent-based tutor surface (T1/T2/T3) and P10 are
demonstrable. Each is linked to three sample students **with the parent as
`granted_by`**, which is the real grant path — not an administrator inserting rows.
The AC-21…26 tests exercise revocation and expiry against these rows and roll back.

The **100 assigned vs 8 exposed** gap is deliberate and is the point of A12: §5.4
warns that counting assigned-but-never-shown users biases every experiment toward
the null. The report counts 4 per arm, not 50. Sample exposures are backdated to
each parent's `OFFER_MADE` timestamp so the after-exposure conversion guard
produces a meaningful answer rather than excluding every historical checkout.

The experiment **definition** (`n7_locked_click_personalisation`) is configuration
and survives the teardown; only the sample subjects' arms are removed.

`funnel_state` is **derived from the seeded `funnel_events`**, not generated
independently — so the two cannot disagree about how far a parent got. Only
parents who reached `SIGNUP_COMPLETED` get a row, matching the application, which
creates `funnel_state` at signup rather than at first page view. The 5 sample
customers carry a **synthetic `first_purchase_amount_cents` of 14900 ($149.00)**;
real prices live in Stripe and ingestion is Phase 3.

Sample funnel events also carry two props that real events carry, so the reports
built on them are exercisable:

- **`device`** — assigned per *parent* (≈58% mobile / 12% tablet / 30% desktop),
  not per event, because a real visitor does not switch device mid-journey. This
  is what makes C9's device split demonstrable: mobile 124 / desktop 72 / tablet 7
  stage rows, no `unknown`.
- **`insight`** — on `PAYWALL_LOCK_CLICKED` only, one of the five real locked
  insight titles, assigned per parent. This is what lever N-7 reads back to order
  the offer's benefit list. All five titles appear across the 12 sample clicks.

Derived reporting rows (`dim_student` 203, `fact_test_attempt` 1300,
`fact_item_response` 12573, `fact_event` 511, `mv_skill_gap` 1051) are **not
sample rows themselves** — they are ETL output. The teardown re-runs the loaders
so they rebuild from whatever remains.

### Reserved UUID prefixes

Every synthetic primary key uses a prefix no real `gen_random_uuid()` can produce:

```
5a000000-…  student_profiles        5d000000-…  attempts
5b000000-…  parent auth.users       5e000000-…  responses
5c000000-…  parent_student_links    5f000000-…  student auth.users
59000000-…  funnel_events
```

Two independent markers (UUID prefix **and** `sample: true` in props / metadata)
mean the rows stay identifiable even if someone queries by a column other than
`id`.

## What is fake about the *values*

The shape is realistic; the values are invented. Specifically:

- **Ability** is drawn per student in `[0.35, 0.85]` from an md5 hash. Real
  ability distributions are neither uniform nor independent of year level.
- **Scores** average 53.5 and span the full 0–100 range. Real attainment will differ,
  and the true distribution shape matters for percentile banding and for P1's
  projection confidence.
- **Improvement** is a synthetic `+0.12` over a year of tenure. Real learning
  curves are not linear and they plateau.
- **Conversion** is 5% landing→customer with fixed stage drop-offs
  (100 → 75 → 58 → 41 → 28 → 18 → 12 → 8 → 5). **Do not quote these rates.**
  They are placeholders chosen to exercise A11's arithmetic, not estimates.
- **UTM** cycles deterministically through google/facebook/organic/referral and
  three campaigns. Real channel mix will look nothing like this.
- **Timing** is spaced at fixed 28-day intervals per attempt. Real usage is bursty
  around exam dates and school terms.
- **Marking used to be independent of the answer key — found and FIXED.** This was
  the most consequential defect in the dataset, and it is recorded here in full
  because everything downstream depended on it. `responses.is_correct` was drawn
  from the student's simulated ability **without ever comparing the chosen answer to
  `questions.correct_answer`**: the seed picked a letter from md5 seed `'ans:'` and
  the verdict from a *different* seed `'r:'`. Measured across the 12,499 MCQ
  responses at the time:

  | Chosen answer | Marked correct |
  |---|---|
  | matches the key (3,089) | **54.0%** |
  | does not match the key (9,410) | **54.3%** |

  The two rates are identical, i.e. marking was statistically independent of whether
  the answer was right — 6,528 responses (52.2%) contradicted the key.

  **What it did:** every accuracy-derived figure on the platform — A1 `p_value`,
  P3 mastery, T1 performance levels, T2 skill gaps, T3 at-risk rules, T7/P8
  recommendations, A4 test metrics — was computed correctly from a column that did
  not measure right answers. A1 flagged 275 of 340 items, including `KEY_BEATEN` on
  78 of them, because the key lost to random guessing.

  **The fix (seed §4):** ability now drives *which option is chosen*. With
  probability `p(correct)` the student picks the authored key, otherwise a distractor
  drawn uniformly from that question's real option set; `is_correct` is then simply
  "the key was picked", so the two cannot disagree by construction. The probability
  model is unchanged, so the score spread, tenure trend and difficulty gradient all
  survive. Verified after re-seeding: **0 disagreements across 17,604 letter-keyed
  responses.**

  Two things this fixed as a side effect: five-option questions can now be answered
  "E" (the old `% 4` could never emit it, which would have made E a dead distractor on
  all 348 of them), and the audit widened from `type = 'MCQ'` to *any* letter-keyed
  item, which brought 738 `READING_COMPREHENSION` questions — 5,105 more responses —
  under the check.

  **Not a production bug.** Live marking in `src/lib/scoring/score-attempt.ts`
  derives `is_correct` from the question and was always correct. The A15 check and
  the `marking_reliable` flag both remain in place, computed from the data, so a
  regression here fails loudly instead of quietly poisoning every report again.
    - A15 check: `marking_key_disagreement`, threshold **0** — currently **OK**.
    - Every A1/T4 row carries `marking_reliable`, currently **true**, and both
      endpoints attach a caveat only while it is false. Both cleared themselves with
      no code change, which is the point of deriving them from data rather than
      hardcoding a warning that would outlive the fix.

## What is *not* fake

Attempts reference the **53 genuinely published tests** (of 54 in the catalogue) and
responses reference **genuinely published questions** — 1,900 of them, joined through
1,900 `test_questions` rows and 174 `test_sections`. So subject / topic / sub-topic
tagging, authored difficulty values, answer options and section names are real —
which is why P3 mastery, P8 recommendations, A3 coverage gaps, TC1's production queue
and A1/T4 item statistics all exercise the real taxonomy rather than invented labels.

## Replacing it

1. **Run the teardown** — `999_cleanup_sample_dataset.sql`. It deletes only
   sample-prefixed rows, rebuilds the reporting layer, then prints counts that must
   all be zero.
2. **Capture real data** as it arrives. Nothing needs changing in the reporting
   layer: every view, RPC and report reads the same tables.
3. **Re-check the cohort thresholds.** P2 percentile suppresses below n≥20 and
   marketing claims require n≥200 (`15-conversion-and-ux-resolution.md` X-1/X-4).
   Those floors are about *real* students; a large sample cohort does not satisfy
   them. The percentile UI must keep saying how many children the figure is based
   on.

## Guard rails verified before seeding

- Sample auth users **cannot sign in or receive email**: `.invalid` is reserved by
  RFC 2606 and is non-routable, `encrypted_password` is empty, and
  `email_confirmed_at` is NULL.
- No FKs were bypassed — `student_profiles.auth_user_id` and four other columns
  reference `auth.users`, which is why those auth rows exist.
- `attempts_one_in_progress_per_student_test` is respected: only the first attempt
  of each (student, test) pair is left `IN_PROGRESS`.
- Attempt scores are **derived from the seeded responses**, not generated
  separately, so DA-03 score reconciliation still holds.
- **A15 data quality stayed fully green** after the load (16 OK, 1 honest
  `NOT_IMPLEMENTED` for Stripe).

## Known gaps in the sample data

- `NAPLAN_STYLE_READING` attempts have `score = NULL` because the one published
  test of that type has zero questions. Realistic, but that exam family contributes
  nothing to score-based reports.
- No **purchases**, **subscriptions** or **entitlements** were seeded: Stripe
  ingestion does not exist yet (Phase 3), so A8/A9/A10 still render empty. Seeding
  fake revenue would be actively misleading.
- No **writing** responses were seeded — criterion-level marking does not exist
  yet, so P6/T6/A5/A6/A7 remain blocked on real work, not on data.
- No **enquiries** were seeded; that channel has no write path (`/contact` is
  mailto-only).
- **Per-item evidence is thin, deliberately.** The re-seed spread attempts across
  **47 published tests** instead of 11, so responses now touch **1,750 distinct
  questions** rather than 340 — but that divides the same ~17.5k responses five ways.
  Median responses per item is ~9 against a configured floor of 20, so A1 reports
  `enough_evidence = false` for all but **16** items and withholds their statistics.
  That is the honest output, not a bug: A1 says "too little data" rather than
  inventing a difficulty from nine observations. If you need A1 populated for a demo,
  raise attempt volume in seed §3 (`2 + u01*9` attempts per student) rather than
  lowering `reporting.item_thresholds.min_responses_per_item` — lowering the floor
  would make every report noisier, not better.
- **Skipped items are not recorded, and cannot be inferred.** The runner is
  adaptive: attempts answer ~10 of the ~48 items in their test (avg 9.96 answered
  against 48.46 in `test_questions`), and it writes **no** `responses` row for an
  item it never serves. `responses.answer` is `NOT NULL` and `is_correct` is never
  NULL, so there is no "unanswered" marker either — 0 of 17,643 rows in
  `reporting.fact_item_response` have `is_skipped = true`. A missing row is therefore
  indistinguishable from a skip, and A1/T4's `skip_rate_pct` computes to **0.0% for
  every item**. That is the specified formula applied faithfully to data that cannot
  answer the question, so both reports surface `skip_rate_reliable = false` and the
  UI renders `n/a` rather than `0%`. Fixing it needs an item-exposure log (which A2's
  `item_exposure_rate` also needs), not a change to the metric.
- **Item statistics are all-time, not per-period.** `questions.flag_count` is a
  running total with no timestamp, so `item_flag_rate_pct` cannot be a period rate.
  §5 anticipates this ("Until then A1 shows a lifetime rate and says so"), and every
  A1/T4 row says so via `period_label = 'ALL_TIME'`. Per-period rates need the
  `ITEM_FLAGGED` event, which is declared in the funnel catalogue but still unwired.

## Reproducibility

The seed is **deterministic**: every value derives from `md5` of a stable key via
`sample_data.u01()`, never from `random()` or clock state. Running it twice
produces identical data, so an expected value asserted today still holds tomorrow.
Every insert is `ON CONFLICT DO NOTHING`, so a re-run neither duplicates nor fails.

## Teardown verified by execution

The teardown was run **inside a transaction and rolled back** against the live
database while it held both sample and real rows. Every table came back clean —
all sample rows removed, every real row preserved:

| table | sample before | sample after | real before | real after |
|---|---|---|---|---|
| attempts | 1,299 | 0 | 1 | 1 |
| responses | 17,575 | 0 | 68 | 68 |
| funnel_events | 508 | 0 | 3 | 3 |
| funnel_state | 58 | 0 | 0 | 0 |
| parent_student_links | 200 | 0 | 3 | 3 |
| app_user_roles | 300 | 0 | 8 | 8 |
| student_profiles | 200 | 0 | 3 | 3 |
| auth.users | 300 | 0 | 8 | 8 |

That proves the statements are valid, the FK ordering is correct, and the
predicates select exactly the sample rows and not one real row. The dataset was
left intact by the rollback.


