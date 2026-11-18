"""Validate app_baseline/public_schema.sql against the LIVE database.

The reporting baseline has validate_baseline.py; the application half needs the
same guarantee: a capture that silently drifts from production is worse than no
capture, because it is trusted. This script re-counts the live catalogue and
compares it against what the dump file contains, and asserts the objects the
funnel, monetisation and consent features depend on are actually in the file.

Usage:
    npm run schema:validate:app
    (or: C:\\Python314\\python.exe scripts/validate_app_baseline.py)

Reads SUPABASE_DB_URL from the environment or .env.local. Requires psql on PATH.
Exits 0 when every check passes, 1 otherwise.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CAPTURE = ROOT / "supabase" / "migrations" / "app_baseline" / "public_schema.sql"
TRIGGERS = ROOT / "supabase" / "migrations" / "app_baseline" / "auth_triggers.sql"

passed = 0
failed = 0


def check(label: str, ok: bool, detail: str = "") -> None:
    global passed, failed
    if ok:
        passed += 1
        print(f"  PASS  {label}")
    else:
        failed += 1
        print(f"  FAIL  {label}" + (f"  [{detail}]" if detail else ""))


def read_env_url() -> str | None:
    import os

    if os.environ.get("SUPABASE_DB_URL"):
        return os.environ["SUPABASE_DB_URL"]
    env_file = ROOT / ".env.local"
    if not env_file.exists():
        return None
    for raw in env_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line.startswith("SUPABASE_DB_URL="):
            value = line.split("=", 1)[1].strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            return value
    return None


def psql_one(url: str, query: str) -> str:
    out = subprocess.run(
        ["psql", url, "-At", "-c", query],
        capture_output=True,
        text=True,
        check=True,
    )
    return out.stdout.strip()


def main() -> int:
    if not CAPTURE.exists():
        print(f"missing capture: {CAPTURE}")
        return 1
    if shutil.which("psql") is None:
        print("psql not found on PATH")
        return 1
    url = read_env_url()
    if not url:
        print("SUPABASE_DB_URL not set (env or .env.local)")
        return 1

    capture = CAPTURE.read_text(encoding="utf-8")
    triggers = TRIGGERS.read_text(encoding="utf-8") if TRIGGERS.exists() else ""

    print("\n=== capture contains the objects the app depends on ===")
    # Every table the funnel, monetisation, consent and entitlement flows read.
    # If one is missing from the capture, a restore silently drops a feature.
    required_tables = [
        "attempts", "responses", "student_profiles", "parent_student_links",
        "tutor_student_links", "consent_records", "tests", "questions",
        "assignments", "entitlements", "purchases", "products", "product_tests",
        "offers", "funnel_events", "funnel_state", "student_exam_targets",
        "enquiries", "email_log", "processed_webhook_events",
        "experiments", "experiment_assignments", "experiment_exposures",
        # NB: experiment_thresholds lives in the REPORTING schema and is
        # covered by validate_baseline.py's *_thresholds config discovery.
        "subscriptions", "referral_codes", "referrals",
    ]
    for t in required_tables:
        check(f"capture contains public.{t}", f"CREATE TABLE public.{t} " in capture)

    check(
        "capture contains the role-provisioning function (009)",
        "CREATE FUNCTION public.handle_new_auth_user" in capture,
    )
    check(
        "auth trigger capture contains both custom triggers",
        "on_auth_user_created" in triggers and "on_auth_user_created_profile" in triggers,
    )

    print("\n=== live parity (counts must match exactly) ===")
    pairs = [
        (
            "tables",
            len(re.findall(r"CREATE TABLE public\.", capture)),
            int(psql_one(url, "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'")),
        ),
        (
            "functions",
            len(re.findall(r"CREATE FUNCTION public\.", capture)),
            int(psql_one(url, "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'")),
        ),
        (
            "policies",
            len(re.findall(r"CREATE POLICY ", capture)),
            int(psql_one(url, "SELECT count(*) FROM pg_policies WHERE schemaname='public'")),
        ),
    ]
    for label, in_file, live in pairs:
        check(f"{label}: capture {in_file} == live {live}", in_file == live)

    check(
        "public has no triggers the capture would miss",
        int(psql_one(url, "SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname='public'")) == 0,
    )
    check(
        "exactly 2 custom auth.users triggers exist live",
        int(psql_one(url, "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid='auth.users'::regclass")) == 2,
    )

    print(f"\n{'-' * 58}")
    print(f"PASSED: {passed}   FAILED: {failed}")
    print(f"{'-' * 58}\n")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())