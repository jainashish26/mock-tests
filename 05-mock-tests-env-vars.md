# Environment Variables — Mock Tests Platform (Vercel + Supabase + QStash + Stripe + SendGrid)

> **Purpose**: This document lists **all environment variables** required to run the platform across **Vercel (Web + API routes)**, **Supabase (DB + Auth)**, **Upstash QStash (async jobs)**, **Stripe (one‑time payments)**, **SendGrid (SMTP for Supabase Auth emails)**, and supporting services.
>
> **Conventions**
> - **SERVER ONLY**: Must be set in Vercel as *Server Environment Variables* and **never** exposed to the browser.
> - **PUBLIC (Client)**: Prefixed with `NEXT_PUBLIC_` and safe to expose to the browser (contains no secrets).
> - Use separate values for **Development**, **Preview/Staging**, and **Production**.
>
> **Recommended environments**
> - `development` (local)
> - `preview` / `staging` (Vercel Preview Deployments)
> - `production` (Vercel Production)

---

## 1) Vercel / Next.js — Core App Variables

### 1.1 Application identity & URLs
- `APP_NAME` (**SERVER ONLY**) — Display name for emails/logging (e.g., `"Mock Tests"`).
- `APP_ENV` (**SERVER ONLY**) — `development | staging | production`.
- `APP_URL` (**SERVER ONLY**) — Base URL of the deployed app.
  - Example: `https://yourdomain.com` (prod), `https://<vercel-preview>.vercel.app` (preview)
- `NEXT_PUBLIC_APP_URL` (**PUBLIC**) — Same as `APP_URL` but client-readable.

### 1.2 Security & sessions
> If you use Supabase Auth session cookies only, you may not need your own session secret. Keep these for server-side signing, state and encryption.

- `SESSION_SECRET` (**SERVER ONLY**) — Random 32+ bytes for signing server-side sessions (if used).
- `APP_ENCRYPTION_KEY` (**SERVER ONLY**) — Random 32 bytes for encrypting sensitive server-side payloads (optional but recommended).
- `CSRF_SECRET` (**SERVER ONLY**) — Secret used by CSRF middleware (if implemented).

### 1.3 Feature flags (optional)
- `FF_PERCENTILES_ENABLED` (**SERVER ONLY**) — `true|false` (keep false until cohort ≥ threshold).
- `FF_LEADERBOARD_ENABLED` (**SERVER ONLY**) — `true|false`.

---

## 2) Supabase — Project, DB, and Auth

### 2.1 Supabase project connection
- `NEXT_PUBLIC_SUPABASE_URL` (**PUBLIC**) — Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (**PUBLIC**) — Supabase anon key.

### 2.2 Supabase privileged access
- `SUPABASE_SERVICE_ROLE_KEY` (**SERVER ONLY**) — Service role key (bypasses RLS). Use ONLY in trusted endpoints (webhooks/jobs/admin bulk).

### 2.3 Database connection (migrations/maintenance)
> If you run SQL migrations via Supabase CLI, you may not need `DATABASE_URL` in Vercel. Keep it for server-side scripts, analytics jobs, or CI.

- `DATABASE_URL` (**SERVER ONLY**) — Postgres connection string (prefer pooling connection if available).
- `DATABASE_URL_NON_POOLING` (**SERVER ONLY, optional**) — Direct connection for migrations if pooling causes issues.

### 2.4 Supabase Auth email (SendGrid SMTP)
Set these in **Supabase Dashboard → Auth → SMTP** (not necessarily as Vercel env vars), but keep values documented here.

- `SMTP_HOST` — e.g., `smtp.sendgrid.net`
- `SMTP_PORT` — usually `587` (STARTTLS)
- `SMTP_USER` — SendGrid username (often `apikey`)
- `SMTP_PASS` — SendGrid API key used as SMTP password
- `SMTP_SENDER_NAME` — e.g., `Mock Tests`
- `SMTP_SENDER_EMAIL` — e.g., `no-reply@yourdomain.com`

### 2.5 Supabase Auth settings (Supabase dashboard)
- **Site URL**: must match `APP_URL` (prod) and allow preview URLs as additional redirect URLs.
- **Redirect URLs allowlist**: include
  - `APP_URL/*`
  - Vercel preview pattern (as needed)
  - `APP_URL/auth/callback` (required for social sign-in — see 2.6)

### 2.6 Social sign-in — Google (Supabase-hosted OAuth)

> **Key point:** Supabase is the OAuth client. The Google client ID and client
> secret are stored in the **Supabase Dashboard**, never in this app's
> environment. There are therefore no `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
> variables to set in Vercel.

**App-side variables**

- `NEXT_PUBLIC_SOCIAL_AUTH_GOOGLE_ENABLED` (**PUBLIC**) — `"true"|"false"`. Controls
  whether the "Continue with Google" buttons render. Keep it `"false"` in any
  environment where the provider has not been enabled in that project's Supabase
  dashboard, otherwise the button produces a "Provider is not enabled" error.
- `NEXT_PUBLIC_SOCIAL_AUTH_FACEBOOK_ENABLED` (**PUBLIC**) — reserved; the Meta app
  does not exist yet, so Facebook is not registered in `src/lib/auth/oauth.ts`.

**Two distinct redirect URLs — the most common misconfiguration**

| Where | Value |
|---|---|
| Google Cloud → OAuth client → *Authorized redirect URIs* | `https://<project-ref>.supabase.co/auth/v1/callback` |
| Supabase → Authentication → URL Configuration → *Redirect URLs* | `APP_URL/auth/callback`, e.g. `http://localhost:3000/auth/callback` and `https://<prod-domain>/auth/callback` |

Both are required. Exact match, no trailing slash, no wildcards.

**Supabase Dashboard → Authentication → Sign In / Providers → Google**: enable,
then paste the **Client ID** and **Client Secret** from the Google OAuth client
and Save.

Full console walkthrough, scopes and provider-specific quirks:
`09-social-auth-google-setup.md`.

---

## 3) Upstash QStash — Async Jobs

### 3.1 QStash tokens & signing
- `QSTASH_TOKEN` (**SERVER ONLY**) — Token for publishing jobs.
- `QSTASH_CURRENT_SIGNING_KEY` (**SERVER ONLY**) — Signing key for verifying job deliveries.
- `QSTASH_NEXT_SIGNING_KEY` (**SERVER ONLY, optional**) — For key rotation.

### 3.2 Job endpoints (internal)
- `QSTASH_BASE_CALLBACK_URL` (**SERVER ONLY**) — Base callback URL for job handlers (usually `APP_URL`).
- `QSTASH_WRITING_EVAL_ENDPOINT` (**SERVER ONLY**) — Full URL path to writing evaluation job handler.
  - Example: `${QSTASH_BASE_CALLBACK_URL}/api/jobs/writing-eval`
- `QSTASH_ANALYTICS_ROLLUP_ENDPOINT` (**SERVER ONLY, optional**) — Full URL for analytics rollup job.

### 3.3 Job safety
- `QSTASH_MAX_RETRIES` (**SERVER ONLY, optional**) — e.g., `5`
- `QSTASH_RETRY_BACKOFF_SECONDS` (**SERVER ONLY, optional**) — e.g., `60`

---

## 4) Stripe — One‑Time Payments (No Subscription)

### 4.1 Stripe keys
- `STRIPE_SECRET_KEY` (**SERVER ONLY**) — Stripe secret key.
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (**PUBLIC**) — Publishable key for client checkout (if needed).

### 4.2 Webhooks
- `STRIPE_WEBHOOK_SECRET` (**SERVER ONLY**) — Webhook signing secret for your Stripe webhook endpoint.
- `STRIPE_WEBHOOK_PATH` (**SERVER ONLY, optional**) — e.g., `/api/webhooks/stripe`.

### 4.3 Checkout URLs
- `STRIPE_SUCCESS_URL` (**SERVER ONLY**) — Redirect URL after successful payment.
  - Example: `${APP_URL}/checkout/success`
- `STRIPE_CANCEL_URL` (**SERVER ONLY**) — Redirect URL after cancellation.
  - Example: `${APP_URL}/checkout/cancel`

### 4.4 Product mapping
> You store `stripe_price_id` in `products.stripe_price_id` in Postgres.

- `STRIPE_DEFAULT_CURRENCY` (**SERVER ONLY, optional**) — `AUD`.

---

## 5) SendGrid — Operational Email (Optional)

> You are using **SendGrid SMTP inside Supabase Auth**. The following variables are only needed if your app sends additional emails directly (beyond Supabase Auth flows).

- `SENDGRID_API_KEY` (**SERVER ONLY, optional**) — SendGrid API key.
- `SENDGRID_FROM_EMAIL` (**SERVER ONLY, optional**) — From address.
- `SENDGRID_FROM_NAME` (**SERVER ONLY, optional**) — From name.

---

## 6) DeepSeek — Writing Marking API

- `DEEPSEEK_API_KEY` (**SERVER ONLY**) — API key for writing rubric scoring.
- `DEEPSEEK_MODEL` (**SERVER ONLY, optional**) — API model identifier. Verified live (2026-11): the API rejects marketing names — the supported ids are `deepseek-flash` and `deepseek-v4-pro`, and `deepseek-chat` is an alias that routes to `deepseek-flash`. The business-named "DeepSeek-V4.1-Flash" therefore maps to `DEEPSEEK_MODEL=deepseek-flash`. Unset falls back to `deepseek-chat`.
- `DEEPSEEK_BASE_URL` (**SERVER ONLY, optional**) — unset → `https://api.deepseek.com`.
- `DEEPSEEK_TIMEOUT_SECONDS` (**SERVER ONLY, optional**) — unset → 90. Full-rubric essay grades were measured at 18–58 s live, so the old 30 s suggestion times out; the graded routes also export `maxDuration` for Vercel.

### 6.1 Prompt / rubric configuration
- `WRITING_RUBRIC_PROMPT_VERSION` (**SERVER ONLY**) — Version string for your rubric prompt (e.g., `v1.0`).
- `WRITING_RUBRIC_CONFIG_JSON` (**SERVER ONLY, optional**) — JSON string to parameterize rubric (if you want server-side config without code edits).

---

## 7) Rate Limiting / Abuse Prevention (Recommended)

> For production-grade security, implement rate limiting at key endpoints: login, OTP, assignments, start attempt, submit attempt, payments, admin actions.

### 7.1 Upstash Redis (recommended)
- `UPSTASH_REDIS_REST_URL` (**SERVER ONLY**) — Redis REST URL.
- `UPSTASH_REDIS_REST_TOKEN` (**SERVER ONLY**) — Redis REST token.

### 7.2 Rate limit configuration
- `RATE_LIMIT_WINDOW_SECONDS` (**SERVER ONLY, optional**) — e.g., `60`.
- `RATE_LIMIT_MAX_REQUESTS` (**SERVER ONLY, optional**) — e.g., `30`.

---

## 8) Observability / Monitoring (Recommended)

### 8.1 Error tracking (e.g., Sentry)
- `SENTRY_DSN` (**PUBLIC or SERVER ONLY depending on setup**) — Typically public DSN can be exposed.
- `SENTRY_AUTH_TOKEN` (**SERVER ONLY**) — Required for uploading sourcemaps (CI).
- `SENTRY_ORG` (**SERVER ONLY**) — Org slug.
- `SENTRY_PROJECT` (**SERVER ONLY**) — Project slug.

### 8.2 Logging
- `LOG_LEVEL` (**SERVER ONLY**) — `debug|info|warn|error`.
- `LOG_FORMAT` (**SERVER ONLY, optional**) — `json|pretty`.

---

## 9) Analytics / Product Telemetry (Optional)

- `NEXT_PUBLIC_ANALYTICS_ID` (**PUBLIC, optional**) — Plausible/GA/etc.
- `ANALYTICS_WRITE_KEY` (**SERVER ONLY, optional**) — Segment/etc.

---

## 10) File Storage (Question Images) — If using Supabase Storage

> If you store question images in Supabase Storage buckets.

- `SUPABASE_STORAGE_BUCKET` (**SERVER ONLY or PUBLIC depending on access**) — e.g., `question-images`.
- `NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET` (**PUBLIC, optional**) — only if you need bucket name client-side.

---

## 11) Environment variable templates

### 11.1 Minimal required (Production)
Copy/paste and fill values:

```bash
# Core
APP_NAME=
APP_ENV=production
APP_URL=
NEXT_PUBLIC_APP_URL=
SESSION_SECRET=
APP_ENCRYPTION_KEY=

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# QStash
QSTASH_TOKEN=
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_BASE_CALLBACK_URL=
QSTASH_WRITING_EVAL_ENDPOINT=

# Stripe
STRIPE_SECRET_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_SUCCESS_URL=
STRIPE_CANCEL_URL=

# DeepSeek
DEEPSEEK_API_KEY=
WRITING_RUBRIC_PROMPT_VERSION=v1.0

# Optional (recommended)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
LOG_LEVEL=info
```

### 11.2 Staging / Preview
Same keys as production, but:
- `APP_ENV=staging`
- `APP_URL` points to staging/preview URL
- Stripe uses test keys + test webhook secret

---

## 12) Secret handling rules (must-follow)

1. Never commit secrets to Git.
2. Do not expose **SERVER ONLY** variables to client bundles.
3. Only use `SUPABASE_SERVICE_ROLE_KEY` inside:
   - Stripe webhook handler
   - QStash job handlers
   - Admin-only endpoints (guarded by RBAC)
4. Rotate keys on schedule or upon suspected compromise.

---

## 13) Quick validation checklist

- [ ] Supabase Auth SMTP configured with SendGrid.
- [ ] RLS enabled and verified in Supabase.
- [ ] Stripe webhook secret set and endpoint reachable from Stripe.
- [ ] QStash signing key verification enabled on job handlers.
- [ ] Separate env vars exist for dev/staging/prod.

