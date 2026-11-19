# Mock Tests Platform — Database Schema (Supabase Postgres)

> **Purpose**: This document describes the complete logical database schema for the mock tests web app (Year 2–8), including **tables**, **primary keys**, **foreign keys (dependencies)**, **constraints**, **indexes**, and **security notes (RLS + server-side RBAC)**.
>
> **Identity**: All human/system actors are represented as **Supabase Auth users** in `auth.users`.
>
> **Access model**: 
> - **Row Level Security (RLS)** is enabled on sensitive tables and enforced using the caller’s Supabase JWT.
> - **Server-side RBAC** is enforced in Next.js API routes, especially for privileged endpoints that use the **service-role** key (which bypasses RLS).
>
> **Content visibility rule (final)**:
> - **Anonymous users**: cannot read published tests/questions.
> - **Logged-in users**: can read published tests/questions **only if** the test is **free** (`tests.is_free = true`) **or** the user has an **active entitlement** for the test.
> - **Admin**: can read **all drafts** via RLS (and also via service-role + RBAC).

---

## 1) High-level entity relationship overview

### 1.1 External dependency
- `auth.users` (**Supabase Auth**) — identity store for all personas (Parent, Student, Tutor, Test Creator, Admin).

### 1.2 Core relationships (text ERD)

```
auth.users (1) ── (1) app_user_roles

PARENT auth.users (1) ── (N) parent_student_links ── (N) ── (1) student_profiles ── (1) ── (1) auth.users (STUDENT)

tests (1) ── (N) test_sections

tests (1) ── (N) test_questions ── (N) ── (1) questions

student_profiles (1) ── (N) assignments ── (1) tests

student_profiles (1) ── (N) attempts ── (1) tests
attempts (1) ── (N) responses ── (1) questions
attempts (1) ── (0..1) writing_evaluations

auth.users (1) ── (N) notifications

products (1) ── (N) product_tests ── (N) ── (1) tests
auth.users (1) ── (N) purchases (1) ── (N) entitlements (N) ── (1) tests

processed_webhook_events (Stripe idempotency)
processed_jobs (QStash idempotency)
```

---

## 2) Enumerations (Postgres enum types)

### `public.user_role`
- `PARENT`
- `TUTOR`
- `STUDENT`
- `TEST_CREATOR`
- `ADMIN`

### `public.exam_type`
- `BENCHMARK`
- `NAPLAN_STYLE`
- `OLYMPIAD`
- `SELECTIVE`

### `public.content_status`
- `DRAFT`
- `PENDING_APPROVAL`
- `PUBLISHED`
- `ARCHIVED`

### `public.question_type`
- `MCQ`
- `SHORT_ANSWER`
- `WRITING`

### `public.attempt_status`
- `IN_PROGRESS`
- `SUBMITTED`
- `WRITING_PENDING`
- `COMPLETE`

---

## 3) Tables (complete schema)

> **Notation**
> - **PK** = Primary Key
> - **FK** = Foreign Key
> - **UQ** = Unique constraint
> - **CK** = Check constraint
> - **IDX** = Index

### 3.1 `public.app_user_roles`
**Purpose**: Stores application role for each Supabase Auth user.

- **PK**: `user_id` (uuid)
- **FK**: `user_id → auth.users(id)` (ON DELETE CASCADE)
- **Columns**
  - `user_id` (uuid, PK) — Supabase Auth user id
  - `role` (user_role, NOT NULL) — app role
  - `created_at` (timestamptz, NOT NULL, default `now()`)
- **Dependencies**: depends on `auth.users`
- **Notes**
  - Used by both **RLS helper function** `has_role()` and server-side RBAC.

---

### 3.2 `public.student_profiles`
**Purpose**: Privacy-first student profile with pseudonymous username. Links to an Auth user for the student.

- **PK**: `id` (uuid)
- **FK**: `auth_user_id → auth.users(id)` (ON DELETE CASCADE)
- **UQ**:
  - `auth_user_id` unique (1-to-1 mapping of auth user to student profile)
  - `username` unique
- **CK**:
  - `year_level between 2 and 9`
- **Columns**
  - `id` (uuid, PK, default `gen_random_uuid()`)
  - `auth_user_id` (uuid, NOT NULL, unique)
  - `year_level` (int, NOT NULL)
  - `username` (text, NOT NULL, unique) — system-generated (e.g., flower+fruit+digits)
  - `created_at` (timestamptz, default `now()`)
  - `updated_at` (timestamptz, default `now()`)
- **Dependencies**: depends on `auth.users`

---

### 3.3 `public.parent_student_links`
**Purpose**: Links a parent (auth user) to one or more student profiles.

- **PK**: `id` (uuid)
- **FKs**:
  - `parent_user_id → auth.users(id)` (ON DELETE CASCADE)
  - `student_id → student_profiles(id)` (ON DELETE CASCADE)
- **UQ**: `(parent_user_id, student_id)` unique
- **Columns**
  - `id` (uuid, PK, default `gen_random_uuid()`)
  - `parent_user_id` (uuid, NOT NULL)
  - `student_id` (uuid, NOT NULL)
  - `created_at` (timestamptz, default `now()`)
- **Dependencies**: depends on `auth.users`, `student_profiles`
- **IDX**:
  - `idx_parent_student_links_parent (parent_user_id)`
  - `idx_parent_student_links_student (student_id)`

---

### 3.4 `public.tests`
**Purpose**: Defines a test (benchmark, NAPLAN-style, Olympiad, Selective). Supports free/paid gating.

- **PK**: `id` (uuid)
- **FKs**:
  - `created_by → auth.users(id)` (ON DELETE RESTRICT)
  - `approved_by → auth.users(id)` (ON DELETE SET NULL)
- **Columns**
  - `id` (uuid, PK)
  - `title` (text, NOT NULL)
  - `exam_type` (exam_type, NOT NULL)
  - `year_level_min` (int, NOT NULL)
  - `year_level_max` (int, NOT NULL)
  - `time_limit_mins` (int, NOT NULL)
  - `is_free` (boolean, NOT NULL, default false) — **free vs paid gating**
  - `status` (content_status, NOT NULL, default `DRAFT`)
  - `created_by` (uuid, NOT NULL)
  - `approved_by` (uuid, NULL)
  - `published_at` (timestamptz, NULL)
  - `created_at` (timestamptz, default `now()`)
  - `updated_at` (timestamptz, default `now()`)
- **CK**:
  - `time_limit_mins > 0`
- **Dependencies**: depends on `auth.users`
- **IDX**:
  - `idx_tests_status_exam (status, exam_type)`
- **Comments**
  - Published visibility is controlled by RLS function `can_access_published_test()`.

---

### 3.5 `public.test_sections`
**Purpose**: Section definitions per test (e.g., Numeracy, Reading...).

- **PK**: `id` (uuid)
- **FK**: `test_id → tests(id)` (ON DELETE CASCADE)
- **UQ**: `(test_id, section_order)` unique
- **Columns**
  - `id` (uuid, PK)
  - `test_id` (uuid, NOT NULL)
  - `name` (text, NOT NULL)
  - `section_order` (int, NOT NULL)
  - `time_limit_mins` (int, NULL) — optional override per section
  - `question_count` (int, NOT NULL)
  - `created_at` (timestamptz, default `now()`)
- **CK**:
  - `question_count > 0`
- **Dependencies**: depends on `tests`

---

### 3.6 `public.questions`
**Purpose**: Question bank with tagging, answer key and explanations.

- **PK**: `id` (uuid)
- **FK**: `created_by → auth.users(id)` (ON DELETE RESTRICT)
- **UQ**: none (by design)
- **Columns**
  - `id` (uuid, PK)
  - `type` (question_type, NOT NULL)
  - `stem` (text, NOT NULL)
  - `passage` (text, NULL) — reading passage
  - `image_url` (text, NULL) — image asset URL
  - `options` (jsonb, NULL) — MCQ options
  - `correct_answer` (jsonb, NULL) — MCQ key or short-answer regex config
  - `explanation` (text, NULL) — 1–2 lines for non-numeracy
  - `explanation_steps` (jsonb, NULL) — step-by-step for numeracy
  - `tags` (jsonb, NOT NULL) — **year, subject, topic, skill, difficulty, reasoning_type, exam_type**
  - `status` (content_status, NOT NULL, default `DRAFT`)
  - `created_by` (uuid, NOT NULL)
  - `created_at` (timestamptz, default `now()`)
  - `updated_at` (timestamptz, default `now()`)
- **Dependencies**: depends on `auth.users`
- **IDX**:
  - `idx_questions_status_type (status, type)`
- **Comments**
  - Published questions are readable only if they are part of at least one **accessible** published test (via `test_questions`).

---

### 3.7 `public.test_questions`
**Purpose**: Joins tests to questions; includes section and baseline difficulty.

- **PK**: `id` (uuid)
- **FKs**:
  - `test_id → tests(id)` (ON DELETE CASCADE)
  - `question_id → questions(id)` (ON DELETE RESTRICT)
- **UQ**: `(test_id, question_id)` unique
- **Columns**
  - `id` (uuid, PK)
  - `test_id` (uuid, NOT NULL)
  - `question_id` (uuid, NOT NULL)
  - `section_name` (text, NOT NULL)
  - `base_difficulty` (int, NOT NULL) — 1..4
  - `question_order` (int, NULL) — optional ordering
- **CK**:
  - `base_difficulty between 1 and 4`
- **Dependencies**: depends on `tests`, `questions`

---

### 3.8 `public.assignments`
**Purpose**: Parent assigns a test to a student.

- **PK**: `id` (uuid)
- **FKs**:
  - `student_id → student_profiles(id)` (ON DELETE CASCADE)
  - `test_id → tests(id)` (ON DELETE RESTRICT)
  - `assigned_by → auth.users(id)` (ON DELETE RESTRICT)
- **Columns**
  - `id` (uuid, PK)
  - `student_id` (uuid, NOT NULL)
  - `test_id` (uuid, NOT NULL)
  - `assigned_by` (uuid, NOT NULL) — typically a parent (or tutor later)
  - `assigned_at` (timestamptz, default `now()`)
  - `due_at` (timestamptz, NULL)
- **Dependencies**: depends on `student_profiles`, `tests`, `auth.users`
- **IDX**:
  - `idx_assignments_student (student_id)`
  - `idx_assignments_test (test_id)`

---

### 3.9 `public.attempts`
**Purpose**: Represents a student’s attempt at a test; stores scoring summary.

- **PK**: `id` (uuid)
- **FKs**:
  - `student_id → student_profiles(id)` (ON DELETE CASCADE)
  - `test_id → tests(id)` (ON DELETE RESTRICT)
- **Columns**
  - `id` (uuid, PK)
  - `student_id` (uuid, NOT NULL)
  - `test_id` (uuid, NOT NULL)
  - `started_at` (timestamptz, default `now()`)
  - `submitted_at` (timestamptz, NULL)
  - `status` (attempt_status, default `IN_PROGRESS`)
  - `score_out_of100` (numeric(5,2), NULL) — final reported score
  - `section_scores` (jsonb, NULL) — section breakdown (out of 100)
  - `raw_accuracy` (numeric(5,2), NULL)
  - `weighted_score` (numeric(5,2), NULL)
  - `time_spent_seconds` (int, NULL)
  - `created_at` (timestamptz, default `now()`)
- **Dependencies**: depends on `student_profiles`, `tests`
- **IDX**:
  - `idx_attempts_student (student_id)`
  - `idx_attempts_test (test_id)`

---

### 3.10 `public.responses`
**Purpose**: Stores per-question responses within an attempt, including timing and correctness.

- **PK**: `id` (uuid)
- **FKs**:
  - `attempt_id → attempts(id)` (ON DELETE CASCADE)
  - `question_id → questions(id)` (ON DELETE RESTRICT)
- **UQ**: `(attempt_id, question_id)` unique
- **Columns**
  - `id` (uuid, PK)
  - `attempt_id` (uuid, NOT NULL)
  - `question_id` (uuid, NOT NULL)
  - `section_name` (text, NOT NULL)
  - `difficulty_served` (int, NOT NULL) — 1..4
  - `answer` (jsonb, NOT NULL)
  - `is_correct` (boolean, NULL)
  - `time_spent_seconds` (int, NULL)
  - `created_at` (timestamptz, default `now()`)
- **CK**:
  - `difficulty_served between 1 and 4`
- **Dependencies**: depends on `attempts`, `questions`
- **IDX**:
  - `idx_responses_attempt (attempt_id)`
  - `idx_responses_question (question_id)`

---

### 3.11 `public.writing_evaluations`
**Purpose**: Stores async AI-based writing marking results for an attempt.

- **PK**: `id` (uuid)
- **FK**: `attempt_id → attempts(id)` (ON DELETE CASCADE)
- **UQ**: `attempt_id` unique (0..1 evaluation per attempt)
- **Columns**
  - `id` (uuid, PK)
  - `attempt_id` (uuid, NOT NULL, unique)
  - `provider` (text, NOT NULL, default 'DeepSeek')
  - `score_out_of100` (numeric(5,2), NOT NULL)
  - `strengths` (jsonb, NULL)
  - `improvements` (jsonb, NULL)
  - `improved_text` (text, NULL)
  - `raw_response` (jsonb, NULL)
  - `created_at` (timestamptz, default `now()`)
- **Dependencies**: depends on `attempts`
- **Comments**
  - Typically inserted by a QStash job handler using **service-role** after verifying QStash signature.

---

### 3.12 `public.notifications`
**Purpose**: In-app notifications (e.g., “Writing report ready”).

- **PK**: `id` (uuid)
- **FK**: `user_id → auth.users(id)` (ON DELETE CASCADE)
- **Columns**
  - `id` (uuid, PK)
  - `user_id` (uuid, NOT NULL)
  - `type` (text, NOT NULL)
  - `title` (text, NOT NULL)
  - `message` (text, NOT NULL)
  - `link_url` (text, NULL)
  - `is_read` (boolean, NOT NULL, default false)
  - `created_at` (timestamptz, default `now()`)
- **Dependencies**: depends on `auth.users`
- **IDX**:
  - `idx_notifications_user_created (user_id, created_at desc)`

---

### 3.13 `public.products`
**Purpose**: Store one-time purchase products (bundles or single tests).

- **PK**: `id` (uuid)
- **UQ**: `stripe_price_id` unique
- **Columns**
  - `id` (uuid, PK)
  - `name` (text, NOT NULL)
  - `description` (text, NULL)
  - `active` (boolean, default true)
  - `price_cents` (int, NOT NULL, >= 0)
  - `currency` (text, NOT NULL, default 'AUD')
  - `stripe_price_id` (text, unique, NULL)
  - `created_at` (timestamptz, default `now()`)
- **Dependencies**: none

---

### 3.14 `public.product_tests`
**Purpose**: Mapping between a product and the tests it unlocks.

- **PK**: composite `(product_id, test_id)`
- **FKs**:
  - `product_id → products(id)` (ON DELETE CASCADE)
  - `test_id → tests(id)` (ON DELETE RESTRICT)
- **Columns**
  - `product_id` (uuid)
  - `test_id` (uuid)
- **Dependencies**: depends on `products`, `tests`

---

### 3.15 `public.purchases`
**Purpose**: Records one-time purchase transaction and its status.

- **PK**: `id` (uuid)
- **FK**: `user_id → auth.users(id)` (ON DELETE CASCADE)
- **Columns**
  - `id` (uuid, PK)
  - `user_id` (uuid, NOT NULL)
  - `provider` (text, NOT NULL, default 'Stripe')
  - `provider_ref` (text, NULL) — Stripe session/payment intent id
  - `total_amount_cents` (int, NOT NULL, >= 0)
  - `currency` (text, NOT NULL, default 'AUD')
  - `status` (text, NOT NULL, default 'PENDING')
  - `created_at` (timestamptz, default `now()`)
- **Dependencies**: depends on `auth.users`
- **IDX**:
  - `idx_purchases_user (user_id)`

---

### 3.16 `public.entitlements`
**Purpose**: Grants access to paid tests after successful payment.

- **PK**: `id` (uuid)
- **FKs**:
  - `user_id → auth.users(id)` (ON DELETE CASCADE)
  - `purchase_id → purchases(id)` (ON DELETE CASCADE)
  - `test_id → tests(id)` (ON DELETE RESTRICT)
- **UQ**: `(user_id, test_id)` unique (one entitlement per test per user)
- **Columns**
  - `id` (uuid, PK)
  - `user_id` (uuid, NOT NULL)
  - `purchase_id` (uuid, NOT NULL)
  - `test_id` (uuid, NOT NULL)
  - `active` (boolean, NOT NULL, default true)
  - `created_at` (timestamptz, default `now()`)
- **Dependencies**: depends on `auth.users`, `purchases`, `tests`
- **IDX**:
  - `idx_entitlements_user (user_id)`
  - `idx_entitlements_test (test_id)`

---

### 3.17 `public.processed_webhook_events`
**Purpose**: Stripe webhook idempotency (prevents double granting of entitlements).

- **PK**: `id` (uuid)
- **UQ**: `event_id` unique
- **Columns**
  - `id` (uuid, PK)
  - `provider` (text, NOT NULL, default 'Stripe')
  - `event_id` (text, NOT NULL, unique)
  - `processed_at` (timestamptz, default `now()`)
- **Dependencies**: none
- **Comments**
  - Written by webhook handler (service role) after verifying Stripe signatures.

---

### 3.18 `public.processed_jobs`
**Purpose**: QStash idempotency (prevents duplicate processing of async jobs).

- **PK**: `id` (uuid)
- **UQ**: `job_id` unique
- **Columns**
  - `id` (uuid, PK)
  - `job_id` (text, NOT NULL, unique)
  - `job_type` (text, NOT NULL)
  - `processed_at` (timestamptz, default `now()`)
- **Dependencies**: none
- **Comments**
  - Written by QStash job handler (service role) after verifying QStash signatures.

---

## 4) Key constraints and uniqueness rules (summary)

- Student privacy:
  - No real name/DOB/school columns exist in `student_profiles`.
  - `student_profiles.username` is **unique**.

- Relationship integrity:
  - Parent-student link is unique: `parent_student_links(parent_user_id, student_id)`.

- Attempt integrity:
  - One response per question per attempt: `responses(attempt_id, question_id)` unique.
  - One writing evaluation per attempt: `writing_evaluations(attempt_id)` unique.

- Entitlement integrity:
  - One entitlement per test per user: `entitlements(user_id, test_id)` unique.

---

## 5) Indexes (performance)

### Implemented indexes
- `parent_student_links(parent_user_id)`
- `parent_student_links(student_id)`
- `assignments(student_id)`
- `assignments(test_id)`
- `attempts(student_id)`
- `attempts(test_id)`
- `responses(attempt_id)`
- `responses(question_id)`
- `tests(status, exam_type)`
- `questions(status, type)`
- `purchases(user_id)`
- `entitlements(user_id)`
- `entitlements(test_id)`
- `notifications(user_id, created_at desc)`

### Optional recommended indexes (if needed later)
- `tests(status, is_free)` — speeds up “free vs paid” browsing for logged-in users.
- `test_questions(test_id, section_name)` — speeds up test assembly per section.
- `responses(attempt_id, section_name)` — speeds up section analytics.

---

## 6) Security model notes (RLS + RBAC)

### 6.1 Published content gating (database enforced)
- **Published tests** are readable only if:
  - caller is logged in, and
  - test is `is_free = true` **OR** caller has an active entitlement for the test.

- **Published questions** are readable only if:
  - caller is logged in, and
  - the question belongs to at least one accessible published test via `test_questions`.

### 6.2 Draft access
- **Admin** can read all drafts via RLS (and additionally via service-role + RBAC endpoints).
- **Test Creator** can read their own drafts.

### 6.3 Service-role usage
- Service-role bypasses RLS and must be used **only** in trusted endpoints:
  - Stripe webhooks (signature verified; idempotent processing)
  - QStash job handlers (signature verified; idempotent processing)
  - Admin-only bulk tooling endpoints (RBAC enforced)

---

## 7) Data lifecycle notes

- `attempts` + `responses` form the audit trail of student performance.
- `writing_evaluations` is generated asynchronously and linked 1:1 to an attempt.
- `processed_webhook_events` and `processed_jobs` are idempotency journals; they may be retained long-term for security/replay prevention.

---

## 8) Glossary

- **Entitlement**: A row granting a logged-in user access to a paid test.
- **RLS (Row Level Security)**: Postgres policy layer that filters rows per requesting user.
- **RBAC**: Role-based access control enforced in server-side application code.
- **Objective question**: MCQ or Short Answer (eligible for adaptive engine).

---

## Appendix — Writing Assessment schema (DeepSeek Flash, 2026-11)

Implemented after the original schema doc. Applies to the hosted project
`ekdjrvjgrhpqolthbznr` (migrations 096–100) and is recorded by the same names in
`supabase/migrations/`.

### Enum change
- `public.exam_type` gains `'WRITING'` (096). Writing-assessment tests and
  questions are classified by it instead of borrowing a misleading value.

### `public.writing_evaluations` — first-class detail columns (096, 100)
The AI mark detail was previously only reachable by re-parsing `raw_response`.
Added (all additive, backfilled where present):

| column | type | notes |
|---|---|---|
| `text_type` | text | `narrative` \| `persuasive` \| `other` |
| `category_scores` | jsonb | five categories + sub-criteria, mirrors the rubric |
| `techniques_used` | jsonb | narrative or persuasive techniques detected |
| `practice_exercise` | text | tailored drill |
| `rubric_version` | text | stamped from `WRITING_RUBRIC_VERSION` |
| `model` | text | DeepSeek model id |
| `word_count` | int | student word count |
| `graded_at` | timestamptz | |
| `duration_ms` | int | DeepSeek round-trip |
| `improvements_detail` | jsonb | `[{suggestion, estimated_score_gain, rewrite}]` (100) |

`improvements` (text[]) is retained for legacy consumers; `improvements_detail`
carries the rich objects.

### New table `public.writing_practice_sessions` (096)
Standalone AI Practice Lab grading. It exists because `writing_evaluations.attempt_id`
is `NOT NULL UNIQUE` and cannot host non-test writing.

| column | type |
|---|---|
| `id` | uuid PK |
| `student_id` | uuid FK → student_profiles |
| `prompt_id`, `text_type`, `prompt_text`, `student_text` | text |
| `word_count` | int |
| `year_level` | int |
| `status` | text `PENDING`\|`GRADED`\|`FAILED` |
| `score_out_of100` | numeric(5,2) |
| `evaluation` | jsonb (full mark detail incl. `improvements_detail`) |
| `rubric_version`, `model`, `created_at`, `graded_at`, `duration_ms` | |

RLS matches the 015 student-blindness rule:
- student **INSERT only** (`is_student_self(student_id)`) — never SELECT a result;
- parent **SELECT** (`may_read_results() AND is_parent_of(student_id)`);
- admin SELECT/ALL; service role ALL; `anon` revoked.

### Seeded content (097–099, idempotent)
- 13 `WRITING` questions (8 narrative + 5 persuasive), `PUBLISHED`, `exam_type='WRITING'`.
- 6 `WRITING` tests: 3 year bands (2–4 / 5–6 / 7–8) × narrative/persuasive, one
  writing question each (PM rule: max 1 per test), `is_free=true` initially.

### Access model (unchanged, load-bearing)
Students never see a mark: reports (`WritingReportPanel`, progress) are
parent/tutor-facing; the AI Practice Lab gives only a qualitative acknowledgment.
