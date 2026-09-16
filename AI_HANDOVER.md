# AI Handover Document - Mock Tests Web Platform

This document is designed to provide comprehensive context and setup instructions for another AI model or developer taking over the development of the "Mock Tests" web platform. 

## 1. Project Overview

**Mock Tests** is an educational web platform designed to provide adaptive mock tests for students. It supports distinct roles:
- **Admin**: System management and content approval.
- **Creator**: Authors questions and tests.
- **Parent**: Manages student profiles, assigns tests, and views premium reports.
- **Student**: Takes tests in a distraction-free runner and sees simplified results.

### Key Features:
- Layered access control via Postgres Row Level Security (RLS) + API Role-Based Access Control (RBAC).
- Adaptive testing engine (server-side selection of questions based on rolling difficulty).
- AI marking for writing questions (using DeepSeek API via Upstash QStash).
- Subscriptions/Payments via Stripe.
- No student PII (synthetic email pattern used).

## 2. Tech Stack

- **Framework**: Next.js 15 (App Router, React 19)
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4, shadcn/ui
- **Database & Auth**: Supabase (PostgreSQL, Supabase Auth)
- **State Management**: TanStack Query (server state), Zustand (client test runner state)
- **Payments**: Stripe (Checkout Sessions)
- **Async Jobs & Queue**: Upstash QStash (for AI writing evaluation pipeline)
- **Testing**: Vitest, Playwright
- **Linting/Formatting**: ESLint, Prettier

## 3. Directory Structure

The project code is primarily located inside the `mock-tests` directory.

- `mock-tests/src/app`: Next.js App Router routes and layouts.
- `mock-tests/src/components`: Reusable UI components (including `shadcn/ui`).
- `mock-tests/src/features`: Domain-specific features (e.g., test runner, CMS).
- `mock-tests/src/lib`: Core utilities (Supabase clients, RBAC guards, logging).
- `mock-tests/supabase/migrations`: Supabase SQL schema migrations and RLS policies.
- `mock-tests/supabase/seed`: SQL scripts to seed the database with initial tests, roles, and dummy users.
- `01-mock-tests-project-charter.md` through `07-implementation-plan.md`: Planning documents defining the entire architecture, schema, sprints, and DB details.

## 4. Current State vs. What's Left

Development is mapped out across **6 Sprints** (detailed in `07-implementation-plan.md`). 

**What's been done (or is in progress):**
- Initial Next.js 15 project scaffolded in `mock-tests/`.
- Basic dependencies installed (`package.json` contains Supabase, Upstash, Stripe, Framer Motion, Lucide React).
- Planning documents are extremely thorough, especially the database schema, RLS policies, and Sprint breakdowns.

**What's left to do (Next LLM Action Items):**
1. **Database & Schema**: Check if `supabase/migrations/` have been written. If not, refer to `07-implementation-plan.md` (Sprint 1) and `04-mock-tests-db-schema.md` to create the initial schema, enums, triggers, and RLS policies.
2. **Auth & RBAC**: Implement the synthetic email pattern for students and role-based redirects.
3. **Seed Data**: Run/create seed scripts as defined in `02-mock-tests-rls-and-seed-plan.md` to unblock UI testing.
4. **UI/UX**: Proceed with the layouts and views as outlined in Sprint 2 (Parent child creation, CMS question editor).
5. **Follow the plan**: Strictly follow `07-implementation-plan.md` sequentially (Sprint 1 -> Sprint 6).

## 5. Local Setup Instructions

To get the project running locally, follow these exact steps:

### Prerequisites
- Node.js (v20+ recommended)
- Supabase CLI installed locally (`npm install -g supabase`)
- Docker Desktop (must be running for local Supabase)
- Git

### Step-by-Step Installation

1. **Navigate to the Project Root**
   ```bash
   cd mock-tests
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Start Local Supabase**
   Ensure Docker is running, then initialize and start Supabase:
   ```bash
   supabase init
   supabase start
   ```
   *Note: This will spin up a local PostgreSQL instance, API gateway, and Auth server. It will output your local `API URL` and `anon key`.*

4. **Apply Migrations and Seed Data**
   ```bash
   supabase db reset
   ```
   *This applies all SQL migrations in `supabase/migrations` and loads `supabase/seed/seed.sql`.*

5. **Environment Variables**
   - Copy `.env.example` to `.env.local`:
     ```bash
     cp ../06-env.example .env.local
     ```
   - Update `.env.local` with the local Supabase URLs provided from the `supabase start` command output:
     ```env
     NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"
     NEXT_PUBLIC_SUPABASE_ANON_KEY="<your-local-anon-key>"
     SUPABASE_SERVICE_ROLE_KEY="<your-local-service-role-key>"
     ```

6. **Run the Development Server**
   ```bash
   npm run dev
   ```
   The app will be accessible at [http://localhost:3000](http://localhost:3000).

## 6. Important Notes for the Next AI Context

1. **Role-Level Security (RLS)** is a core pillar of this app. The database schema relies heavily on RLS policies to restrict row visibility. Do not bypass RLS unless explicitly needed for a background job using the `service_role` key.
2. **Student PII**: We strictly use synthetic emails for students (`student_{uuid}@mock-tests.internal`). Do not request or store real student emails.
3. **Adaptive Engine**: The adaptive test difficulty logic runs *server-side*. The client should never receive the entire question pool, only the current question.
4. **AI Marking (DeepSeek)**: Handled asynchronously. The test is marked as `WRITING_PENDING`, a QStash job is created, and a webhook handles the final result. See `DeepSeek Writing Prompt.txt` for the prompt design.

**Before modifying anything, always review:**
- `07-implementation-plan.md`
- `04-mock-tests-db-schema.md`
