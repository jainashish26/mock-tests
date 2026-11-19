# Mock Tests Platform — BI Assurance & Roadmap (Part 4 of 4)

> **Deliverables 15–16**, plus the assumptions log, the self-review against MECE / access rules /
> privacy / accessibility / performance, remaining risks, and the questions I need answered.

---

## 15. Deliverable 15 — Test plan for data accuracy and access control

### 15.1 Approach

The database is **empty** — every table has 0 rows. Two consequences:

1. No test can validate against real data, so **fixtures are the product**. A suite without fixtures
   tests nothing here.
2. `pgtap` is **available but not installed**. The repo has no database test runner either —
   `package.json`'s `test` script is `node --import ./scripts/ts-register.mjs
   scripts/consent.test.mts`, a hand-rolled Node test. So the plan uses **both**: pgtap for
   in-database invariant and RLS tests (via `CREATE EXTENSION pgtap`), and Node tests in the existing
   style for API contracts. Neither introduces a new pattern for this repo.

Fixture design: a deterministic seed of **200 students × 6 year levels × 4 test families × 12
months**, with **hand-computed** expected values for a subset. Hand-computed matters — a fixture
whose expected value came from the same SQL as the metric under test proves only that the query is
stable, not that it is right.

### 15.2 Data accuracy tests

| # | Test | Method | Why it is not trivially true |
|---|---|---|---|
| DA-01 | **Grain integrity**: one `fact_item_response` row per (attempt, item) | pgtap: the unique constraint rejects a duplicate | A re-run ETL silently double-counting answers is the most common star-schema defect |
| DA-02 | **Row-count reconciliation**: `COUNT(fact_item_response) = COUNT(public.responses)` for a closed period | pgtap | Catches ETL drops and, more often, ETL duplicates |
| DA-03 | **Score reconciliation**: `fact_test_attempt.score` equals `attempts.score_out_of100` | pgtap | The column is renamed in the fact table; a mapping typo is otherwise invisible |
| DA-04 | **Revenue reconciliation**: `SUM(fact_order.amount_cents)` by kind equals Stripe API totals for a closed day | Node vs Stripe test-mode fixtures | The highest-consequence number in the system. Fees arrive on a different object at a different time (§10.3 of `13-…md`) |
| DA-05 | **Idempotent webhook**: replaying an `event_id` produces zero new `fact_order` rows | Node test | `processed_webhook_events` already gates this; the test proves the gate reaches the fact |
| DA-06 | **Percentile hand-check**: a 21-student cohort with known scores gives the expected mid-rank percentile | pgtap, hand-computed | The 0.5-for-ties convention is easy to get wrong and still looks plausible |
| DA-07 | **Percentile suppression**: a 19-student cohort returns `NULL` and `suppressed = true` | pgtap | A suppression rule that lives only in the UI is not a rule |
| DA-08 | **Cohort counts distinct students**: one student with 9 attempts in a 20-student cohort does not become 28 | pgtap | The `DISTINCT ON` exists for exactly this |
| DA-09 | **Point-biserial excludes the item**: recomputing with the item included gives a materially higher value | pgtap | Proves the correction is applied, not merely documented |
| DA-10 | **SCD2 year level**: a Year 3 attempt still reports Year 3 after the child moves to Year 4 | pgtap | Type 1 here would silently rewrite history and break every trend |
| DA-11 | **Daily target cap**: `required_daily = 40`, `cap = 10` ⇒ the student view returns 10 | pgtap | The cap must win and the overload flag must be true |
| DA-12 | **Rest days excluded**: 5 rest days in the window increase `required_daily` | pgtap | An off-by-one on the rest-day subtraction is invisible |
| DA-13 | **Cross-report consistency**: `mastery_level` in P3 equals the same value in T2 | pgtap | Two reports computing one metric differently is the MECE failure that survives review (§4.8 risk 2) |
| DA-14 | **Timezone**: an attempt at 23:30 UTC lands on the *next* Melbourne `date_key` | pgtap | Every daily metric is wrong by a day if this fails, and it looks fine in data created during the day |
| DA-15 | **Refresh lag**: every MV has a successful `refresh_log` run within its window | pgtap | A stale MV is indistinguishable from a correct one |
| DA-16 | **Blackout honoured**: `safe_refresh` in a seeded blackout logs `skipped_blackout` and does not refresh | pgtap | The core "never slow down live tests" guarantee |
| DA-17 | **Concurrent refresh works**: every MV has a unique index, so `REFRESH … CONCURRENTLY` succeeds | pgtap over `pg_matviews` | Without the index the statement errors and someone quietly drops `CONCURRENTLY`, reintroducing blocking locks |
| DA-18 | **Incremental equals full**: after an incremental refresh the MV matches a full rebuild | pgtap | Incremental pipelines diverge silently; the nightly reconcile only helps if this is tested |
| DA-19 | **Statement timeout**: a deliberately slow reporting query is cancelled at 5s | Node test | Proves the timeout is live, not merely configured |

### 15.3 Access control tests — including proof a student cannot read results

These run **as the actual role**, using a generated Supabase JWT per persona. A test that runs as
`postgres` proves nothing: `postgres` has `rolbypassrls = true` on this project (verified in
`pg_roles`).

| # | Test | Expected |
|---|---|---|
| **AC-01** | Student JWT: `SELECT * FROM reporting.mv_percentile_cohort` | **`permission denied`** (no GRANT), *not* an empty set |
| **AC-02** | Student JWT: `SELECT * FROM reporting.mv_student_readiness` | **`permission denied`** |
| **AC-03** | Student JWT: `SELECT * FROM reporting.fact_item_response` | **`permission denied`** |
| **AC-04** | Student JWT: `SELECT * FROM reporting.fact_test_attempt` | **`permission denied`** |
| **AC-05** | Student JWT: `SELECT * FROM reporting.fact_writing_mark` | **`permission denied`** |
| **AC-06** | Student JWT: `SELECT score_out_of100 FROM public.attempts` | **`permission denied for column`** — the column grant from §9.6 of `12-…md` |
| **AC-07** | Student JWT: `SELECT is_correct FROM public.responses` | **`permission denied for column`** |
| **AC-08** | Student JWT: `SELECT * FROM public.writing_evaluations` | **`permission denied`** — no column grant back |
| **AC-09** | Student JWT: `SELECT * FROM reporting.v_student_today` | **Succeeds**, and the returned column list contains **no** score, percentage, rank, band or correctness field |
| **AC-10** | Student JWT: same view, another student's `student_id` | **0 rows** (RLS), not an error |
| **AC-11** | Student JWT: `GET /api/reporting/student/completion` | Body matches the constant exactly; **no numeric field exists** |
| **AC-12** | Student JWT: `SELECT * FROM reporting.mv_student_daily_target` | **`permission denied`** — the student reads `v_student_today`, which excludes `required_daily` and `plan_overload_flag` |
| **AC-13** | Student JWT: `GET /api/reporting/parent/*` | **403** |
| **AC-14** | Student JWT: `GET /api/reporting/tutor/*`, `/admin/*`, `/creator/*` | **403** |
| **AC-15** | Student JWT: `SET ROLE reporting_ro; SELECT * FROM reporting.mv_percentile_cohort` | **`permission denied`** — `SET ROLE` must not be an escalation path |
| **AC-16** | Student JWT: `EXECUTE reporting.admin_student_drilldown(...)` | **`not authorised`** |
| **AC-17** | Parent JWT: reads a linked child's readiness | **Succeeds** |
| **AC-18** | Parent JWT: reads an **unlinked** child's readiness | **0 rows** |
| **AC-19** | Parent JWT: `GET …/parent/percentile` **without** P1 resolving | **403** — B1 enforced server-side |
| **AC-20** | Parent JWT: percentile for a cohort of 14 | `data: null`, `meta.suppressed: true`, `meta.cohort.size: 14` |
| **AC-21** | Tutor JWT: reads a consented student | **Succeeds** |
| **AC-22** | Tutor JWT: reads a student with **no** link | **0 rows** |
| **AC-23** | Tutor JWT: reads a linked student whose consent is **revoked** | **0 rows**, immediately, with no refresh in between |
| **AC-24** | Tutor JWT: reads a linked student whose consent has **expired** | **0 rows** |
| **AC-25** | Tutor JWT: item stats for a test they did **not** assign | **0 rows** |
| **AC-26** | Tutor JWT: reads `fact_order` or any billing object | **`permission denied`** |
| **AC-27** | Test Creator JWT: reads `v_creator_coverage` | **Succeeds** |
| **AC-28** | Test Creator JWT: reads any fact table or student-keyed MV | **`permission denied`** |
| **AC-29** | Test Creator JWT: `v_creator_coverage` column list | Contains **no** student identifier |
| **AC-30** | Admin JWT: reads aggregate MVs | **Succeeds** |
| **AC-31** | Admin JWT: `admin_student_drilldown(key, NULL, 'A15')` | **Exception** — reason required |
| **AC-32** | Admin JWT: `admin_student_drilldown(key, 'short', 'A15')` | **Exception** — under 12 characters |
| **AC-33** | Admin JWT: valid drill-down | Returns rows **and** writes exactly one `admin_access_audit` row |
| **AC-34** | Admin JWT: drill-down result column list | Has `student_pseudonym`; has **no** `student_id`, name or contact field |
| **AC-35** | Admin JWT: `SELECT * FROM public.enquiry_contacts` | **`permission denied`** |
| **AC-36** | Admin JWT: `read_enquiry_contact(id, reason)` | Succeeds **and** writes one `enquiry_contact_access_log` row |
| **AC-37** | Any role: `UPDATE`/`DELETE` on `admin_access_audit` | **`permission denied`** — append-only |
| **AC-38** | `anon` JWT: every reporting object | **`permission denied`** |
| **AC-39** | Student JWT: `SELECT * FROM public.attempts` (own row, permitted columns) | **Succeeds** — proves the remediation did not break test-taking |
| **AC-40** | Student JWT: full test-taking flow (start → save → submit) | **Succeeds** end to end |

**AC-01 to AC-08 are the tests that prove the hard constraint.** Note the distinction they assert:
`permission denied` is a **privilege** failure; `0 rows` is an **RLS** outcome. Both are correct in
their place, and conflating them is how an access test passes while the constraint is broken — an
RLS-only defence returns 0 rows today and can return everything tomorrow if a policy is edited. The
privilege layer cannot be changed by a policy edit. That is why §9.6 uses column grants as the
primary control and row policies as the secondary one.

**AC-39 and AC-40 are the tests that prove the remediation is safe.** Revoking student SELECT is the
easy half; confirming a child can still sit a test is the half that gets skipped, and it is the one
that would take the product down.

### 15.4 Privacy tests

| # | Test | Expected |
|---|---|---|
| PR-01 | No column named `email`, `phone`, `full_name`, `first_name`, `last_name` or `dob` in any `reporting` object | CI grep over `information_schema.columns` fails the build |
| PR-02 | No `reporting` object has a FK or join path to `public.enquiry_contacts` | pgtap walking `pg_constraint` |
| PR-03 | `fact_event.props` contains no PII across the fixture set | pgtap regex scan for email/phone patterns |
| PR-04 | Retention: rows older than the policy window are removed by `apply_retention_policy()` | pgtap with backdated fixtures |
| PR-05 | A revoked consent removes tutor access with no refresh | pgtap (overlaps AC-23) |
| PR-06 | Audit rows are written even when the subsequent SELECT returns 0 rows | pgtap — proves the audit is not conditional on data existing |
| PR-07 | Every `fact_*` and `dim_*` table has RLS enabled **and forced** | pgtap over `relrowsecurity` / `relforcerowsecurity` |

### 15.5 Performance tests

| # | Test | Budget |
|---|---|---|
| PF-01 | Every reporting endpoint, p95, under fixture load | < 400 ms server time |
| PF-02 | No dashboard query touches a `fact_*` table | Static assertion over each route's SQL — a design rule, tested as one |
| PF-03 | Lighthouse mobile, throttled 4G, each dashboard | TTI < 2 s |
| PF-04 | Route JS budget, parent/student | < 90 KB gz |
| PF-05 | Route JS budget, tutor/admin | < 200 KB gz |
| PF-06 | Data payload per screen | < 30 KB gz |
| PF-07 | A full `REFRESH … CONCURRENTLY` of the largest MV does **not** block a concurrent `attempts` insert | pgtap with two sessions — **the direct test of "reporting must never slow down live tests"** |
| PF-08 | Every index in §8.4/§8.5 of `12-…md` exists after migration | pgtap over `pg_indexes` |

PF-07 is the test that matters most here. Everything else is a budget; PF-07 is the requirement.

### 15.6 Accessibility tests

| # | Test | Standard |
|---|---|---|
| A11Y-01 | Every chart has a `<details>` data table with the same values | WCAG 1.1.1 |
| A11Y-02 | `aria.decal.show: true` on every ECharts instance | 1.4.1 — no meaning by colour alone |
| A11Y-03 | Every chart has an accessible name and description | 1.1.1, 4.1.2 |
| A11Y-04 | Text contrast ≥ 4.5:1; large text ≥ 3:1 | 1.4.3 |
| A11Y-05 | Touch targets ≥ 24×24 CSS px | WCAG 2.2 **2.5.8** |
| A11Y-06 | All functionality keyboard-reachable; visible focus order | 2.1.1, 2.4.7 |
| A11Y-07 | No essential information conveyed by a drag gesture alone | WCAG 2.2 **2.5.7** |
| A11Y-08 | Charts can be dismissed or paused; no auto-advancing animation | 2.2.2 |
| A11Y-09 | axe-core automated scan, zero serious/critical violations | CI gate |
| A11Y-10 | Student surface at Year 4 reading level; sentences < 12 words | Manual, per §2.5 of `11-…md` |
| A11Y-11 | Screen-reader pass on P2 confirming the personal-progress figure is announced with the rank | Manual — the B1 rule tested as an accessibility behaviour |

**Colour-blind safety is structural, not a palette choice.** Decals are enabled globally, so a series
is distinguishable with hue removed. Verified by rendering each chart to greyscale in CI and diffing —
a palette audit is a recurring manual cost that gets skipped; a greyscale diff is not.

---

## 16. Deliverable 16 — Phased roadmap

Effort is in **engineering days for one experienced full-stack engineer**, assuming the VC2 mapping
is done by editorial staff in parallel (it is not engineering work and is not estimated here).
Estimates include writing the §15 tests — a phase estimated without its tests is not an estimate.

### Phase 0 — Unblocking (must happen first) · **6.5 days**

Nothing in phases 1–3 can start until this is done. It is mostly repairing what already exists.

| Task | Days | Why |
|---|---|---|
| Fix `010_subscriptions.sql` (`public.profiles` does not exist) and apply 010 + 011 | 1.5 | **Blocker.** The event store, subscriptions and exam targets all live here |
| Apply `012_enquiries.sql`; build `POST /api/enquiries` and the `/contact` web form | 2.5 | No channel writes anything today (§7.1) |
| Apply `015_student_access_remediation.sql` + the five application changes | 2 | **P0 breach.** Must ship with AC-01…AC-08 and AC-39/AC-40 passing |
| Install `pg_cron`, `pgtap`, `citext`; create the `reporting` schema and `reporting_ro` | 0.5 | Prerequisite for everything |

**Exit criteria**: a student JWT cannot read any score column (AC-01…AC-08 green); a student can
still sit a test end to end (AC-40 green); 010/011/012 applied and recorded in `supabase_migrations`.

### Phase 1 — MVP · **35.5 days**

The minimum that lets a parent answer "is my child on track, and what next?" and lets you operate
the platform.

| Task | Days | Reports |
|---|---|---|
| Dimensions: `dim_date` generation, `dim_student` (SCD2), `dim_test`, `dim_test_family`, `dim_item` (SCD2), `dim_parent`, `dim_campaign` | 4 | — |
| Facts + ETL: `fact_test_attempt`, `fact_item_response`, `fact_event` | 5 | — |
| `withReportingRole()`, the report envelope, empty/low-data/error state components | 2.5 | — |
| **S1, S2, S3** student surfaces + `/api/reporting/student/*` | 3 | S1 S2 S3 |
| **P1** readiness (wrapping the existing engine) + projection range | 3 | P1 |
| **P4** history & trends | 2 | P4 |
| **P8** recommendations (heuristic ranking) | 2 | P8 |
| **P7** study behaviour (time on task, pace, skips, sessions, adherence) | 2 | P7 |
| **P9** plan controls + rest days + `dim_practice_plan` | 2.5 | P9 |
| ECharts wrapper, SSR-to-SVG, `<details>` data tables, decal config | 2 | all charts |
| `pg_cron` schedules, `safe_refresh`, blackout table, `refresh_log`, lag badges | 1.5 | — |
| **A14** platform health + **A15** data quality | 2 | A14 A15 |
| Tests: DA-01…DA-19, AC-01…AC-40, PR-01…PR-07, PF-01…PF-08 | 4 | — |

**10 reports**: S1, S2, S3, P1, P4, P7, P8, P9, A14, A15. Deliberately **out of MVP**, with the
reason in each case:
- **P2 percentile** — needs a 20-student cohort that does not exist yet and would be suppressed anyway.
- **P3, T2, A3, TC1** — blocked on the VC2 mapping (A-02).
- **P5 misconceptions** — blocked on authored misconception content (A-02).
- **P6, T6, A5, A6, A7** — need criterion-level marking that is not captured today (§11.1).
- **The whole tutor surface** — needs consent UX first; a tutor dashboard without consent is a
  privacy incident.
- **All revenue reporting** — needs Stripe reconciliation, which needs the ingestion layer.

Shipping these early would mean shipping empty states and suppressed cohorts, which is worse than
not shipping them: an empty dashboard reads as a broken product.

**Exit criteria**: a parent sees readiness with an honest projection, sees trend, gets three
recommendations and controls the plan; a student sees only a countdown and a target; every dashboard
shows its refresh lag; all §15 tests green.

### Phase 2 · **41 days**

| Task | Days | Reports |
|---|---|---|
| `dim_curriculum_vc2` + `dim_item_curriculum` load pipeline and the creator tagging UI | 4 | — |
| **P3** mastery map, **A3** coverage gaps, **TC1** creator queue | 5 | P3 A3 TC1 |
| **P5** question review (needs authored misconception content) | 3 | P5 |
| Writing mark extension (§11.1), `fact_writing_mark`, criterion capture | 4 | — |
| **P6**, **T6**, **A5**, **A6**, **A7** + anchor set tooling | 6 | P6 T6 A5 A6 A7 |
| Tutor foundation: `tutor_student_links`, `consent_records`, **P10** consent UX | 4 | P10 |
| **T1**, **T2**, **T3**, **T5**, **T7** + heatmap | 5 | T1 T2 T3 T5 T7 |
| **P2** percentile, once cohorts reach n=20 | 2 | P2 |
| Tests for all of the above, including greyscale chart diffs | 4 | — |

**16 reports**: P2, P3, P5, P6, P10, T1, T2, T3, T5, T6, T7, A3, A5, A6, A7, TC1.

### Phase 3 · **39 days**

| Task | Days | Reports |
|---|---|---|
| Stripe ingestion: `stripe_charges/refunds/disputes/balance_txns`, fee and GST handling | 5 | — |
| Nightly reconciliation + gap blocking | 3 | — |
| `fact_order`, `fact_subscription`, **A8**, **A9** | 4 | A8 A9 |
| **A10** cohort retention & LTV (+ manual spend entry for CAC) | 3 | A10 |
| **A11** funnel + segments + device derivation | 4 | A11 |
| **A12** experiments + exposure logging | 3 | A12 |
| Email/chat enquiry ingest integrations, **A13** | 3 | A13 |
| **A1** item stats, **A2** adaptive health, **A4** test-form metrics | 4 | A1 A2 A4 |
| **T4** tutor item analysis (scoped to assigned tests; consumes A1's definitions) | 1.5 | T4 |
| Partitioning (`pg_partman`), retention automation, alerting engine | 3 | — |
| Tests for all of the above | 4 | — |

**10 reports**: A1, A2, A4, A8, A9, A10, A11, A12, A13, T4.
T4 is placed here rather than in Phase 2 because it consumes `mv_item_stats`, which A1 builds —
building it earlier would mean computing item statistics twice, breaching the single-owner rule.

### Totals and sequencing rationale

| Phase | Engineering days | Reports | Cumulative |
|---|---|---|---|
| 0 — Unblocking | 6.5 | 0 | 0 / 36 |
| 1 — MVP | 35.5 | 10 | 10 / 36 |
| 2 | 41 | 16 | 26 / 36 |
| 3 | 39 | 10 | **36 / 36** |

**Total ≈ 122 engineering days**: roughly 25 weeks at one engineer, or 14–15 weeks at two including
coordination overhead. The count reconciles exactly to the 36 reports in `11-…md` §4 — no report is
unscheduled and none is scheduled twice.

---

## 17. Assumptions log

Every assumption is marked. None is presented as a fact, and none involves an invented statistic,
benchmark, exam format or curriculum code.

| ID | Assumption | Why it was necessary | Impact if wrong | How to resolve |
|---|---|---|---|---|
| **A-01** | Deliverable **1** of the brief is an architecture overview | The brief's list starts at 2 | Low — cosmetic | Confirm (Q-1) |
| **A-02** | **No VC2 curriculum mapping exists**, and none will be generated by me | Verified: no VC2 codes anywhere in the DB; only `tags` jsonb, `topic`, `sub_topic` and 15 `skill_*` columns | **Critical** — blocks P3, T2, A3, TC1 and P5's misconceptions | Editorial team maps the item bank to VC2 content descriptions |
| **A-03** | The brief's Tutor row is a formatting fault; tutors see reports for consented students | The "Can see" cell was empty and the Parent's text appeared in it | Medium — changes the whole tutor scope | Confirm (Q-2) |
| **A-04** | Test Creator gets TC1, a content-only report with no student data | Without it the coverage matrix has an empty row | Medium | Confirm (Q-3) |
| **A-05** | Subscriptions exist, so MRR/churn/renewal are in scope | `010_subscriptions.sql` defines them; `funnel_events` carries the lifecycle events | Low | Already evidenced |
| **A-06** | Australia/Melbourne is the reporting timezone | Victorian Curriculum 2.0 product; project region is `ap-southeast-2` | Medium — every daily metric shifts a day if wrong | Confirm |
| **A-07** | Peak test windows are weekday 16:00–21:00 and weekend 09:00–13:00 | The brief requires refreshes outside peak windows but states none, and no measured data exists | Medium — refreshes could land in a real peak | Replace with measured peaks from A14; the blackout table is data, so no deploy is needed |
| **A-08** | No ad-spend data exists anywhere | Verified: no spend table, no ads integration | High for A10 — CAC and ROAS return `null` | Supply `dim_campaign.monthly_spend_cents` manually, or integrate an ads API |
| **A-09** | Device class can be derived server-side from client hints and User-Agent | `funnel_events` has no device column and the CRO requires device segments | Low | Standard approach |
| **A-10** | Student copy targets a Year 4 reading level | Years 2–8 spans roughly ages 7–14 | Low | A copywriting standard, **not** a claim about any child's reading age |
| **A-11** | Year-level daily caps are unset; S2 falls back to `weekly_sessions_goal / 7` | No cap data exists and inventing one would be a fabricated child-safety limit | **High** — the cap is the primary protection against overload | You set `dim_year_level_cap` (Q-4) |
| **A-12** | At-risk rules and mastery cut-points are seeded defaults, not validated thresholds | No validated cut-points exist for this population | Medium — flags may over- or under-fire | Tune against tutor dismissal rates; every flag is dismissible with a recorded reason |
| **A-13** | The 200 peak concurrency figure is a stated capacity target, not a measured ceiling | Nothing in the repo or DB corroborates it | Low — it is a reference line, not a limit | Confirm the source |
| **A-14** | `runner/save` and `runner/submit` do not depend on student SELECT over `responses` | Only `runner/start` was verified | **High** — could break test-taking | Verify before applying migration 015; AC-40 is the guard |
| **A-15** | The enquiry SLA basis (business vs calendar hours) is unknown | The contact page publishes a response time; the repo does not state the basis | Medium — `sla_breach_rate` would be wrong | Confirm (Q-5) |
| **A-16** | Email and chat vendors are unchosen | The brief left `[email ingestion method]` and `[chat tool]` as placeholders | Medium — A13 covers only `web_form` until chosen | Choose vendors (Q-6) |
| **A-17** | No validated threshold exists for acceptable length–score correlation in AI writing assessment | I will not invent one | Medium — AL-10 stays disabled | Set from observed platform data once a baseline is frozen |
| **A-18** | Every product line is GST-taxable, so `net_revenue_ex_gst = gross / 1.10` | Stripe Tax is not configured and no product carries a tax code | **High** — revenue misstated if any line is GST-free | Confirm per-product GST treatment (Q-7) |
| **A-19** | `dim_date.is_school_term` defaults to `true` | No Victorian school term calendar was supplied | Low — affects only term-based segmentation | Supply a term calendar if wanted |
| **A-20** | The 200 concurrency cap, the 20 cohort minimum and the 12-month window are brief-confirmed and not re-derived | The brief states its decisions are confirmed | Low | Already given |

---

## 18. Self-review

### 18.1 Against MECE

| Check | Result |
|---|---|
| Every report has exactly one primary question | **Pass** — §4.3–§4.6 of `11-…md` |
| Every report has exactly one primary role | **Pass** |
| Every metric has exactly one owning report | **Pass** — §5; consumers listed in §4.8 |
| Every role decision is covered | **Pass** — 38 decisions, no empty rows (§4.7) |
| Every report serves at least one decision | **Pass** — reverse check (§4.8) |
| The brief's own duplications resolved | **Pass** — pricing/A-B merged (X-9); 6 marking items → 3 |
| Known residual overlaps declared | **4 declared** (§4.8): P4 owns two decisions; `mastery_level` shared P3→T2; `coverage_status` shared A3→TC1; A11 is wide |

### 18.2 Against the access rules

| Rule | Where enforced | Tested by |
|---|---|---|
| Student sees only countdown and daily target | `reporting.v_student_today` selects 7 columns, none a result | AC-09, AC-12 |
| Student has no SELECT on any results table | **Column-level grants** (§9.6) + no reporting GRANT | AC-01…AC-08 |
| Post-test screen shows a completion message only | **Constant payload, no query** | AC-11 |
| Overload never shown to the student | `required_daily` / `plan_overload_flag` absent from the student view | AC-12 |
| Parent sees only linked children | `can_parent_see()` + `parent_student_links` | AC-17, AC-18 |
| Percentile never alone | API returns 403 unless P1 resolves; the MV always carries cohort context | AC-19, AC-20 |
| Tutor sees only consented students | `v_tutor_student` requires a live, unexpired, unrevoked consent | AC-21…AC-24 |
| Tutor sees no billing | No policy, no grant | AC-26 |
| Test Creator sees no student data | `v_creator_coverage` has no student column | AC-27…AC-29 |
| Admin row-level is pseudonymous, audited, reason-required | `admin_student_drilldown()` audits before selecting | AC-30…AC-34 |
| Raw contact details only via the restricted table | No policy on `enquiry_contacts`; audited function only | AC-35, AC-36 |
| Enforced in RLS **and** the API, not the UI alone | Both layers on every endpoint | the whole AC suite |

### 18.3 Against privacy

- Minimum cohort size **20**, band-not-point below 50, always displayed with size and window. ✔
- **No PII in analytics tables** — `reporting` has no email/name/phone column; PR-01 fails the build
  on one. ✔
- Retention periods per event class, stored as data in `reporting.retention_policy`. ✔
- Consent records for tutor access, event-sourced, revocation immediate. ✔
- Enquirer contact details in a separate restricted table with **no reporting path at all**. ✔

### 18.4 Against accessibility

WCAG 2.2 AA targeted; decals make colour-blind safety structural; every chart has a `<details>` data
table; 2.5.7 and 2.5.8 explicitly tested; greyscale diff in CI. The student surface is tested for
reading level, not only for conformance. ✔

### 18.5 Against performance

<2s budget itemised (§1.4 of `11-…md`); no dashboard query touches a fact table (PF-02);
`reporting_ro` at 5s; blackout-guarded `CONCURRENTLY` refreshes; PF-07 directly tests that a refresh
cannot block a live test insert. ✔

### 18.6 Remaining risks

| # | Risk | Severity | Mitigation | Residual |
|---|---|---|---|---|
| R-01 | **The student access breach is live right now** (`11-…md` §0.1) | **Critical** | Phase 0, migration 015, AC-01…AC-08 | Until Phase 0 ships, students can read their own scores. The most urgent item in the programme. |
| R-02 | **VC2 mapping is unstaffed** and gates 8 reports | **High** | Escalate as an editorial hiring decision, not an engineering task | Phase 2 slips by the mapping duration. No engineering mitigation exists. |
| R-03 | `010_subscriptions.sql` fails; migration history is inconsistent | High | Phase 0 fix | Applying anything before this risks a partial migration state |
| R-04 | AI writing marks are unvalidated and unversioned, with no human moderation | **High** | A5/A6/A7 + anchors + `model_version` NOT NULL + AL-07/AL-08 | Until anchors exist, parents receive marks of unknown accuracy. Consider labelling them provisional. |
| R-05 | Year-level caps unset, so S2's overload protection is inactive | High | Q-4; the fallback still caps at `weekly_sessions_goal/7` | A child could be shown an uncapped target derived from an ambitious parent goal |
| R-06 | Percentile at n=20 is statistically thin | Medium | Band-not-point below 50; cohort size always shown | A parent may still over-read a small-cohort rank |
| R-07 | No spend data ⇒ CAC/ROAS unavailable | Medium | `null` + "spend not recorded" state | Channel decisions stay intuition-based |
| R-08 | Pre-launch emptiness means every dashboard shows an empty state on day one | Medium | Empty states carry the action that creates data | Stakeholders may read "empty" as "broken" |
| R-09 | `funnel_events` is append-only with no UPDATE policy, so a mis-fired event cannot be corrected | Medium | Exclude known-bad `event_id`s in the ETL via a suppression table | The mechanism is not yet built |
| R-10 | ECharts has no official React wrapper | Low | ~60-line in-house wrapper; no third-party dependency | A React 19 behaviour change would need a manual fix |
| R-11 | Two metrics named `p_value` with opposite meanings | Medium | Distinct names (`p_value`, `p_value_experiment`); the dictionary forbids abbreviation | A future developer could still conflate them in prose |

---

## 19. Questions I need answered

The brief said to ask only about conflicts. These are the conflicts and unfilled placeholders found.

| # | Question | Blocks |
|---|---|---|
| **Q-1** | Deliverable 1 was omitted from the brief's list. I assumed an architecture overview (`11-…md` §1). Correct? | Nothing — documentation only |
| **Q-2** | The Tutor row of the access table is malformed: "Can see" is empty and the Parent's text sits in it. I read it as *"all reports for students linked by current consent; no unlinked students; no billing"*. Confirm? | The entire tutor surface, T1–T7 |
| **Q-3** | Test Creator has "no student reporting access", which read literally leaves the role with zero reports and an empty coverage-matrix row. May Test Creator have **TC1** — content coverage and production queue, item counts and coverage status only, provably no student data? | TC1 |
| **Q-4** | What are the **daily practice caps per year level** (Years 2–8), in tests and in questions? I will not invent a child-safety limit. | S2's overload protection (R-05) |
| **Q-5** | What is the enquiry **first-response SLA**, and is it measured in **business hours or calendar hours**? The contact page publishes a response time but the basis is not in the repo. | `sla_breach_rate`, AL-19, AL-20 |
| **Q-6** | The brief left `[email ingestion method]` and `[chat tool]` unfilled. Which vendors? Requirements: server-side webhook, signed payloads, AU/APAC data residency. I recommend an inbound-email webhook and a widget vendor with a conversation webhook, both normalised through `ingest_enquiry()`. | The email and chat channels in A13 |
| **Q-7** | Is **every** product line GST-taxable? `net_revenue_ex_gst` divides by 1.10 on that assumption. Is Stripe Tax configured, or should it be? | A8, A9 (A-18) |
| **Q-8** | May I apply the Phase 0 migrations to `ekdjrvjgrhpqolthbznr`? Nothing has been run. Order: fix `010` → `010`, `011` → `012_enquiries` → `013_reporting_foundation` → `014_reporting_mvs_and_rls` → `015_student_access_remediation`. | All implementation |
| **Q-9** | Is the **adaptive engine** on the roadmap? A2 and `pathway_distribution` have no source column today, and I have not invented one. | A2 |
| **Q-10** | Does a **VC2 mapping** already exist anywhere — spreadsheet, authoring tool, publisher data? If so, Phase 2's critical path shortens substantially. | P3, T2, A3, TC1, P5 |

**Q-10 — answered 2026-11-20, decision 6-C: the dependency is retired.** No mapping
was ever produced, because there is nothing left to map *to*. Migration `026` dropped
VC2 and created `dim_skill_area` instead; P3, A3, TC1 and T-series reports were then
shipped on that basis without it. The register row is kept rather than deleted for the
same reason as D-A above — a question that was framed as "High — gates 8 reports,
biggest schedule risk" and later dissolved not by an answer arriving but by the thing
it asked about ceasing to exist is a fact about how the estimate was built, and that is
worth more than a struck line. What survives from it is A-9's assumed skill→exam
mapping, which is now governed by **Q-11 / decision 7-A** and is labelled editorial and
unvalidated rather than inherited silently from a retired document.


> **Where these stand now.** This register is the *questions*, not the answers —
> the answers live in `16-delivery-backlog.md` item 21's decision table, and one
> place deciding is the only reason the two documents cannot disagree. As of
> 2026-11-20: **Q-4** → 4-A (year caps as ceiling + advisory target, stored in the
> DB), **Q-5** → 1-B (business days; the shipped `sla_basis='calendar'` is interim
> and says so), **Q-6** → 3-A (Resend inbound, built dormant), **Q-9** → 5-B (on
> the roadmap; design note outstanding), **Q-10** → 6-C (answered above),
> **Q-11/Q-12/Q-13** → 7-A / closed-by-data / 2-A (§19.1). **Q-1, Q-2, Q-3, Q-7
> and Q-8 remain genuinely open**, and Q-2 is the one with the largest consequence:
> nine tutor reports wait on it.

### 19.1 Q-11 was used for three different questions — now Q-11, Q-12, Q-13



> Renumbered on 2026-11-20 under decision 8. This was not pedantry. `Q-11`
> appeared in three places meaning three different things, and none of them was
> in the register above, which stops at Q-10:
>
> - `14-…md` §20.5 — the 11 unmapped `SKILL_EXAM_TYPES` values,
> - `14-…md` §20.8 — `dim_test_family.family_group` as a P2 cohort prerequisite,
> - `16-…md` item 21 — what a "converted enquiry" references when the order is a subscription.
>
> A shared tag is worse than a missing one, because it reads as agreement: two of
> these were answered by different decisions, so a reader who looked up "Q-11"
> would have applied the wrong answer to the wrong blocker. Cross-references now
> point at distinct numbers, and each row records its resolution rather than
> leaving it to be re-derived.

| # | Question | Blocks | **Resolved (2026-11-20)** |
|---|---|---|---|
| **Q-11** | The 11 skill values in `dim_skill_area` (`GRAMMAR`, `GEOMETRY`, `SPELLING`…) are exported as `SKILL_EXAM_TYPES` and map to no readiness exam. Does an authoritative skill→exam relationship exist, or may one be asserted? | A-9 readiness attribution | **7-A.** Invent it as configuration, labelled editorial and unvalidated. See `16-…md` item 21 decision 7 and the proposed `skill_exam_mapping` rows, which need review before shipping — the label is the guarantee. |
| **Q-12** | `dim_test_family.family_group` is needed before P2 can compute a cohort; without it a NAPLAN cohort fragments three ways and drops below the n=20 suppression floor. | P2 cohort, A-21 | **Closed by the data, not by a decision.** `family_group` exists and is populated for **17 of 17** members. The §20.8 row that still says "needed" is stale and is corrected below. |
| **Q-13** | What does a "converted enquiry" reference when the order is a **subscription**? Migration 012's `enquiries_converted_has_order` CHECK demands a `purchases` row, and subscription payments do not create one — so conversion is unreachable for most revenue. | A13 conversion metric | **2-A.** Relax the CHECK and add `converted_ref`. Until that migration lands the metric reports `NOT_IMPLEMENTED`, which is what it does now. |


---

**End of Part 4.** Document set: `11-bi-reporting-design.md`, `12-bi-reporting-data-model.md`,
`13-bi-reporting-integrations-api-ux.md`, `14-bi-reporting-assurance-roadmap.md`.

---

## 20. Implementation log and corrections

Phase 0 was executed against `ekdjrvjgrhpqolthbznr`. **Four design assumptions proved wrong when
they met the real database.** Each would have produced a silently broken or silently insecure
system. The design documents above still contain the original (incorrect) text; §20.6 lists exactly
where.

### 20.1 What was applied

| Migration | Status | What it did |
|---|---|---|
| `015_student_access_remediation` | **Applied** | Closed the P0 breach: dropped 3 student SELECT policies, narrowed the `FOR ALL` write policies to INSERT/UPDATE, added the `may_read_results()` guard to every surviving SELECT policy, added `resume_attempt_answers()` and `my_attempt_status()` |
| `011_funnel` | **Applied** | `funnel_events`, `funnel_state`, `student_exam_targets`, `offers`, `referral_codes`, `referrals`, `email_log`, `funnel_conversion` |
| `012_enquiries` | **Applied** | `enquiries`, `enquiry_contacts` (restricted), `enquiry_contact_access_log`, `ingest_enquiry()`, `read_enquiry_contact()` |
| `013_reporting_foundation` | **Applied** | `reporting` schema, `reporting_ro`, 2,557 `dim_date` rows, `dim_test_family`, `dim_student` (SCD2), `dim_year_level_cap`, `dim_practice_plan`, `practice_rest_days`, `refresh_blackout`, `refresh_log`, `in_blackout()`, `safe_refresh()`, `load_student_dims()` |
| `014_reporting_student_surface` | **Applied** | S1 and S2 materialised views, `v_student_today`, grants, `pg_cron` schedules |
| `016_reporting_role_non_inherited` | **Applied** | Closed a privilege-escalation hole (§20.3) |
| `010_subscriptions` | **Fixed in repo, not applied** | The `public.profiles` blocker is repaired; applying it is still outstanding |

### 20.2 Correction 1 — PostgreSQL does not support RLS on materialised views

`12-…md` §9.3 asserted *"Views are where RLS lives"* and §9.5 issued `ALTER TABLE … ENABLE ROW LEVEL
SECURITY` across every `reporting` relation plus `CREATE POLICY` on views. Applying it failed:

```
ERROR: 42809: ALTER action ENABLE ROW SECURITY cannot be performed on
       relation "mv_student_countdown"
DETAIL: This operation is not supported for materialized views.
```

`CREATE POLICY` also requires a table, so a policy cannot attach to a plain view either. **The access
model in §9.3/§9.5 is not implementable as written.** What replaced it, and why it is still sound:

1. **MVs are protected by GRANT alone** — SELECT to `reporting_ro`, revoked from `PUBLIC`, `anon`,
   `authenticated`.
2. **Row filtering lives in the view's WHERE clause** using `auth.uid()`-based predicates. This works
   because `auth.uid()` reads the `request.jwt.claims` GUC, so it evaluates against the *caller* even
   though the view is owned by `postgres`.
3. **A browser cannot escalate**: browser clients reach Postgres through PostgREST, which exposes
   relations over REST and cannot execute `SET ROLE` or arbitrary SQL. Only server code holding a
   direct connection string can `SET LOCAL ROLE reporting_ro`.

RLS *is* still applied to the reporting **base tables** (the dimensions), where it is supported.

### 20.3 Correction 2 — `GRANT reporting_ro TO authenticated` is an escalation hole

The more serious of the two, and invisible until the grants were measured. `12-…md` §8.3 specified
`GRANT reporting_ro TO authenticated, service_role, postgres` so the API could `SET LOCAL ROLE`. A
plain role grant is **inherited**, so `authenticated` silently acquired every privilege
`reporting_ro` holds. Measured after `014`:

```
has_table_privilege('authenticated','reporting.mv_student_daily_target','SELECT') = true
```

That MV carries `required_daily` and `plan_overload_flag` — both parent-facing only. The entire
mechanism for keeping the overload figure away from a child (rule B7, conflict X-5) was defeated: any
signed-in user, a student included, could read the MV directly through PostgREST.

**Fix (`016`)**: re-grant the membership `WITH INHERIT FALSE` (PostgreSQL 16+; this project is 17.6).
Non-inherited membership means `authenticated` does *not* automatically hold the privileges, while
`SET LOCAL ROLE reporting_ro` still acquires them — SET ROLE needs membership, not inheritance. That
is precisely the intended semantics: a capability the trusted API layer opts into per transaction.

| Check | Before `016` | After `016` |
|---|---|---|
| `authenticated` → `mv_student_daily_target` SELECT | **true** (hole) | **false** |
| `authenticated` → `v_student_today` SELECT | true | **false** |
| `authenticated` → schema `reporting` USAGE | true | **false** |
| `anon` → `mv_student_daily_target` SELECT | false | false |
| `reporting_ro` → `mv_student_daily_target` SELECT | true | true |
| `pg_auth_members` row with `inherit_option = false` | 0 | **1** |

### 20.4 Correction 3 — column grants cannot separate parent from student

`12-…md` §9.6 called column-level grants "the decisive control". **That is wrong.** Column privileges
are granted per Postgres role, and parents and students both connect as `authenticated`; the
application role lives in `public.app_user_roles`, not in the JWT role claim. So
`GRANT SELECT (score) TO authenticated` grants it to parents *and* students. Column grants can only
withhold a column from *every* authenticated user, which would break the parent report.

`015` therefore enforces the rule in three layers instead:

1. **No student SELECT policy exists** on any results table. RLS is deny-by-default once enabled, so a
   student SELECT returns zero rows — not an error, and not data.
2. **`public.may_read_results()`** is an explicit central guard on every surviving SELECT policy,
   returning `false` for `STUDENT` unconditionally. One function to audit instead of N policies, and a
   mistakenly re-added permissive student policy still cannot leak through the parent/admin ones.
3. **The `FOR ALL` write policies were narrowed to INSERT + UPDATE.** `FOR ALL` includes SELECT, so
   leaving them would have silently undone step 1. This is the easiest part of the fix to get wrong.

### 20.5 Correction 4 — the `exam_type` enum has 17 members and the readiness engine matched 2

`04-mock-tests-db-schema.md` documents four `exam_type` values. **The live enum has 17** — migration
`20260328045141` expanded it and the schema document was never updated. Seeding `dim_test_family` from
`pg_enum` exposed this: `BENCHMARK`, `NAPLAN_STYLE_READING`, `NAPLAN_STYLE_NUMERACY`,
`NAPLAN_STYLE_LANGUAGE_CONVENTION`, `MATHS_OLYMPIAD`, `ENGLISH_OLYMPIAD`, `SELECTIVE`, `GRAMMAR`,
`VERBAL_REASONING`, `NUMERICAL_REASONING`, `SPELLING`, `MENTAL_MATHS`, `GEOMETRY`, `WORD_PROBLEMS`,
`PROBLEM_SOLVING`, `CRITICAL_THINKING`, `VOCABULARY`.

**This uncovered a live defect in `src/lib/report/readiness.ts`.** Its `EXAM_TYPE_TO_READINESS` map
listed `NAPLAN_STYLE` and `OLYMPIAD` — neither of which exists. Only `SELECTIVE` matched, so every
NAPLAN-style and Olympiad attempt fell through to `attemptWeight`'s cross-exam fallback (0.15 for
Olympiad, 0.35 otherwise) instead of being weighted as direct evidence. The readiness report —
described in its own source comment as "the single highest-leverage asset in the funnel" — was
systematically under-weighting exactly the tests it exists to interpret.

The failure was silent by construction: a `Record<string, ReadinessExam>` miss returns `undefined` and
`attemptWeight` has a fallback for `undefined`. **Fixed** by mapping all six live family members, plus
a new regression test `scripts/readiness-exam-types.test.mts` (wired into `npm test`) asserting every
enum member is either mapped, is `BENCHMARK`, or is listed in the new `SKILL_EXAM_TYPES` export.
Result: **consent 46 pass / 0 fail, readiness 10 pass, `tsc --noEmit` exit 0.**

**Consequence for the P2 cohort definition — assumption A-21.** The brief defines the percentile
cohort as "same test family, year level and test form". With 17 members that is ambiguous: the values
mix genuine exam families with skill categories (`GRAMMAR`, `GEOMETRY`, `SPELLING`…). Two things follow:

- `dim_test_family` currently maps the enum **1:1**, which would fragment a NAPLAN cohort into three
  (Reading / Numeracy / Language Convention), each a third of the size — pushing it below the n=20
  suppression floor and silently switching P2 off. It needs a `family_group` column collapsing
  `NAPLAN_STYLE_*` → one family and `*_OLYMPIAD` → one family.
- Mapping the 11 skill values onto a readiness exam would assert an assessment relationship nobody has
  decided (e.g. that a `GEOMETRY` practice item evidences Selective readiness). **I have not invented
  one.** They are unmapped, exported as `SKILL_EXAM_TYPES`, and flagged as question **Q-11** —
  answered on 2026-11-20 by **decision 7-A**: a `skill_exam_mapping` configuration table, labelled
  editorial and unvalidated. The mapping is asserted *as configuration*, which is the only form in
  which it can be reviewed and withdrawn; had it been written into the readiness function itself it
  would have presented as measured fact, and a parent reading "Selective readiness 62%" off a
  `GRAMMAR` practice item would have had no way to know the link was invented.

### 20.6 Design-document text now known to be wrong

| Document | Section | Wrong | Correct version |
|---|---|---|---|
| `12-…md` | §9.3, §9.5 | RLS/policies on MVs and views | `014` header: grants + view WHERE clause |
| `12-…md` | §8.3 | `GRANT reporting_ro TO authenticated` (inherited) | `016`: `WITH INHERIT FALSE` |
| `12-…md` | §9.6 | Column grants as "the decisive control" | `015`: `may_read_results()` + policy narrowing |
| `12-…md` | §8.4 | `dim_test_family` mapped 1:1 from a 4-value enum | 17 live members; needs `family_group` |
| `11-…md` | §0.4, §5 | `readiness.ts` safe to reuse verbatim | Its enum mapping was broken; now fixed and tested |
| `14-…md` | §15.3 AC-06…AC-08 | Expect `permission denied for column` | Expect **0 rows** — the mechanism is RLS, not column grants |

Recorded rather than silently edited, so the reasoning that produced them stays visible.

### 20.7 Verified working end to end

| Behaviour | How verified | Result |
|---|---|---|
| Student SELECT policies gone from all three results tables | `pg_policies` sweep | **0 student SELECT policies** |
| Surviving SELECT policies carry the guard | `pg_policies` qual inspection | **all contain `may_read_results()`** |
| Students retain INSERT/UPDATE (can still sit a test) | `pg_policies` | **present on `attempts` and `responses`** |
| `load_student_dims()` runs | executed | **no error** |
| `safe_refresh()` non-concurrent | executed | **status `ok`, duration logged** |
| `REFRESH … CONCURRENTLY` works (DA-17) | executed on both MVs | **status `ok`, `ran_concurrently = true`** |
| Blackout guard (DA-16) | seeded a window covering now | **status `skipped_blackout`, no refresh** |
| `v_student_today` column list (AC-09) | `information_schema.columns` | **7 columns, zero forbidden** |
| Overload columns on the MV but not the view (AC-12) | `pg_attribute` vs `information_schema` | **2 on MV, 0 on view** |
| `reporting_ro` timeouts | `pg_roles.rolconfig` | **5s / 10s / 2s** |
| `dim_year_level_cap` seeded unset (Q-4) | count where cap IS NULL | **7 of 7 NULL, as designed** |
| Failed migrations roll back atomically | two failures observed | **no partial objects left behind** |
| Readiness enum mapping | `npm test` | **46 + 10 pass, 0 fail** |
| TypeScript | `tsc --noEmit` | **exit 0** |

One verification trap worth recording: `information_schema.columns` **excludes materialised views**, so
an early check returned 0 for the overload columns and looked like a pass for the wrong reason. MV
columns must be checked through `pg_attribute`. That is the assertion now used above.

### 20.8 What remains

| Item | Notes |
|---|---|
| Apply `010_subscriptions` | Fixed in repo — creates `public.profiles` plus an `auth.users` trigger, without which the webhook's `.update()` silently affects zero rows. Not applied. |
| Student app surface | `src/app/student/report/[attemptId]/page.tsx` still renders `TestReportView`. It now **fails safe** — with the SELECT policies gone, `loadReportData` returns `attempt: null` and the page shows "Report unavailable" — but it should be replaced by the S3 completion screen plus the S1/S2 cards. |
| `/api/reporting/student/*` routes | `today` and `completion` endpoints per `13-…md` §12, using `withReportingRole()`. |
| ~~`dim_test_family.family_group`~~ | **Done, and the reference was stale.** This row cited it as an outstanding prerequisite under `Q-11`, the same tag two other unrelated questions were using; it is renumbered **Q-12** in §19.1. Verified against the live database on 2026-11-20: `family_group` is populated for **17 of 17** families across `NAPLAN_STYLE`, `SELECTIVE`, `OLYMPIAD`, `SKILL_PRACTICE`, `BENCHMARK` — so the three-way NAPLAN fragmentation that would have pushed a cohort under the n=20 suppression floor no longer happens. P2's cohort is unblocked by the data, not by a decision. |
| Year-level caps | `dim_year_level_cap` is 7 rows of NULL awaiting Q-4. Until set, S2 falls back to `weekly_sessions_goal / 7`. |
| Remainder of Phase 1 | P1, P4, P7, P8, P9, A14, A15 per §16. |


**Phase 0 is not optional and not compressible.** It fixes a live access breach and unblocks the
event store that everything else reads.

**Phase 1 is ordered around the parent's two hardest questions** — PA1 "is my child on track?" and
PA2/PA8 "what should we do next?" — because they drive retention and, uniquely, need no editorial
or third-party dependency. Everything in Phase 1 can be built from data the platform already
captures.

**Phase 2 is gated on content authored by humans**: the VC2 mapping, misconception explanations,
writing anchors and the consent UX. None of it is engineering work.

**Phase 3 is gated on Stripe and on volume**: cohort retention, LTV and experiment significance are
all meaningless below a traffic floor, and building them before there is data produces dashboards
that display `INSUFFICIENT_DATA` permanently.

**The critical path is editorial, not engineering.** VC2 mapping, misconception authoring and the
anchor set together gate 8 of the 36 reports and cannot be started by an engineer. If those are not
staffed in parallel with Phase 1, Phase 2 slips by their full duration regardless of engineering
capacity. **This is the single largest schedule risk in the programme** and it is not visible in an
engineering-only plan.
