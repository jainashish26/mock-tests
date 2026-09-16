# Project Charter — Mock Tests Web Platform (Year 2–8)

## Project Overview
**One-line summary:** Build a **privacy-first, mobile‑first web platform** that delivers **real exam-like, adaptive mock tests** (NAPLAN-style + selective + Olympiad) for **Year 2–8 students**, enabling parents to track progress and purchase test bundles, using **Next.js (Vercel) + Supabase (Auth + Postgres + RLS) + Upstash QStash + Stripe (one-time payments) + DeepSeek (async writing marking)**. 

### Why we’re building it
- Parents need a **clear, actionable improvement report** (scores, weak areas, time diagnostics) and a **premium, exam-like UX** to build confidence and drive score improvement.
- We monetize via **freemium** (benchmark + selected free packs) and **one‑time purchases** for premium bundles.
- We protect children’s privacy by design (no student names/DOB/school stored; pseudonymous usernames).

### Target users (personas)
- **Parent** (primary buyer): onboard child profiles, assign tests, view detailed reports.
- **Student**: take assigned tests in exam-like UI, view results.
- **Tutor** (MVP‑2): manage classes, assign tests to groups, monitor progress.
- **Test Creator**: create/edit/tag questions/tests (drafts).
- **Admin**: approve/publish content, manage catalog, oversee platform.


---

## Goals & Objectives
### Business goals
1. **Parent happiness**: premium UX + reliable, actionable reporting.
2. **Freemium → conversion**: free benchmark drives trust and activates purchases.
3. **Scalable content operations**: CMS + approval workflow supports 1–3 new tests/week.

### Product goals
1. **Exam-like experience**: timed tests, navigation, flagging, review-before-submit.
2. **Adaptive engine (objective only)**: within-test adaptivity per section.
3. **Detailed analytics**: section/topic/skill breakdown, time-per-question, trends.
4. **Writing feedback**: async AI marking with score out of 100 + strengths/improvements.

### Security & privacy objectives
1. **Deny-by-default access control** at API and DB levels to prevent unauthorized access (a key OWASP risk category). 
2. **ASVS Level 2 launch bar** for web app security verification (evidence-based).
3. **RLS + server-side RBAC**: RLS for data-plane access; RBAC for endpoint-plane access (service role bypasses RLS).

---

## Key Deliverables

### A) Product surfaces (pages / routes)
> *Exact URLs are indicative; final routing follows Next.js App Router conventions.*

#### Public (unauthenticated)
- **Landing** (`/`) — value proposition + CTA to sign in.
- **Pricing / Catalog preview** (`/pricing`) — explains bundles (no test content visible).
- **Auth** (`/auth/*`) — Supabase Auth flows.

#### Parent
- **Parent Dashboard** (`/parent`) — children list, progress overview.
- **Child Detail** (`/parent/child/[id]`) — assign tests, trend charts.
- **Attempt Report** (`/parent/report/[attemptId]`) — premium report + full question review.
- **Catalog** (`/shop`) — shows free + purchased tests (gated).
- **Cart/Checkout** (`/checkout`) — Stripe checkout initiation and confirmation pages.
- **Notifications** (`/notifications`) — in-app notifications (writing ready).

#### Student
- **Student Home** (`/student`) — assigned tests.
- **Test Runner** (`/student/test/[assignmentId]`) — timer, nav, flag, sections.
- **Submission Review** (`/student/test/[assignmentId]/review`) — review before submit.
- **Student Report** (`/student/report/[attemptId]`) — simplified view + question review.

#### Test Creator
- **Creator Dashboard** (`/creator`) — drafts, submissions.
- **Question Editor** (`/creator/questions/[id]`) — MCQ/short/writing creation + tags.
- **Test Builder** (`/creator/tests/[id]`) — sections, assembly, preview.

#### Admin
- **Admin Dashboard** (`/admin`) — queues: pending approvals, published, drafts.
- **Approval Review** (`/admin/review/[entity]/[id]`) — approve/reject with comments.
- **Catalog Manager** (`/admin/catalog`) — products/prices/test mappings.
- **Ops Views** (`/admin/ops`) — webhook/job logs and basic health.


### B) MVP Definition (Production-ready “one-go”)
The MVP shipped to production must include:

1. **Supabase Auth + SendGrid SMTP** for email OTP and login. 
2. **RLS + server-side RBAC** for all sensitive data and privileged endpoints. 
3. **Content gating**: Published tests/questions readable only by logged‑in users who either:
   - can access a **free** test, or
   - have **active entitlements** for paid tests.
4. **CMS + approval workflow**: Creator drafts → Admin approves → publish.
5. **Test runner (mobile-first, pixel-perfect)**: timed, sectioned, nav/flag, review-before-submit.
6. **Adaptive engine**: objective questions only (MCQ + short answer), adaptivity per section.
7. **Marking + scoring**: all tests scored **out of 100**; no negative marking.
8. **Reports**: Parent premium report includes full question review + explanations.
9. **Writing marking**: async DeepSeek pipeline + in-app notification.
10. **Payments**: Stripe one-time purchase checkout + webhook-based entitlements.
    - Webhook security requires signature verification using Stripe’s recommended method.
11. **Analytics baseline**: time-per-question, accuracy by tag, trend over time.
12. **ASVS Level 2 security verification evidence pack** before production release.

### C) Non-MVP (explicitly deferred)
- Tutor classes and tutor dashboards.
- Coupons.
- Percentiles: feature-flagged until cohort threshold (≥200 attempts per Year+ExamType).
- Advanced adaptivity models beyond rule-based per-section adaptivity.

---

## Technical & Code Standards

### 1) Core stack standards
- **Framework:** Next.js (App Router), TypeScript, React.
- **Hosting:** Vercel.
- **Data:** Supabase Postgres with **SQL migrations**.
- **Auth:** Supabase Auth with SendGrid SMTP.
- **Async:** Upstash QStash (writing marking, rollups).
- **Payments:** Stripe one-time purchases.

### 2) Naming Conventions

#### Files & folders
- **kebab-case** for directories: `test-runner/`, `question-editor/`.
- **PascalCase** for React components: `TestRunner.tsx`.
- **camelCase** for functions/variables: `calculateScore()`.

#### Database
- **snake_case** for table/column names: `student_profiles`, `created_at`.
- Foreign keys end with `_id`: `student_id`, `test_id`.
- Join tables use `<left>_<right>`: `product_tests`.

#### API routes
- REST-like paths under `/api/*`.
- Admin/service endpoints namespaced:
  - `/api/admin/*` (RBAC enforced)
  - `/api/webhooks/*` (signature verified)
  - `/api/jobs/*` (QStash verified)

### 3) Component Patterns

#### UI layering
- **Pages/Routes**: compose views, minimal logic.
- **Feature components**: `features/<feature>/` owns domain UI + hooks.
- **UI primitives**: `components/ui/` (button, input, modal, tabs).

#### State management
- Prefer **server components** for data fetching views when possible.
- Use client components only where interaction requires it (runner, forms).
- Keep request logic in `lib/api/*` and data hooks in `features/*/hooks/*`.

### 4) Typing Standards & Import Conventions
- TypeScript strict mode enabled.
- Avoid `any`; use `unknown` + narrowing.
- Define shared types in `src/types/`.
- Import order:
  1. Node/standard libs
  2. External libs
  3. Internal absolute imports (`@/…`)
  4. Relative imports
- Prefer **type-only imports**: `import type { Attempt } from '@/types';`

### 5) Error Handling & Commenting Practices

#### Error handling
- All API routes return consistent error shape:
  - `{ error: { code, message, correlationId } }`
- Use correlation IDs in logs for traceability.
- Fail closed for authorization (deny-by-default).

#### Comments
- Comments must explain **why**, not **what**.
- For security-sensitive code (webhooks, RBAC), include brief rationale and references.

---

## Project Structure (target directory layout)

```
.
├─ src/
│  ├─ app/                      # Next.js App Router routes
│  │  ├─ (public)/
│  │  ├─ parent/
│  │  ├─ student/
│  │  ├─ creator/
│  │  ├─ admin/
│  │  └─ api/
│  │     ├─ webhooks/
│  │     ├─ jobs/
│  │     ├─ admin/
│  │     └─ ...
│  ├─ components/
│  │  ├─ ui/                     # reusable primitives
│  │  └─ layout/                 # shells, nav
│  ├─ features/
│  │  ├─ auth/
│  │  ├─ catalog/
│  │  ├─ runner/
│  │  ├─ reporting/
│  │  ├─ cms/
│  │  ├─ payments/
│  │  └─ notifications/
│  ├─ lib/
│  │  ├─ supabase/               # client/server creators
│  │  ├─ rbac/                   # role checks, guards
│  │  ├─ stripe/                 # checkout + webhook helpers
│  │  ├─ qstash/                 # publish + verify helpers
│  │  └─ logging/
│  ├─ types/
│  ├─ styles/
│  └─ config/
│
├─ supabase/
│  ├─ migrations/                # SQL migrations (schema, RLS, indexes, seed)
│  └─ seed/                      # optional seed scripts
│
├─ docs/                         # markdown docs
├─ package.json
└─ ...
```

---

## Commands

> Commands are indicative; final scripts live in `package.json`.

### Development
- `npm install`
- `npm run dev` — start local dev server

### Testing & QA
- `npm run lint` — lint
- `npm run typecheck` — TypeScript checks
- `npm run test` — unit tests
- `npm run test:e2e` — end-to-end tests (recommended)

### Database / Supabase
- `supabase start` — local Supabase stack (if used)
- `supabase db reset` — reset local DB and apply migrations
- `supabase migration up` — apply migrations
- `supabase migration new <name>` — create a new migration

### Build & Deploy
- `npm run build` — production build
- `npm run start` — run production build locally
- Vercel deploy is via Git push / CI.

---

## Conventions / Gotchas (project-specific “institutional knowledge”)

1. **RLS + Service Role**: service role bypasses RLS. Therefore:
   - Only use `SUPABASE_SERVICE_ROLE_KEY` in trusted endpoints (webhooks/jobs/admin bulk).
   - Always enforce RBAC in those endpoints.
2. **Stripe webhook raw body**: Stripe signature verification requires the **raw request body** (do not JSON-parse before verification). citeturn6search19
3. **Content gating is DB-enforced**:
   - Published tests/questions require login.
   - Paid content requires entitlements.
4. **Students are Auth users** (synthetic email pattern): ensures RLS works uniformly for all personas.
5. **Adaptive engine scope**: objective questions only; per section; no cross-section adaptivity.
6. **Percentiles**: do not show until cohort threshold is reached; keep behind a feature flag.
7. **NAPLAN past papers**: do **not** upload FOI-released past papers to the platform; create original “NAPLAN-style” questions.

---

## Workflow Rules

### 1) Planning & task execution
- Work in **2-week sprints** with a staging demo every sprint.
- Every task must map to a Jira story with:
  - clear acceptance criteria
  - security/privacy notes when relevant
  - test plan notes

### 2) Branching & PR rules
- Branch naming: `feat/<scope>-<short-desc>`, `fix/<scope>-<short-desc>`.
- PR requirements:
  - passing lint/typecheck/tests
  - reviewer approval (Tech Lead or designated owner)
  - screenshots/video for UI changes

### 3) Definition of Done (DoD)
A story is “done” only if:
- RLS and RBAC considerations addressed
- Tests added/updated
- Logging and error handling aligned with standard
- UX/UI sign-off if user-facing

### 4) Security verification workflow
- Maintain an **ASVS L2 evidence checklist** and update per sprint.
- Run access control regression tests (role escalation/IDOR patterns).

---

## Design & Quality Standards

### Design style
- **Premium academic** + **progressive modern**.
- Calm, high-contrast palette; accessible typography.
- Minimal distraction in test runner; focus on readability.

### UI requirements
- **Mobile-first** responsive design; pixel-perfect across common breakpoints.
- Consistent component library (tokens: spacing, typography, colors).
- Clear feedback states: loading, error, success, disabled.

### Quality standards
- Performance: smooth test runner interactions; avoid layout shifts.
- Accessibility: keyboard navigation, focus states, contrast checks.
- Reliability: idempotent webhook/job processing.

---

## Reference Documents

Use these documents only when needed (avoid overloading context during coding).

- @import `docs/mock-tests-db-schema.md` — database schema reference.
- @import `docs/mock-tests-rls-and-seed-plan.md` — RLS helper functions + seed plan.
- @import `docs/mock-tests-env-vars.md` — complete environment variable reference.
- @import `.env.example` — variable names template for local/Vercel.

### External references (security & payments)
- OWASP ASVS (security verification baseline).
- OWASP Top 10: Broken Access Control guidance for deny-by-default authorization.
- Stripe webhook signature verification guidance.

---
