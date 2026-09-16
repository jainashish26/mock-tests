# Sprint Plan (6 Sprints) — Epics & Stories with Detailed Steps

> **Document purpose:** A single, sequenced sprint plan, listing **Epics** and **Stories** in the correct build order, with **detailed implementation steps** inside each story.
>
> **Guiding rules (constant across all sprints):**
> - **Deny-by-default**: every API route and DB policy assumes no access unless explicitly allowed.
> - **RLS + RBAC**: RLS protects the DB rows for user-context queries; server-side RBAC protects privileged endpoints (service-role).
> - **Content gating**: published tests/questions are readable only by logged-in users who can access **free** tests or tests they **purchased**.
> - **No content creation dependency**: sprint execution assumes content is seeded minimally for QA (smoke tests).

---

## Sprint 1  — Foundations + Supabase + Auth SMTP + Baseline Security

### Epic 1: Platform Foundations (Vercel / CI-CD / Observability)

#### Story 1.1 — CI/CD + Environments (Dev / Preview / Prod)
**Outcome:** Automated build/deploy pipeline with environment separation.

**Steps**
1. Create Vercel project and connect Git repository.
2. Configure environment targets:
   - Development: local `.env.local`
   - Preview: Vercel preview deployments
   - Production: custom domain (later) and production deployments
3. Add required environment variables for each environment (Preview/Prod).
4. Configure build checks: lint + typecheck + unit tests must pass before merge.
5. Enable Preview Deployments for PRs.

**Acceptance checks**
- PR creates a preview URL automatically.
- Build fails on lint/type errors.

---

#### Story 1.2 — Secrets management + rotation plan
**Outcome:** All secrets stored only in Vercel/Supabase/Upstash/Stripe dashboards; rotation plan documented.

**Steps**
1. Ensure no secrets exist in repo history.
2. Add `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `QSTASH_TOKEN`, etc. as Vercel **server** env vars.
3. Document which keys are server-only and why.
4. Create a key rotation checklist (Quarterly + incident-driven).

**Acceptance checks**
- No secret-like patterns in repo scan.
- All server-only secrets are not exposed via `NEXT_PUBLIC_*`.

---

#### Story 1.3 — Observability baseline (logging + error tracking)
**Outcome:** Centralized error capture + structured logs with correlation IDs.

**Steps**
1. Add error tracking provider (e.g., Sentry) or equivalent logging pipeline.
2. Implement structured logger in API routes.
3. Add request correlation ID middleware.
4. Ensure sensitive fields are redacted in logs.

**Acceptance checks**
- Errors in staging appear in monitoring.
- Logs include correlation IDs.

---

### Epic 2: Database & Migrations (Supabase SQL)

#### Story 2.1 — Supabase projects (Dev / Staging / Prod)
**Outcome:** Separate Supabase projects ready, with correct auth redirect URLs.

**Steps**
1. Create Supabase projects for dev/staging/prod.
2. Configure Auth Site URL + Redirect URL allowlist for each.
3. Capture `NEXT_PUBLIC_SUPABASE_URL` and keys per environment.

**Acceptance checks**
- Auth redirect works in staging.
- Dev/staging/prod keys are isolated.

---

#### Story 2.2 — Apply schema v1 via SQL migrations
**Outcome:** Core tables created and versioned in `supabase/migrations`.

**Steps**
1. Add initial migration files: schema, RLS skeleton, indexes.
2. Apply migrations to dev and staging.
3. Verify all foreign keys and constraints apply successfully.

**Acceptance checks**
- Fresh reset applies migrations end-to-end.
- `auth.users` integration works for app tables.

---

#### Story 2.3 — Indexes + constraints migration
**Outcome:** Baseline indexes for performance-critical queries.

**Steps**
1. Add indexes for attempts, responses, entitlements, notifications.
2. Validate query plans on staging for list views.

**Acceptance checks**
- Parent dashboard and report queries are performant in staging.

---

### Epic 3: Authentication (Supabase Auth + SendGrid SMTP)

#### Story 3.1 — Configure Supabase Auth email delivery via SendGrid SMTP
**Outcome:** All auth emails (OTP/magic link/verification) sent via SendGrid.

**Steps**
1. In Supabase Dashboard: Auth → SMTP settings.
2. Set SendGrid SMTP credentials.
3. Configure sender name/email.
4. Send test email.

**Acceptance checks**
- OTP/verification email arrives from branded sender.

---

#### Story 3.2 — Auth UI flow (login / signup)
**Outcome:** Working auth pages and session establishment.

**Steps**
1. Build `/auth` pages using Supabase Auth helpers.
2. On successful login, redirect based on role.
3. Persist session via Supabase client.

**Acceptance checks**
- User can sign up and log in on staging.
- Session persists refresh.

---

### Epic 4: RBAC Skeleton (server-side)

#### Story 4.1 — RBAC middleware & role resolution
**Outcome:** Server-side role checks available for all API routes.

**Steps**
1. Create a server utility: `getUserRole(auth.uid()) → role`.
2. Add `requireRole([...])` guard for API routes.
3. Ensure deny-by-default behavior.

**Acceptance checks**
- Non-admin cannot access `/api/admin/*`.
- Unauthenticated calls return 401.

---

### Sprint 1 Exit Criteria
- Supabase projects created; schema and indexes applied.
- Supabase Auth emails delivered via SendGrid SMTP.
- Vercel CI/CD and preview deployments working.
- RBAC guard exists and blocks privileged APIs.

---

## Sprint 2 — RLS Policies + Child Profiles + CMS v1 + Runner v1 (MCQ)

### Epic 5: RLS Policies (Core)

#### Story 5.1 — Enable RLS on sensitive tables
**Outcome:** RLS enabled on student, attempts, responses, entitlements, etc.

**Steps**
1. Enable RLS on: `student_profiles`, `parent_student_links`, `assignments`, `attempts`, `responses`, `entitlements`, `purchases`, `notifications`, `tests`, `questions`, `test_sections`, `test_questions`.
2. Add base policies for admin override and ownership checks.

**Acceptance checks**
- Anonymous cannot query protected tables.
- Logged-in users only see permitted rows.

---

#### Story 5.2 — Implement published content gating (free vs entitled)
**Outcome:** Published tests/questions are readable only for logged-in users; paid tests require entitlement.

**Steps**
1. Ensure `tests.is_free` exists and is set for seeded tests.
2. Add helper functions (documented): `has_entitlement`, `can_access_published_test`.
3. Add/select policies:
   - `tests`: published read allowed only if `can_access_published_test(test_id)`.
   - `questions`: published read allowed only if it belongs to at least one accessible test.
4. Validate that anonymous users cannot read published content.

**Acceptance checks**
- Logged-in user sees free tests.
- Logged-in user cannot see paid tests without entitlement.

---

#### Story 5.3 — Admin draft visibility via RLS
**Outcome:** Admin can read all drafts via RLS.

**Steps**
1. Add `ADMIN` role policy that allows select across drafts/pending for tests/questions.
2. Verify Test Creator can read only their own drafts.

**Acceptance checks**
- Admin sees all drafts.
- Creator sees only own drafts.

---

### Epic 6: Child Profiles & Assignments

#### Story 6.1 — Parent creates child profile (pseudonymous)
**Outcome:** Parent can create student profile with generated username; no personal details stored.

**Steps**
1. Build child creation UI in parent dashboard.
2. Generate username suggestions (flower+fruit+4 digits) and enforce uniqueness.
3. Create student auth user (synthetic email) + link to `student_profiles`.
4. Link parent to student via `parent_student_links`.

**Acceptance checks**
- Child created successfully with year level + username.
- Parent link exists.

---

#### Story 6.2 — Student login experience
**Outcome:** Student can log in using username/password (implemented via Supabase Auth behind the scenes).

**Steps**
1. Provide a student login screen that accepts username+password.
2. Map username → synthetic email internally (server-side or deterministic mapping).
3. Authenticate using Supabase Auth.
4. Redirect to `/student`.

**Acceptance checks**
- Student logs in and sees only their assigned tests.

---

#### Story 6.3 — Assign tests to student
**Outcome:** Parent assigns a test; student sees assignment.

**Steps**
1. Parent UI: choose child, select test, click Assign.
2. Insert into `assignments`.
3. Student dashboard fetches assignments.

**Acceptance checks**
- Student sees assignment within seconds.

---

### Epic 7: CMS v1 + Approval Workflow

#### Story 7.1 — Question authoring with mandatory tags
**Outcome:** Test Creator creates MCQ/Short/Writing questions with required tags.

**Steps**
1. Build question editor:
   - question type selector
   - stem/passage/image
   - options + correct answer
   - explanation fields
   - tags: year, subject, topic, skill, difficulty, reasoning type, exam type
2. Validate required fields by type.
3. Save as `DRAFT`.

**Acceptance checks**
- Cannot save without mandatory tags.

---

#### Story 7.2 — Test builder (sections + counts)
**Outcome:** Creator assembles a test with sections and counts.

**Steps**
1. Build test builder UI.
2. Add sections and question counts.
3. Map questions to tests via `test_questions`.
4. Save as `DRAFT`.

**Acceptance checks**
- Test contains correct number of sections.
- Questions mapped properly.

---

#### Story 7.3 — Approval workflow (submit → approve/reject → publish)
**Outcome:** Admin approves creator content.

**Steps**
1. Creator submits test/questions → status `PENDING_APPROVAL`.
2. Admin review page lists pending changes.
3. Admin can approve → publish, or reject with comment.
4. Record approval metadata (approved_by, published_at).

**Acceptance checks**
- Only admin can publish.

---

### Epic 8: Test Runner v1 (MCQ)

#### Story 8.1 — Attempt lifecycle (start/save/submit)
**Outcome:** Student can start a test, answer questions, submit.

**Steps**
1. Create attempt row on start.
2. Render question list with navigation.
3. Save responses incrementally.
4. Review screen shows unanswered/flagged.
5. Submit locks attempt.

**Acceptance checks**
- Attempt status transitions correctly.
- Responses persisted.

---

#### Story 8.2 — Timer + navigation + flagging
**Outcome:** Exam-like experience for timing and navigation.

**Steps**
1. Implement countdown timer.
2. Auto-submit when time expires (configurable).
3. Implement flag/unflag.
4. Review screen allows jump to any question.

**Acceptance checks**
- Timer is accurate.
- Flags persist.

---

#### Story 8.3 — Reading passage pane + image rendering
**Outcome:** Supports reading-style questions and image-based questions.

**Steps**
1. UI layout with passage toggle.
2. Image rendering with safe URLs (Supabase Storage or approved domain list).

**Acceptance checks**
- Passage readable on mobile.

---

### Sprint 2 Exit Criteria
- RLS protects sensitive tables.
- Published gating works for free vs paid.
- CMS allows authoring + admin approval.
- Student can take an MCQ test end-to-end.

---

## Sprint 3 — Adaptive Engine + Scoring + Reports (Premium)

### Epic 9: Adaptive Engine (Objective only, per section)

#### Story 9.1 — Adaptive selection logic per section
**Outcome:** Within a section, difficulty adapts for MCQ/short answers.

**Steps**
1. Define difficulty levels 1–4.
2. Implement per-section state (rolling last-2 answers):
   - 2 correct → difficulty +1
   - 2 incorrect → difficulty -1
   - else unchanged
3. Select next question from pool at target difficulty with no repeats.
4. Record `difficulty_served` for each response.

**Acceptance checks**
- No cross-section adaptivity.
- Difficulty changes match rules.

---

#### Story 9.2 — Fallback rules (insufficient pool)
**Outcome:** Test continues even if pool is thin.

**Steps**
1. If no question exists at target difficulty, fallback to nearest difficulty with availability.
2. Log fallback reason for analytics.

**Acceptance checks**
- No crashes; user completes test.

---

### Epic 10: Marking & Scoring (Out of 100)

#### Story 10.1 — MCQ marking
**Outcome:** MCQ correctness calculated.

**Steps**
1. Compare selected option to correct key.
2. Save `is_correct`.

**Acceptance checks**
- Correctness stored per response.

---

#### Story 10.2 — Score computation (overall + section) out of 100
**Outcome:** Results always shown as percentage.

**Steps**
1. Calculate per-section accuracy/weighted score.
2. Convert to out-of-100.
3. Persist to `attempts.score_out_of100` + `attempts.section_scores`.

**Acceptance checks**
- Score is consistent across repeat runs.

---

### Epic 11: Reports (Parent + Student) with Full Question Review

#### Story 11.1 — Parent premium report
**Outcome:** Parent sees actionable analytics.

**Steps**
1. Summary: overall score, time used.
2. Section breakdown: score, time per question.
3. Weak areas: by tags (topic/skill).
4. Create UI for “next steps” suggestions (based on weak tags).

**Acceptance checks**
- Parent can view report for linked student only.

---

#### Story 11.2 — Full question review (parent)
**Outcome:** Parent sees every question and explanation.

**Steps**
1. Render question with student answer and correct answer.
2. Show explanation:
   - Numeracy: step-by-step
   - Others: 1–2 lines
3. Provide navigation within review.

**Acceptance checks**
- All questions visible; no missing content.

---

#### Story 11.3 — Explanation rendering rules
**Outcome:** Explanations match subject rules.

**Steps**
1. For Numeracy section, prefer `explanation_steps`.
2. For others, show `explanation`.
3. Validate fallback behavior when missing.

**Acceptance checks**
- No blank explanation areas without a warning.

---

### Sprint 3 Exit Criteria
- Adaptive engine works for objective questions per section.
- Scores are computed out of 100.
- Parent premium report + full review works end-to-end.

---

## Sprint 4 — Payments + Entitlements + Short Answer Regex + Writing Async

### Epic 12: Payments & Entitlements (Stripe one-time)

#### Story 12.1 — Product catalog + cart
**Outcome:** Users can browse products and add to cart.

**Steps**
1. Create `/shop` and `/checkout` flows.
2. Read `products` + included tests.
3. Add items to cart (client state).

**Acceptance checks**
- Only logged-in users can view catalog.

---

#### Story 12.2 — Stripe checkout session
**Outcome:** One-time purchase checkout works.

**Steps**
1. Server API creates Stripe checkout session.
2. Redirect user to Stripe checkout.
3. Return to success/cancel URL.

**Acceptance checks**
- Test mode checkout completes in staging.

---

#### Story 12.3 — Webhook verification + idempotent entitlement grant
**Outcome:** Entitlements created only after verified webhook events.

**Steps**
1. Implement `/api/webhooks/stripe` using raw body.
2. Verify signature with `STRIPE_WEBHOOK_SECRET`.
3. Check idempotency table `processed_webhook_events` by `event_id`.
4. Create/update purchase row.
5. Insert `entitlements` for tests included in purchased products.

**Acceptance checks**
- Webhook replay does not duplicate entitlements.

---

#### Story 12.4 — Server-side gating for paid content
**Outcome:** Paid tests/questions invisible without entitlements.

**Steps**
1. Confirm RLS gating blocks access.
2. Add UI gating (paywall) for locked tests.
3. Ensure API returns 404/403 appropriately (avoid leaking existence).

**Acceptance checks**
- Non-entitled user cannot read paid test IDs.

---

### Epic 13: Short Answer Regex Marking

#### Story 13.1 — Regex marking with normalization
**Outcome:** Short answers marked via regex exact match tolerant to spacing.

**Steps**
1. Define normalization: trim, collapse whitespace, optional case normalization.
2. Store regex pattern in `questions.correct_answer` (JSON config).
3. Evaluate normalized answer against regex.
4. Log evaluation result.

**Acceptance checks**
- Equivalent spacing variants are treated consistently.

---

### Epic 14: Writing Async Marking + Notifications (QStash)

#### Story 14.1 — Writing pending state
**Outcome:** After submission, writing status becomes pending.

**Steps**
1. On submit, set attempt status to `WRITING_PENDING` when writing items exist.
2. Show UI message: “Your writing report will be ready shortly.”

**Acceptance checks**
- Pending state persists on refresh.

---

#### Story 14.2 — QStash enqueue + handler verification + idempotency
**Outcome:** Async pipeline runs reliably and securely.

**Steps**
1. Publish QStash job with payload: attempt_id, writing text, rubric version.
2. Implement `/api/jobs/writing-eval` handler.
3. Verify QStash signature.
4. Check `processed_jobs` for job_id (idempotency).
5. Call DeepSeek API.
6. Write `writing_evaluations` row.
7. Update attempt status to `COMPLETE`.

**Acceptance checks**
- Duplicate job deliveries do not duplicate results.

---

#### Story 14.3 — In-app notification on completion
**Outcome:** Parent receives notification “Writing report ready”.

**Steps**
1. Create notification row for parent user(s) linked to student.
2. Update UI notification badge.
3. Link to the attempt report.

**Acceptance checks**
- Notification visible in parent account only.

---

### Sprint 4 Exit Criteria
- Stripe payments create entitlements securely.
- Paid gating works end-to-end.
- Short answer regex marking works.
- Writing async flow produces report + in-app notification.

---

## Sprint 5 — Pixel Perfect UI + Analytics Rollups + Percentiles (Feature Flag)

### Epic 15: UI Polish (Premium academic, pixel-perfect)

#### Story 15.1 — Pixel-perfect pass (all primary screens)
**Outcome:** UI meets premium standards across mobile breakpoints.

**Steps**
1. Apply design tokens consistently.
2. Validate layouts on common devices.
3. Improve runner UX: touch targets, readability, transitions.
4. Ensure report readability and review navigation.

**Acceptance checks**
- UI sign-off by UX/UI.

---

#### Story 15.2 — Accessibility baseline
**Outcome:** Keyboard navigation and focus states work.

**Steps**
1. Add focus rings and tab order.
2. Ensure contrast meets standards.
3. Add aria labels for controls.

**Acceptance checks**
- Basic accessibility checklist passes.

---

### Epic 16: Analytics Aggregations

#### Story 16.1 — Compute analytics metrics for reports
**Outcome:** Store aggregates for time and accuracy by tag.

**Steps**
1. Define event/metric model: time per question, accuracy per tag, section stats.
2. Add scheduled or on-submit aggregation step.
3. Persist aggregates in attempt-level JSON fields or dedicated tables (future).

**Acceptance checks**
- Parent dashboard trend charts populated.

---

#### Story 16.2 — Percentiles engine (feature-flagged)
**Outcome:** Percentiles computed only when eligible.

**Steps**
1. Cohort definition: `Year + ExamType`.
2. Threshold: ≥200 attempts.
3. Compute percentile ranks.
4. Protect behind `FF_PERCENTILES_ENABLED`.

**Acceptance checks**
- Percentiles hidden until threshold met.

---

### Sprint 5 Exit Criteria
- Pixel-perfect UI completed.
- Analytics rollups populate dashboards.
- Percentiles implemented but feature-flagged.

---

## Sprint 6 — Security Verification (ASVS L2) + QA Hardening + Launch Readiness

### Epic 17: Security Verification Pack (ASVS L2)

#### Story 17.1 — ASVS L2 evidence pack completion
**Outcome:** Documented security verification aligned to ASVS Level 2.

**Steps**
1. Create ASVS checklist mapping to implemented controls:
   - auth/session
   - access control
   - input validation
   - logging/monitoring
   - data protection
2. Capture evidence: screenshots, test logs, policy listings.
3. Resolve any gaps.

**Acceptance checks**
- Evidence pack stored in `/docs/security/asvs-l2/`.

---

#### Story 17.2 — Broken access control regression suite
**Outcome:** Automated tests prevent regressions.

**Steps**
1. Write tests for:
   - role escalation attempts
   - IDOR attempts on attempts/responses
   - access to paid tests without entitlement
2. Run tests in CI.

**Acceptance checks**
- Tests fail if unauthorized data is accessible.

---

#### Story 17.3 — Rate limiting review (auth, webhooks, jobs)
**Outcome:** Abuse controls validated.

**Steps**
1. Add rate limiting to:
   - auth endpoints
   - assignment/test start
   - submit
   - admin endpoints
   - webhooks and job handlers
2. Confirm correct 429 responses and logging.

**Acceptance checks**
- High-volume test triggers throttling.

---

### Epic 18: Release Readiness

#### Story 18.1 — Backup/restore drill + rollback test
**Outcome:** Operational readiness.

**Steps**
1. Confirm Supabase backups are enabled.
2. Run restore drill in staging.
3. Validate rollback path in Vercel.

**Acceptance checks**
- Restore procedure documented.
- Rollback tested.

---

#### Story 18.2 — Final regression & go-live checklist
**Outcome:** “One-go” production launch ready.

**Steps**
1. Run full regression on staging:
   - parent onboarding + child creation
   - free test access
   - paid purchase + entitlement
   - test runner + adaptive
   - reports + writing async
2. Run security smoke checks.
3. Freeze release candidate and deploy to production.

**Acceptance checks**
- All critical paths pass with no P0 defects.

---

### Sprint 6 Exit Criteria
- ASVS L2 evidence complete.
- Access control regression suite in CI.
- Operational drills complete.
- Production launch executed.

