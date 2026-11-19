# Implementation Plan — Mock Tests Web Platform

> **Created**: 2026-03-18  
> **Role**: Lead Developer (Solo)  
> **Status**: Pre-development — Greenfield  
> **Inputs reviewed**: All 6 PM planning documents (charter, RLS/seed, sprint plan, DB schema, env vars, .env.example)

---

## Table of Contents

1. [Document Review & Assessment](#1-document-review--assessment)
2. [Key Technical Decisions](#2-key-technical-decisions)
3. [Gaps, Risks & Recommendations](#3-gaps-risks--recommendations)
4. [Revised Sprint Plan (Solo Developer)](#4-revised-sprint-plan-solo-developer)
5. [Sprint 1 — Detailed Breakdown](#5-sprint-1--foundations--auth--db--rbac)
6. [Sprint 2 — Detailed Breakdown](#6-sprint-2--rls--child-profiles--cms-v1--runner-v1)
7. [Sprint 3 — Detailed Breakdown](#7-sprint-3--adaptive-engine--scoring--reports)
8. [Sprint 4 — Detailed Breakdown](#8-sprint-4--payments--short-answer--writing-async)
9. [Sprint 5 — Detailed Breakdown](#9-sprint-5--ui-polish--analytics--percentiles)
10. [Sprint 6 — Detailed Breakdown](#10-sprint-6--security-verification--qa--launch)
11. [Project Directory Structure](#11-project-directory-structure)
12. [Database Migration Strategy](#12-database-migration-strategy)
13. [Seed Data Strategy](#13-seed-data-strategy)
14. [Security Checklist (Running)](#14-security-checklist-running)
15. [Definition of Done (Global)](#15-definition-of-done-global)

---

## 1) Document Review & Assessment

### 1.1 Overall quality

The PM has produced an **exceptionally thorough** set of planning documents. The architecture is sound and the security posture (deny-by-default, RLS + RBAC, content gating) is well above average for an educational platform. Specific strengths:

- **Privacy-by-design**: no student PII stored — pseudonymous usernames only.
- **Layered access control**: RLS at the DB level + RBAC at the API level + content gating — this is the correct approach.
- **Idempotency for webhooks/jobs**: both Stripe and QStash have idempotency journals — prevents double-grant bugs that plague payment systems.
- **Clear content lifecycle**: DRAFT → PENDING_APPROVAL → PUBLISHED → ARCHIVED with role-gated transitions.
- **Enum-driven constraints**: Postgres enums for roles, statuses, question types — reduces invalid states at the DB layer.

### 1.2 Per-document assessment

| Document | Verdict | Notes |
|----------|---------|-------|
| `01-project-charter` | **Solid** | Clear scope, personas, non-MVP items explicitly deferred. Good. |
| `02-rls-and-seed-plan` | **Solid** | Helper function semantics are well-documented. Seed plan is practical. |
| `03-sprint-plan` | **Needs adjustment** | Sprint sizing assumes a team; needs re-sequencing for solo dev. Stories are well-scoped but some epics can be merged. |
| `04-db-schema` | **Solid with minor gaps** | See schema concerns below. |
| `05-env-vars` | **Comprehensive** | Good separation of server/public vars. Well-organized. |
| `06-env.example` | **Good** | Matches the env-vars doc. Ready to use. |

---

## 2) Key Technical Decisions

### 2.1 Confirmed stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Framework** | Next.js 15 (App Router) + TypeScript | As per charter. Server components for data views, client for interactive UI. |
| **Hosting** | Vercel | As per charter. Git-push deploys, preview URLs. |
| **Database** | Supabase Postgres | As per charter. RLS-native, managed. |
| **Auth** | Supabase Auth + SendGrid SMTP | Email OTP/magic link. Students use synthetic email pattern. |
| **UI** | shadcn/ui + Tailwind CSS v4 | Premium academic look. Mobile-first. Highly customizable, no vendor lock-in. |
| **Server state** | TanStack Query (React Query v5) | Cache, deduplicate, and sync server data. |
| **Client state** | Zustand | Lightweight store for test runner state (timer, flags, navigation, answers). |
| **Payments** | Stripe (one-time) | Checkout Sessions API. Webhook-driven entitlements. |
| **Async jobs** | Upstash QStash | Writing marking pipeline. Signature-verified, with retry/backoff. |
| **AI marking** | DeepSeek API | Async writing evaluation via QStash. |
| **Testing** | Vitest (unit/integration) + Playwright (E2E) | Fast unit tests, reliable browser E2E. |
| **Linting** | ESLint (flat config) + Prettier | Enforced in CI. |
| **Rate limiting** | Upstash Redis (`@upstash/ratelimit`) | Per-IP and per-user throttling on sensitive endpoints. |
| **Error tracking** | Sentry | Client + server error capture with source maps. |

### 2.2 Key package choices

```
# Core
next@15               typescript@5         react@19
@supabase/supabase-js @supabase/ssr

# UI
tailwindcss@4         @shadcn/ui           lucide-react
class-variance-authority  clsx  tailwind-merge

# State & data
@tanstack/react-query  zustand

# Payments
stripe                @stripe/stripe-js

# Async / rate-limit
@upstash/qstash       @upstash/ratelimit   @upstash/redis

# Testing
vitest                @vitejs/plugin-react  playwright
@testing-library/react

# Observability
@sentry/nextjs

# Utilities
zod                   nanoid               date-fns
```

---

## 3) Gaps, Risks & Recommendations

### 3.1 Schema concerns (minor — address in Sprint 1)

| # | Concern | Recommendation |
|---|---------|----------------|
| 1 | **`purchases` has no link to `products`** — a purchase should reference which product(s) were bought. | Add a `purchase_items` table or a `product_id` FK on `purchases`. Alternatively, store `product_ids` as JSONB on `purchases`. **Recommended**: add `purchase_items (purchase_id, product_id, price_cents)` join table for clean audit trail. |
| 2 | **`tests` has `year_level_min` + `year_level_max`** — but `student_profiles` has a single `year_level`. There's no schema-level enforcement that assignments match year level. | Enforce year-level validation in the API layer (assignment creation) rather than DB. Acceptable trade-off. Document this as a business rule. |
| 3 | **`assignments` has no unique constraint** on `(student_id, test_id)` — a parent could assign the same test twice. | Add a unique constraint `(student_id, test_id)` on `assignments`. **Confirmed**: students cannot re-take the same test (see PM answer #3). |
| 4 | **`app_user_roles` is 1:1** (user → single role). A user who is both a Parent and a Test Creator would need two auth accounts. | **Confirmed by PM**: each role is unique — a PARENT cannot also be a TEST_CREATOR. The 1:1 design is final, not just an MVP trade-off. No future migration needed. |
| 8 | **`attempts` has no unique constraint** on `(student_id, test_id)` — but students cannot re-take the same test. | Add a unique constraint `(student_id, test_id)` on `attempts`. Enforces the "no re-attempts" business rule at the DB level. |
| 5 | **No `updated_at` trigger** — `updated_at` columns exist but nothing auto-updates them. | Add a reusable `moddatetime` trigger or a Postgres function for auto-updating `updated_at`. |
| 6 | **`test_questions.section_name`** is text, not FK to `test_sections`. | This is denormalized by design for flexibility, but consider adding a `section_id` FK for integrity. Alternatively, enforce via application. For MVP, keep as-is with validation in CMS. |
| 7 | **`responses.answer`** is `NOT NULL` — but a student may skip a question (no answer). | Change to nullable, or define a convention: `{"skipped": true}` as the answer value for unanswered questions. **Recommended**: make it nullable. |

### 3.2 Architecture considerations

| # | Topic | Recommendation |
|---|-------|----------------|
| 1 | **Student synthetic email pattern** — must be deterministic and collision-free. | Use pattern: `student_{student_profile_id}@mock-tests.internal`. This is unique by definition (UUID) and never conflicts with real emails. |
| 2 | **Adaptive engine runs client-side or server-side?** | **Server-side** — the question pool and difficulty logic must not be exposed to the client. The client requests "next question for section X", server returns it. This prevents cheating. |
| 3 | **Test runner offline resilience** — what if connection drops mid-test? | Store answers in Zustand + `localStorage` as backup. On reconnect, sync to server. Add a "connection lost" banner in runner UI. |
| 4 | **Image storage for questions** — Supabase Storage or external? | **Supabase Storage** with a private bucket + signed URLs. Questions images should not be publicly accessible without auth. |
| 5 | **Writing prompt/rubric versioning** — if the rubric changes, old evaluations should reference the version used. | Already handled: `writing_evaluations` stores `provider` and the job payload includes `rubric_version`. The full rubric prompt is available in `DeepSeek Writing Prompt.txt` — it includes 5 scoring categories (Language Mechanics /20, Vocabulary /15, Cohesion & Structure /20, Content & Ideas /25, Engagement & Style /20), narrative/persuasive technique detection, strengths, improvements, polished rewrite, and targeted practice exercises. |
| 6 | **Writing questions: max 1 per test** (PM confirmed). | Simplifies the QStash pipeline: exactly **one job per attempt** (not per question). CMS test builder must enforce this constraint. If a test has no writing questions, the attempt completes immediately on submit (no `WRITING_PENDING` state). |
| 7 | **Parent can reset student password** (PM confirmed). | Since students use synthetic emails (no real inbox), the parent must be able to trigger a password reset via the parent dashboard. Implement as a server action using the Supabase Admin API (`admin.updateUserById`). |

### 3.3 Sprint plan adjustments for solo developer

The PM's plan assumes a small team. As a solo developer:

- **Merge Story 2.2 + 2.3** (schema + indexes into one migration story).
- **Defer Story 1.3** (Sentry/observability) to Sprint 2 — get the DB and auth working first.
- **Pull RLS into Sprint 1** — RLS is foundational and should be enabled alongside schema creation, not deferred to Sprint 2. Add policies incrementally.
- **Move Story 15.2** (accessibility) earlier — embedding a11y from Sprint 2 is cheaper than retrofitting in Sprint 5.
- **Combine Epics 9+10** (adaptive + scoring) — these are tightly coupled for a solo dev.
- **Add explicit seed-data story** in Sprint 1 — having test data from day 1 unblocks all subsequent sprint testing.

### 3.4 Risk register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Solo dev burnout from 6-sprint scope | High | Strict Sprint 1–3 = functional MVP. Sprints 4–6 = polish/monetize. Ship incrementally to staging. |
| DeepSeek API changes or downtime | Medium | Abstract AI provider behind an interface. Store raw prompts/responses for replay. |
| Supabase RLS policy complexity causes bugs | High | Write RLS integration tests (Vitest + Supabase local) that assert visibility rules. Run on every PR. |
| Stripe webhook reliability | Medium | Idempotency table + manual reconciliation admin endpoint as backup. |
| Content pool too small for adaptive engine | Medium | Implement fallback rules (Story 9.2). Log when pool is thin. Alert admin. |
| Mobile test runner performance (120 question tests) | Medium | Virtualize question list. Lazy-load images. Keep runner state in Zustand (not React state). |

---

## 4) Revised Sprint Plan (Solo Developer)

> **Sprint duration**: 2 weeks each  
> **Total timeline**: 12 weeks (6 sprints)  
> **Deploy strategy**: Staging after each sprint. Production after Sprint 6.  
> **Each sprint includes**: implementation + testing + self-review.

### High-level overview

```
Sprint 1 ─ Foundations + DB + Auth + RLS Core + Seed Data
Sprint 2 ─ Child Profiles + CMS v1 + Test Runner v1 (MCQ) + Observability
Sprint 3 ─ Adaptive Engine + Scoring + Reports (Parent + Student)  
Sprint 4 ─ Payments + Entitlements + Short Answer + Writing Async Pipeline
Sprint 5 ─ UI Polish + Analytics Rollups + Percentiles (Feature-Flagged)
Sprint 6 ─ Security Verification (ASVS L2) + QA Hardening + Launch
```

### What changed vs PM's plan

| Change | Rationale |
|--------|-----------|
| RLS core policies moved from Sprint 2 → Sprint 1 | RLS should be active from first migration. Prevents "wide open" DB in staging. |
| Observability (Sentry) moved from Sprint 1 → Sprint 2 | Less critical for initial DB/auth work. Add when there's actual UI to monitor. |
| Seed data story added to Sprint 1 | Need test data to validate RLS, auth, and every subsequent feature. |
| Schema + indexes merged into one story | Solo dev efficiency — no separate migration PR for indexes. |
| Accessibility embedded from Sprint 2 | shadcn/ui components have good a11y defaults. Enforce from start, not retrofit. |
| Adaptive + Scoring merged in Sprint 3 | Tightly coupled — scoring depends on adaptive `difficulty_served`. |

---

## 5) Sprint 1 — Foundations + Auth + DB + RLS + Seed

> **Goal**: Working Next.js app on Vercel with Supabase DB, auth, RLS policies, and seed data. All subsequent sprints build on this foundation.

### Stories

#### S1.1 — Project scaffold + Vercel CI/CD
**Effort**: 0.5 day

- `npx create-next-app@latest mock-tests --typescript --tailwind --eslint --app --src-dir`
- Configure `tsconfig.json` (strict mode, path aliases `@/`).
- Install core dependencies (shadcn/ui, Supabase, Zod, TanStack Query, Zustand).
- Initialize shadcn/ui: `npx shadcn@latest init`.
- Set up Vitest + Playwright configs.
- Create Vercel project, connect Git repo.
- Configure environment variables for Preview + Production.
- Verify: PR creates preview deploy, build fails on lint/type errors.

**Acceptance**:
- `npm run dev` starts locally.
- `npm run lint && npm run typecheck` pass.
- Vercel preview URL works on PR.

---

#### S1.2 — Supabase project setup + schema v1 migration
**Effort**: 1 day

- Create Supabase projects (dev/staging/prod).
- Configure Auth Site URL + Redirect URL allowlist per environment.
- Write migration `001_schema.sql`:
  - Create enums: `user_role`, `exam_type`, `content_status`, `question_type`, `attempt_status`.
  - Create all 18 tables with PKs, FKs, constraints, checks.
  - Add `updated_at` auto-update trigger function.
  - Create all indexes from schema doc.
  - Add schema fix: `assignments(student_id, test_id)` unique constraint.
  - Add schema fix: `attempts(student_id, test_id)` unique constraint — enforces no re-attempts.
  - Add schema fix: `responses.answer` → nullable.
  - Add `purchase_items` join table (purchase → product mapping).
- Apply migration to dev via `supabase db reset`.
- Verify: fresh reset applies cleanly end-to-end.

**Acceptance**:
- All 18+ tables created with correct constraints.
- `supabase db reset` succeeds from scratch.

**Migration file plan**:
```
supabase/migrations/
  001_enums.sql
  002_tables.sql
  003_indexes.sql
  004_triggers.sql
```

Or as a single `001_initial_schema.sql` for simplicity (solo dev, no parallel work).

---

#### S1.3 — RLS policies + helper functions
**Effort**: 1.5 days

- Write migration `005_rls.sql`:
  - Enable RLS on all sensitive tables (12 tables).
  - Create helper functions:
    - `has_role(target_role)` → checks `app_user_roles`.
    - `is_parent_of(student_id)` → checks `parent_student_links`.
    - `is_student_self(student_id)` → checks `student_profiles.auth_user_id`.
    - `is_attempt_owner(attempt_id)` → joins attempts → student_profiles.
    - `has_entitlement(test_id)` → checks `entitlements.active`.
    - `can_access_published_test(test_id)` → is_free OR has_entitlement.
  - Add policies per the RLS catalogue (doc 02):
    - `app_user_roles`: self-read + admin-read/write.
    - `student_profiles`: parent-read linked + student self-read + admin-all.
    - `parent_student_links`: parent manages own + admin-all.
    - `tests`: published → `can_access_published_test`; drafts → creator own + admin.
    - `questions`: published → exists in accessible test; drafts → creator own + admin.
    - `test_sections`, `test_questions`: follow test visibility.
    - `assignments`: parent-read linked + student self + admin.
    - `attempts`, `responses`: student own + parent linked + admin.
    - `writing_evaluations`: student own + parent linked + admin.
    - `notifications`: user own + admin read.
    - `products`, `product_tests`: logged-in read + admin write.
    - `purchases`, `entitlements`: user own + admin.
    - `processed_webhook_events`, `processed_jobs`: admin/service only.

- Write RLS integration tests (Vitest + Supabase local):
  - Anonymous cannot read any published test.
  - Logged-in user sees free published tests.
  - Logged-in user cannot see paid tests without entitlement.
  - Student sees only own attempts/responses.
  - Parent sees only linked student data.
  - Admin sees all drafts.
  - Test Creator sees only own drafts.

**Acceptance**:
- All RLS tests pass.
- `supabase db reset` applies RLS migration cleanly.

---

#### S1.4 — Supabase Auth + SendGrid SMTP
**Effort**: 0.5 day

- Configure Supabase Auth SMTP (SendGrid credentials in Supabase Dashboard).
- Set sender name/email.
- Build auth pages at `/auth/login` and `/auth/signup`:
  - Email + OTP (magic link) for parents.
  - Username + password for students (mapped to synthetic email internally).
- Create Supabase client utilities:
  - `lib/supabase/client.ts` — browser client.
  - `lib/supabase/server.ts` — server component client (cookies-based).
  - `lib/supabase/admin.ts` — service-role client (server-only, for webhooks/jobs/admin).
- Create auth middleware (`middleware.ts`) — refresh session on every request.
- Role-based redirect after login:
  - PARENT → `/parent`
  - STUDENT → `/student`
  - TEST_CREATOR → `/creator`
  - ADMIN → `/admin`

**Acceptance**:
- Parent can sign up with email, receive OTP, log in.
- Session persists across refresh.
- Redirect works per role.

---

#### S1.5 — RBAC middleware (server-side)
**Effort**: 0.5 day

- Create `lib/rbac/guards.ts`:
  - `getUserRole(userId)` → queries `app_user_roles` → returns role or null.
  - `requireRole(allowedRoles[])` → middleware that returns 401/403 on failure.
  - `requireAuth()` → verifies session exists.
- Create consistent API error response shape:
  ```ts
  { error: { code: string, message: string, correlationId: string } }
  ```
- Create correlation ID utility (`lib/logging/correlation.ts`).
- Apply guards to route group layouts:
  - `/api/admin/*` → `requireRole(['ADMIN'])`.
  - `/api/webhooks/*` → signature verification (no auth — webhook-specific).
  - `/api/jobs/*` → QStash signature verification.
- Test: unauthenticated call to `/api/admin/test` returns 401.

**Acceptance**:
- Non-admin cannot hit admin endpoints.
- Unauthenticated requests get 401.
- Error responses include correlation IDs.

---

#### S1.6 — Seed data (admin user + benchmark tests + sample questions)
**Effort**: 1 day

- Create seed script `supabase/seed/seed.sql` (or `seed.ts` for flexibility):
  1. Create admin auth user → insert `app_user_roles(ADMIN)`.
  2. Create test-creator auth user → insert `app_user_roles(TEST_CREATOR)`.
  3. Create parent auth user → insert `app_user_roles(PARENT)`.
  4. Create student auth user (synthetic email) → insert `student_profiles` + `parent_student_links`.
  5. Create 7 benchmark tests (Year 2–8), each with:
     - `exam_type = BENCHMARK`, `status = PUBLISHED`, `is_free = true`.
     - 5 sections (Numeracy, Reading, Spelling & Grammar, Verbal Reasoning, Numerical Reasoning).
     - Question counts per the seed plan (doc 02, section 5.3).
  6. Create ~20 sample MCQ questions per section (placeholder content — will be replaced later):
     - Proper tags: `{ year, subject, topic, skill, difficulty, reasoning_type, exam_type }`.
     - Difficulty spread: 5 each at difficulty 1–4.
     - `status = PUBLISHED`.
  7. Map questions to tests via `test_questions`.
  8. Create 1 paid test (`is_free = false`, `PUBLISHED`) + 1 product + `product_tests` mapping.

**Acceptance**:
- `supabase db reset` + seed populates all test data.
- Logged-in user can see free benchmark tests via RLS.
- Paid test is invisible without entitlement.

---

#### S1.7 — Layout shell + navigation skeleton
**Effort**: 0.5 day

- Create shared layout components:
  - `components/layout/AppShell.tsx` — responsive sidebar (desktop) / bottom nav (mobile).
  - `components/layout/Header.tsx` — logo, user menu, notifications badge placeholder.
  - `components/layout/RoleGuard.tsx` — client-side route protection wrapper.
- Create route group layouts:
  - `(public)/layout.tsx` — landing, auth pages.
  - `parent/layout.tsx` — parent shell.
  - `student/layout.tsx` — student shell.
  - `creator/layout.tsx` — creator shell.
  - `admin/layout.tsx` — admin shell.
- Set up TanStack Query provider + Zustand (minimal store skeleton).
- Set up Tailwind design tokens:
  - Color palette (calm academic: navy, teal, warm white).
  - Typography scale.
  - Spacing scale.
  - Breakpoints (mobile-first: 375px, 768px, 1024px, 1440px).

**Acceptance**:
- Navigation renders correctly per role.
- Mobile bottom nav works.
- Design tokens applied consistently.

---

### Sprint 1 Exit Criteria
- [ ] Next.js app deployed on Vercel with preview URLs.
- [ ] Supabase DB with all tables, constraints, indexes.
- [ ] RLS enabled on all sensitive tables with integration tests passing.
- [ ] Auth working (parent email OTP + student username/password).
- [ ] RBAC middleware blocking unauthorized API access.
- [ ] Seed data loaded (benchmark tests + sample questions + test users).
- [ ] Layout shell with role-based navigation.

---

## 6) Sprint 2 — Child Profiles + CMS v1 + Test Runner v1 + Observability

> **Goal**: Parents can manage children. Creators can author content. Students can take an MCQ test end-to-end.

### Stories

#### S2.1 — Observability (Sentry + structured logging)
**Effort**: 0.5 day

- Install `@sentry/nextjs`, configure DSN.
- Create structured logger (`lib/logging/logger.ts`) with correlation IDs.
- Add global error boundary.
- Redact sensitive fields in logs (emails, tokens).

---

#### S2.2 — Parent creates child profile
**Effort**: 1 day

- Parent dashboard page (`/parent`): list of children with progress cards.
- "Add child" flow:
  - Form: year level (2–8 dropdown), generate username suggestions (adjective + animal + 4 digits).
  - Set password for student.
  - Server action:
    1. Create Supabase Auth user with synthetic email (`student_{uuid}@mock-tests.internal`).
    2. Insert `student_profiles` row.
    3. Insert `parent_student_links` row.
    4. Insert `app_user_roles(STUDENT)`.
- Display child card with username + year level.
- **Reset student password** (parent-initiated):
  - "Reset password" button on each child card.
  - Parent enters new password → server action calls Supabase Admin API `admin.updateUserById()` with new password.
  - Requires RBAC: only the linked parent (or admin) can reset. Validate via `is_parent_of(student_id)` server-side.
  - Confirmation toast: "Password updated for {username}".

---

#### S2.3 — Student login + dashboard
**Effort**: 0.5 day

- Student login page: username + password → map to synthetic email → Supabase Auth.
- Student dashboard (`/student`): list assigned tests + past attempts.

---

#### S2.4 — Assign tests to student
**Effort**: 0.5 day

- Parent child detail page (`/parent/child/[id]`): show available tests (free + entitled).
- "Assign test" button → insert `assignments` row.
- Validation: enforce `(student_id, test_id)` uniqueness, validate year-level match.

---

#### S2.5 — CMS: Question editor
**Effort**: 1.5 days

- Creator dashboard (`/creator`): list own drafts.
- Question editor (`/creator/questions/new` + `/creator/questions/[id]`):
  - Question type selector (MCQ / Short Answer / Writing).
  - Stem editor (rich text or markdown — keep simple for MVP: textarea).
  - Passage text area (optional).
  - Image upload (Supabase Storage, private bucket, signed URLs).
  - MCQ: 4 options (A/B/C/D) + correct answer selector.
  - Short Answer: regex pattern + expected answer.
  - Writing: prompt only (no correct answer).
  - Explanation: text field + step-by-step JSON (for Numeracy).
  - Tags panel: year, subject, topic, skill, difficulty (1–4), reasoning type, exam type.
  - Validation: all tags required. MCQ must have options + correct answer.
  - Save as DRAFT.
- Use Zod schemas for validation.

---

#### S2.6 — CMS: Test builder
**Effort**: 1 day

- Test builder (`/creator/tests/new` + `/creator/tests/[id]`):
  - Title, exam type, year level range, time limit.
  - Section manager: add/remove/reorder sections with name + question count.
  - Question mapper: for each section, pick questions from the creator's published/draft pool. Filter by tags.
  - **Writing question limit**: enforce max **1 writing question per test**. Validation error if creator tries to add a second writing question. Some tests may have zero writing questions.
  - Save as DRAFT.

---

#### S2.7 — CMS: Approval workflow
**Effort**: 1 day

- Creator: "Submit for approval" button → status becomes `PENDING_APPROVAL`.
- Admin dashboard (`/admin`): queue of pending tests + questions.
- Admin review page (`/admin/review/[type]/[id]`):
  - Preview content.
  - Approve → status = `PUBLISHED`, set `approved_by`, `published_at`.
  - Reject → status back to `DRAFT` (or add a `REJECTED` intermediate — for MVP, back to DRAFT with a comment).
- Admin can also directly create + publish (bypass workflow for admin-authored content).

---

#### S2.8 — Test Runner v1 (MCQ only)
**Effort**: 2 days

- **Attempt lifecycle**:
  - Student clicks "Start test" → API checks for existing attempt on this `(student_id, test_id)` — if one exists, **block** with message: "You have already completed this test." (No re-attempts allowed.)
  - If no prior attempt, create `attempts` row (`IN_PROGRESS`).
  - Load test structure (sections, question count — NOT the questions themselves for adaptive).
  - Request first question from server (server-side question selection for now — non-adaptive in Sprint 2, adaptive in Sprint 3).

- **Runner UI** (`/student/test/[assignmentId]`):
  - Full-screen, distraction-free layout.
  - **Header**: test title, section name, timer (countdown), question X of Y.
  - **Question pane**: stem + options (radio buttons for MCQ).
  - **Reading passage pane**: collapsible split view for passage-based questions.
  - **Navigation**: prev/next buttons, question palette (grid showing answered/unanswered/flagged).
  - **Flag button**: toggle flag on current question.
  - **Timer**: countdown from `time_limit_mins`. Visual warning at 5 min and 1 min. Auto-submit on expiry.

- **Answer persistence**:
  - On answer selection, upsert `responses` row immediately (server call or batched).
  - Backup: Zustand store + `localStorage` for offline resilience.
  - On reconnect, sync any unsynced answers.

- **Review screen** (`/student/test/[assignmentId]/review`):
  - Grid of all questions: answered (green), unanswered (red), flagged (yellow).
  - Click to jump to any question.
  - "Submit test" button with confirmation modal.

- **Submit**:
  - Lock attempt: `status = SUBMITTED`, `submitted_at = now()`.
  - Mark MCQ answers (compare to `correct_answer`).
  - Calculate basic score (no adaptive weighting yet — that's Sprint 3).
  - Redirect to basic result page.

- **Mobile-first considerations**:
  - Touch-friendly option buttons (min 48px tap targets).
  - Swipe gestures for prev/next (optional enhancement).
  - Question palette as bottom sheet on mobile.
  - Passage pane as full-screen overlay on mobile.

---

### Sprint 2 Exit Criteria
- [ ] Parent can create child profiles (pseudonymous).
- [ ] Student can log in and see assigned tests.
- [ ] Parent can assign free tests to children.
- [ ] Creator can author MCQ questions + build tests.
- [ ] Admin can approve/reject/publish content.
- [ ] Student can take an MCQ test end-to-end (start → answer → review → submit).
- [ ] Timer, navigation, flagging work.
- [ ] Sentry capturing errors.

---

## 7) Sprint 3 — Adaptive Engine + Scoring + Reports

> **Goal**: Tests adapt difficulty per section. Scores computed out of 100. Parent gets an actionable premium report.

### Stories

#### S3.1 — Adaptive question selection (server-side, per section)
**Effort**: 2 days

- **Adaptive state model** (per section within an attempt):
  - Track rolling window of last 2 answers.
  - 2 correct → target difficulty +1 (max 4).
  - 2 incorrect → target difficulty −1 (min 1).
  - Otherwise → unchanged.
  - Initial difficulty: 2 (medium).

- **Server endpoint**: `POST /api/student/next-question`
  - Input: `attemptId`, `sectionName`, `currentQuestionId` (optional).
  - Logic:
    1. Get all responses so far for this attempt + section.
    2. Compute current target difficulty from rolling window.
    3. Query question pool: `test_questions` WHERE `test_id` AND `section_name` AND `base_difficulty = target` AND NOT already answered.
    4. If pool empty at target → fallback to nearest difficulty with availability.
    5. Return question (without correct answer — never send answer key to client).
    6. Log `difficulty_served` for analytics.

- **Runner integration**: replace "load all questions" with incremental "fetch next question" per section.

- **Section transitions**: when section complete (question count reached), prompt student to start next section.

---

#### S3.2 — Fallback rules
**Effort**: 0.5 day

- If no question at target difficulty:
  1. Try target ± 1.
  2. Try any remaining question in section.
  3. If section exhausted, mark section complete.
- Log fallback events with `{ attemptId, sectionName, targetDifficulty, actualDifficulty, reason }`.

---

#### S3.3 — MCQ + score computation (out of 100)
**Effort**: 1 day

- On submit, compute scores:
  - **Per section**: `(correct / total) × 100`.
  - **Overall**: weighted average of section scores (weights = question counts).
  - **No negative marking** (charter requirement).
- Store:
  - `attempts.score_out_of100` — overall.
  - `attempts.section_scores` — JSON: `{ "Numeracy": 85.0, "Reading": 72.5, ... }`.
  - `attempts.raw_accuracy` — raw correct/total.
  - `attempts.time_spent_seconds` — total elapsed.
- Compute `responses.is_correct` for each MCQ response.

---

#### S3.4 — Parent premium report
**Effort**: 2 days

- **Report page** (`/parent/report/[attemptId]`):
  - **Summary card**: overall score (big number), time used vs. time limit, attempt date.
  - **Section breakdown**: horizontal bar chart per section (score out of 100).
  - **Time analysis**: average time per question per section. Flag slow sections.
  - **Weak areas**: group questions by tag (topic, skill). Identify bottom 2–3 tags.
  - **Next steps**: auto-generated recommendations based on weak tags ("Focus on fractions", "Practice reading comprehension").

- **Full question review** (sub-page or expandable):
  - For each question:
    - Question stem + passage (if any).
    - Student's answer (highlighted red if wrong, green if correct).
    - Correct answer (always shown).
    - Explanation:
      - Numeracy: render `explanation_steps` as numbered list.
      - Others: render `explanation` as text.
    - Difficulty served + time spent.
  - Navigation: prev/next through questions, or jump via section tabs.

- **RLS enforcement**: parent can only view reports for linked students.

---

#### S3.5 — Student report (simplified)
**Effort**: 0.5 day

- **Student report** (`/student/report/[attemptId]`):
  - Overall score + section breakdown.
  - Question review with correct/incorrect markers.
  - No "weak areas" or "next steps" (parent-only feature).

---

### Sprint 3 Exit Criteria
- [ ] Adaptive question selection works per section (difficulty 1–4).
- [ ] Fallback rules handle thin pools gracefully.
- [ ] Scores computed out of 100 (overall + per section).
- [ ] Parent premium report with section breakdown, weak areas, question review.
- [ ] Student simplified report works.
- [ ] Explanations render correctly (step-by-step for Numeracy, text for others).

---

## 8) Sprint 4 — Payments + Short Answer + Writing Async

> **Goal**: Parents can purchase test bundles. Short answers marked via regex. Writing evaluated async via DeepSeek + QStash.

### Stories

#### S4.1 — Product catalog + shop page
**Effort**: 1 day

- **Shop page** (`/shop`): grid of products with prices, included test count, "Add to cart" button.
- Read `products` + `product_tests` to display what's included.
- Cart: Zustand store (client-side, ephemeral). Show cart in header badge.
- Logged-in only (redirect to auth if anonymous).

---

#### S4.2 — Stripe checkout session
**Effort**: 1 day

- **API**: `POST /api/payments/create-checkout` → creates Stripe Checkout Session.
  - Input: `productId` (or array for multi-product).
  - Server: verify user is authenticated. Look up product `stripe_price_id`. Create session.
  - Return: `sessionUrl`.
- **Client**: redirect to Stripe Checkout.
- **Success page** (`/checkout/success`): "Payment processing. You'll be notified when your tests are ready."
- **Cancel page** (`/checkout/cancel`): "Payment cancelled. Return to shop."

---

#### S4.3 — Stripe webhook + idempotent entitlement grant
**Effort**: 1.5 days

- **Webhook endpoint**: `POST /api/webhooks/stripe`.
  - Parse raw body (do NOT JSON-parse before Stripe signature verification).
  - Verify signature with `STRIPE_WEBHOOK_SECRET`.
  - Check idempotency: `processed_webhook_events` by `event.id`.
  - On `checkout.session.completed`:
    1. Create/update `purchases` row (status = `SUCCEEDED`).
    2. Insert `purchase_items` rows.
    3. Look up `product_tests` for purchased product(s).
    4. Insert `entitlements` for each test (upsert — ignore if already exists).
  - Return 200 quickly (Stripe expects fast response).
- **Test**: replay same webhook event → no duplicate entitlements.
- **Security**: endpoint uses service-role Supabase client (no RLS). No auth middleware (webhook has its own signature auth).

---

#### S4.4 — Server-side + UI gating for paid content
**Effort**: 0.5 day

- Verify RLS blocks paid tests for non-entitled users.
- Shop page: show "Purchased" badge on owned tests.
- Test list: show lock icon + "Buy" CTA for paid tests.
- API: return 404 (not 403) for non-entitled test details (avoid leaking existence to users who shouldn't see them).

---

#### S4.5 — Short answer regex marking
**Effort**: 1 day

- On submit, for SHORT_ANSWER questions:
  - Normalize student answer: trim, collapse whitespace, lowercase.
  - Load `questions.correct_answer` JSON: `{ "pattern": "regex here", "flags": "i" }`.
  - Match normalized answer against regex.
  - Set `responses.is_correct`.
- **CMS update**: short answer editor validates regex pattern on save.
- **Security**: regex patterns are stored server-side and never sent to client. Run regex matching server-side with timeout protection (prevent ReDoS).

---

#### S4.6 — Writing async pipeline (QStash + DeepSeek)
**Effort**: 2 days

> **Key constraint (PM confirmed)**: Max 1 writing question per test → exactly **1 QStash job per attempt** (not per question). Tests with no writing questions skip this pipeline entirely.

- **On submit** (when test contains a writing question):
  - Set `attempts.status = WRITING_PENDING`.
  - Identify the single writing response for this attempt.
  - Publish QStash job:
    ```json
    {
      "attemptId": "...",
      "questionId": "...",
      "writingText": "student's writing",
      "questionPrompt": "the original writing prompt",
      "rubricVersion": "v1.0"
    }
    ```
  - If test has **no** writing questions → set `attempts.status = COMPLETE` immediately. No QStash job.

- **Job handler**: `POST /api/jobs/writing-eval`:
  1. Verify QStash signature (`QSTASH_CURRENT_SIGNING_KEY`).
  2. Check idempotency: `processed_jobs` by `job_id` (from QStash header).
  3. Build DeepSeek prompt using the full rubric from `DeepSeek Writing Prompt.txt` + student text.
  4. Call DeepSeek API.
  5. Parse structured response — the rubric produces:
     - **Overall score** (X/100).
     - **Category scores**: Language Mechanics (/20: Grammar /10, Spelling /5, Punctuation /5), Vocabulary (/15: Effective word choices /10, Difficult words /5), Cohesion & Structure (/20: Cohesiveness /10, Structure /10), Content & Ideas (/25: Relevance /10, Depth /10, Evidence /5), Engagement & Style (/20: Engagement /5, Tone /5, Language features /10).
     - **Text type detection**: Narrative vs. Persuasive.
     - **Narrative analysis** (if applicable): device type (Chronological, Reverse Chronological, Real Time, Breaking Fourth Wall, Epistolic/Diary, Story Within Story, Stream of Consciousness) + techniques used (Foreshadowing, Cliffhanger, Flashback, Metaphor, Sensory Detail, etc.).
     - **Persuasive analysis** (if applicable): A FOREST devices + rhetorical techniques (Emotive Language, Inclusive Language, Anecdotes, etc.) + strategic techniques (Ethos/Pathos/Logos, Call to Action, etc.).
     - **Strengths**: bullet points.
     - **Areas for Improvement**: bullet points with score impact + rewritten sentences.
     - **Polished Rewritten Text**: improved version preserving original idea.
     - **Targeted Practice Exercise**: tailored drill based on student's errors.
  6. Store in `writing_evaluations` row:
     - `score_out_of100` → overall score.
     - `strengths` (JSONB) → strengths bullet points.
     - `improvements` (JSONB) → areas for improvement + category scores + technique analysis.
     - `improved_text` (text) → polished rewrite.
     - `raw_response` (JSONB) → full DeepSeek response for audit/debugging.
  7. Update `attempts.status = COMPLETE`.
  8. Record in `processed_jobs`.
  9. Create notification for parent: "Writing report ready" with link.

- **Writing report UI** (rendered within Parent/Student report pages):
  - Overall writing score with category breakdown (radar chart or segmented bar).
  - Text type badge: "Narrative" or "Persuasive".
  - Techniques/devices detected (collapsible list).
  - Strengths and improvement areas.
  - Side-by-side: student's original text vs. polished rewrite.
  - Targeted practice exercise section.

- **UI**: "Writing pending" badge on attempt. Notification bell updates.

---

#### S4.7 — Notifications system
**Effort**: 0.5 day

- **Notifications page** (`/notifications`): list of notifications, mark as read.
- **Header badge**: count of unread notifications.
- **Polling**: TanStack Query refetch every 30 seconds (no WebSocket for MVP).
- **Notification types**: `WRITING_READY`, `TEST_ASSIGNED` (future).

---

### Sprint 4 Exit Criteria
- [ ] Parent can purchase test bundles via Stripe.
- [ ] Webhook creates entitlements idempotently.
- [ ] Paid tests become accessible after purchase.
- [ ] Short answer marking works with regex normalization.
- [ ] Writing async pipeline: submit → QStash → DeepSeek → result + notification.
- [ ] In-app notifications working.

---

## 9) Sprint 5 — UI Polish + Analytics + Percentiles

> **Goal**: Premium, pixel-perfect UI. Analytics rollups for trend charts. Percentiles behind feature flag.

### Stories

#### S5.1 — Design tokens + component polish
**Effort**: 2 days

- Finalize color palette:
  - Primary: deep navy (`#1a1f36`).
  - Accent: teal (`#0d9488`).
  - Background: warm white (`#fafaf9`).
  - Error: `#dc2626`, Success: `#16a34a`, Warning: `#f59e0b`.
- Typography: Inter or similar clean sans-serif.
- Review all screens against mobile breakpoints (375px, 390px, 412px, 768px).
- Polish:
  - Loading skeletons (not spinners).
  - Empty states with illustrations/CTAs.
  - Error states with retry buttons.
  - Success animations (subtle).
  - Transitions between pages (no janky layout shifts).
- Test runner polish:
  - Larger touch targets.
  - Better timer visibility (color changes near end).
  - Smooth question transitions.
  - Report charts (consider Recharts or Chart.js for section breakdown).

---

#### S5.2 — Accessibility pass
**Effort**: 1 day

- Focus management: logical tab order, visible focus rings.
- ARIA labels on interactive elements (timer, flag button, nav).
- Color contrast: WCAG AA compliance.
- Screen reader: question content, timer announcements (aria-live).
- Keyboard: navigate questions, select options, submit — all via keyboard.

---

#### S5.3 — Analytics rollups
**Effort**: 1.5 days

- On attempt completion, compute and store:
  - Time per question (already in `responses.time_spent_seconds`).
  - Accuracy by tag: group responses by `questions.tags` → compute accuracy per topic/skill.
  - Store in `attempts.section_scores` (expand JSON) or dedicated fields.
- **Parent dashboard trends**:
  - Line chart: score over time per exam type.
  - Stacked bar: section scores across attempts.
  - Table: weak tags across last N attempts.

---

#### S5.4 — Percentiles (feature-flagged)
**Effort**: 1 day

- `FF_PERCENTILES_ENABLED = false` by default.
- Cohort: `(year_level, exam_type)`.
- Threshold: ≥200 `COMPLETE` attempts in cohort.
- Logic:
  1. Count attempts in cohort.
  2. If ≥ threshold, compute percentile rank for the student's score.
  3. Display on report: "Your score is higher than X% of students in Year 5 NAPLAN-style tests."
- Behind feature flag — hidden in UI and API until threshold met.

---

#### S5.5 — Parent dashboard enhancements
**Effort**: 0.5 day

- Child cards: show last test score, trend arrow (up/down/flat).
- Quick-assign CTA.
- Recent activity feed.

---

### Sprint 5 Exit Criteria
- [ ] All screens pixel-perfect across mobile breakpoints.
- [ ] Accessibility baseline met (keyboard, contrast, ARIA).
- [ ] Analytics trends populate parent dashboard.
- [ ] Percentiles implemented but hidden behind feature flag.

---

## 10) Sprint 6 — Security Verification + QA + Launch

> **Goal**: ASVS L2 evidence. Comprehensive QA. Production deploy.

### Stories

#### S6.1 — ASVS L2 evidence pack
**Effort**: 2 days

- Create checklist in `docs/security/asvs-l2-evidence.md` covering:
  - **V2 (Authentication)**: Supabase Auth config, OTP flow, session management.
  - **V4 (Access Control)**: RLS policies listing, RBAC middleware, deny-by-default evidence.
  - **V5 (Validation)**: Zod schemas, input sanitization, regex timeout protection.
  - **V7 (Error Handling & Logging)**: Sentry config, structured logs, sensitive field redaction.
  - **V8 (Data Protection)**: no PII stored, encrypted connections (TLS), service-role key handling.
  - **V9 (Communication)**: HTTPS everywhere (Vercel), Stripe webhook TLS.
  - **V13 (API)**: rate limiting, CORS, content-type validation.
- Capture evidence: screenshots, test output, policy SQL.

---

#### S6.2 — Broken access control regression tests
**Effort**: 1.5 days

- Write Playwright E2E tests for:
  - Role escalation: student tries to access `/admin/*` → blocked.
  - IDOR: parent tries to view another parent's child report → blocked.
  - Entitlement bypass: user tries to read paid test without purchase → blocked.
  - Creator tries to approve own content → blocked.
  - Unauthenticated access to protected pages → redirected to login.
- Write Vitest integration tests for:
  - RLS: verify row visibility for each role combination.
  - API: verify 401/403 responses for unauthorized requests.
- Run all in CI.

---

#### S6.3 — Rate limiting
**Effort**: 0.5 day

- Add `@upstash/ratelimit` to:
  - `/auth/*` endpoints: 5 attempts per minute per IP.
  - `/api/payments/*`: 10 per minute per user.
  - `/api/student/submit`: 5 per minute per user.
  - `/api/admin/*`: 30 per minute per user.
  - `/api/webhooks/*`: 100 per minute per IP (Stripe retries).
- Return `429 Too Many Requests` with `Retry-After` header.

---

#### S6.4 — Full regression QA
**Effort**: 2 days

- Manual + automated test of all critical paths:
  1. Parent signup → add child → assign free test.
  2. Student login → take test (adaptive) → submit → view report.
  3. Parent view premium report + question review.
  4. Parent purchase paid test → entitlement created → assign → student takes test.
  5. Writing submission → QStash → DeepSeek → notification → report.
  6. Creator: draft question → draft test → submit for approval.
  7. Admin: approve → publish → test appears in catalog.
  8. Admin: reject → content goes back to draft.
  9. Security: each IDOR/escalation test passing.
- Fix all P0 bugs.

---

#### S6.5 — Operational readiness
**Effort**: 0.5 day

- Verify Supabase backups enabled (prod).
- Document rollback procedure (Vercel instant rollback).
- Verify monitoring alerts (Sentry, Vercel).
- Create production environment variables on Vercel.
- DNS + custom domain (if ready).

---

#### S6.6 — Production deploy
**Effort**: 0.5 day

- Freeze release candidate on `main`.
- Deploy to production.
- Smoke test all critical paths on production.
- Monitor for 24 hours.

---

### Sprint 6 Exit Criteria
- [ ] ASVS L2 evidence pack complete.
- [ ] Broken access control regression tests in CI.
- [ ] Rate limiting active on all sensitive endpoints.
- [ ] Full regression passed with no P0 bugs.
- [ ] Production deployed and monitored.

---

## 11) Project Directory Structure

```
mock-tests/
├── .github/
│   └── workflows/          # CI config (if not using Vercel-only)
├── public/
│   └── images/             # Static assets
├── src/
│   ├── app/
│   │   ├── (public)/
│   │   │   ├── page.tsx                  # Landing page
│   │   │   └── pricing/page.tsx          # Pricing preview
│   │   ├── auth/
│   │   │   ├── login/page.tsx
│   │   │   ├── signup/page.tsx
│   │   │   └── student-login/page.tsx
│   │   ├── parent/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx                  # Parent dashboard
│   │   │   ├── child/[id]/page.tsx       # Child detail
│   │   │   └── report/[attemptId]/page.tsx
│   │   ├── student/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx                  # Student home
│   │   │   ├── test/[assignmentId]/
│   │   │   │   ├── page.tsx              # Test runner
│   │   │   │   └── review/page.tsx       # Review before submit
│   │   │   └── report/[attemptId]/page.tsx
│   │   ├── creator/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx                  # Creator dashboard
│   │   │   ├── questions/[id]/page.tsx   # Question editor
│   │   │   └── tests/[id]/page.tsx       # Test builder
│   │   ├── admin/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx                  # Admin dashboard (queues)
│   │   │   ├── review/[type]/[id]/page.tsx
│   │   │   └── catalog/page.tsx
│   │   ├── shop/page.tsx
│   │   ├── checkout/
│   │   │   ├── page.tsx
│   │   │   ├── success/page.tsx
│   │   │   └── cancel/page.tsx
│   │   ├── notifications/page.tsx
│   │   ├── api/
│   │   │   ├── admin/                    # Admin-only endpoints (RBAC)
│   │   │   ├── webhooks/
│   │   │   │   └── stripe/route.ts       # Raw body, signature verified
│   │   │   ├── jobs/
│   │   │   │   └── writing-eval/route.ts # QStash verified
│   │   │   ├── payments/
│   │   │   │   └── create-checkout/route.ts
│   │   │   └── student/
│   │   │       ├── next-question/route.ts
│   │   │       └── submit/route.ts
│   │   ├── layout.tsx                    # Root layout (providers)
│   │   └── middleware.ts                 # Auth session refresh
│   ├── components/
│   │   ├── ui/                           # shadcn/ui primitives
│   │   └── layout/
│   │       ├── AppShell.tsx
│   │       ├── Header.tsx
│   │       ├── MobileNav.tsx
│   │       └── RoleGuard.tsx
│   ├── features/
│   │   ├── auth/
│   │   │   ├── components/
│   │   │   └── hooks/
│   │   ├── catalog/
│   │   │   ├── components/
│   │   │   └── hooks/
│   │   ├── runner/
│   │   │   ├── components/
│   │   │   │   ├── QuestionCard.tsx
│   │   │   │   ├── QuestionPalette.tsx
│   │   │   │   ├── Timer.tsx
│   │   │   │   ├── PassagePane.tsx
│   │   │   │   └── ReviewGrid.tsx
│   │   │   ├── hooks/
│   │   │   │   └── useRunnerStore.ts     # Zustand store
│   │   │   └── lib/
│   │   │       └── adaptive.ts           # Adaptive engine logic
│   │   ├── reporting/
│   │   │   ├── components/
│   │   │   │   ├── ScoreSummary.tsx
│   │   │   │   ├── SectionBreakdown.tsx
│   │   │   │   ├── WeakAreas.tsx
│   │   │   │   └── QuestionReview.tsx
│   │   │   └── hooks/
│   │   ├── cms/
│   │   │   ├── components/
│   │   │   └── hooks/
│   │   ├── payments/
│   │   │   ├── components/
│   │   │   └── hooks/
│   │   └── notifications/
│   │       ├── components/
│   │       └── hooks/
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts                 # Browser Supabase client
│   │   │   ├── server.ts                 # Server component client
│   │   │   └── admin.ts                  # Service-role client (server-only)
│   │   ├── rbac/
│   │   │   └── guards.ts                 # requireRole(), requireAuth()
│   │   ├── stripe/
│   │   │   ├── checkout.ts               # Create checkout session
│   │   │   └── webhook.ts                # Verify + process webhook
│   │   ├── qstash/
│   │   │   ├── publish.ts                # Publish job
│   │   │   └── verify.ts                 # Verify signature
│   │   ├── logging/
│   │   │   ├── logger.ts                 # Structured logger
│   │   │   └── correlation.ts            # Correlation ID utility
│   │   └── utils/
│   │       ├── api-response.ts           # Consistent error shape
│   │       ├── username-generator.ts     # Pseudonymous username
│   │       └── regex-safe.ts             # Timeout-protected regex eval
│   ├── types/
│   │   ├── database.ts                   # Generated Supabase types
│   │   ├── api.ts                        # API request/response types
│   │   └── index.ts                      # Shared domain types
│   ├── styles/
│   │   └── globals.css                   # Tailwind + custom tokens
│   └── config/
│       ├── constants.ts                  # App-wide constants
│       └── feature-flags.ts              # FF_PERCENTILES, etc.
│
├── supabase/
│   ├── migrations/
│   │   ├── 001_initial_schema.sql        # Enums + tables + constraints
│   │   ├── 002_indexes.sql               # Performance indexes
│   │   ├── 003_rls_functions.sql         # Helper functions
│   │   ├── 004_rls_policies.sql          # All RLS policies
│   │   └── 005_triggers.sql              # updated_at triggers
│   ├── seed/
│   │   └── seed.sql                      # Test users + benchmark tests + questions
│   └── config.toml
│
├── tests/
│   ├── unit/                             # Vitest unit tests
│   ├── integration/                      # Vitest + Supabase local
│   │   └── rls/                          # RLS policy tests
│   └── e2e/                              # Playwright E2E tests
│       ├── auth.spec.ts
│       ├── runner.spec.ts
│       ├── reports.spec.ts
│       ├── payments.spec.ts
│       └── access-control.spec.ts
│
├── docs/
│   ├── security/
│   │   └── asvs-l2-evidence.md
│   └── architecture/
│       └── decisions.md                  # ADRs
│
├── .env.example
├── .env.local                            # Local dev (gitignored)
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── vitest.config.ts
├── playwright.config.ts
├── package.json
└── README.md
```

---

## 12) Database Migration Strategy

### Approach
- **Single migration per logical change** — not one file per table.
- Migrations are idempotent where possible.
- Use `supabase migration new <name>` to create timestamped files.
- Apply with `supabase db reset` (dev) or `supabase migration up` (staging/prod).

### Initial migrations (Sprint 1)

| Order | File | Contents |
|-------|------|----------|
| 001 | `initial_schema.sql` | Enums, all 18 tables, PKs, FKs, constraints, checks |
| 002 | `indexes.sql` | All performance indexes |
| 003 | `rls_functions.sql` | `has_role`, `is_parent_of`, `is_student_self`, `is_attempt_owner`, `has_entitlement`, `can_access_published_test` |
| 004 | `rls_policies.sql` | Enable RLS + all policies per table |
| 005 | `triggers.sql` | `updated_at` auto-update trigger |

### Schema changes (Sprint 1 fixes)

These changes will be incorporated into the initial migration (since we're greenfield):

1. Add `purchase_items` table (purchase → product mapping).
2. Add unique constraint on `assignments(student_id, test_id)`.
3. Add unique constraint on `attempts(student_id, test_id)` — enforces no re-attempts.
4. Make `responses.answer` nullable.

---

## 13) Seed Data Strategy

### Test users (created via Supabase Auth + seed SQL)

| User | Email | Role | Purpose |
|------|-------|------|---------|
| Admin | `admin@mock-tests.dev` | ADMIN | Approve content, manage catalog |
| Creator | `creator@mock-tests.dev` | TEST_CREATOR | Author questions/tests |
| Parent | `parent@mock-tests.dev` | PARENT | Manage children, view reports |
| Student | `student_{uuid}@mock-tests.internal` | STUDENT | Take tests |

### Seed content

- **7 Benchmark tests** (Year 2–8), each PUBLISHED + `is_free = true`.
- **5 sections per test**: Numeracy, Reading, Spelling & Grammar, Verbal Reasoning, Numerical Reasoning.
- **~100 placeholder MCQ questions** distributed across sections and difficulty levels (1–4).
- **1 paid test** (PUBLISHED, `is_free = false`) + 1 product + product_tests mapping.
- All question content is placeholder ("What is 2+2?" style) — to be replaced with real content via CMS.

### Seed execution
```bash
supabase db reset   # applies migrations + runs seed.sql
```

---

## 14) Security Checklist (Running)

> Updated per sprint. Items checked off as implemented and verified.

### Authentication (V2)
- [ ] Supabase Auth with email OTP (no password spray risk).
- [ ] Student synthetic email pattern — not guessable.
- [ ] Session cookie httpOnly, secure, sameSite.
- [ ] Auth middleware refreshes session on every request.

### Access Control (V4)
- [ ] Deny-by-default: no API route accessible without explicit guard.
- [ ] RLS enabled on all 12+ sensitive tables.
- [ ] Admin-only endpoints behind `requireRole(['ADMIN'])`.
- [ ] Service-role key used ONLY in webhooks/jobs/admin endpoints.
- [ ] Content gating: anonymous → 0 tests; free → free tests; paid → entitled tests.
- [ ] No IDOR: parent sees only linked children; student sees only own data.

### Input Validation (V5)
- [ ] Zod schemas on all API inputs.
- [ ] Regex evaluation with timeout protection (prevent ReDoS).
- [ ] No SQL injection (Supabase client uses parameterized queries).
- [ ] XSS prevention: React auto-escapes; no `dangerouslySetInnerHTML`.

### Cryptography (V6)
- [ ] All connections TLS (Vercel enforces HTTPS).
- [ ] Stripe webhook signature verification with raw body.
- [ ] QStash signature verification.
- [ ] No secrets in client bundle.

### Error Handling & Logging (V7)
- [ ] Consistent error response: `{ error: { code, message, correlationId } }`.
- [ ] Sensitive fields redacted in logs.
- [ ] Sentry captures errors with source maps.

### Data Protection (V8)
- [ ] No student PII (name, DOB, school) in database.
- [ ] Pseudonymous usernames only.
- [ ] Supabase service-role key in server env only.

### API Security (V13)
- [ ] Rate limiting on auth, payments, submit, admin endpoints.
- [ ] CORS restricted to app domain.
- [ ] Content-type validation on API routes.

### Payments
- [ ] Stripe webhook raw body for signature verification.
- [ ] Idempotent entitlement grants (processed_webhook_events).
- [ ] No client-side price trust (price resolved server-side from Stripe).

---

## 15) Definition of Done (Global)

Every story is "done" only when:

1. **Code complete**: implementation matches acceptance criteria.
2. **Type-safe**: `npm run typecheck` passes with no errors.
3. **Linted**: `npm run lint` passes.
4. **Tested**: relevant unit/integration tests added and passing.
5. **RLS considered**: if the story touches data access, RLS implications verified.
6. **RBAC considered**: if the story adds an API endpoint, role guard applied.
7. **Mobile-first**: UI verified at 375px minimum.
8. **Error states**: loading, error, empty states handled.
9. **Deployed to staging**: Vercel preview/staging build passes.

---

## Appendix A: PM Answers (Resolved)

| # | Question | PM Answer | Impact on Plan |
|---|----------|-----------|----------------|
| 1 | Multi-role users? | **No** — each role is unique. PARENT cannot be TEST_CREATOR. | `app_user_roles` 1:1 design is final. No future migration needed. |
| 2 | Parent can reset student password? | **Yes**. | Added to S2.2: parent dashboard "Reset password" action via Supabase Admin API. |
| 3 | Can students re-take the same test? | **No**. | Added `attempts(student_id, test_id)` unique constraint. Runner blocks re-attempts with clear message. |
| 4 | Writing questions per test? | **Max 1** (some tests may have 0). | Simplifies QStash pipeline to 1 job per attempt. CMS test builder enforces limit. Tests with 0 writing questions skip `WRITING_PENDING` state. |
| 5 | Rubric/prompt for DeepSeek? | **Provided** — full rubric in `DeepSeek Writing Prompt.txt`. | Integrated into S4.6: 5 scoring categories, narrative/persuasive technique detection, polished rewrite, targeted practice exercises. |
| 6 | Design mockups? | **None** — define design system from scratch using design tokens. | Already planned in S1.7 + S5.1. No Figma dependency. |
| 7 | Custom domain? | **TBD** — PM will provide later. | **Open item.** Needed before production: Supabase Auth redirect URLs, Stripe webhook URL, DNS. |

---

## Appendix B: Remaining Open Questions

1. **Custom domain**: What is the production domain? Needed for Supabase Auth redirect URLs, Stripe webhook URL configuration, and DNS setup. Required before Sprint 6 production deploy.

---

## Appendix C: Reference Documents

| Document | Purpose |
|----------|---------|
| `01-mock-tests-project-charter.md` | Scope, personas, MVP definition, tech standards |
| `02-mock-tests-rls-and-seed-plan.md` | RLS policy catalogue, helper function semantics, seed plan |
| `03-mock-tests-sprint-plan.md` | Original PM sprint plan (6 sprints, team-sized) |
| `04-mock-tests-db-schema.md` | Complete DB schema: tables, FKs, constraints, indexes |
| `05-mock-tests-env-vars.md` | All environment variables with scope annotations |
| `06-env.example` | `.env` template for local development |
| `DeepSeek Writing Prompt.txt` | Full DeepSeek evaluation rubric + output format for writing marking |

---

> **Next step**: Begin Sprint 1, Story S1.1 — Project scaffold + Vercel CI/CD.
---

## Appendix — Writing Assessment (DeepSeek Flash): implementation status

Delivered 2026-11 as an extension of the Sprint-9 writing pipeline. The marking
core (`src/lib/writing/prompt.ts`, `grade-writing.ts`, QStash job + cron sweeper)
now feeds a full report suite.

### Marking
- Model default `deepseek-flash` (API id for "DeepSeek-V4.1-Flash-1017"),
  overridable via `DEEPSEEK_MODEL`.
- Rubric `v1.1` — adds a year-scaled length expectation; weights unchanged.
- `callDeepseekForText` extracted (shared by attempt + practice grading);
  `gradePracticeSession` added (idempotent, clamped, traceable).
- First-class `writing_evaluations` columns written on grade (096/100).

### Content
- `src/lib/writing/prompts-catalog.ts` — 13 typed prompt seeds (source of truth
  for the AI Practice Lab); `word-limits.ts` — year-band word/time scaffolding
  (2–4: 150/20 · 5–6: 250/30 · 7–8: 400/40).

### Reports (parent/tutor only — see 015 student-blindness rule)
- **A. Enhanced per-attempt report** — `WritingReportPanel`: band, category
  breakdown bars, technique badges, strengths, improvements with
  `estimated_score_gain` + grammar rewrites, side-by-side "High Distinction"
  rewrite, targeted practice exercise, `ParentActionSummary`.
- **B. Writing progress** — `/parent/child/[id]/writing`: `WritingProgressChart`
  (hand-rolled SVG) + recent-results table linking to per-attempt and
  per-practice detail.
- **C. AI Practice details** — `/parent/child/[id]/writing/[sessionId]`.

### AI Practice Lab
- `/student/ai-practice` (replaces the stub): prompt picker, textarea with
  word/time hint, submit → `writing_practice_sessions` (PENDING) → QStash job
  `/api/jobs/writing-practice` (sweeper as fallback). Student sees only a
  qualitative acknowledgment; the parent sees the graded detail.

### Gating
- Free tier: score, band, strengths, first two improvements.
- Premium (active subscription via `my_access.is_unlimited`): category breakdown,
  techniques, full improvements, rewrite, practice exercise, parent actions.
  Locked content renders inline as a `LockedInsightCard` (same funnel tracking
  as the readiness report).

### Runner
- Soft word-count warning for WRITING items using the year-band minimum.

### Validation
`tsc --noEmit` ✓ · `lint-ratchet` no regression ✓ · `next build` ✓ ·
`npm run test:writing` (42 assertions) ✓. A live mark still requires
`DEEPSEEK_API_KEY` set in the environment.
