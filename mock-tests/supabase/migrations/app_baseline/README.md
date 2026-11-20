# Application-schema baseline (`app_baseline/`)

> Companion to `../baseline/` (the **reporting** layer). This folder captures the
> **application** half of the live database — the `public` schema and the two
> custom `auth.users` triggers — so that "what does production actually have?"
> has one authoritative, reviewable answer.

## Files

| File | Contents | Captured |
|---|---|---|
| `public_schema.sql` | `pg_dump --schema-only --no-owner --schema=public`, **ACLs included** (GRANT/REVOKE statements are part of the dump) | 39 tables · 67 functions · 109 RLS policies · 0 triggers |
| `auth_triggers.sql` | The two CUSTOM triggers on `auth.users` (`on_auth_user_created` → role provisioning, `on_auth_user_created_profile` → profile creation). Their functions live in `public` and are inside `public_schema.sql`. | 2 triggers |

Not captured here, deliberately:
- **`reporting` schema** → `../baseline/` (validated by `scripts/validate_baseline.py`)
- **pg_cron schedules** → `../baseline/10_cron.sql` (all 15 jobs are `rpt-*`; no public cron jobs exist)
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

## How to re-capture — and the one way that quietly ruins the file

```powershell
# CORRECT: pg_dump writes the file itself, so the bytes are exactly what the
# database produced.
pg_dump --schema-only --no-owner --schema=public -f supabase/migrations/app_baseline/public_schema.sql $SUPABASE_DB_URL

# WRONG: piping or redirecting through the shell.
pg_dump --schema-only --no-owner --schema=public $SUPABASE_DB_URL > supabase/migrations/app_baseline/public_schema.sql
```

**Do not use the second form.** A shell redirect re-encodes the output and
re-terminates its lines, and it does so invisibly: one such capture in this
project's history holds CRLF terminators *plus 241 stray lone CR bytes*, so it
differs from a correct one on every line. Encoding is the other hazard — an
attempt to regenerate this file by redirect produced `Â§` where the database held
`§`.

That matters because these captures exist to be **diffed**. `schema:validate:app`
and code review both assume the file is what `pg_dump` emitted, and a capture with
mixed endings differs from a correct one on every line, which is how a 31-line
schema change once arrived as a 13,929-line diff that nobody could meaningfully
review. `.gitattributes` pins this directory to `-text` so git stops converting
these files, and pins `supabase/migrations/*.sql` to LF so applying a migration
does not carry CRLF into `pg_proc.prosrc`.

One thing that is *not* corruption, so it is not worth "fixing":
`baseline/08_public_wrappers.sql` contains 309 CRLF lines because **five live
function bodies legitimately contain carriage returns** — they were created by
migrations applied from a CRLF working tree
(`admin_enquiry_transition` 129 bytes, `admin_enquiry_queue` 94,
`admin_set_year_level_cap` 61, `admin_enquiry_counts` 18, `admin_year_level_caps`
7; the total is exactly 309). Carriage returns are whitespace to the SQL parser.
Those five functions are deliberately left as they are: rewriting three of the
support access-control RPCs to tidy 309 bytes of whitespace is churn with a real
risk and no upside. The `.gitattributes` rule stops new ones arriving.

If a capture has already been written by redirect, the recovery is simply to
re-capture with `-f` and commit that; expect one final whole-file diff, because
correcting the endings is itself a change to every line.


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