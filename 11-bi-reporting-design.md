# Mock Tests Platform — BI & Reporting Design (Part 1 of 4)

> **Scope of this document**: Deliverables 1–5 — architecture, advisory panel, role access
> matrix, MECE report inventory + decision coverage matrix, metric dictionary.
> **Companion documents**: `12-bi-reporting-data-model.md` (deliverables 6–9),
> `13-bi-reporting-integrations-api-ux.md` (deliverables 10–14),
> `14-bi-reporting-assurance-roadmap.md` (deliverables 15–16, assumptions log, self-review).
>
> **Written against**: live Supabase project `ekdjrvjgrhpqolthbznr` (org *PerfectPrep*,
> region `ap-southeast-2` Sydney, Postgres 17.6), inspected 24 October 2026.
> **Language**: Australian English throughout.

---

## 0. Read this first — what the inspection found

Three findings change the shape of this design. Everything downstream depends on them.

### 0.1 P0 — The live database already breaches the student access rule

The hard constraint is: *"The student role must have no SELECT permission on any results
table or on the reporting schema."* The production database currently grants exactly that
permission. Queried from `pg_policies`:

| Table | Policy | USING clause | Leaks |
|---|---|---|---|
| `public.attempts` | `Student can view own attempts` | `is_student_self(student_id)` | `score_out_of100`, `raw_accuracy`, `weighted_score`, `section_scores` |
| `public.responses` | `Student can view own responses` | `is_attempt_owner(attempt_id)` | `is_correct`, `answer` |
| `public.writing_evaluations` | `Student can view own evals` | `is_attempt_owner(attempt_id)` | AI writing marks, strengths, improvements |

And the UI consumes them: `mock-tests/src/app/student/report/[attemptId]/page.tsx` calls
`requireRole(['STUDENT'])` then renders the **full** `TestReportView` with scores,
per-question correctness and writing marks.

**This is not a reporting-layer problem. It is a live breach that must be remediated before
any dashboard work starts.** Remediation SQL is in `12-bi-reporting-data-model.md` §9.6.

The complication: students legitimately need `INSERT`/`UPDATE` on `attempts` and `responses`
to sit a test. So the fix is *not* "revoke everything" — it is:

1. Drop the three student **SELECT** policies above.
2. Keep the student **write** policies (the runner needs them).
3. Give the runner its read-back through a `SECURITY DEFINER` function returning only
   `question_id` and the student's own `answer` — never `is_correct`, never `correct_answer`.
4. Replace `/student/report/[attemptId]` with the completion screen (report **S3**).

Verified mitigating fact: `src/app/api/runner/start/route.ts` reads only
`attempts(id, started_at)` and `attempts(id, status)` — it does **not** select from
`responses`. So step 3 is a new capability, not a rewrite. This must be re-verified against
`runner/save` and `runner/submit` during implementation (assumption **A-14**).

### 0.2 P1 — The repo is two migrations ahead of the database, and migration 010 will fail

| | Repo | Live DB |
|---|---|---|
| Migrations present | `001`–`011` | `001`–`009` + `social_auth` (11 applied) |
| `010_subscriptions.sql` | present | **not applied** |
| `011_funnel.sql` | present | **not applied** |

`to_regclass` returns `NULL` for `public.profiles`, `public.subscriptions`,
`public.funnel_events` and `public.student_exam_targets`.

**Blocker**: `010_subscriptions.sql` line 23 runs
`ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS stripe_customer_id text;`
but `public.profiles` does not exist in this database. Migration 010 **will abort**.
`IF NOT EXISTS` guards the *column*, not the *table*.

This matters because `011_funnel.sql` is where the event store lives. `funnel_events` is the
source for `fact_event`; `student_exam_targets` is the source for the student countdown
(**S1**) and practice plan (**S2**); `subscriptions` is the source for MRR and churn
(**A8**). **None of the reporting layer can be built until 010 and 011 are applied.**
Fixing 010 is prerequisite work, not optional cleanup.

### 0.3 P1 — Other structural gaps

| Missing | Consequence |
|---|---|
| No enquiry / contact / lead / message / ticket table in any schema | Deliverable 7 creates one from scratch |
| `pg_cron` **available** (1.6.4) but **not installed** | Must `CREATE EXTENSION` before any refresh schedule |
| `pg_net` available, not installed | Needed only if reconciliation runs in-DB rather than from Node |
| No `reporting` schema | Deliverable 8 creates it |
| No tutor↔student link table (`TUTOR` enum value exists, nothing else) | Every tutor report is unbuildable until it exists |
| No consent table | Privacy requirement 5 (consent for tutor access) is unmet |
| No Victorian Curriculum 2.0 dimension | Only `questions.tags` jsonb, `topic`, `sub_topic` and 15 `skill_*` numeric columns exist. **There are no VC2 content descriptions or codes anywhere in the database.** |

That last row is the biggest content risk in the programme. Reports P3, T2 and A3 are
specified as *VC2 content description* views. The platform cannot produce them until the item
bank is mapped to VC2. That is an **editorial task, not an engineering task**, and it sits on
the critical path. It is not something I can generate — inventing curriculum codes is
explicitly forbidden. See assumption **A-02**.

### 0.4 What already exists and must be reused

| Asset | Reuse decision |
|---|---|
| `public.funnel_events` (011) | Becomes the source for `reporting.fact_event`. Do **not** build a second event store. |
| `EVENT_STEP` in `src/lib/funnel/events.ts` | The naming convention already exists: **`SCREAMING_SNAKE_CASE`** with a closed typed vocabulary. Deliverable 6 extends it, never replaces it. |
| `processed_webhook_events` (`event_id` UNIQUE) | Already the Stripe idempotency ledger. Deliverable 10 builds on it. |
| `has_role()`, `is_parent_of()`, `is_student_self()`, `is_attempt_owner()` (004) | Reused verbatim in new RLS policies so access rules cannot drift. |
| `can_access_published_test()` (007/010) | Untouched. |
| `src/lib/report/readiness.ts` | Readiness band logic already written and well-commented. **P1** wraps it; it does not reimplement it. |
| `questions.difficulty_dynamic`, `discrimination_index`, `success_rate`, `skip_rate`, `most_common_wrong_answer`, `avg_time_taken_seconds`, `flag_count` | The columns **A1** needs — but denormalised onto the item table, which is wrong for reporting. See §5, metric `p_value`. |

---

## 1. Deliverable 1 — Architecture overview

> **Note on numbering**: the brief's deliverable list starts at **2**. Item **1** was not
> supplied. I have assumed it is the architecture overview, because every other deliverable
> references a target architecture that is otherwise nowhere stated. Logged as **A-01**.

### 1.1 Principle: isolate reporting inside one database, do not duplicate it

The platform is pre-launch — **every table in `public` has 0 rows**. That is the most
important fact in this document. It means:

- No legacy volume to migrate, so the star schema can be built correctly first time.
- No data to validate against, so the test plan must generate its own fixtures. Accuracy
  testing without fixtures is theatre.
- The `<2s` budget is achievable at launch and stays achievable, because the design
  pre-aggregates rather than computing on request.

A separate analytics database is **not** justified at this scale. It would add a second
failure mode, replication lag and a second bill, to solve contention that does not exist.
Instead reporting is isolated *inside* the same instance by four mechanisms, each cheap and
each aimed directly at "never slow down live tests":

| Mechanism | How it protects the test-taking path |
|---|---|
| Separate `reporting` schema | Dashboards never scan `public` tables at query time |
| Materialised views | Expensive aggregation runs once on a schedule, not per request |
| `reporting_ro` role + `statement_timeout` | A runaway reporting query is killed at 5s |
| `pg_cron` blackout windows | `REFRESH` never runs during peak test windows |

### 1.2 Target architecture

```
                       ┌──────────────────────────────────────────────┐
   Browser (mobile)    │  Next.js 16 App Router (Vercel)              │
   ───────────────────►│                                              │
                       │  /student   → S1 S2 S3   (NO charts at all)  │
                       │  /parent    → P1..P10    (ECharts SSR→SVG)   │
                       │  /tutor     → T1..T7     (ECharts canvas)    │
                       │  /admin     → A1..A15    (ECharts canvas)    │
                       │  /creator   → TC1        (tables only)       │
                       └───────────────┬──────────────────────────────┘
                                       │  /api/reporting/*  (Node, per-role)
                                       │  SET LOCAL ROLE reporting_ro
                                       │  SET LOCAL statement_timeout = '5s'
                                       ▼
   ┌───────────────────────────────────────────────────────────────────────────┐
   │ Supabase Postgres 17 (ap-southeast-2)                                     │
   │                                                                           │
   │  schema public     ── OLTP. Test-taking path. Never scanned by BI.         │
   │    attempts, responses, writing_evaluations, funnel_events,               │
   │    subscriptions, purchases, student_exam_targets, enquiries, ...         │
   │                     │                                                     │
   │                     │  ETL (pg_cron, blackout windows only)               │
   │                     ▼                                                     │
   │  schema reporting  ── BI. Star schema + pre-aggregations.                 │
   │    dim_*  fact_*  mv_*  v_*  reporting_ro  refresh_blackout               │
   └───────────────────────────────────────────────────────────────────────────┘
                                       ▲
   Stripe webhooks ──► /api/webhooks/stripe ──► public.stripe_*  ─┘
   QStash (cron)   ──► /api/cron/*        ──► reconcile, refresh, alerts
```

### 1.3 Charting library recommendation

**Recommendation: Apache ECharts 6.1.0 (Apache-2.0), consumed through `echarts/core` with
explicit component registration.**

A genuine trade-off, because ECharts is the *largest* shortlisted option and the brief sets a
hard mobile budget. It wins on three non-negotiable requirements rather than on size.

| Library | Version / Licence | Renderer | Tree-shaken gz | Built-in text alternative | Built-in non-colour encoding | React 19 fit | Verdict |
|---|---|---|---|---|---|---|---|
| **Apache ECharts** | 6.1.0 / **Apache-2.0** | Canvas (SVG optional) | ~100 kB | **Yes** — `aria.show:true` generates a description from title, series and data | **Yes** — `aria.decal.show:true` renders pattern fills | No official wrapper; ~60-line `useRef` wrapper, zero deps | **Selected** |
| Recharts | 3.10.1 / MIT | SVG only | ~35–50 kB | No | No | Supported (16.8–19) but needs a `react-is` override | Rejected |
| Chart.js | 4.x / MIT | Canvas | ~35–40 kB | No | No (heatmap needs `chartjs-chart-matrix`) | Via `react-chartjs-2` | Rejected |
| Visx | 3.x / MIT | SVG | small per package | No | No | Native, but you build every chart | Rejected |
| Nivo | 0.99.x / MIT | SVG/Canvas | large | No | No | React 19 since 0.98; still pre-1.0 | Rejected |

**1. Accessibility — decisive.** The brief requires *text alternatives for every chart* and
*no meaning carried by colour alone* under WCAG 2.2 AA. ECharts is the only shortlisted
library with a first-class `aria` component **and** `aria.decal` pattern fills. Decals are the
correct technical answer to colour-blind safety: they satisfy "not by colour alone"
*structurally*, rather than depending on a palette a reviewer must re-audit every release.
With Recharts/Chart.js/Visx both features are hand-built per chart — precisely the requirement
that decays under deadline. Decals also solve the tutor **skill-gap heatmap (T2)**, which must
stay readable in greyscale and in print.

**2. Mobile rendering.** Canvas beats SVG on mid-range Android once a chart exceeds a few
hundred nodes. That matters for **T2** (students × content descriptions) and the **A1** item
scatter (potentially thousands of items). SVG libraries re-render DOM nodes; canvas does not.

**3. Bundle size — the real objection, and how it is neutralised.** Two ECharts features make
~100 kB acceptable:
- **Server-side SVG string rendering** (since 5.3, zero dependencies). The parent dashboard is
  rendered to an SVG string inside a Next.js server component. The chart arrives in the
  initial HTML — no client JS, no layout shift, no request waterfall.
- **Lightweight client runtime** (since 5.5.0, ~4 kB / **~1 kB gzipped**) for the few
  interactions worth having on a phone. The parent route ships ~1 kB of chart JS, not ~100 kB.

The full canvas build is `next/dynamic`-imported **only** on `/tutor` and `/admin`, which are
desktop-weight routes anyway. The **student route ships zero chart JS** — S1 is a number, S2
is a number plus a CSS progress ring.

**4. Licence.** Apache-2.0: permissive, patent-granting, commercial-SaaS compatible, no UI
attribution, no copyleft. (Highcharts was excluded outright — commercial licence.)

**Implementation rules that follow** (enforced in code review):
- Never `import * as echarts from 'echarts'` — that ships ~1.8 MB min / ~520 kB gz. Always
  `echarts/core` + `echarts.use([...])`. This is the most common ECharts performance mistake
  and would blow the 2s budget on its own.
- One shared `src/components/charts/EChart.tsx` wrapper. No third-party React wrapper
  (`echarts-for-react` is community-maintained — a compatibility risk on React 19).
- Every chart renders a sibling `<details>` containing the data as an HTML table. That is the
  *real* text alternative — the `aria` description is a summary, the table is the accessible
  equivalent, and it gives screen-reader users the drill-down sighted users get by tapping.

### 1.4 Performance budget

Target: **<2s to interactive on a mid-range phone on 4G**, per dashboard.

| Budget line | Allocation | Enforced by |
|---|---|---|
| TTFB (server component + reporting query) | 400 ms | `statement_timeout=5s`; every query hits an MV, never a fact table |
| HTML + critical CSS | 60 KB gz | Existing Tailwind 4 setup |
| Route JS — parent / student | 90 KB gz | ECharts SSR→SVG + 1 kB runtime; `next/dynamic` elsewhere |
| Route JS — tutor / admin | 200 KB gz | Acceptable: desktop-weight, lazily loaded |
| Data payload per screen | 30 KB gz | Pagination caps |
| Render + interaction | 400 ms | Canvas, not SVG, above ~300 nodes |

The decision that makes this achievable: **no dashboard query touches a fact table.** Every
read is from a materialised view keyed by exactly the filters the UI exposes.

---

## 2. Deliverable 2 — Advisory panel requirements and conflict resolution

Each panel member was consulted in turn on the full report set. What follows is what each
asked for, then the conflicts, then the resolution. Where a panel member asked for something
the brief forbids, the brief wins and the reason is recorded — the panel advises, it does not
overrule a confirmed decision.

### 2.1 Digital Marketing Specialist

| # | Requirement | Lands in |
|---|---|---|
| M1 | UTM captured at first touch and replayed on every subsequent event, so a paying customer can be attributed to the channel that produced them | `dim_campaign`, `fact_event.utm_*` |
| M2 | CAC / cost-per-acquisition by channel and campaign — requires ad spend, which is **not** in any system today | A10, manual spend input |
| M3 | Cohort retention curves by acquisition channel (month-0 signups → still active at month *n*) | A10 |
| M4 | Lifetime value by channel, so ROAS can be computed | A10 |
| M5 | Lifecycle email performance: sent / delivered / opened / clicked / unsubscribed by template | A11 + `email_log` (011) |
| M6 | Referral programme performance — `referrals` and `referral_codes` already exist in 011 | A11, referral segment |
| M7 | Channel mix over time, so budget can be shifted | A10 |
| M8 | Suppress channel reporting below a volume floor, because a 1-conversion channel showing 100% conversion will be believed | A10 low-data state |

**Critical dependency M2 raises**: CAC needs spend. There is no ads integration, no spend
table, no budget data anywhere in the repo or the database. **I will not invent spend
figures.** Resolution: `dim_campaign` carries a nullable, manually-maintained
`monthly_spend_cents`, and every CAC/ROAS visual renders a *"spend not recorded"* empty state
until populated. Logged as **A-08**.

### 2.2 Conversion Rate Optimiser

| # | Requirement | Lands in |
|---|---|---|
| C1 | Stage-to-stage funnel with absolute drop-off counts, not just percentages | A11 |
| C2 | Funnel segmented by channel, campaign, device, test family and year level | A11 |
| C3 | Checkout abandonment: `CHECKOUT_STARTED` without `CHECKOUT_COMPLETED`, with time-to-abandon | A11 |
| C4 | Pricing page behaviour: scrolls, plan comparisons, exit point | A11 (event-driven) |
| C5 | Free-to-paid conversion rate with the denominator stated explicitly on the visual | A11 |
| C6 | A/B test results with sample size, significance and a recommended decision | A12 |
| C7 | Time-to-first-value — signup to `DIAGNOSTIC_COMPLETED` — as the activation metric | A11 |
| C8 | Offer mechanics: `OFFER_MADE` → `OFFER_VIEWED` → `CHECKOUT_COMPLETED`, and expiry loss | A11 |
| C9 | Device split on every funnel number, because mobile converts differently | A11 |

**C9 exposes a real gap**: `funnel_events` (011) does **not** store device, screen size or
user agent. The `props` jsonb could carry it, but nothing writes it today. Resolution:
deliverable 6 adds a `device` property to the tracking contract and `/api/events` derives it
server-side from `User-Agent` / `Sec-CH-UA` headers — **not** from client-supplied props,
because a client can lie and would then corrupt every segment. Logged as **A-09**.

### 2.3 Behavioural Economist

This panel member holds **veto rights on every parent and student surface**, per the brief.

| # | Requirement | Type |
|---|---|---|
| B1 | **No percentile rank may ever render without personal progress beside it.** A rank alone says "your child is below average" with no path forward — the most anxiety-generating artefact in education reporting | Hard rule |
| B2 | **No rank, score, percentage, band or comparison of any kind on any student surface.** Countdown and daily target only | Hard rule (matches brief) |
| B3 | **Predictions must carry uncertainty.** A point estimate is read as a verdict. Every projection shows a range plus a plain-English confidence statement | Hard rule |
| B4 | **No loss-framed streak mechanics.** A broken streak must not appear as a loss, a red reset counter, or a "you lost your streak" message. If a streak shows at all it shows only the current run — never a personal best the child has fallen short of | Hard rule |
| B5 | **No red warning states on student or parent surfaces.** Alerts use neutral or amber treatment and describe the *action*, not the *failure* — "Two sessions left this week", not "You are behind" | Hard rule |
| B6 | **No social comparison between children.** No leaderboards, no "compared to your class", no named peer benchmarks. Cohort percentile is an anonymous statistical distribution, explicitly labelled a *platform* cohort | Hard rule |
| B7 | **Daily target capped; overload never shown.** If missed days push required load above the year-level cap, the student keeps seeing the cap and the parent gets a plan-adjustment notice | Hard rule (matches brief) |
| B8 | **No countdown-driven scarcity aimed at a child.** Deadlines are a parent-facing commercial mechanic and never appear on a student surface | Hard rule |
| B9 | **Upsell prompts must not use the child's performance as leverage.** "Your child is falling behind — upgrade now" is prohibited. Offers may reference the *product*, never the *child's standing* | Hard rule |
| B10 | **Goal setting proximal and achievable.** Small weekly goals beat a distant exam target. The daily target is the proximal goal; the exam date is context, not pressure | Design rule |
| B11 | **AI writing marks labelled as AI-generated at the point of display**, not in a footnote — a parent will otherwise read them as a teacher's professional judgement | Hard rule (matches brief) |
| B12 | **At most three recommended next actions.** More produces choice paralysis and reduces the chance any is taken | Design rule (matches brief) |
| B13 | **No misleading precision.** "73.4%" is false precision. Band to whole numbers or to a named band; never show more significant figures than the evidence supports | Hard rule |

**B-flagged designs already in the codebase** (the panel reviewed what is built, per the
instruction to review *every* parent element):

| Existing artefact | Concern | Resolution |
|---|---|---|
| `funnel_state.stage` includes `PAYWALL_READY`; events `PAYWALL_TRIGGERED`, `PAYWALL_LOCK_CLICKED` | A paywall immediately after a child's diagnostic risks presenting the child's result as the reason to pay | Keep the mechanic — it is the business model. **Constrain the copy**: the paywall may not display the child's score as the reason to buy. Locked panels show *what exists*, not *what the child scored* |
| `offers.offer_expires_at`; `OFFER_EXPIRED` | Expiry countdowns are a pressure pattern; on a children's product aimed at anxious parents this is the highest-risk dark pattern present | Countdown permitted **only** parent-facing, **only** at ≥7 days, never worded as scarcity of the child's opportunity. Sub-24h timers prohibited. See conflict **X-3** |
| `src/features/report/components/LockedInsightPanel.tsx` | Must not preview a locked score to induce purchase | Audit required: may describe the *kind* of insight ("time-per-question analysis"), may not show a number |
| `readiness.ts` bands using ACARA-style proficiency vocabulary | Band language must not become a label for the child | Bands describe *performance on this platform's tests*, never the child. Wording audited in P1 |
| `student_exam_targets.weekly_sessions_goal` | A parent-set goal could become child-facing guilt if missed | Drives **S2** arithmetic only. Never shown to the student as a target they failed |

### 2.4 Parents

| # | Question they actually ask | Requirement | Lands in |
|---|---|---|---|
| PA1 | "Is my child on track for their exam?" | One headline answer in plain English, with a date and a range — not a dashboard to interpret | P1 |
| PA2 | "What should we work on next?" | A named topic in words a non-teacher understands. **No curriculum codes.** At most three actions | P3, P8 |
| PA3 | "Is this worth paying for?" | Visible progress since they started. Must be answerable from free data already shown — the paywall may not hide the evidence that the product works | P4 |
| PA4 | "How does this compare to other kids?" | Percentile, but only with cohort size, date range, and an explicit statement that this is a platform cohort, not the state or national population | P2 |
| PA5 | "What did they actually get wrong?" | Item review grouped by skill with the likely misconception, in plain English | P5 |
| PA6 | "Is the writing mark fair?" | Rubric criteria, trend per criterion, next steps, and a clear AI-generated disclosure | P6 |
| PA7 | "Is my child actually working, or clicking through?" | Time on task, pacing, skips, guessing | P7 |
| PA8 | "How do I set this up?" | Assign exams, set dates, set rest days — without a manual | P9 |
| PA9 | "Who can see my child's data?" | A consent and access surface listing tutor links, with revoke | P10 |
| PA10 | "Can I understand this on my phone in 30 seconds?" | ≤5 visuals per screen, one clear next action per screen, no jargon | All parent reports |

**PA3 is the hardest parent requirement**, because it collides with the paywall. The existing
`readiness.ts` already resolves it correctly: headline score, band per exam and top topic gaps
are **free always**, with the code comment noting that withholding them "would break the
reciprocity the offer depends on". This design adopts that as a rule: *the evidence that the
product works is never behind the paywall*. What is locked is **depth** — time-per-question
diagnostics, per-question review, longitudinal trend, the adaptive study plan.

### 2.5 Students (Years 2 to 8)

| # | Question | Requirement | Lands in |
|---|---|---|---|
| ST1 | "How long until my exam?" | A single large number of days. Nothing else on that card | S1 |
| ST2 | "How much should I practise today?" | A single small number — today's target — that feels achievable | S2 |
| ST3 | "Did I do it?" | Immediate positive acknowledgement. **No score, no correctness, no mark of any kind** | S3 |
| ST4 | "Am I good at this?" | **Deliberately not answered.** Any answer is a judgement on a child. The student surface answers "did I practise?", never "how well?" | — |

Reading-age constraint: Years 2–8 spans roughly ages 7–14, and a Year 2 student reads very
differently from a Year 8 student. Resolution: copy written to a **Year 4 reading level** (the
midpoint), sentences under 12 words, no abstraction, and every numeric card carries an icon
plus text. Logged as **A-10**. I am not asserting a measured reading age for any specific
child — this is a copywriting standard, not a claim about the users.

### 2.6 Independent tutors

| # | Question | Requirement | Lands in |
|---|---|---|---|
| TU1 | "Which of my students need help?" | A ranked list, each row showing **the rule that flagged it** — a tutor must be able to disagree with a flag | T3 |
| TU2 | "On which skills?" | Student × content-description heatmap, printable, readable in greyscale | T2 |
| TU3 | "What should I set next?" | A recommendation per flagged student, ranked by expected impact | T7 |
| TU4 | "How is each student moving?" | Period-over-period movement, not just a level | T1 |
| TU5 | "Is this item working?" | p-value and top distractors, **only for tests this tutor assigned** | T4 |
| TU6 | "What have I set and what is outstanding?" | Assigned / started / completed / overdue | T5 |
| TU7 | "Can I trust this AI writing mark?" | Read-only mark, model + rubric version visible, and a flag action | T6 |
| TU8 | "Can I export this to plan a lesson offline?" | CSV export from every tutor table | T1–T6 |
| TU9 | "Am I seeing this student lawfully?" | Only students with a current consent record. Linkage state visible | T1 + P10 |

**TU9 binds the whole tutor surface.** The `TUTOR` role exists as an enum value and *nothing
else* — no link table, no consent record, no UI. Every tutor report is unbuildable until
`public.tutor_student_links` and `public.consent_records` exist. Deliverable 8 creates both.

### 2.7 Conflicts between panel members, and how each was resolved

Nine genuine conflicts surfaced. Where the brief had already made a decision, the brief wins
and the conflict is about *how*, not *whether*.

| ID | Conflict | Parties | Resolution | Why |
|---|---|---|---|---|
| **X-1** | Marketing wants percentile-based "how you compare" messaging to drive acquisition. The Behavioural Economist prohibits comparison between children. | Marketing vs Behavioural Economist | **Percentile is parent-login-only, never in marketing, never student-facing, always paired with personal progress (B1), suppressed below n=20, always labelled a platform cohort.** Marketing may say "see where your child stands against a similar cohort" and may not publish any percentile figure externally. | The brief already mandates the pairing and the suppression. Marketing's ask is satisfiable by *describing* the feature without *showing* a number. No compromise on B1/B6 was needed. |
| **X-2** | The CRO wants the paywall immediately after the readiness report, with the score visible as the hook. The Behavioural Economist prohibits using the child's standing as purchase leverage (B9); the Parent panel needs free evidence that the product works (PA3). | CRO vs Behavioural Economist vs Parents | **Free always**: headline readiness score, band per exam, top topic gaps. **Locked**: time-per-question diagnostics, per-question review, longitudinal trend, adaptive study plan. The paywall describes what is locked; it never re-displays the score as the reason to buy. | This is exactly the split already implemented and justified in `src/lib/report/readiness.ts`. Adopting it costs nothing and resolves all three positions at once. The CRO keeps a strong paywall; the Economist keeps the child out of the sales pitch; the parent keeps the evidence. |
| **X-3** | The CRO wants short expiry countdowns on offers (`offers` table and `OFFER_EXPIRED` already exist). The Behavioural Economist classifies sub-24h scarcity timers as a dark pattern on a product sold to anxious parents. | CRO vs Behavioural Economist | **Countdown permitted, with a floor: minimum 7 days to expiry, parent-facing only, never on a student surface, never worded as the child losing an opportunity.** Sub-24h and fabricated-scarcity timers prohibited. Copy states what the offer is, not what the child will lose. | The CRO's mechanism (a deadline converts better than an open-ended gift — stated in the 011 migration comments) survives at 7 days. The Economist's concern is *pressure magnitude*, not deadlines per se. |
| **X-4** | The brief sets the minimum percentile cohort at **20 students**. `01-mock-tests-project-charter.md` line 98 sets the internal threshold at **≥200 attempts per Year+ExamType**, behind a feature flag. | Brief vs existing charter | **Brief wins: n≥20 students.** The charter's 200-attempt rule is retained as a *separate, stricter* feature flag for the marketing-facing benchmark, and both are recorded in the metric dictionary so the numbers are never confused. | The brief states its decisions are confirmed. But the charter's concern is legitimate — at n=20 the standard error is large enough that one additional student moves a child several places. So: cohort size always visible (the brief requires it), plus a low-data treatment between n=20 and n=49 that shows the **band** rather than the point. Satisfies both without inventing a threshold. |
| **X-5** | The Behavioural Economist wants the daily target small and always achievable (B7, B10). The Parent panel wants enough practice to hit an exam goal, and `weekly_sessions_goal` allows up to 14. | Behavioural Economist vs Parents | **The cap wins; overflow goes to the parent, never the child.** Required daily load is computed from the plan; if it exceeds the year-level cap, the student sees the cap and the parent gets a *plan-adjustment* notice with **no purchase CTA**. | The brief mandates this behaviour. My addition: the notice must be commercially neutral, otherwise "adjust the plan" quietly becomes "buy more" — B9 by another route. |
| **X-6** | Tutors want item-level analysis (p-value, distractors). Test Creator has "no student reporting access". Admin owns item statistics. Three roles touch one metric. | Tutors vs Test Creator vs Admin | **One definition, one owner, scoped instances.** `p_value` and `distractor_analysis` are **owned by A1**. **T4** is the same metric restricted to tests the tutor assigned and to that tutor's consented students. **TC1** receives *no* item statistics — only content coverage counts, which contain no student data. | The MECE rule permits a metric in several reports provided it has one owning definition. Splitting the definition guarantees the tutor's p-value and the admin's diverge within a quarter. Scope is enforced in RLS, not the UI. |
| **X-7** | Marketing wants LTV and CAC by channel, requiring orders joined to identity. Privacy requires no PII in analytics tables. | Marketing vs Privacy | **`reporting` holds no PII.** Dimensions carry surrogate keys plus pseudonymous attributes only. The `user_id → surrogate key` mapping stays in `public`. `dim_campaign` holds UTM strings (not personal data). Enquirer contact details live in `public.enquiry_contacts`, **excluded from the reporting schema entirely**, with no view over it. | Attribution needs a *link*, not a *name*. A surrogate key preserves the join while leaving the reporting schema non-identifying on its own — which is also what makes the admin pseudonym rule enforceable rather than aspirational. |
| **X-8** | Admin wants row-level student drill-down for operational tasks. Privacy requires pseudonymous access with a stated reason. | Admin vs Privacy | **Drill-down goes through one `SECURITY DEFINER` function requiring a `task_reason` argument, writing an audit row before returning data, and returning pseudonym + metrics only — never a name, never a contact detail.** No direct table access. The audit table is append-only and visible to Admin. | "Only for operational tasks" is unenforceable without a record of which task. Making the reason a *required argument* means the audit trail cannot be skipped by forgetting — there is no other way in. |
| **X-9** | The CRO and Marketing both asked for A/B reporting; the brief lists it twice (under revenue as "pricing experiment outcomes", under acquisition as "A/B test results"). | CRO vs Marketing — and a MECE breach in the brief itself | **Merged into one report: A12 Experiment Results**, owning significance testing and the recommended decision for *all* experiments, pricing included. A9 shows the revenue outcome and links to A12 for the causal claim. | A pricing experiment and a UI experiment answer the identical question — "did this change work, should we ship it?" — with identical statistics. Two reports produce two definitions of significance and, eventually, two contradictory recommendations for the same test. |

**Where the conflicts clustered.** The brief's student constraints (B2, B4, B5, B8) and the
Parent panel's PA10 (≤5 visuals, one next action) were already mutually consistent — no student
or parent surface required a trade-off. **Every real conflict sat in the admin/commercial
layer**, where revenue motives meet privacy and behavioural constraints. That is where review
effort should be concentrated, and it is why §9 of `12-…md` enforces these rules in RLS rather
than trusting the UI.

---

## 3. Deliverable 3 — Role access matrix

### 3.1 Correction to the brief's table

The brief's access table has a **formatting fault in the Tutor row**: the "Can see" cell is
empty and the Parent's text ("All reports for their own linked children, including percentile
ranks and personal progress") appears to have shifted into it. I have read the Tutor row as:

> **Tutor — Can see:** all reports for students linked to them by a current consent record,
> including percentile ranks and personal progress. **Cannot see:** students not linked to
> them; billing data.

This is consistent with the "Cannot see" cell that *is* present, and with the tutor dashboard
scope in the brief. Logged as **A-03**; please confirm.

### 3.2 The matrix

Enforcement layer is stated for every cell, because *"hiding data in the user interface alone
is not acceptable"*.

**Legend** — `R` = read, `W` = write, `—` = no access, `A` = audited access, `P` = pseudonymised.
**Layers**: `RLS` = row-level security, `GRANT` = SQL object privilege, `FN` = SECURITY DEFINER function.

| Data object | Student | Parent | Tutor | Test Creator | Admin |
|---|---|---|---|---|---|
| `reporting.*` (all views & MVs) | **—** `GRANT` revoked | R own children `RLS`+`GRANT` | R consented students `RLS`+`GRANT` | **—** `GRANT` revoked | R aggregate `RLS`; A/P row-level `FN` |
| `public.attempts` | **W only**, no SELECT `RLS` | R own children `RLS` | R consented `RLS` | — `RLS` | R all `RLS` |
| `public.responses` | **W only**, no SELECT `RLS` | R own children `RLS` | R consented `RLS` | — `RLS` | R all `RLS` |
| `public.writing_evaluations` | **—** `RLS` | R own children `RLS` | R consented `RLS` | — `RLS` | R all `RLS` |
| `public.enquiries` | — | R own `RLS` | — | — | R all, **no contact details** `RLS` |
| `public.enquiry_contacts` (restricted) | — | — | — | — | **R via restricted view only** `GRANT`+`FN` |
| Billing: `purchases`, `subscriptions`, `fact_order` | — | R own `RLS` | **—** `RLS` | — | R all `RLS` |
| `dim_student` / student identity | own pseudonym only | linked children | consented students | — | **P only** `FN` |
| Raw contact details (email, phone) | — | own | — | — | **—** outside `enquiry_contacts` `GRANT` |
| Item statistics (`A1` metrics) | — | — | R for own assigned tests `RLS` | **—** | R all `RLS` |
| Curriculum coverage counts (no student data) | — | — | R | **R** `RLS` | R |
| `reporting.admin_access_audit` | — | — | — | — | R, append-only `RLS` |

### 3.3 Student: what the role may and may not see

This is the row currently breached (§0.1) and the one with least tolerance for error.

| Permitted | Source | Prohibited | Enforcement |
|---|---|---|---|
| Countdown in days to each assigned exam | `student_exam_targets.exam_date`, `assignments` | Any score, percentage, percentile, band | `GRANT` revoked on `reporting`; no RLS policy returns a result value to `STUDENT` |
| Daily practice target (tests or questions) | plan tables | Correct/incorrect on any item | No SELECT policy on `responses` for `STUDENT` |
| Completion acknowledgement after a test | `attempts.status` only | Any writing mark or rubric criterion | No SELECT policy on `writing_evaluations` for `STUDENT` |
| Own pseudonymous username | `student_profiles.username` | Mastery, trends, any report | `/student/report/*` route removed |
| | | Any indication of relative performance | Post-test screen returns a **fixed** payload |

**The structural guarantee.** Rather than relying on a filtered view, the student post-test
endpoint returns a **constant object** with no query behind it:

```typescript
// src/app/api/reporting/student/completion/route.ts
// There is deliberately no database read here. A query that cannot run cannot leak.
const PAYLOAD = { status: 'completed', message: 'Nice work — you finished!' } as const
```

Countdown and daily-target endpoints are the *only* two student reads, and both are
`SECURITY DEFINER` functions whose `RETURNS` clause makes leakage structurally impossible —
they return `(exam_label text, days_remaining int)` and `(target_units int, unit_kind text)`.
No column in either return type could carry a score. **This is what makes the hard constraint
testable** rather than merely asserted — see `14-…md` §15.3.

### 3.4 Admin: the pseudonymous drill-down rule

Admin sees aggregates freely. Row-level student data requires all of:

1. A `SECURITY DEFINER` function `reporting.admin_student_drilldown(student_key, task_reason)`.
2. `task_reason` `NOT NULL` with a minimum length — an empty string is rejected.
3. The function inserts into `reporting.admin_access_audit` **before** it selects. If the audit
   insert fails the whole call fails; there is no path returning data without a record.
4. The return type contains `student_pseudonym`, never `student_id`, never a name, never a
   contact detail.
5. Raw contact details are reachable **only** through `public.enquiry_contacts` — no `reporting`
   view, no admin dashboard surface, a separate `GRANT`.

### 3.5 Test Creator: an empty row is not acceptable

The brief gives Test Creator "no student reporting access" and "cannot see all student-level
data". Read literally that role has **zero** reports — and the coverage matrix would then hold
a row for a role with no decisions covered, breaching collective exhaustiveness.

Resolution: **TC1 Content Coverage & Production Queue** is granted to Test Creator. It is
provably not student reporting:

| TC1 contains | TC1 does not contain |
|---|---|
| Count of items per VC2 content description per level | Any attempt, response or score |
| Coverage status: none / too few / all-too-easy / all-too-hard | Any student key, pseudonym or aggregate |
| Draft → pending → published counts by test family | Any p-value, discrimination index or distractor |
| Age of oldest draft awaiting review | Any parent, tutor or order data |

Item *statistics* are computed from student responses, so they are excluded — that is what
keeps TC1 on the right side of the constraint. Coverage *counts* come from the item bank and
the curriculum dimension alone. **This is a deviation from a literal reading of the brief and
needs your sign-off** (question **Q-3**).

---

## 4. Deliverable 4 — MECE report inventory and decision coverage matrix

### 4.1 Inventory rules applied

- **Mutually exclusive**: each report answers *one* primary question for *one* primary role. A
  metric may appear in several reports but has exactly one **owning report** and one
  definition (§5).
- **Collectively exhaustive**: every decision each role must make is covered by at least one
  report. Proven by the matrix in §4.6 — **no empty rows**.
- **Report IDs are stable identifiers.** They are used in the API paths (§12 of `13-…md`), the
  alerting rules (§14) and the test plan (§15). Renaming one is a breaking change.

### 4.2 Changes made to the brief's scope, and why

The brief says to treat its dashboard lists as a starting point. Six changes were needed to
achieve MECE:

| Change | Type | Reason |
|---|---|---|
| **Added S3** Session Complete (student) | Add | Not in the brief's student list, but the brief separately mandates "the post-test screen shows a completion message only". That screen is the highest-leakage surface in the product and must be specified as a report with an explicit zero-metric contract, or it will be built ad hoc. |
| **Added P10** Consent & Access Control (parent) | Add | Privacy requirement 5 demands "consent records for tutor access", and parent question PA9 ("who can see my child's data?") is a real decision. Without P10 the coverage matrix has an empty row. |
| **Added T7** Next-Best Recommendations (tutor) | Add | The tutor's stated question is *"what should I set next?"*. The brief's Assignment Tracker answers "what is the status of what I set?" — a different question. A tracker alone leaves TU3 uncovered. |
| **Added TC1** Content Coverage & Production Queue | Add | Prevents an empty Test Creator row. Contains no student data (§3.5). |
| **Merged** brief's "Pricing experiment outcomes" + "A/B test results" → **A12** | Merge | Conflict **X-9**. One question, one statistic, one owner. |
| **Merged** brief's 6 AI-marking-quality items → **A5, A6, A7** | Merge | Six items answered three questions: *is it accurate?* (anchor agreement + re-mark consistency), *is it fair?* (distribution drift + length bias), *is it healthy?* (queue/failures/retries + flag rate). Six reports for three questions is not mutually exclusive. |
| **Merged** brief's "Support themes" → **A13** | Merge | Support themes are a text-mining view of enquiry data. A13 already owns enquiry volume, type and SLA. A separate report would duplicate the grain. |
| **Split** brief's "Goal and readiness" from "Percentile rank" → **P1 / P2** | Keep split | The brief already lists them separately and they have different grains (student-exam vs student-cohort). But **P2 may never render without P1** — enforced in the API (§12), not the UI, per B1. |

**Net**: **36 reports** (3 student, 10 parent, 7 tutor, 1 test creator, 15 admin) covering
**38 decisions**. Counts are reconciled in §4.7.

### 4.3 Student reports — motivation tools only, no reports

| ID | Question it answers | Decision it drives | Primary user | Key metrics (owner in §5) | Grain | Refresh | Next action for user |
|---|---|---|---|---|---|---|---|
| **S1** Exam Countdown | "How long until my exam?" | Decide whether today is a practice day | Student | `days_to_exam` (S1) | student × assigned exam | Daily 04:00 AEST/AEDT | "Open today's practice" |
| **S2** Daily Practice Target | "How much should I practise today?" | How much to do now | Student | `daily_target_units` (S2) | student × day | Daily 04:00 + on plan change | "Start" |
| **S3** Session Complete | "Did I finish?" | Stop, and feel good about stopping | Student | **none — zero-metric contract** | student × attempt | Real-time (constant payload) | "Back to dashboard" |

**S3 zero-metric contract**: the response type is
`{ status: 'completed', message: string }`. No numeric field exists. Adding one requires a
code review against B2. This is the single most important line of defence for the student
role, because the post-test moment is exactly when a curious child (or a well-meaning
developer) tries to see a result.

**S2 formula** (as mandated, made precise):

```
remaining_units   = plan.total_planned_units − units_completed_to_date
remaining_days    = (exam_date − today) − count(rest_days in that window) − count(days already elapsed)
required_daily    = ceil(remaining_units / remaining_days)          -- remaining_days ≤ 0 ⇒ required_daily = 0
daily_target      = min(required_daily, year_level_cap)             -- CAP ALWAYS WINS
overloaded        = required_daily > year_level_cap                 -- parent alert flag, never shown to student
```

`year_level_cap` is configuration, not a statistic I will invent. It is seeded as `NULL` and
**must be set by you** per year level (question **Q-4**). Until set, S2 falls back to
`weekly_sessions_goal / 7` rounded up, and the UI shows the low-data state. Logged as **A-11**.

Behavioural rules for S1/S2/S3 (B4, B5, B7, B10): positive framing; small achievable goals; no
punishment for a broken streak; no red warning states; no comparison with other children. When
`overloaded` is true the student sees the capped number and **nothing else** — no hint that
they are behind.

### 4.4 Parent reports

All parent reports share: plain English, **≤5 key visuals per screen**, **one clear next action
per screen**, and every prediction showing uncertainty (B3, B13). Refresh is nightly unless
stated — a parent does not need intraday readiness, and intraday refresh would load the
instance during evening peak test windows.

| ID | Question | Decision | Key metrics (owning report) | Grain | Refresh | Next action |
|---|---|---|---|---|---|---|
| **P1** Goal & Readiness | "Is my child on track for their exam?" | Keep the plan, or change it | `readiness_score`(P1), `readiness_band`(P1), `projected_outcome_range`(P1), `projection_confidence`(P1), `days_to_exam`(S1) | student × target exam | Nightly 02:30 | "See what to practise next" → P8 |
| **P2** Percentile & Cohort Context | "How does this compare to similar students?" | Calibrate expectations | `percentile_rank`(P2), `cohort_size`(P2), `cohort_window_months`(P2) + `personal_progress_delta`(P4) | student × test family × year level × form | Nightly 02:30 | "See personal progress" → P4 |
| **P3** Curriculum Mastery Map | "Which curriculum areas are weak?" | Where to focus | `mastery_level`(P3), `items_answered`(P3), `content_description_plain_english`(P3) | student × VC2 strand × content description | Nightly 02:30 | "Practise this area" → P8 |
| **P4** Test History & Trends | "Is my child improving?" | Continue paying / continue the plan | `attempt_score`(P4), `personal_progress_delta`(P4), `section_trend`(P4) | student × attempt (and × section) | Nightly 02:30 | "Look at what went wrong" → P5 |
| **P5** Question Review & Misconceptions | "What exactly did they get wrong, and why?" | Targeted correction at home | `incorrect_by_skill`(P5), `likely_misconception`(P5) | student × item × skill | Nightly 02:30 | "Set a practice set" → P8 |
| **P6** Writing Feedback | "How is the writing, and is this mark fair?" | Work on specific criteria | `rubric_criterion_score`(P6), `criterion_trend`(P6), `writing_next_step`(P6), `marking_source`(P6) | student × attempt × rubric criterion | Nightly + on mark completion | "Work on this criterion" |
| **P7** Study Behaviour | "Is my child working effectively?" | Change *how* they practise | `time_on_task`(P7), `pace_vs_expected`(P7), `skip_rate`(P7), `guess_rate`(P7), `sessions_per_week`(P7), `daily_target_adherence`(P7) | student × week (and × attempt) | Nightly 02:30 | "Adjust the plan" → P9 |
| **P8** Recommended Next Actions | "What should we do next?" | Allocate this week's practice | `expected_impact_score`(P8), `recommendation_rank`(P8) — **max 3** (B12) | student × recommended practice set | Nightly 02:30 | "Start practice set" |
| **P9** Practice Plan Controls | "How do I set this up?" | Configure the plan | `plan_total_units`(P9), `rest_days_set`(P9), `plan_overload_flag`(P9) | student × plan | Real-time (write-through) | "Save plan" |
| **P10** Consent & Access Control | "Who can see my child's data?" | Grant or revoke tutor access | `active_tutor_consents`(P10), `consent_granted_at`(P10), `data_request_status`(P10) | student × tutor × consent record | Real-time | "Revoke" / "Grant" |

**P1 readiness logic** reuses `src/lib/report/readiness.ts` unchanged. That module already
implements weighted attempt scoring, per-exam eligibility gates (`SELECTIVE_MIN_YEAR = 7`,
`SCHOLARSHIP_MIN_YEAR = 5`, NAPLAN Years 3–9) and `confidenceForSample()` keyed on weighted
question volume. **I am not redefining readiness** — that would create a second definition and
breach MECE. P1 adds exactly one thing the module lacks: a **projection with an explicit range**.

**How the projection range is computed, and why it is honest.** There is no validated predictive
model for these exams and I will not invent one. The projection is a transparent linear
extrapolation of observed platform scores, with a range derived from the *observed variability
of that child's own attempts*:

```
point = latest_weighted_readiness + (mean_delta_per_week × weeks_to_exam)
range = point ± t × sd(delta_between_attempts)     -- t scaled by the child's own attempt count
```

Three guardrails follow from B3/B13, all enforced **in the API, not the UI**:
1. **Fewer than 3 completed attempts ⇒ no projection at all.** Response returns
   `projection: null`; UI shows "Not enough practice yet to project" — true, and itself the
   next action.
2. **The range is never narrower than the observed standard deviation.** A model cannot be more
   certain than the child's own score variability.
3. **Displayed as a band plus a named readiness band, never a decimal.** "Between Developing and
   Consolidating", not "73.4%".

Confidence wording uses the existing `CONFIDENCE_LABEL` vocabulary so P1 cannot disagree with
the emailed readiness report.

**P2 render rule (B1, server-side).** `/api/reporting/parent/percentile` returns `403` unless
P1 also resolves for the same student, and always embeds `personal_progress_delta`. Cohort
suppression below n=20 returns `percentile: null, suppressed: true, cohort_size: n`. The
response always carries `cohort_definition: "platform cohort"`, `cohort_size`, `cohort_window`.
Between n=20 and n=49 it returns a **band**, not a point (conflict X-4).

**P3 no-codes rule.** `content_description_code` is **absent from the P3 response type**. It
exists in `dim_curriculum_vc2` for tutors and admins; the parent endpoint cannot return it
because the field is not in its DTO. Plain English comes from
`dim_curriculum_vc2.parent_facing_label`, an editorial field populated during VC2 mapping
(assumption **A-02**).

**P6 AI disclosure.** `marking_source` is not a boolean the UI may choose to render. P6 returns
`marking_source: "AI-generated"` as a **required string field**, placed by the wireframe in the
panel header beside the score — not in a footer.

### 4.5 Tutor and Test Creator reports

| ID | Question | Decision | Key metrics (owning report) | Grain | Refresh | Next action |
|---|---|---|---|---|---|---|
| **T1** Student Overview | "How is each student doing and moving?" | Who to look at first | `completion_rate`(T1), `performance_level`(T1), `movement_since_last_period`(T1) | tutor × student × period | Nightly 03:00 | Open student → T2 |
| **T2** Skill Gap Heatmap | "On which skills does each student need help?" | Lesson content | `mastery_level`(P3) scoped to consented students | tutor × student × VC2 content description | Nightly 03:00 | "Set practice" → T7 |
| **T3** At-Risk List | "Which students need help now?" | Intervene this week | `at_risk_flag`(T3), `at_risk_rule`(T3), `at_risk_severity`(T3) | tutor × student | Nightly 03:00 | Open rule → T2 |
| **T4** Item Analysis (assigned tests) | "Is this item working for my students?" | Keep, replace or reteach | `p_value`(A1), `distractor_analysis`(A1), `median_time_per_item`(A1), `skip_rate`(A1) | tutor × test × item | Nightly 03:00 | "Flag item to admin" |
| **T5** Assignment Tracker | "What have I set and what is outstanding?" | Chase or reassign | `assignment_status`(T5), `overdue_count`(T5) | tutor × student × assignment | Hourly 06:00–22:00 | "Remind" |
| **T6** Writing Marks (read-only) | "Can I trust this AI mark?" | Accept or challenge | `rubric_criterion_score`(P6), `model_version`(A5), `rubric_version`(A5), `mark_flagged`(A7) | tutor × student × attempt × criterion | Nightly + on flag | "Flag for admin review" |
| **T7** Next-Best Recommendations | "What should I set next?" | Assign now | `expected_impact_score`(P8), `recommendation_rank`(P8) | tutor × student × practice set | Nightly 03:00 | "Assign" → T5 |
| **TC1** Content Coverage & Production Queue | "What content needs writing?" | Prioritise authoring | `coverage_status`(A3), `items_per_content_description`(A3), `draft_age_days`(TC1) | VC2 level × content description × test family | Nightly 03:30 | "Create items" |

**T3 flag rules must be visible.** Each at-risk row carries the rule that produced it, in words a
tutor can dispute: `DECLINING_TREND` (score down over ≥3 consecutive attempts),
`LOW_ENGAGEMENT` (no session in ≥14 days while an exam target is active),
`REPEATED_MISCONCEPTION` (same skill wrong in ≥2 attempts). These thresholds are **seeded as
tunable defaults** — I am not asserting them as validated cut-points (assumption **A-12**).
Every flag is dismissible with a reason, and the dismissal is recorded so rule quality can
itself be reviewed.

**T4 scope enforcement.** The RLS predicate requires an `assignments` row with
`assigned_by = auth.uid()` for that test, combined with current consent. A tutor cannot see item
statistics for a test they did not assign, even if their student sat it.

**T2/T3/T7 consent gate.** All three join `public.tutor_student_links` filtered by a
`consent_records` row with `purpose = 'TUTOR_REPORTING'`, `revoked_at IS NULL`,
`expires_at > now()`. Revocation takes effect immediately at query time because the RLS
predicate is evaluated live, not at refresh time.

### 4.6 Admin reports

Admin views are dense but scannable: every report is summary → drill-down → row level, with CSV
export at every level.

**(a) Content and test quality**

| ID | Question | Decision | Key metrics (owning report) | Grain | Refresh |
|---|---|---|---|---|---|
| **A1** Item Statistics | "Which items are defective?" | Retire, rewrite or recalibrate | `p_value`(A1), `point_biserial`(A1), `distractor_analysis`(A1), `median_time_per_item`(A1), `skip_rate`(A1), `item_flag_rate`(A1) | item × test form × period | Nightly 01:30 |
| **A2** Adaptive Engine Health | "Is the adaptive engine still calibrated?" | Recalibrate or adjust routing | `item_exposure_rate`(A2), `calibration_drift`(A2), `pathway_distribution`(A2) | item × period; pathway × period | Nightly 01:30 |
| **A3** Curriculum Coverage Gaps | "Where is VC2 coverage too thin?" | Commission content | `coverage_status`(A3), `items_per_content_description`(A3), `coverage_difficulty_balance`(A3) | VC2 level × content description × test family | Nightly 03:30 |
| **A4** Test-Level Metrics | "Is this test form fit to stay live?" | Publish, revise or withdraw | `test_completion_rate`(A4), `abandonment_point`(A4), `score_distribution`(A4), `reliability_coefficient`(A4) | test form × period | Nightly 01:30 |

**(b) AI writing marking quality** — *no human moderation exists, so this is the only quality gate*

| ID | Question | Decision | Key metrics (owning report) | Grain | Refresh |
|---|---|---|---|---|---|
| **A5** Marking Accuracy & Drift | "Is the AI marker still accurate?" | Keep or roll back a model/rubric version | `anchor_agreement`(A5), `anchor_drift`(A5), `remark_score_stability`(A5), `model_version`(A5), `rubric_version`(A5) | anchor script × model/rubric version × run | On each anchor run (scheduled) + nightly |
| **A6** Marking Fairness & Bias | "Is the AI marker fair across groups?" | Intervene on a prompt, level or version | `length_score_correlation`(A6), `distribution_drift`(A6) | prompt × year level × model version | Nightly 02:00 |
| **A7** Marking Pipeline Health | "Is the pipeline reliable, and are users disputing marks?" | Fix ops or re-tune | `mark_queue_time_p95`(A7), `mark_failure_rate`(A7), `mark_retry_rate`(A7), `mark_flag_rate`(A7) | hour; model version | Hourly |

**(c) Offerings and revenue (Stripe)**

| ID | Question | Decision | Key metrics (owning report) | Grain | Refresh |
|---|---|---|---|---|---|
| **A8** Revenue & Orders | "Is revenue healthy?" | Financial control | `gross_revenue_inc_gst`(A8), `net_revenue_ex_gst`(A8), `refunds`(A8), `disputes`(A8), `stripe_fees`(A8), `arppu`(A8), `bundle_attach_rate`(A8), `mrr`(A8), `churn_rate`(A8), `renewal_rate`(A8) | day / month × product | Nightly 02:00 |
| **A9** Revenue by Offering | "Which offering should we push or retire?" | Portfolio and pricing | `net_revenue_ex_gst`(A8) by test family / bundle; `units_sold`(A9), `attach_rate`(A8) | month × test family × product / bundle | Nightly 02:00 |
| **A10** Cohort Retention & LTV by Channel | "Which channels are worth spending on?" | Shift budget | `retention_rate`(A10), `ltv_cents`(A10), `cac_cents`(A10), `roas`(A10) | signup month × channel × campaign | Nightly 02:00 |

Subscription metrics (`mrr`, `churn_rate`, `renewal_rate`) are **conditional**: the brief says to
add them *if subscriptions exist*. They do — `010_subscriptions.sql` defines
`public.subscriptions`, and `funnel_events` already carries `SUBSCRIPTION_PAUSED`,
`SUBSCRIPTION_RESUMED`, `SUBSCRIPTION_CANCELLED`, `RENEWAL_COMPLETED` and `CHURNED`. So A8
includes them. **But migration 010 is not applied and will fail as written (§0.2)**, so until it
is fixed these render the empty state.

**(d) Acquisition, conversion and enquiries**

| ID | Question | Decision | Key metrics (owning report) | Grain | Refresh |
|---|---|---|---|---|---|
| **A11** Conversion Funnel | "Where are we losing people?" | Fix the weakest stage | `stage_conversion_rate`(A11), `stage_dropoff_count`(A11), `free_to_paid_rate`(A11), `checkout_abandonment_rate`(A11), `time_to_first_value_hours`(A11) | day × stage × segment (channel, campaign, device, test family, year level) | Hourly 06:00–22:00 |
| **A12** Experiment Results | "Did this change work?" | Ship, revert or extend | `variant_conversion_rate`(A12), `sample_size`(A12), `p_value_experiment`(A12), `confidence_interval`(A12), `recommended_decision`(A12) | experiment × variant | Nightly 02:00 |
| **A13** Enquiry & Support Tracker | "Are enquiries answered in time, and do they convert?" | Staffing and SLA | `enquiry_volume`(A13), `first_response_minutes`(A13), `sla_breach_rate`(A13), `resolution_hours`(A13), `enquiry_to_customer_rate`(A13), `support_theme`(A13) | day × channel × enquiry type × status | Hourly |

**(e) Operations and platform health**

| ID | Question | Decision | Key metrics (owning report) | Grain | Refresh |
|---|---|---|---|---|---|
| **A14** Platform Health & Usage | "Is the platform coping, and are tests failing?" | Scale or fix | `active_users`(A14), `peak_concurrency`(A14), `concurrency_vs_cap`(A14), `test_error_rate`(A14), `failed_submission_rate`(A14) | hour; test × hour | Every 15 min |
| **A15** Data Quality & Reconciliation | "Can we trust the data?" | Repair before reporting on it | `untagged_item_count`(A15), `orphan_record_count`(A15), `failed_event_count`(A15), `stripe_reconciliation_gap_count`(A15), `mv_refresh_lag_minutes`(A15) | day × check | Nightly 04:00 + after each refresh |

`concurrency_vs_cap` uses the **200 peak** figure stated in the brief. I have treated 200 as a
confirmed capacity target rather than a measured value; nothing in the repo or database
corroborates it, and I will not invent a measured peak (assumption **A-13**).

### 4.7 Decision coverage matrix

**Format**: one row per decision the role must make. `●` = owning report; `○` = supporting
report (contributes but does not own). **A row with no `●` is a MECE failure.** There are none.

**Student**

| # | Decision | Reports |
|---|---|---|
| D-S1 | When is my exam, and is today a practice day? | ● S1 |
| D-S2 | How much practice do I do today? | ● S2 ○ S1 |
| D-S3 | Did I finish, and what do I do now? | ● S3 ○ S2 |

**Parent**

| # | Decision | Reports |
|---|---|---|
| D-P1 | Is my child on track for the target exam? | ● P1 ○ P4 P2 |
| D-P2 | How does my child compare to similar students? | ● P2 ○ P1 P4 |
| D-P3 | Which curriculum areas are weak? | ● P3 ○ P5 |
| D-P4 | Is my child improving over time? | ● P4 ○ P1 P7 |
| D-P5 | What specific mistakes should we correct? | ● P5 ○ P3 |
| D-P6 | How is the writing, and what next? | ● P6 |
| D-P7 | Is my child practising effectively? | ● P7 ○ P4 |
| D-P8 | What should we do next? | ● P8 ○ P3 P5 P7 |
| D-P9 | Is this worth paying for? | ● P4 ○ P1 P7 |
| D-P10 | How do I configure the plan? | ● P9 ○ S1 S2 |
| D-P11 | Who can see my child's data, and how do I change that? | ● P10 |

**Tutor**

| # | Decision | Reports |
|---|---|---|
| D-T1 | Which students need help now? | ● T3 ○ T1 |
| D-T2 | How is each student performing and moving? | ● T1 ○ T3 |
| D-T3 | On which skills does each student need help? | ● T2 ○ T3 |
| D-T4 | What should I set next? | ● T7 ○ T2 T3 |
| D-T5 | What have I set, and what is outstanding? | ● T5 ○ T7 |
| D-T6 | Is this item working for my students? | ● T4 |
| D-T7 | Can I trust this AI writing mark? | ● T6 ○ A5 |
| D-T8 | Am I seeing this student lawfully? | ● T1 ○ P10 |

**Test Creator**

| # | Decision | Reports |
|---|---|---|
| D-TC1 | Which content descriptions need items written? | ● TC1 ○ A3 |
| D-TC2 | What is the status of my drafts through approval? | ● TC1 |

**Admin**

| # | Decision | Reports |
|---|---|---|
| D-A1 | Which items are defective and should be retired or rewritten? | ● A1 ○ A2 |
| D-A2 | Is the adaptive engine still calibrated? | ● A2 ○ A1 |
| D-A3 | Where are the curriculum coverage gaps to commission? | ● A3 ○ TC1 |
| D-A4 | Is this test form fit to publish or keep live? | ● A4 ○ A1 |
| D-A5 | Can we keep shipping AI writing marks, or roll back? | ● A5 ○ A6 A7 |
| D-A6 | Is the AI marker fair across groups? | ● A6 ○ A5 |
| D-A7 | Is the marking pipeline reliable, and are users disputing marks? | ● A7 ○ A5 |
| D-A8 | Is revenue healthy — earned, refunded, fees? | ● A8 ○ A15 |
| D-A9 | Which offerings and bundles should we push or retire? | ● A9 ○ A8 A12 |
| D-A10 | Which acquisition channels are worth spending on? | ● A10 ○ A11 |
| D-A11 | Where in the funnel are we losing people? | ● A11 ○ A10 A12 |
| D-A12 | Should we ship this change or this price? | ● A12 ○ A11 A9 |
| D-A13 | Are enquiries answered within SLA, and do they convert? | ● A13 ○ A11 |
| D-A14 | Is the platform coping at peak, and are tests failing? | ● A14 ○ A15 |
| D-A15 | Can we trust the data, and where are the gaps? | ● A15 ○ A8 A14 |

**Totals: 38 decisions (3 student, 11 parent, 8 tutor, 2 test creator, 15 admin) — one row per
decision, every row has an owner. No empty rows.**

### 4.8 MECE proof

**Mutual exclusivity — two tests applied.**

*Test 1: one primary question per report.* Each of the 36 reports has exactly one question
string in §4.3–§4.6 and no two reports share a question. The two near-collisions the brief
contained (pricing experiments vs A/B tests; six marking-quality items) were merged per X-9 and
§4.2.

*Test 2: one owning report per metric.* Every metric in §5 names exactly one owner. Where a
metric appears in more than one report the non-owners are recorded as consumers:

| Metric | Owner | Consumers |
|---|---|---|
| `days_to_exam` | S1 | P1, P9 |
| `mastery_level` | P3 | T2 |
| `expected_impact_score`, `recommendation_rank` | P8 | T7 |
| `p_value`, `distractor_analysis`, `median_time_per_item`, `skip_rate` | A1 | T4 |
| `rubric_criterion_score` | P6 | T6 |
| `model_version`, `rubric_version` | A5 | T6, A6, A7 |
| `net_revenue_ex_gst` | A8 | A9, A10 |
| `coverage_status`, `items_per_content_description` | A3 | TC1 |
| `personal_progress_delta` | P4 | P2 |
| `attempt_score` | P4 | P1, T1 |

Note the deliberate asymmetry: **S1 owns `days_to_exam` even though P1 displays it**, because
the countdown is the student's primary question and the parent view is derivative. Ownership
follows the primary question, not the most prominent screen.

**Collective exhaustiveness.** §4.7 enumerates every decision and maps each to an owner. The
reverse check also passes — **no report exists without a decision**:

| Report | Serves | Report | Serves | Report | Serves |
|---|---|---|---|---|---|
| S1 | D-S1 | P6 | D-P6 | A6 | D-A6 |
| S2 | D-S2 | P7 | D-P7 | A7 | D-A7 |
| S3 | D-S3 | P8 | D-P8 | A8 | D-A8 |
| P1 | D-P1 | P9 | D-P10 | A9 | D-A9 |
| P2 | D-P2 | P10 | D-P11 | A10 | D-A10 |
| P3 | D-P3 | T1 | D-T2, D-T8 | A11 | D-A11 |
| P4 | D-P4, D-P9 | T2 | D-T3 | A12 | D-A12 |
| P5 | D-P5 | T3 | D-T1 | A13 | D-A13 |
| TC1 | D-TC1, D-TC2 | T4 | D-T6 | A14 | D-A14 |
| A1 | D-A1 | T5 | D-T5 | A15 | D-A15 |
| A2 | D-A2 | T6 | D-T7 | A4 | D-A4 |
| A3 | D-A3 | T7 | D-T4 | A5 | D-A5 |

**Remaining MECE risks — declared, not hidden:**

1. **P4 owns two decisions** (D-P4 improving, D-P9 worth paying for). Acceptable — both are
   answered by the same longitudinal evidence — but it makes P4 the report most exposed to
   commercial pressure. It is the first thing the Behavioural Economist should re-review each
   quarter.
2. **`mastery_level` (P3) feeds T2**, so changing the mastery definition silently changes the
   tutor heatmap. Mitigation: the definition lives in exactly one materialised view, and
   `14-…md` §15.2 includes a cross-report consistency test.
3. **A3 and TC1 share `coverage_status`.** TC1 is a filtered, student-free projection of A3. If
   TC1 ever needs item statistics it stops being student-free and must be withdrawn (§3.5).
4. **A11 is the widest report** (five segments × seven stages). It risks becoming a grab-bag.
   Guard: any new segment must name a decision it changes; otherwise it is rejected.

---

## 5. Deliverable 5 — Metric dictionary

**One definition per metric across the platform.** Every metric has exactly one owning report.
Where a metric is displayed elsewhere it is read from the owner's materialised view — never
recomputed.

**Conventions**
- All money is `integer` **cents**, AUD. GST treatment is stated per metric, because Australian
  GST is 10% and "revenue" is ambiguous without it.
- All dates are **Australia/Melbourne** local. `dim_date.date_key` is `integer YYYYMMDD` in that
  zone. Storing UTC dates would misattribute every evening attempt to the wrong day.
- Percentages are `numeric(5,2)`, 0–100.
- `[config]` marks a threshold that is **tunable configuration**, not a validated benchmark. I
  have not invented target values; defaults are seeded and flagged for your review.
- Formulae use reporting-schema object names from `12-…md` §8.

### 5.1 Student metrics

| Metric | Business definition | SQL formula | Grain | Source | Owner | Refresh | Threshold | Caveats |
|---|---|---|---|---|---|---|---|---|
| `days_to_exam` | Whole calendar days from today to the assigned exam date, Australia/Melbourne | `(t.exam_date - (now() AT TIME ZONE 'Australia/Melbourne')::date)` | student × exam | `student_exam_targets`, `dim_date` | S1 | Daily 04:00 | n/a | Negative after the exam date; UI shows an "exam done" state, never a negative number. Recalculated daily, never cached across midnight. |
| `daily_target_units` | Practice units to complete today: remaining planned units ÷ remaining practice days, capped by year level | `LEAST(CEIL(remaining_units::numeric / NULLIF(remaining_days,0)), year_level_cap)` | student × day | `dim_practice_plan`, `fact_event`, `dim_year_level_cap` | S2 | Daily 04:00 + on plan change | Cap is `[config]` per year level, **currently unset** | Never expose the uncapped value to a student. If `remaining_days <= 0` returns 0 and raises `plan_overload_flag` for the parent. |
| `plan_overload_flag` | True when required daily load exceeds the year-level cap | `CEIL(remaining_units::numeric / NULLIF(remaining_days,0)) > year_level_cap` | student × day | as above | S2 (surfaced in P9) | Daily 04:00 | n/a | **Parent-facing only.** Never in any student payload. Carries no purchase CTA (conflict X-5). |

### 5.2 Parent metrics

| Metric | Business definition | SQL formula | Grain | Source | Owner | Refresh | Threshold | Caveats |
|---|---|---|---|---|---|---|---|---|
| `readiness_score` | Weighted 0–100 standing against a target exam, using the existing readiness engine's weights | `SUM(attempt_score * attempt_weight) / NULLIF(SUM(attempt_weight),0)` | student × target exam | `fact_test_attempt`, `dim_test_family` | P1 | Nightly 02:30 | Bands from `readiness.ts` | Measures performance **on this platform's tests**, not the real exam. Labelled as such wherever shown. |
| `readiness_band` | Named band for `readiness_score` | `band_for_score(readiness_score)` (existing vocabulary) | student × target exam | as above | P1 | Nightly 02:30 | Existing bands | Never invent a band name. Bands describe performance, not the child. |
| `projected_outcome_range` | Extrapolated readiness at exam date, as a lower–upper pair | `point ± t * STDDEV(delta)`, `point = latest + mean_delta_per_week * weeks_to_exam` | student × target exam | `fact_test_attempt` | P1 | Nightly 02:30 | **Suppressed below 3 completed attempts** | Not a validated predictive model — a transparent extrapolation. Range never narrower than observed SD. Shown as a band, never a decimal (B13). |
| `projection_confidence` | Plain-English confidence label from evidence volume | `confidence_for_sample(weighted_question_count)` (existing) | student × target exam | as above | P1 | Nightly 02:30 | Existing `CONFIDENCE_LABEL` | Must use the same vocabulary as the emailed report or the two will disagree. |
| `percentile_rank` | Student's position within the platform cohort, 0–100 | `100.0 * (COUNT(*) FILTER (WHERE peer_score < s.score) + 0.5 * COUNT(*) FILTER (WHERE peer_score = s.score)) / NULLIF(COUNT(*),0)` | student × test family × year level × form | `fact_test_attempt` | P2 | Nightly 02:30 | **Suppressed if `cohort_size < 20`**; band not point if `< 50` | Mid-rank convention (0.5 for ties) — state it or two implementations will differ. **Platform cohort, not state or national.** Never renders without `personal_progress_delta` (B1). |
| `cohort_size` | Distinct students in the percentile cohort | `COUNT(DISTINCT student_key)` | as above | as above | P2 | Nightly 02:30 | Always displayed | Distinct **students**, not attempts. A student with 5 attempts counts once. |
| `cohort_window_months` | Rolling window defining the cohort | constant `12` | — | config | P2 | — | Always displayed | Brief-specified as 12. Shown with explicit start and end dates. |
| `mastery_level` | Ordinal mastery of a VC2 content description from weighted item correctness | `CASE WHEN weighted_accuracy >= 0.85 THEN 'CONSOLIDATED' WHEN >= 0.65 THEN 'DEVELOPING' WHEN >= 0.40 THEN 'EMERGING' ELSE 'NEEDS_SUPPORT' END` | student × content description | `fact_item_response`, `dim_curriculum_vc2` | P3 | Nightly 02:30 | Cut-points `[config]` | **Requires `items_answered >= 3`**; below that returns `INSUFFICIENT_EVIDENCE`, not a level. Cut-points are seeded defaults, not validated (A-12). |
| `items_answered` | Distinct items answered for a content description | `COUNT(DISTINCT item_key)` | student × content description | `fact_item_response` | P3 | Nightly 02:30 | Min 3 for mastery | Drives the insufficient-evidence gate. |
| `content_description_plain_english` | Parent-facing wording for a content description | `dim_curriculum_vc2.parent_facing_label` | content description | `dim_curriculum_vc2` | P3 | On dim change | n/a | **Editorial field, currently empty** (A-02). No VC2 mapping exists in the database. Codes must never appear in a parent payload. |
| `attempt_score` | Normalised 0–100 score for one attempt | `attempts.score_out_of100` → `fact_test_attempt.score` | attempt | `fact_test_attempt` | P4 | Nightly 02:30 | n/a | Source column is `score_out_of100` (sic — that is the live name). Renamed to `score` in the fact table; the mapping is documented so nobody "fixes" one and not the other. |
| `personal_progress_delta` | Score change between two comparable attempts | `score - LAG(score) OVER (PARTITION BY student_key, test_family ORDER BY attempt_date)` | student × attempt | `fact_test_attempt` | P4 | Nightly 02:30 | n/a | **Only comparable within the same test family and year level.** Comparing a Year 3 NAPLAN-style attempt to a Year 4 Olympiad attempt is meaningless — the window partitions on both. |
| `section_trend` | Direction of section scores across attempts | `REGR_SLOPE(section_score, attempt_ordinal)` | student × test family × section | `fact_test_attempt.section_scores` | P4 | Nightly 02:30 | n/a | `section_scores` is jsonb in the source; the ETL must normalise it or the trend silently breaks when a section is renamed. |
| `incorrect_by_skill` | Incorrect responses grouped by skill | `COUNT(*) FILTER (WHERE NOT is_correct)` by skill | student × skill | `fact_item_response` | P5 | Nightly 02:30 | n/a | Skill attribution is **weighted** — the `questions.skill_*` columns let one item contribute to several skills (per `QuestionBankFieldGLossary.csv`). Raw counts double-count. |
| `likely_misconception` | Plain-English misconception inferred from the chosen distractor | `dim_item.misconception_by_distractor[response.answer]` | student × item × distractor | `dim_item`, `fact_item_response` | P5 | On dim change | n/a | **Editorial content that does not exist yet.** `most_common_wrong_answer` holds a letter, not an explanation. Requires authoring per distractor (A-02). Until authored, P5 shows the item and correct answer only. |
| `rubric_criterion_score` | AI-assigned score for one writing rubric criterion | `fact_writing_mark.criterion_score` | student × attempt × criterion | `fact_writing_mark` | P6 | Nightly + on mark | n/a | **Must carry `model_version` and `rubric_version`** — a criterion score without them is unauditable and cannot be compared across a model change. |
| `criterion_trend` | Direction of a criterion score across attempts | `REGR_SLOPE(criterion_score, attempt_ordinal)` | student × criterion | `fact_writing_mark` | P6 | Nightly | Min 3 marks | A slope over fewer than 3 marks is noise; return `null`. |
| `writing_next_step` | Specific next step for a criterion | `fact_writing_mark.next_step` | student × attempt × criterion | `fact_writing_mark` | P6 | On mark | n/a | AI-generated text, shown under the `marking_source` disclosure. |
| `marking_source` | Whether a mark is AI-generated | constant `'AI-generated'` | mark | — | P6 | — | **Required field, not optional** | Not a boolean the UI may skip. Placed in the panel header beside the score (B11). |
| `time_on_task` | Seconds actively spent, from attempt timing | `SUM(fact_item_response.time_spent_seconds)` | student × week | `fact_item_response` | P7 | Nightly 02:30 | n/a | Includes idle time if the tab is left open. Cap per item at `[config]` seconds before summing, or one abandoned session dominates the week. |
| `pace_vs_expected` | Actual vs expected seconds per item | `AVG(time_spent_seconds) / NULLIF(dim_item.expected_seconds,0)` | student × attempt | `fact_item_response`, `dim_item` | P7 | Nightly 02:30 | Ratio band `[config]` | `expected_seconds` does not exist in the source today — must be authored or derived from the median. If derived, say so; never present a derived median as an expert expectation. |
| `skip_rate` | Proportion of items left unanswered | `COUNT(*) FILTER (WHERE answer IS NULL)::numeric / NULLIF(COUNT(*),0) * 100` | student × attempt (and item) | `fact_item_response` | **P7** at student grain; **A1** at item grain | Nightly | n/a | **Same name, two grains.** Both read `fact_item_response`. Recorded here so nobody conflates a struggling child with a badly-worded item. |
| `guess_rate` | Items answered faster than a floor time and incorrectly | `COUNT(*) FILTER (WHERE time_spent_seconds < :floor AND NOT is_correct)::numeric / NULLIF(COUNT(*),0) * 100` | student × attempt | `fact_item_response` | P7 | Nightly 02:30 | Floor `[config]` | A **proxy**, not a measurement. Cannot distinguish a fast confident wrong answer from a guess. Label as an indicator, never as proof. |
| `sessions_per_week` | Distinct practice days per week | `COUNT(DISTINCT date_key)` | student × week | `fact_test_attempt` | P7 | Nightly 02:30 | Goal from `weekly_sessions_goal` | Counts days with ≥1 attempt, not attempts. Two attempts in one day is one session. |
| `daily_target_adherence` | Proportion of practice days the target was met | `COUNT(*) FILTER (WHERE units_completed >= daily_target_units)::numeric / NULLIF(COUNT(*),0) * 100` | student × week | `fact_event`, `dim_practice_plan` | P7 | Nightly 02:30 | n/a | **Parent-facing only.** Never shown to the student (B4, B5). Framed as "days completed", not "days missed". |
| `expected_impact_score` | Rank score for a recommended practice set | `gap_severity * item_count_weight * recency_weight` | student × practice set | `fact_item_response`, `dim_curriculum_vc2` | P8 | Nightly 02:30 | Top 3 only (B12) | A **heuristic ranking**, not a causal estimate of score gain. Must not be labelled "expected improvement of X points" — that is B13 false precision. |
| `plan_total_units` | Total practice units in the current plan | `dim_practice_plan.total_planned_units` | student × plan | `dim_practice_plan` | P9 | Real-time | n/a | Set by the parent. Feeds S2; never shown to the student as a total. |
| `active_tutor_consents` | Unrevoked, unexpired tutor consents | `COUNT(*) FILTER (WHERE revoked_at IS NULL AND expires_at > now())` | student | `consent_records`, `tutor_student_links` | P10 | Real-time | n/a | Revocation must take effect immediately at query time, not at the next refresh. |

### 5.3 Tutor metrics

| Metric | Business definition | SQL formula | Grain | Source | Owner | Refresh | Threshold | Caveats |
|---|---|---|---|---|---|---|---|---|
| `completion_rate` | Assigned tests completed, for consented students | `COUNT(*) FILTER (WHERE status IN ('SUBMITTED','COMPLETE'))::numeric / NULLIF(COUNT(*),0) * 100` | tutor × student × period | `fact_test_attempt`, `tutor_student_links` | T1 | Nightly 03:00 | `[config]` | Denominator is **assignments**, not attempts. An expired assignment counts as incomplete. |
| `performance_level` | Current score band for a student | roll-up of `attempt_score` bands | tutor × student | `fact_test_attempt` | T1 | Nightly 03:00 | n/a | Reuses P4's `attempt_score`. T1 must not define its own banding. |
| `movement_since_last_period` | Period-over-period change | `current_period_score - prior_period_score` | tutor × student × period | `fact_test_attempt` | T1 | Nightly 03:00 | n/a | **Undefined with fewer than 2 attempts in either period** — return `null`, not `0`. A `0` reads as "no progress", which is a different claim. |
| `at_risk_flag` | Student meets at least one at-risk rule | `bool_or(rule_triggered)` | tutor × student | `fact_test_attempt`, `fact_event`, `fact_item_response` | T3 | Nightly 03:00 | Rules `[config]` | Every true flag must name its rule. An unexplained flag cannot be acted on or disputed. |
| `at_risk_rule` | Which rule fired | `DECLINING_TREND` / `LOW_ENGAGEMENT` / `REPEATED_MISCONCEPTION` | tutor × student × rule | as above | T3 | Nightly 03:00 | ≥3 attempts / ≥14 days / ≥2 attempts | Seeded defaults, **not validated cut-points** (A-12). Dismissible with a recorded reason. |
| `assignment_status` | Lifecycle state of an assignment | `CASE … assigned / started / completed / overdue` | tutor × student × assignment | `assignments`, `fact_test_attempt` | T5 | Hourly 06:00–22:00 | Overdue when `due_at < now()` | `assignments.due_at` is **nullable** in the live schema. A null due date can never be overdue — show "no due date", not "on time". |
| `overdue_count` | Assignments past due and not complete | `COUNT(*) FILTER (WHERE due_at < now() AND status NOT IN ('SUBMITTED','COMPLETE'))` | tutor × student | as above | T5 | Hourly | n/a | Excludes assignments with null `due_at`. |
| `mark_flagged` | A tutor or parent has disputed a writing mark | `fact_writing_mark.flagged_at IS NOT NULL` | mark | `fact_writing_mark_flags` | T6 (action) / **A7** (rate) | Real-time | n/a | T6 owns the *action*; A7 owns the *aggregate rate*. Splitting them keeps one definition of the rate. |

### 5.4 Admin — content and test quality

| Metric | Business definition | SQL formula | Grain | Source | Owner | Refresh | Threshold | Caveats |
|---|---|---|---|---|---|---|---|---|
| `p_value` | Item difficulty as proportion correct | `COUNT(*) FILTER (WHERE is_correct)::numeric / NULLIF(COUNT(*),0)` | item × form × period | `fact_item_response` | A1 | Nightly 01:30 | Flag outside `0.20–0.90` `[config]` | **Not** a statistical-hypothesis p-value. Standard psychometric usage, but the name invites confusion — the UI labels it "difficulty (% correct)". Minimum `[config]` responses before it is reported at all. |
| `point_biserial` | Correlation of item correctness with total score | `CORR(is_correct::numeric, total_score_excluding_item)` | item × form × period | `fact_item_response`, `fact_test_attempt` | A1 | Nightly 01:30 | Flag below `0.20` `[config]` | Total score must be computed **excluding the item itself**, or the correlation is inflated by construction. The most commonly botched item statistic. |
| `distractor_analysis` | Selection frequency per option | `COUNT(*)` grouped by chosen option | item × option × period | `fact_item_response` | A1 | Nightly 01:30 | Flag any distractor never chosen | An option nobody chooses is dead weight; an option chosen more than the key means a defective item or a defective key. |
| `median_time_per_item` | Median seconds spent per item | `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY time_spent_seconds)` | item × period | `fact_item_response` | A1 | Nightly 01:30 | Flag above `[config]` | Median, not mean — one abandoned session would otherwise dominate. |
| `item_flag_rate` | Flags per exposure | `SUM(flags_in_period)::numeric / NULLIF(SUM(exposures),0) * 100` | item × period | `item_flags`, `fact_item_response` | A1 | Nightly 01:30 | Flag above `[config]` | `questions.flag_count` is a **running total with no timestamp**, so a period rate cannot be derived from it. Needs the new `ITEM_FLAGGED` event (deliverable 6). Until then A1 shows a lifetime rate and says so. |
| `item_exposure_rate` | Share of adaptive sessions in which an item appeared | `COUNT(DISTINCT attempt_key) FILTER (WHERE shown)::numeric / NULLIF(total_adaptive_attempts,0) * 100` | item × period | `fact_item_response`, `fact_test_attempt` | A2 | Nightly 01:30 | Flag above `[config]` | Over-exposed items lose calibration, because high-ability students meet them first. |
| `calibration_drift` | Observed difficulty vs stored calibration | `ABS(p_value_current - difficulty_dynamic_stored)` | item × period | `fact_item_response`, `dim_item` | A2 | Nightly 01:30 | Flag above `[config]` | `questions.difficulty_dynamic` is overwritten in place, so **historical calibration is lost**. `dim_item` must be SCD Type 2 on this attribute or drift becomes unmeasurable. |
| `pathway_distribution` | Share of adaptive sessions per difficulty pathway | `COUNT(*)` grouped by pathway | pathway × period | `fact_test_attempt` | A2 | Nightly 01:30 | n/a | **No adaptive engine exists in the database** — `attempts` has no pathway column. A2 renders the empty state until it ships. Flagged, not invented. |
| `coverage_status` | Whether a VC2 content description has adequate, appropriately-difficult items | `NONE` / `TOO_FEW` / `ALL_TOO_EASY` / `ALL_TOO_HARD` / `ADEQUATE` | VC2 level × content description × test family | `dim_item`, `dim_curriculum_vc2` | A3 | Nightly 03:30 | Min items `[config]` | **Blocked entirely on the VC2 mapping** (A-02). Without `dim_curriculum_vc2` rows this returns zero rows, not an error. |
| `items_per_content_description` | Item count for a content description | `COUNT(DISTINCT item_key)` | as above | as above | A3 | Nightly 03:30 | `[config]` | Counts **published** items by default; draft counts are a separate column, or authoring progress will masquerade as live coverage. |
| `test_completion_rate` | Attempts submitted ÷ attempts started | `COUNT(*) FILTER (WHERE submitted_at IS NOT NULL)::numeric / NULLIF(COUNT(*),0) * 100` | test form × period | `fact_test_attempt` | A4 | Nightly 01:30 | `[config]` | Includes abandoned attempts. An attempt never started is not in the denominator. |
| `abandonment_point` | Median item position at which attempts were abandoned | `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY last_answered_position)` | test form × period | `fact_test_attempt`, `fact_item_response` | A4 | Nightly 01:30 | n/a | Clustering at one position suggests a specific item or a timing fault, not general fatigue. |
| `score_distribution` | Distribution of attempt scores | `width_bucket(score, 0, 100, 10)` histogram | test form × period | `fact_test_attempt` | A4 | Nightly 01:30 | n/a | Bimodal, ceiling- or floor-clumped distributions indicate a mis-targeted form. |
| `reliability_coefficient` | Internal consistency of a form | KR-20 (dichotomous): `(k/(k-1)) * (1 - SUM(p*q)/VAR_SAMP(total_score))`; Cronbach's α for polytomous criteria | test form × period | `fact_item_response`, `fact_test_attempt` | A4 | Nightly 01:30 | Flag below `0.70` `[config]` | **KR-20 for MCQ, α for writing criteria.** Requires a minimum `[config]` attempts; below that return `null` — never a coefficient computed from 5 attempts. |

### 5.5 Admin — AI writing marking quality

| Metric | Business definition | SQL formula | Grain | Source | Owner | Refresh | Threshold | Caveats |
|---|---|---|---|---|---|---|---|---|
| `anchor_agreement` | Agreement between AI marks and agreed anchor scores | `100 - AVG(ABS(ai_score - anchor_score)) / anchor_range * 100`, plus exact-adjacent-band rate | anchor script × model/rubric version × run | `marking_anchor_set`, `marking_anchor_runs` | A5 | On each anchor run | `[config]` min agreement | Anchor scores must be **agreed by a human before the run** and frozen. If anchors are re-scored after seeing AI output, agreement is meaningless. |
| `anchor_drift` | Change in agreement between consecutive runs | `anchor_agreement_now - anchor_agreement_previous` | model/rubric version × run | as above | A5 | On each run | Alert on `[config]` drop | Detects silent model-version changes upstream. `writing_evaluations.provider` currently stores `'DeepSeek'` with **no version** — version capture is mandatory (deliverable 11). |
| `remark_score_stability` | Score spread when the same script is re-marked | `MAX(score) - MIN(score)` and `STDDEV(score)` over *n* re-marks | script × model/rubric version | `marking_remarks` | A5 | Nightly | `[config]` max spread | Requires re-marking a **random sample**, not a chosen one, or stability is overstated. |
| `model_version` | Version of the marking model | `fact_writing_mark.model_version` | mark | `fact_writing_mark` | A5 | On write | **NOT NULL enforced** | **Not captured today.** `writing_evaluations` has `provider` only. Every existing mark would be unauditable. Migration adds the column; historical rows get `'UNKNOWN'` and are excluded from drift metrics. |
| `rubric_version` | Version of the rubric used | `fact_writing_mark.rubric_version` | mark | `fact_writing_mark` | A5 | On write | **NOT NULL enforced** | As above. Without it, a rubric change looks like model drift. |
| `length_score_correlation` | Correlation between script length and score | `CORR(word_count, total_score)` | prompt × year level × model version | `fact_writing_mark` | A6 | Nightly 02:00 | Alert above `[config]` abs value | Length bias is the best-documented failure mode of automated writing assessment. A strong positive correlation means the model rewards verbosity. Report the correlation **with n**; on 12 scripts it proves nothing. |
| `distribution_drift` | Shift in score distribution vs baseline | difference in mean and in deciles vs a frozen baseline period | prompt × year level × model version | `fact_writing_mark` | A6 | Nightly 02:00 | `[config]` | Needs a **frozen baseline**. Without one, "drift" is undefined. Baseline is set once the platform has `[config]` marks. |
| `mark_queue_time_p95` | 95th percentile wait from submission to mark | `PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY marked_at - submitted_at)` | hour | `fact_writing_mark` | A7 | Hourly | `[config]` | Parent-visible latency. A slow mark looks like a lost mark. |
| `mark_failure_rate` | Marks that failed | `COUNT(*) FILTER (WHERE status='FAILED')::numeric / NULLIF(COUNT(*),0) * 100` | hour × model version | `fact_writing_mark` | A7 | Hourly | `[config]` | **`writing_evaluations` has no status column today** — failures are invisible. Migration adds it. |
| `mark_retry_rate` | Marks needing a retry | `COUNT(*) FILTER (WHERE attempts > 1)::numeric / NULLIF(COUNT(*),0) * 100` | hour | as above | A7 | Hourly | `[config]` | A rising retry rate precedes a rising failure rate; it is the earlier warning. |
| `mark_flag_rate` | Marks disputed by parents or tutors | `COUNT(DISTINCT flagged_mark)::numeric / NULLIF(COUNT(DISTINCT mark),0) * 100` | day × flagged_by_role | `fact_writing_mark_flags` | A7 | Hourly | `[config]` | Split by role: tutors flag on professional judgement, parents on surprise. The two mean different things and must not be summed into one number without the split visible. |

### 5.6 Admin — revenue (Stripe)

| Metric | Business definition | SQL formula | Grain | Source | Owner | Refresh | Threshold | Caveats |
|---|---|---|---|---|---|---|---|---|
| `gross_revenue_inc_gst` | Total captured, GST inclusive | `SUM(amount_cents) FILTER (WHERE status IN ('succeeded','paid'))` | day × product | `fact_order` | A8 | Nightly 02:00 | n/a | Refunds are separate negative lines, **not** netted silently — a netted number hides a refund problem. |
| `net_revenue_ex_gst` | Revenue after refunds and disputes, GST exclusive | `(SUM(gross) - SUM(refunds) - SUM(disputes)) / 1.10` | day × product | `fact_order` | A8 | Nightly 02:00 | n/a | **Dividing by 1.10 assumes every line is GST-taxable.** If any product becomes GST-free or input-taxed the divisor is wrong; the assumption is asserted in the view comment. Stripe fees are **not** deducted here. |
| `refunds` | Refunded amount | `SUM(amount_cents) FILTER (WHERE kind='refund')` | day × product | `fact_order` | A8 | Nightly | Alert above `[config]` rate | The published policy is a 14-day money-back guarantee for any reason (contact page), so a **high refund rate is expected and is not by itself a defect**. Compare against that policy, not a generic SaaS benchmark. |
| `disputes` | Disputed (chargeback) amount | `SUM(amount_cents) FILTER (WHERE kind='dispute')` | day | `fact_order` | A8 | Nightly | Alert on any | Disputes carry a fee whether won or lost. One is worth investigating. |
| `stripe_fees` | Payment processing fees | `SUM(fee_cents)` from the Stripe balance transaction | day | `fact_order` | A8 | Nightly | n/a | Fees sit on the **balance transaction**, not the charge, and can land in a later period than the payment. Reconciliation must not assume same-day. |
| `arppu` | Average revenue per paying parent | `SUM(net_revenue_ex_gst) / NULLIF(COUNT(DISTINCT paying_parent_key),0)` | month | `fact_order` | A8 | Monthly | n/a | **Paying parents**, not customers or students. A parent with three children is one paying parent. Print the denominator on the visual. |
| `bundle_attach_rate` | Share of orders including a bundle | `COUNT(*) FILTER (WHERE is_bundle)::numeric / NULLIF(COUNT(*),0) * 100` | month × product | `fact_order`, `dim_product` | A8 | Monthly | `[config]` | Requires `dim_product.is_bundle`, which needs a bundle flag on `public.products` — **not present today**. |
| `mrr` | Monthly recurring revenue from active subscriptions | `SUM(normalised_monthly_amount_cents) FILTER (WHERE status IN ('active','trialing')) / 100` | month | `fact_subscription` | A8 | Monthly | n/a | **Normalise annual plans to monthly** or MRR spikes on every annual renewal. Trialling is not revenue — report separately. |
| `churn_rate` | Subscriptions cancelled in a period ÷ active at period start | `cancelled / NULLIF(active_at_start,0) * 100` | month | `fact_subscription` | A8 | Monthly | `[config]` | **Gross churn.** Net churn (with upgrades/downgrades) is a different metric and must not share the name. `SUBSCRIPTION_CANCELLED` fires on *intent*; churn is real only when the period ends without renewal. |
| `renewal_rate` | Renewals ÷ renewals due | `renewed / NULLIF(due,0) * 100` | month | `fact_subscription` | A8 | Monthly | `[config]` | "Due" comes from the subscription period end date, not the calendar month. |

### 5.7 Admin — acquisition, funnel and experiments

| Metric | Business definition | SQL formula | Grain | Source | Owner | Refresh | Threshold | Caveats |
|---|---|---|---|---|---|---|---|---|
| `retention_rate` | Cohort still active *n* months after signup | `active_at_month_n / NULLIF(cohort_size,0) * 100` | signup month × channel × n | `fact_event`, `dim_campaign` | A10 | Nightly 02:00 | n/a | **Define "active"** as an attempt in the month — not a login. A login without practice is not retention for this product. |
| `ltv_cents` | Cumulative net revenue per parent in a cohort | `SUM(net_revenue_ex_gst)` per cohort ÷ cohort size | signup month × channel | `fact_order`, `dim_campaign` | A10 | Nightly 02:00 | n/a | Observed LTV to date, **not a forecast**. A projected LTV needs a survival model the platform does not have. Label "LTV to date, *n* months". |
| `cac_cents` | Acquisition cost per paying parent | `monthly_spend_cents / NULLIF(new_paying_parents,0)` | month × channel × campaign | `dim_campaign`, `fact_order` | A10 | Monthly | n/a | **Blocked: no spend data exists** (A-08). Returns `null` and renders "spend not recorded" until `dim_campaign.monthly_spend_cents` is populated manually. |
| `roas` | Return on ad spend | `ltv_cents / NULLIF(cac_cents,0)` | month × channel | as above | A10 | Monthly | `[config]` | Inherits the CAC blocker. Never show ROAS unless both inputs are present. |
| `stage_conversion_rate` | Proportion advancing between funnel stages | `stage_n_users / NULLIF(stage_n_minus_1_users,0) * 100` | day × stage × segment | `fact_event`, `funnel_state` | A11 | Hourly 06:00–22:00 | Targets per 011 comments | Segments below `[config]` volume are suppressed — a 1-user segment shows 100% and will be believed (M8). |
| `stage_dropoff_count` | Absolute users lost between stages | `stage_n_minus_1_users - stage_n_users` | as above | as above | A11 | Hourly | n/a | Shown **beside** the percentage. A 50% drop on 2 users is not a finding. |
| `free_to_paid_rate` | Paying parents ÷ parents who reached the paywall | `paying / NULLIF(reached_paywall,0) * 100` | day × segment | `fact_event`, `fact_order` | A11 | Hourly | `[config]` | **Denominator is `PAYWALL_TRIGGERED`, not all signups.** Using signups understates paywall performance and hides upstream problems. The denominator is printed on the visual. |
| `checkout_abandonment_rate` | Started checkout without completing | `started_without_completed / NULLIF(started,0) * 100` | day × device | `fact_event` | A11 | Hourly | `[config]` | `CHECKOUT_ABANDONED` is **derived** — nobody fires "I abandon". Inferred as started-minus-completed after a window; state the window. |
| `time_to_first_value_hours` | Signup to first completed diagnostic | `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY diagnostic_completed_at - signed_up_at)` in hours | day × segment | `funnel_state` | A11 | Hourly | `[config]` | Median, not mean — one account left open for a month destroys the mean. |
| `variant_conversion_rate` | Conversion per experiment variant | `conversions / NULLIF(exposed,0) * 100` | experiment × variant | `fact_event`, `experiments` | A12 | Nightly 02:00 | n/a | Requires **exposure** logging, not just assignment. Counting assigned-but-never-shown users biases every experiment toward the null. |
| `sample_size` | Users exposed per variant | `COUNT(DISTINCT user_key)` | experiment × variant | as above | A12 | Nightly | Min `[config]` | Below the minimum, `recommended_decision` returns `INSUFFICIENT_DATA` — never "no difference". |
| `p_value_experiment` | Two-proportion test, control vs variant | normal-approximation z-test on the two proportions | experiment × variant | as above | A12 | Nightly | `0.05` `[config]` | **Distinct from `p_value` (item difficulty)** — two metrics, same name, opposite meanings. The dictionary exists to prevent exactly this collision. Never abbreviate either. |
| `confidence_interval` | Interval on the conversion difference | Wilson interval on the difference of proportions | experiment × variant | as above | A12 | Nightly | n/a | Wilson, not Wald — Wald is unreliable near 0 or 1. Show the interval, not just significance: a significant 0.2pp lift is not worth shipping. |
| `recommended_decision` | Ship / revert / extend / insufficient data | rule over `p_value_experiment`, `confidence_interval`, `sample_size` | experiment | as above | A12 | Nightly | n/a | A **recommendation**, not an automatic action. Includes a reasoning string so a human can disagree. |

### 5.8 Admin — enquiries, operations and data quality

| Metric | Business definition | SQL formula | Grain | Source | Owner | Refresh | Threshold | Caveats |
|---|---|---|---|---|---|---|---|---|
| `enquiry_volume` | Enquiries received | `COUNT(*)` | day × channel × type | `fact_enquiry` | A13 | Hourly | n/a | Counts enquiries, not enquirers. One parent emailing twice is two enquiries. |
| `first_response_minutes` | Receipt to first human response | `EXTRACT(EPOCH FROM first_response_at - received_at)/60` | enquiry | `fact_enquiry` | A13 | Hourly | SLA `[config]` | **Business-hours or calendar?** The contact page publishes a response time but neither the repo nor the DB states the SLA or its basis. Logged **A-15**, question **Q-5**. |
| `sla_breach_rate` | Share breaching the first-response SLA | `COUNT(*) FILTER (WHERE first_response_minutes > sla)::numeric / NULLIF(COUNT(*),0) * 100` | day × channel | as above | A13 | Hourly | `[config]` | Unresolved enquiries past SLA must count as breaches **now**, not only once resolved — otherwise the worst cases never appear. |
| `resolution_hours` | Receipt to resolution | `EXTRACT(EPOCH FROM resolved_at - received_at)/3600` | enquiry | `fact_enquiry` | A13 | Hourly | `[config]` | Median, not mean. |
| `enquiry_to_customer_rate` | Enquiries that produced an order | `COUNT(*) FILTER (WHERE converted_order_id IS NOT NULL)::numeric / NULLIF(COUNT(*),0) * 100` | month × channel × type | `fact_enquiry`, `fact_order` | A13 | Nightly | n/a | **Attribution window required.** An order 6 months later is not an enquiry conversion. Window is `[config]`. |
| `support_theme` | Categorised enquiry topic | `enquiry_type`, plus theme derived from text | day × theme | `fact_enquiry` | A13 | Nightly | n/a | Derived themes need a classifier. **MVP uses the `enquiry_type` enum only**; free-text extraction is phase 3. Never present a keyword count as a theme. |
| `active_users` | Distinct users with ≥1 meaningful action | `COUNT(DISTINCT user_key)` | day / hour | `fact_event` | A14 | Every 15 min | n/a | "Meaningful" = an attempt started or submitted. A page view is not an active user for this product. |
| `peak_concurrency` | Maximum simultaneous in-progress attempts | max over a 1-minute grid of attempts where `started_at <= t AND (submitted_at IS NULL OR submitted_at > t)` | hour | `fact_test_attempt` | A14 | Every 15 min | Cap **200** | Expensive as a true interval count; computed on a 1-minute grid inside the MV, never per request. |
| `concurrency_vs_cap` | Peak as a percentage of the 200 cap | `peak_concurrency / 200.0 * 100` | hour | as above | A14 | Every 15 min | Alert at `[config]`% | 200 is a **stated target, not a measured ceiling** (A-13). |
| `test_error_rate` | Errors during test-taking | `error_events / NULLIF(attempt_events,0) * 100` | hour × test | `fact_event` | A14 | Every 15 min | `[config]` | Requires an `ERROR_OCCURRED` event that does **not** exist in the catalogue today. Added in deliverable 6. |
| `failed_submission_rate` | Submissions that did not persist | `failed / NULLIF(attempted,0) * 100` | hour × test | `fact_event` | A14 | Every 15 min | Alert on any | The most damaging failure in the product: a child finishes and the result is lost. Any non-zero value is an incident. |
| `untagged_item_count` | Published items with no curriculum tag | `COUNT(*) FILTER (WHERE content_description_key IS NULL AND status='PUBLISHED')` | day | `dim_item` | A15 | Nightly 04:00 | Target **0** | Will equal the entire item bank until the VC2 mapping happens (A-02). |
| `orphan_record_count` | Rows whose parent no longer exists | counts across `responses`→`attempts` and `fact_*`→`dim_*` | day × check | all | A15 | Nightly 04:00 | Target **0** | Foreign keys prevent most orphans; this catches reporting-layer orphans introduced by the ETL. |
| `failed_event_count` | Events rejected by `/api/events` | counter incremented on drop | day | application logs | A15 | Nightly | Target **0** | The endpoint drops unknown event names **silently by design**. Without a counter a typo in a new event name is invisible until a dashboard is mysteriously empty. |
| `stripe_reconciliation_gap_count` | Differences between Stripe and `fact_order` | `COUNT(*)` from the nightly reconciliation | day | `stripe_reconciliation` | A15 | Nightly | Target **0** | Any non-zero value means revenue reporting is wrong. Blocks the A8 refresh until triaged. |
| `mv_refresh_lag_minutes` | Age of each materialised view | `EXTRACT(EPOCH FROM now() - last_refreshed_at)/60` | MV | `reporting.refresh_log` | A15 | Every 15 min | `[config]` per MV | **The most important metric in this dictionary.** A stale MV looks exactly like a correct one. Every dashboard shows its own lag. |

---

**End of Part 1.** Continue in `12-bi-reporting-data-model.md` for the event tracking plan,
enquiry table inspection and migration, the star-schema ERD and DDL, and the view /
materialised-view / RLS SQL.

