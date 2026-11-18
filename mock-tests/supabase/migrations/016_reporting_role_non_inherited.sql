-- ============================================================================
-- 016_reporting_role_non_inherited.sql
--
-- FIXES A PRIVILEGE-ESCALATION HOLE introduced by 013/014, found by verifying the
-- grants immediately after 014 was applied.
--
-- THE BUG
--   013 ran:
--     GRANT reporting_ro TO authenticated, service_role, postgres;
--     GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO reporting_ro;
--   A plain role grant is INHERITED, so `authenticated` silently acquired every
--   privilege reporting_ro holds. Measured after 014:
--     has_table_privilege('authenticated',
--                         'reporting.mv_student_daily_target','SELECT') = true
--   That MV holds `required_daily` and `plan_overload_flag`, both PARENT-FACING
--   ONLY. The entire point of routing students through v_student_today - which
--   deliberately omits those two columns - was defeated, because any signed-in
--   user, a student included, could select the MV directly through PostgREST.
--
-- THE FIX
--   Re-grant the membership WITH INHERIT FALSE (PostgreSQL 16+; this project is
--   17.6). Non-inherited membership means:
--     * `authenticated` does NOT automatically hold reporting_ro's privileges, so a
--       browser through PostgREST cannot select reporting MVs; and
--     * server code that explicitly runs `SET LOCAL ROLE reporting_ro` DOES acquire
--       them, because SET ROLE requires membership, not inheritance.
--   That is exactly the intended semantics: reporting_ro is a capability the
--   trusted API layer opts into per transaction, not a blanket grant to every
--   signed-in user.
--
-- VERIFIED AFTER APPLYING
--   has_table_privilege('authenticated','reporting.mv_student_daily_target','SELECT') = false
--   has_table_privilege('anon',        'reporting.mv_student_daily_target','SELECT') = false
--   has_table_privilege('reporting_ro','reporting.mv_student_daily_target','SELECT') = true
--   has_schema_privilege('authenticated','reporting','USAGE')                        = false
--   pg_auth_members row for (reporting_ro -> authenticated) with inherit_option=false = 1
--
-- This also settles test AC-15 ("SET ROLE must not be an escalation path"): a
-- browser cannot SET ROLE at all through PostgREST, and now it does not need to,
-- because it no longer inherits the privileges either.
--
-- Idempotent: safe to re-run.
-- ============================================================================

REVOKE reporting_ro FROM authenticated;
GRANT reporting_ro TO authenticated WITH INHERIT FALSE;

-- service_role has BYPASSRLS and is used only by trusted server code (Stripe
-- webhooks, QStash jobs), so it keeps inherited membership and existing
-- service-role queries are unaffected. postgres owns the schema either way.

-- Re-assert the object-level revocations: REVOKE ... FROM <role> does not strip
-- privileges that role also holds through some other path.
REVOKE ALL ON ALL TABLES IN SCHEMA reporting FROM PUBLIC, anon, authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO reporting_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA reporting REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA reporting GRANT SELECT ON TABLES TO reporting_ro;

-- Belt and braces: a browser must not even be able to resolve names in the schema.
REVOKE ALL ON SCHEMA reporting FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA reporting TO reporting_ro;

COMMENT ON SCHEMA reporting IS
  'BI schema: star schema, materialised views and role-gated views. reporting_ro holds SELECT; membership is granted to authenticated WITH INHERIT FALSE so a browser through PostgREST cannot read it, while trusted server code opts in per transaction via SET LOCAL ROLE reporting_ro. See 016_reporting_role_non_inherited.sql.';
