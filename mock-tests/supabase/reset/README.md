# Database reset via psql — procedure and rationale

> **Question this answers:** can `supabase db reset` be done through psql?
> **Yes.** The CLI's reset is "fresh database → apply SQL in order → seed".
> This folder is the executable, verifiable form of that sequence, using
> nothing but psql and the captures already in version control.

## Run it

```bash
node scripts/reset-via-psql.mjs \
  --target "postgresql://postgres:<password>@db.<SCRATCH-REF>.supabase.co:5432/postgres" \
  --with-sample-data
```

The script **refuses the production project ref unconditionally** (no override
flag exists). Valid targets: a fresh Supabase project, a Supabase branch, or a
local database. It ends with parity checks against the live-captured counts
and exits non-zero on any failure.

Flags: `--local-stubs` (bare Postgres: creates the four Supabase roles + a
minimal `auth` schema), `--with-sample-data` (deterministic sample dataset),
`--skip-cron`.

## The order, and why each position is forced

| # | File | Why here |
|---|---|---|
| 1 | `reset/00_prelude.sql` | The reporting SCHEMA and `reporting_ro` ROLE exist in no baseline file (they predate the captures). Everything reporting-shaped needs both. |
| 2 | `reset/local_stubs.sql` *(bare PG only)* | The public dump references `anon`/`authenticated`/`service_role`/`postgres` in 297 ACL lines and `auth.uid()` in 71 policy bodies. Supabase provides these; bare Postgres doesn't. |
| 3–9 | `migrations/baseline/01…07` | The reporting layer, in the capture's documented apply order (tables → functions → views → indexes → RLS → grants → config). |
| 10 | `migrations/016_reporting_role_non_inherited.sql` | Re-tightens `reporting_ro` membership to `INHERIT FALSE` (the escalation fix) and sets default privileges. Idempotent; must follow the baseline grants. |
| 11 | `reset/08_dim_date_seed.sql` | `dim_date` rows are ETL data, deliberately absent from the baseline. The generator is reproduced verbatim from migration 013. |
| 12 | `migrations/app_baseline/public_schema.sql` | **Must follow reporting.** The dump contains SQL-language wrappers (`tutor_at_risk`, `parent_mastery`, `child_attempt_history`, …) whose bodies reference `reporting.*` and are validated at CREATE time. |
| 13 | `migrations/app_baseline/auth_triggers.sql` | The two custom `auth.users` triggers; their functions arrived in step 12. |
| 14 | `migrations/baseline/08_public_wrappers.sql` | Duplicate of the dump's wrappers — kept as a `CREATE OR REPLACE` parity pass so the reporting baseline remains self-contained for its own documented restore path. |
| 15 | `migrations/baseline/09_public_grants.sql` | Revocations derived from live ACLs; idempotent after the dump's own ACL section. |
| 16 | `migrations/baseline/10_cron.sql` | The 14 `rpt-*` schedules. Skipped automatically where pg_cron is absent (bare PG). |
| 17 | `reset/09_dim_test_family.sql` | 17 rows snapshotted from live: seeded from the `public.exam_type` enum (step 12) plus the A-21 `family_group` collapse, which exists in no migration file. |
| 18–19 | `seed/funnel_offers.sql`, `seed/expansion_catalog.sql` | Commercial catalogue (offers, product bundle, fulfilment mapping). |
| 20 | `seeds/001_sample_dataset.sql` *(flag)* | Deterministic sample data; required for the pgtap suite's AC-21…26 blocks. |

After a reset with sample data, run the assurance suite
(`npm run test:db` against the target) and the two validators. Stripe prices
are external state: `node scripts/setup-offer-prices.mjs` (test mode).

## What this does NOT prove, stated plainly

- **Migration-history bookkeeping.** `supabase_migrations.schema_migrations`
  is not written; a later `supabase db push` against the reset database would
  not know what has been applied. The CLI remains the right tool for that
  workflow; this kit targets fresh-database reconstruction.
- **Bare-Postgres (local) path.** `local_stubs.sql` exists for offline use but
  has NOT been exercised (the local PG17 password was unavailable). The
  Supabase-target proof below is the verified path.
- **Stripe prices.** External state; run `scripts/setup-offer-prices.mjs`
  against the target's Stripe mode after a reset.

## PROOF RECORD (2026-11-19, scratch project `fkezorhwhxkkdtwcthdl`)

A fresh Supabase project (blank `public`, platform scaffolding only) was reset
from files alone via `scripts/reset-via-psql.mjs --with-sample-data`:

- **All steps green; 17/17 parity checks**: 36 public tables · 57 functions ·
  96 policies · 2 auth triggers · 24/12/26/73 reporting objects · dim_date
  2,557 rows · 17 test families · 3 offers · **54 tests / 1,900 questions**
  (content) · 200 sample students, >1,000 attempts, >10,000 response facts ·
  **14 cron jobs**.
- **`supabase/tests/assurance.sql`: 100 ok / 0 not ok, exit 0** — the entire
  access model (student lockout, grant hygiene, consent lifecycle, tutor
  reports, P2 percentile, A1/T4 parity) verified behaviourally on the rebuilt
  database.
- The proof FOUND AND FIXED four restore gaps that schema-diffing alone would
  have missed, each now a versioned file in this folder:
  1. **`10_reporting_function_acls.sql`** — `pg_get_functiondef` does not
     capture ACLs, so a naive restore left EVERY reporting function
     PUBLIC-executable (verified on scratch: `anon` could execute
     `safe_refresh`). This is the same privilege-escalation class the project
     has fought three times; the file replicates live's lock-down exactly.
  2. **`12/13_content_*`** — test/question content existed only via a
     Python+service-key seeder; now a `pg_dump --data-only` capture plus
     placeholder FK-anchor identities for creator/approver accounts (real
     credentials are never copied).
  3. **`seeds/002_tutor_fixtures.sql`** — the tutor links/consents the suite
     hardcodes were live-only; now versioned and idempotent (proven a no-op
     against live).
  4. **`08_dim_date_seed.sql` / `09_dim_test_family.sql`** — row data the
     baseline deliberately excludes, without which every cohort query groups
     on NULL.
- Structural discoveries encoded in the runner: the public↔reporting
  **dependency cycle** (two-pass tolerant apply + `CREATE OR REPLACE` heal),
  capture-order-vs-dependency-order inside `02_functions`/`03_views`
  (iterative heal passes), `search_path=reporting,public` required by the
  captured view definitions, constraint-index duplicates in `04_indexes`,
  and the `citext` extension dependency of `enquiry_contacts`.
- After the proof the scratch project was **paused**; delete it from the
  dashboard when no longer needed. Its database password was rotated into
  existence for this proof only and dies with the project.

## Known caveats discovered while building this

1. `attempt_expiry_guard` (cited in the backlog as "applied with no local
   file") **no longer exists** anywhere in the live database — verified across
   functions, triggers, event triggers and cron. Nothing to reconcile.
2. The baseline `07_config.sql` does not carry `dim_test_family` rows (they
   are enum-derived + hand-collapsed). Step 17 exists because of this gap;
   without it every cohort query silently groups on NULL.
3. SQL-language function validation is the ONLY reason reporting must precede
   public. If a future wrapper is rewritten in plpgsql, the constraint relaxes
   for that function — do not rely on it; keep the order.