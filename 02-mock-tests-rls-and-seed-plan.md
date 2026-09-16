# Mock Tests Platform — RLS Policies, Helper Functions (Documentation) & Seed-Data Plan

> **Scope**: This companion document describes the **final Row Level Security (RLS) design**, the **helper functions** used by RLS (as readable documentation), and a **seed-data plan** for marking tests as **free vs paid** — **without changing the database schema**.
>
> **Important**:
> - This is **documentation**, not executable SQL.
> - The platform uses **Supabase Auth** for all personas, enabling RLS decisions to be made using `auth.uid()` (the caller’s user id).
> - **Server-side RBAC** in Next.js remains mandatory for privileged endpoints that use the **service-role key**, because service-role bypasses RLS by design.

---

## 1) Why both RLS and server-side RBAC?

- **RLS** protects data *inside Postgres* by limiting which rows are visible/mutable per authenticated user.
- **Server-side RBAC** protects *application actions/endpoints*, particularly:
  - Stripe webhook handlers
  - QStash job handlers
  - Admin-only bulk operations

Access control failures are widely recognized as a high-impact risk category; therefore the design uses **deny-by-default** at the API layer and ownership checks at the data layer. citeturn6search31turn6search35

---

## 2) Final content access rules (published tests/questions)

### 2.1 Non-negotiable rules
1. **Anonymous users** (not logged-in): **cannot** read any published tests/questions.
2. **Logged-in users** can read published tests/questions **only** if:
   - the test is **free** (`tests.is_free = true`), **or**
   - the user has an **active entitlement** for that test (`entitlements.active = true`).
3. **Admins** can read **all drafts** via RLS, and also via service-role + RBAC.

### 2.2 Implications
- Even if a question is published, it is **not globally readable**.
- Published questions are readable only when they are part of at least one published test that the user can access.

---

## 3) RLS helper functions (documented semantics)

The schema defines helper functions to keep policies readable and consistent.

### 3.1 `has_role(target_role)`
**Purpose**: Returns `true` if the current user has the specified application role.

**Inputs**:
- `target_role`: one of `PARENT | TUTOR | STUDENT | TEST_CREATOR | ADMIN`

**Logic**:
- Look up current user id (`auth.uid()`) in `app_user_roles`.
- Return `true` if a matching role row exists.

**Used by**:
- Admin override policies
- Test creator draft access
- Draft approval/publishing capabilities

---

### 3.2 `is_parent_of(student_id)`
**Purpose**: Returns `true` if the current user is linked as a parent to the given student.

**Logic**:
- Checks whether `(auth.uid(), student_id)` exists in `parent_student_links`.

**Used by**:
- Parent reading student profiles
- Parent reading student assignments/attempts/responses

---

### 3.3 `is_student_self(student_id)`
**Purpose**: Returns `true` if the current user is the student that owns the `student_profiles` row.

**Logic**:
- Finds a `student_profiles` row where `id = student_id` and `auth_user_id = auth.uid()`.

**Used by**:
- Student reading their own profile
- Student reading/writing their own attempts/responses

---

### 3.4 `is_attempt_owner(attempt_id)`
**Purpose**: Returns `true` if the current user is the student who owns the attempt.

**Logic**:
- Joins `attempts → student_profiles` and checks `student_profiles.auth_user_id = auth.uid()`.

**Used by**:
- Student read/write policies on `responses`

---

### 3.5 `has_entitlement(test_id)`
**Purpose**: Returns `true` if the current user has an **active** entitlement row for the test.

**Logic**:
- Checks `entitlements` for a row with `user_id = auth.uid()`, `test_id = input test_id`, and `active = true`.

**Used by**:
- Paid gating for published content

---

### 3.6 `can_access_published_test(test_id)`
**Purpose**: Central policy gate for reading a published test.

**Returns true if and only if**:
- User is logged in (`auth.uid()` is not null)
- Test exists and is `status = PUBLISHED`
- And (test is free **OR** user has an active entitlement)

**Used by**:
- `tests` SELECT policy (published)
- `test_sections` SELECT policy (published)
- `test_questions` SELECT policy (published)
- `questions` SELECT policy (published via membership in accessible test)

---

## 4) RLS policy catalogue (readable rules)

> Policies are expressed as “Who can do what, under which conditions”.

### 4.1 `app_user_roles`
- **Select**: user can read their own role; admin can read all.
- **Write**: admin only.

---

### 4.2 `student_profiles`
- **Select**:
  - Parent can read profiles of linked students.
  - Student can read own profile.
  - Admin can read all.
- **Insert**:
  - Parent can insert a new student profile (child creation).
  - Admin can insert.
- **Update**:
  - Parent can update linked student profile.
  - Admin can update.

---

### 4.3 `parent_student_links`
- **Select / Insert / Delete**:
  - Parent can manage their own links.
  - Admin can manage all.

---

### 4.4 `tests`

#### Published tests
- **Select**:
  - Only logged-in users.
  - Must satisfy `can_access_published_test(test_id)`.

#### Draft / pending tests
- **Select**:
  - Test Creator can read their own drafts and pending tests.
  - Admin can read all drafts/pending.

#### Writes
- **Insert**:
  - Test Creator can create drafts.
  - Admin can create.
- **Update**:
  - Test Creator can update only their own `DRAFT` or `PENDING_APPROVAL` tests.
  - Admin can update any.

---

### 4.5 `test_sections`
- **Select**:
  - For published tests: allowed if `can_access_published_test(test_id)`.
  - For drafts/pending: allowed for the owning Test Creator and for Admin.
- **Write**:
  - Owning Test Creator can change sections for their draft/pending tests.
  - Admin can write.

---

### 4.6 `questions`

#### Published questions
- **Select**:
  - Only logged-in users.
  - Question must be `status = PUBLISHED`.
  - Question must belong to **at least one** published test the user can access.
    - Implemented via `exists test_questions where question_id = questions.id AND can_access_published_test(test_id)`.

#### Draft / pending questions
- **Select**:
  - Test Creator can read their own drafts/pending.
  - Admin can read all.

#### Writes
- **Insert**:
  - Test Creator and Admin.
- **Update**:
  - Test Creator can update only their draft/pending questions.
  - Admin can update any.

---

### 4.7 `test_questions`
- **Select**:
  - For published tests: allowed if `can_access_published_test(test_id)`.
  - For drafts/pending: allowed for owning Test Creator and Admin.
- **Write**:
  - Owning Test Creator can change mapping for draft/pending tests.
  - Admin can write.

---

### 4.8 `assignments`
- **Select**:
  - Parent can read assignments for linked students.
  - Student can read own assignments.
  - Admin can read all.
- **Insert**:
  - Parent can assign tests to linked students.
  - Admin can insert.

---

### 4.9 `attempts`
- **Select**:
  - Parent can read attempts for linked students.
  - Student can read own attempts.
  - Admin can read all.
- **Insert/Update**:
  - Student can create/update own attempts.
  - Admin can write.

---

### 4.10 `responses`
- **Select**:
  - Parent can read responses for linked students (via attempt ownership).
  - Student can read own responses (via attempt ownership).
  - Admin can read all.
- **Insert/Update/Delete**:
  - Student can manage their own responses.
  - Admin can write.

---

### 4.11 `writing_evaluations`
- **Select**:
  - Parent can read for linked student attempts.
  - Student can read own.
  - Admin can read all.
- **Write**:
  - Created by trusted server job (service-role) and/or Admin.

---

### 4.12 `notifications`
- **Select/Update**:
  - User can read and mark their own notifications as read.
  - Admin can read all.
- **Insert**:
  - Created by trusted server processes (service-role) and/or Admin.

---

### 4.13 `products` & `product_tests`
- **Select**:
  - Logged-in users can read products and included tests (to browse catalog).
- **Write**:
  - Admin only (through admin portal or service-role + RBAC).

---

### 4.14 `purchases` & `entitlements`
- **Select**:
  - User can read their own purchases/entitlements.
  - Admin can read all.
- **Write**:
  - Purchases: created/updated by trusted payment flows (service-role + RBAC) and/or Admin.
  - Entitlements: created only after payment success (webhook verified) and/or Admin.

**Webhook authenticity** must be verified using Stripe’s recommended signature verification process. citeturn6search19

---

### 4.15 `processed_webhook_events` & `processed_jobs`
- **Purpose**: Idempotency journals.
- **Read/Write**:
  - Admin and trusted server processes only.

---

## 5) Seed-data plan (free vs paid tests) — without schema changes

This plan describes what initial data should be inserted to launch the product with:
- free **Benchmark tests** across Year 2–8
- free starter packs (if desired)
- paid packs/bundles mapped to products

### 5.1 Principles
- Use `tests.is_free` to mark free tests.
- Use `tests.status = PUBLISHED` only after review/approval.
- Use `products` + `product_tests` to define purchasable bundles.
- Grant access by inserting `entitlements` rows when a purchase is confirmed.

### 5.2 Seed roles and admin user
1. Create (or identify) an Admin `auth.users` account.
2. Insert `app_user_roles` for that user with role `ADMIN`.

### 5.3 Seed Benchmark tests (free)
For each year band, create a benchmark test with required duration and question counts:
- Year 2–3: 45 mins, 45 questions
- Year 4–5: 60 mins, 75 questions
- Year 6–7: 75 mins, 90 questions
- Year 8: 90 mins, 120 questions

Set for each benchmark test:
- `exam_type = BENCHMARK`
- `status = PUBLISHED`
- `is_free = true`

Add 5 sections (`test_sections`) to each benchmark:
- Numeracy
- Reading
- Spelling & Grammar
- Verbal Reasoning
- Numerical Reasoning

Recommended initial distribution for question counts per section (can be adjusted later):
- Year 2–3 (45): 12/12/9/6/6
- Year 4–5 (75): 20/20/15/10/10
- Year 6–7 (90): 24/24/18/12/12
- Year 8 (120): 32/32/24/16/16

### 5.4 Seed free “NAPLAN-style” starter tests (optional)
- Create a small number of `NAPLAN_STYLE` tests with `is_free = true` and `PUBLISHED`.
- Purpose: allow parents to experience the platform before purchasing.

### 5.5 Seed paid tests (PUBLISHED but not free)
- Create paid tests with:
  - `status = PUBLISHED`
  - `is_free = false`
- These tests will be invisible to users until they buy a product and obtain entitlements.

### 5.6 Seed products (one-time purchases)
Create products aligned to your pricing plan:
- NAPLAN-style: $5 each, bundle of 4 for $15, pack of 20 for $50
- Olympiad/Selective: $10 each, 5 for $40, 10 for $60, 20 for $100

Implementation:
1. Insert rows into `products` with `price_cents` and `currency = 'AUD'`.
2. Link each product to its included tests via `product_tests`.
3. Store Stripe `price_id` into `products.stripe_price_id` after configuring Stripe.

### 5.7 Purchase and entitlement flow (how seed and live data connect)
**On purchase success** (via Stripe webhook):
1. Create/Update a `purchases` row (`status = SUCCEEDED`).
2. Insert `entitlements` rows for each test included in the purchased product(s).
3. From that moment, RLS allows the user to read those tests/questions.

### 5.8 Assignment to students (parent workflow)
- Parent buys tests (entitlements created for parent user).
- Parent assigns purchased tests to student via `assignments`.
- Student can then attempt the assigned tests; attempts/responses are protected by RLS.

---

## 6) Operational notes (for production)

### 6.1 Stripe webhooks
- Verify Stripe webhook signatures and use idempotency (`processed_webhook_events`) to prevent double-granting entitlements. citeturn6search19

### 6.2 QStash jobs
- Verify QStash signature, and use idempotency (`processed_jobs`) to prevent repeated writing-evaluation insertion.

### 6.3 Security verification
- Use OWASP ASVS as your verification checklist for Level 2 security requirements and evidence packaging. citeturn6search25turn6search26

---

## 7) Quick checklist (what to validate before production)

- [ ] RLS enabled on all sensitive tables.
- [ ] Anonymous cannot read published tests/questions.
- [ ] Logged-in users see only free or entitled tests.
- [ ] Admin can read all drafts via RLS.
- [ ] Stripe webhook signature verification and idempotency in place. citeturn6search19
- [ ] Service-role endpoints protected with server-side RBAC. citeturn6search31turn6search35
