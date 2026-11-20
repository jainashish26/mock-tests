-- Generated baseline: public_grants
-- Source: live database via export_schema_baseline (migrations 051/052).
-- Do not hand-edit; regenerate with scripts/rebaseline_schema.py.
-- See supabase/migrations/README.md for apply order and caveats.

-- Tables deliberately not browser-readable: RLS enabled, no policies, and
-- SELECT withheld from authenticated and anon. Derived from live ACLs (066).
REVOKE SELECT ON TABLE public.email_log FROM authenticated, anon;
REVOKE SELECT ON TABLE public.enquiry_contacts FROM authenticated, anon;
REVOKE SELECT ON TABLE public.enquiry_throttle FROM authenticated, anon;
REVOKE SELECT ON TABLE public.experiment_assignments FROM authenticated, anon;
REVOKE SELECT ON TABLE public.experiment_exposures FROM authenticated, anon;
REVOKE SELECT ON TABLE public.experiments FROM authenticated, anon;
REVOKE SELECT ON TABLE public.funnel_events FROM authenticated, anon;
REVOKE SELECT ON TABLE public.inbound_email_messages FROM authenticated, anon;