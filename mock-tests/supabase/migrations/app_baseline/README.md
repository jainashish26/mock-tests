# Application-schema baseline (`app_baseline/`)

> Companion to `../baseline/` (the **reporting** layer). This folder captures the
> **application** half of the live database — the `public` schema and the two
> custom `auth.users` triggers — so that "what does production actually have?"
> has one authoritative, reviewable answer.

## Files

| File | Contents | Captured |
|---|---|---|
| `public_schema.sql` | `pg_dump --schema-only --no-owner --schema=public`, **ACLs included** (GRANT/REVOKE statements are part of the dump) | 39 tables · 64 functions · 109 RLS policies · 0 triggers |
| `auth_triggers.sql` | The two CUSTOM triggers on `auth.users` (`on_auth_user_created` → role provisioning, `on_auth_user_created_profile` → profile creation). Their functions live in `public` and are inside `public_schema.sql`. | 2 triggers |

Not captured here, deliberately:
- **`reporting` schema** → `../baseline/` (validated by `scripts/validate_baseline.py`)
- **pg_cron schedules** → `../baseline/10_cron.sql` (all 14 jobs are `rpt-*`; no public cron jobs exist)
- **Seed/config data** → `../seed/` and `../seeds/`
- **`auth`/`storage`/`realtime` internals** → Supabase-managed; only our two triggers belong to the app

## Drift findings (verified against the live database, 2026-11-19)

| Historical claim | Verified state |
|---|---|
| "`attempt_expiry_guard` was applied with no local file" (16-delivery-backlog.md) | **Stale.** No function, trigger, event trigger or cron job matching `%expiry%` exists anywhere in the live database. It was superseded/removed by a later hosted migration. Nothing to reconcile. |
| "`005_rls_policies.sql` exists locally but was never applied" | Confirmed irrelevant: live policies (96) come from the hosted migration history and this capture. **Do not apply 005 to any live-shaped database** — it conflicts with the policies that actually exist. |
| "`010_subscriptions.sql` was never applied" | `public.subscriptions` EXISTS live (created by the hosted history). The local file is superseded by this capture. |
| `public` triggers | There are none — `updated_at` maintenance is not trigger-based in the live schema. |

## Restore procedure for a fresh database

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/app_baseline/public_schema.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/app_baseline/auth_triggers.sql
# then the reporting baseline in filename order (../baseline/README.md),
# then seeds: seed/funnel_offers.sql, seed/expansion_catalog.sql,
#            seeds/001_sample_dataset.sql (optional sample data)
# then Stripe prices: node scripts/setup-offer-prices.mjs
```

Validate the capture against live at any time:

```bash
npm run schema:validate:app     # scripts/validate_app_baseline.py
```

## What is NOT yet true

`supabase db reset` still replays `migrations/001–016` (top-level, historical)
and does **not** know about this folder. Making reset produce a working
database requires restructuring the top-level migration sequence into
`app_baseline → reporting baseline → cron/config` and verifying with the
Supabase CLI + Docker — neither is available in this environment, so the
restructure is deliberately NOT done blind. Until then: restore by the
procedure above, and treat `001–016` plus `093/094` as history.