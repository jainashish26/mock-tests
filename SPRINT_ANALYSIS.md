# MockTests Pro - Comprehensive Sprint Task Analysis

## Project Overview

**MockTests Pro** is an Australian EdTech platform for Years 3-8 students, offering adaptive mock tests for NAPLAN, Selective School, Scholarship, and Olympiad exam preparation. It is built with **Next.js 16**, **Supabase** (Auth + Postgres + RLS), **Tailwind CSS v4**, **Stripe** for payments, **DeepSeek AI** for writing evaluation, and **QStash** for async job processing.

**User Roles:** PARENT, TUTOR, STUDENT, TEST_CREATOR, ADMIN

---

## SPRINT 0 - Foundation & Infrastructure (DONE)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 0.1 | Next.js 16 project setup with App Router | Done | Turbopack enabled |
| 0.2 | Supabase integration (client, server, admin clients) | Done | src/lib/supabase/ |
| 0.3 | Database schema - Enums (user_role, exam_type, content_status, question_type, attempt_status) | Done | 001_enums.sql |
| 0.4 | Database schema - 17 tables (app_user_roles, student_profiles, parent_student_links, tests, test_sections, questions, test_questions, assignments, attempts, responses, writing_evaluations, notifications, products, product_tests, purchases, entitlements, processed_webhook_events, processed_jobs) | Done | 002_tables.sql |
| 0.5 | Database indexes for performance | Done | 003_indexes.sql |
| 0.6 | RLS helper functions (has_role, is_parent_of, is_student_self, is_attempt_owner, has_entitlement, can_access_published_test) | Done | 004_rls_helpers.sql |
| 0.7 | RLS policies for all 17 tables | Done | 005_rls_policies.sql |
| 0.8 | RBAC middleware (getUserRole, requireRole) | Done | src/lib/rbac/ |
| 0.9 | Structured JSON logger | Done | src/lib/logging/logger.ts |
| 0.10 | Supabase middleware (session cookie refresh) | Done | src/proxy.ts |
| 0.11 | TypeScript types for core entities | Done | src/types/index.ts |

---

## SPRINT 1 - Authentication & User Management (DONE)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1.1 | Parent signup/login via Supabase Auth (email+password) | Done | auth/signup/page.tsx, auth/login/page.tsx |
| 1.2 | Student login with username (synthetic email pattern) | Done | auth/student-login/page.tsx, StudentLoginForm.tsx |
| 1.3 | Auth callback route for OAuth | Done | auth/callback/route.ts |
| 1.4 | Role assignment API endpoint | Done | /api/auth/assign-role |
| 1.5 | Parent creates child profiles (flower+fruit username generation, 4-child limit) | Done | /api/parent/child, ChildCreationForm.tsx |
| 1.6 | Tutor creates student profiles (no limit) | Done | /api/tutor/child |
| 1.7 | Admin user management & role changes | Done | /api/admin/users/[id]/role, admin/users/page.tsx |

---

## SPRINT 2 - Core Dashboards (DONE)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 2.1 | Admin Dashboard (pending tests/questions review queue) | Done | admin/page.tsx |
| 2.2 | Test Creator Dashboard (drafts, questions, bulk import link) | Done | creator/page.tsx |
| 2.3 | Parent Dashboard (linked children, avg scores, assign tests) | Done | parent/page.tsx |
| 2.4 | Tutor Dashboard (students, reports, assign tests) | Done | tutor/page.tsx |
| 2.5 | Student Dashboard (assignments, streaks, AI writing banner) | Done | student/page.tsx with year-themed mascots |
| 2.6 | Shared DashboardLayout with role-based sidebar navigation | Done | DashboardLayout.tsx |

---

## SPRINT 3 - Content Management System (DONE)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 3.1 | Test Editor (create/edit tests with all fields) | Done | TestEditor.tsx, /api/creator/tests |
| 3.2 | Question Editor (5-section form: core, answers, metadata, psychometrics, skills) | Done | QuestionEditor.tsx, /api/creator/questions |
| 3.3 | Creator tests listing page | Done | creator/tests/page.tsx |
| 3.4 | CSV Bulk Upload for questions (column mapping, enum normalization, validation) | Done | /api/creator/upload-questions, creator/upload/page.tsx |
| 3.5 | Admin review/approve tests & questions (approve -> PUBLISHED, reject -> DRAFT) | Done | /api/admin/review/[entity]/[id] |
| 3.6 | Admin review tests data table | Done | admin/review/tests/page.tsx |
| 3.7 | Admin review entity detail page | Done | admin/review/[entity]/[id]/page.tsx |

---

## SPRINT 4 - Test Runner & Scoring (DONE)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 4.1 | Test Runner UI (timer, question navigation, flagging, offline support) | Done | TestRunner.tsx |
| 4.2 | Auto-save to localStorage + sync queue for offline resilience | Done | Built into TestRunner |
| 4.3 | Accessibility features (high-contrast, dark mode, font sizes) | Done | Theme/font controls in TestRunner |
| 4.4 | Sequential question unlocking | Done | maxUnlockedIndex logic |
| 4.5 | Submit confirmation modal with stats | Done | Answered/unanswered/flagged counts |
| 4.6 | Runner API: start attempt | Done | /api/runner/start |
| 4.7 | Runner API: save response (upsert) | Done | /api/runner/save |
| 4.8 | Runner API: submit attempt + trigger scoring | Done | /api/runner/submit |
| 4.9 | Scoring engine (MCQ exact match, short answer case-insensitive, section scores) | Done | score-attempt.ts |

---

## SPRINT 5 - Payments & Monetization (DONE)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 5.1 | Stripe client setup | Done | src/lib/stripe/client.ts |
| 5.2 | Checkout session creation (15 AUD per test) | Done | /api/checkout |
| 5.3 | Stripe webhook handler (checkout.session.completed -> purchase + entitlement) | Done | /api/webhooks/stripe |
| 5.4 | Idempotency via processed_webhook_events | Done | In webhook handler |
| 5.5 | CheckoutButton component | Done | CheckoutButton.tsx |
| 5.6 | Products & product_tests tables | Done | In schema |

---

## SPRINT 6 - Public Pages & Marketing (DONE)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 6.1 | Landing page (hero, stats counter, features, testimonials, blog strip, CTA) | Done | page.tsx with Framer Motion animations |
| 6.2 | About page | Done | (public)/about/page.tsx |
| 6.3 | Features page | Done | (public)/features/page.tsx |
| 6.4 | Free tests listing page | Done | (public)/free/page.tsx |
| 6.5 | Paid tests store page | Done | (public)/tests/page.tsx |
| 6.6 | Blog listing page | Done | (public)/blog/page.tsx |
| 6.7 | Blog post detail page with reading progress bar | Done | (public)/blog/[slug]/page.tsx, ReadingProgressBar.tsx |
| 6.8 | Blog content component | Done | BlogPostContent.tsx |
| 6.9 | Blog data (20+ posts about NAPLAN, selective school, study tips) | Done | src/data/posts/ |
| 6.10 | Header with scroll-aware blur, mobile menu | Done | Header.tsx |
| 6.11 | Footer with comprehensive links | Done | Footer.tsx |
| 6.12 | PublicLayout wrapper | Done | PublicLayout.tsx |

---

## SPRINT 7 - UI/UX Design System (DONE)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 7.1 | Tailwind CSS v4 integration with PostCSS | Done | postcss.config.mjs |
| 7.2 | shadcn/ui setup (components.json) | Done | |
| 7.3 | Design tokens CSS variables | Done | tokens.css |
| 7.4 | Button component (variants: default, outline, ghost, secondary; sizes) | Done | Button.tsx |
| 7.5 | Badge component | Done | Badge.tsx |
| 7.6 | Card component | Done | Card.tsx |
| 7.7 | SpatialCard (3D parallax hover effect) | Done | Referenced in dashboards |
| 7.8 | MeshGradientBackground (animated gradient) | Done | MeshGradientBackground.tsx |
| 7.9 | Floating3DElement | Done | Floating3DElement.tsx |
| 7.10 | Utility CSS module | Done | utils.module.css |
| 7.11 | cn() utility (clsx + tailwind-merge) | Done | src/lib/utils.ts |
| 7.12 | Global CSS with Tailwind imports | Done | globals.css |

---

## SPRINT 8 - SEO & Technical Foundation (DONE)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 8.1 | manifest.ts (PWA web manifest) | Done | |
| 8.2 | robots.ts (search engine directives) | Done | |
| 8.3 | sitemap.ts (dynamic sitemap generation) | Done | |
| 8.4 | Metadata in layout.tsx | Done | Title + description |

---

## SPRINT 9 - AI Writing Evaluation (DONE)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 9.1 | DeepSeek AI integration for writing evaluation | Done | /api/jobs/writing-eval |
| 9.2 | QStash serverless job trigger after test submission | Done | In score-attempt.ts |
| 9.3 | QStash signature verification | Done | verifySignatureAppRouter |
| 9.4 | Writing evaluation storage (strengths, improvements, improved_text) | Done | writing_evaluations table |
| 9.5 | Attempt status flow (IN_PROGRESS -> SUBMITTED -> WRITING_PENDING -> COMPLETE) | Done | In scoring + writing eval |

---

## SPRINT 10 - Missing Features & Gaps (TO DO)

| # | Task | Priority | Status | Notes |
|---|------|----------|--------|-------|
| 10.1 | Student Test Page (/student/test/[assignmentId]) - loads assignment details and renders TestRunner | Critical | Missing | Referenced in student dashboard but page not found |
| 10.2 | Student Report Page (/student/report) - view completed test results, section scores | Critical | Missing | Linked in sidebar |
| 10.3 | Parent Child Detail Page (/parent/child/[id]) - detailed child progress, assign tests | Critical | Missing | Linked in parent dashboard |
| 10.4 | Test Report Component - referenced in codebase but file not found | Critical | Missing | features/report/components/TestReport.tsx |
| 10.5 | Assign Test Modal - referenced but file not found | High | Missing | features/auth/components/AssignTestModal.tsx |
| 10.6 | Admin Review Panel Component - referenced but file not found | High | Missing | features/cms/components/AdminReviewPanel.tsx |
| 10.7 | Student Settings Page (/student/settings) | High | Missing | Linked in sidebar |
| 10.8 | Parent Settings Page (/parent/settings) | High | Missing | Linked in sidebar |
| 10.9 | Tutor Settings Page (/tutor/settings) | High | Missing | Linked in sidebar |
| 10.10 | Student AI Practice Page (/student/ai-practice) | High | Missing | Linked in dashboard + sidebar |
| 10.11 | Creator Test Detail Page (/creator/tests/[id]) - edit existing test | High | Missing | Linked from creator dashboard |
| 10.12 | Creator New Test Page (/creator/tests/new) | High | Missing | Linked from creator dashboard |
| 10.13 | Creator Question Pages (/creator/questions/new, /creator/questions/[id]) | High | Missing | Linked from creator dashboard |
| 10.14 | Creator Tests [id] API (GET/PUT/DELETE) | High | Missing | Only POST exists |
| 10.15 | Creator Questions [id] API (GET/PUT/DELETE) | High | Missing | Need to verify |
| 10.16 | Middleware (middleware.ts) - route protection at middleware level | High | Missing | proxy.ts exists but not wired as middleware.ts |
| 10.17 | Notification system - table exists, no UI or API to create/read notifications | Medium | Missing | Bell icon in dashboard is non-functional |
| 10.18 | Test sections management - test_sections table exists but no UI to create/manage sections | Medium | Missing | |
| 10.19 | Parent store page (/parent/store) - success/cancel handling from Stripe | Medium | Missing | Referenced in checkout redirect URLs |
| 10.20 | Tutor student detail page (/tutor/student/[id]) | Medium | Missing | Linked from tutor dashboard |
| 10.21 | Admin settings page (/admin/settings) | Medium | Missing | Referenced in code |
| 10.22 | Privacy Policy, Terms of Service, FAQ pages | Medium | Missing | Footer links point to /about |
| 10.23 | Error pages (404, 500, error.tsx, not-found.tsx) | Medium | Missing | Next.js standard |
| 10.24 | Loading states (loading.tsx for each route group) | Low | Missing | |
| 10.25 | Email notifications (assignment reminders, results ready) | Low | Missing | |
| 10.26 | Adaptive difficulty - difficulty_served is hardcoded to 1 in runner/save | Low | Partial | Schema supports it, logic not implemented |
| 10.27 | Unit/Integration tests | Low | Missing | No test files found |
| 10.28 | E2E tests (Playwright/Cypress) | Low | Missing | |

---

## SPRINT 11 - Polish & Production Readiness (TO DO)

| # | Task | Priority | Status |
|---|------|----------|--------|
| 11.1 | Environment variable documentation (.env.example) | Critical | Missing |
| 11.2 | README.md with project setup instructions | Critical | Only default Next.js README |
| 11.3 | Remove .backup files (page.tsx.backup, page.module.css.backup, blog/page.tsx.backup) | High | Should be cleaned |
| 11.4 | Remove clean_chars.ps1 from repo | High | Script artifact |
| 11.5 | Add .gitignore for .env.local | High | Check if covered |
| 11.6 | Stripe webhook URL configuration for production | Medium | Missing |
| 11.7 | DeepSeek API key configuration | Medium | Missing |
| 11.8 | QStash configuration (token, endpoint URLs) | Medium | Missing |
| 11.9 | Vercel deployment configuration | Medium | Missing |
| 11.10 | Image optimization (next/image for blog, mascots) | Low | Missing |
| 11.11 | Performance audit (Lighthouse scores) | Low | Missing |
| 11.12 | Accessibility audit (WCAG 2.1 AA compliance) | Low | Partial - aria labels added |
| 11.13 | Rate limiting on API routes | Low | Missing |
| 11.14 | Input validation (Zod schemas for API routes) | Medium | Only basic validation exists |
| 11.15 | Error boundaries (React error boundaries for client components) | Medium | Missing |

---

## SPRINT 12 - Advanced Features (FUTURE)

| # | Task | Priority |
|---|------|----------|
| 12.1 | Real-time notifications (Supabase Realtime) | Future |
| 12.2 | Analytics dashboard for admin (user growth, revenue, test completion rates) | Future |
| 12.3 | Parent/Tutor subscription plans (monthly/yearly) | Future |
| 12.4 | Test question randomization from question bank | Future |
| 12.5 | Detailed skill-gap analysis per student | Future |
| 12.6 | Progress charts (line/bar charts over time) | Future |
| 12.7 | Social features (leaderboards, class competitions) | Future |
| 12.8 | Multi-language support | Future |
| 12.9 | Mobile app (React Native / PWA) | Future |
| 12.10 | Content versioning (test/question revision history) | Future |

---

## Summary Statistics

| Category | Count |
|----------|-------|
| Total tasks identified | ~95 |
| Completed | ~65 (68%) |
| To Do | ~28 (30%) |
| Partial | ~3 (3%) |

---

## Information Needed to Proceed

1. **Supabase Project**: Is the Supabase project already set up with migrations applied? Do you have the project URL and keys?
2. **Stripe Account**: Is the Stripe account configured? Do you have test mode keys?
3. **DeepSeek API Key**: Is the DeepSeek API key obtained and configured?
4. **QStash Account**: Is Upstash QStash configured for async writing evaluation jobs?
5. **Deployment Target**: Are you deploying to Vercel? Any specific domain?
6. **Design Assets**: Do you have brand guidelines, logos, or specific color preferences beyond the current tokens?
7. **Content**: Do you have actual test content (questions) ready, or should I create sample data?
8. **Priority**: Which sprint should we tackle first? I recommend Sprint 10 (missing pages/features) as it has the most critical gaps.

---

## Suggestions & Feedback

### Strengths
- **Excellent database design** - comprehensive schema with proper RLS, indexes, and helper functions
- **Clean RBAC architecture** - role-based access control is well-structured
- **Great public pages** - landing page is visually impressive with animations
- **Solid offline-first test runner** - localStorage + sync queue is a smart approach
- **Good separation of concerns** - features/, lib/, components/ are well organized

### Areas of Concern
1. **Missing middleware.ts** - proxy.ts exists but is not wired as Next.js middleware. Route protection relies solely on requireRole() in each page, which could be bypassed.
2. **Missing pages create broken links** - Student dashboard links to /student/test/[id], /student/report, /student/ai-practice, etc. that do not exist yet.
3. **Backup files in repo** - .backup files should be removed and added to .gitignore.
4. **Hardcoded prices** - 15 AUD is hardcoded in checkout. Should use products table.
5. **No error handling UI** - Missing error.tsx and not-found.tsx files.
6. **Exam type mismatch** - DB enum has 4 types (BENCHMARK, NAPLAN_STYLE, OLYMPIAD, SELECTIVE) but TypeScript has 17+ granular types. These are out of sync.
7. **Student dashboard hardcodes streak data** - streakDays = [1, 1, 1, 1, 1, 0, 0] is mocked.
8. **No test coverage** - Zero unit/integration/E2E tests.

### Recommended Next Steps (Priority Order)
1. **Sprint 10.1-10.5**: Build the missing critical pages (student test, reports, parent child detail)
2. **Sprint 10.16**: Wire up middleware.ts for proper route protection
3. **Sprint 11.1-11.3**: Create .env.example, update README, clean up backup files
4. **Sprint 10.11-10.13**: Build creator detail/edit pages
5. **Sprint 11.14**: Add Zod validation to all API routes
