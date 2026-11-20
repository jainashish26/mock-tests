"""Re-baseline the reporting schema from the live database into version control.

WHY THIS SCRIPT EXISTS
    52 migrations are applied to the hosted database; the repo holds 16 .sql
    files, and the histories diverge in BOTH directions (005 and 010 exist
    locally but were never applied; attempt_expiry_guard was applied but has no
    file). Copying files cannot reconcile that, and `supabase db reset` from the
    current folder would destroy the entire reporting layer.

    There is no pg_dump, psql, Supabase CLI or connection string in this
    environment - only the project URL and API keys. So the export is reached
    over PostgREST through three bounded, read-only functions (migrations
    051/052). They accept no caller-supplied SQL; they return catalog-derived DDL
    text. This script fetches that text and writes it to disk.

    Doing it this way means ~113 KB of DDL never passes through a chat context or
    gets retyped by hand, which is where transcription errors live.

WHAT IT WRITES
    supabase/migrations/baseline/NN_<part>.sql, numbered in apply order.

USAGE
    C:\\Python314\\python.exe scripts/rebaseline_schema.py

    Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.
    Nothing is sent anywhere except the project's own PostgREST endpoint.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env.local"
OUT_DIR = ROOT / "supabase" / "migrations" / "baseline"
RESET_DIR = ROOT / "supabase" / "reset"

# Apply order. Tables first, then functions, then views: a materialised view can
# reference a function, and a SQL-language function is validated at creation, so
# dependency direction matters. Indexes follow views because a materialised view
# needs its UNIQUE index before REFRESH ... CONCURRENTLY will work.
PARTS: list[tuple[str, str, dict]] = [
    ("tables",          "export_schema_baseline", {"p_part": "tables"}),
    ("functions",       "export_schema_baseline", {"p_part": "functions"}),
    ("views",           "export_schema_baseline", {"p_part": "views"}),
    ("indexes",         "export_schema_baseline", {"p_part": "indexes"}),
    ("rls",             "export_schema_baseline", {"p_part": "rls"}),
    ("grants",          "export_schema_baseline", {"p_part": "grants"}),
    ("config",          "export_schema_baseline", {"p_part": "config"}),
    ("public_wrappers", "export_schema_baseline", {"p_part": "public_wrappers"}),
    ("public_grants",   "export_schema_baseline", {"p_part": "public_grants"}),
    ("cron",            "export_schema_baseline", {"p_part": "cron"}),
]


def read_env(path: Path) -> dict[str, str]:
    """Parse .env.local. Values may be quoted; comments and blanks are skipped."""
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        env[key.strip()] = value
    return env


def rpc(url: str, key: str, fn: str, args: dict) -> list[dict]:
    """Call a PostgREST RPC and return the parsed JSON array."""
    endpoint = f"{url.rstrip('/')}/rest/v1/rpc/{fn}"
    req = urllib.request.Request(
        endpoint,
        data=json.dumps(args).encode("utf-8"),
        method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    env = read_env(ENV_FILE)
    url = env.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = (
        env.get("SUPABASE_SERVICE_ROLE_KEY")
        or env.get("SUPABASE_SECRET_KEY")
        or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    )

    if not url or not key:
        print("ERROR: need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local")
        return 2

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    written: list[tuple[str, int]] = []

    for index, (label, fn, args) in enumerate(PARTS, start=1):
        try:
            rows = rpc(url, key, fn, args)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:400]
            print(f"FAIL {label}: HTTP {exc.code} {detail}")
            return 1
        except Exception as exc:  # noqa: BLE001 - surface any transport failure
            print(f"FAIL {label}: {exc}")
            return 1

        if not rows:
            print(f"SKIP {label}: no rows returned")
            continue

        for row in rows:
            content = row.get("content")
            if not content:
                print(f"SKIP {label}: empty content")
                continue
            name = f"{index:02d}_{label}.sql"
            header = (
                f"-- Generated baseline: {label}\n"
                f"-- Source: live database via {fn} (migrations 051/052).\n"
                "-- Do not hand-edit; regenerate with scripts/rebaseline_schema.py.\n"
                "-- See supabase/migrations/README.md for apply order and caveats.\n\n"
            )
            (OUT_DIR / name).write_text(header + content, encoding="utf-8", newline="\n")
            written.append((name, len(content)))
            print(f"  wrote {name:<28} {len(content):>7,} chars")

    total = sum(n for _, n in written)
    print(f"\n{len(written)} files, {total:,} chars -> {OUT_DIR}")

    # Function ACLs are captured separately and written to supabase/reset/,
    # because pg_get_functiondef omits ACLs: without this file a baseline restore
    # recreates every reporting function PUBLIC-executable. It lives outside
    # PARTS because it returns one scalar rather than (filename, content) rows and
    # because its target directory is not the baseline. Generated here so that
    # adding a reporting function cannot leave the restore script describing an
    # older schema - the gap migration 117 records.
    try:
        acls = rpc(url, key, "export_baseline_function_acls", {})
        text = acls if isinstance(acls, str) else (acls[0].get("content") if acls else "")
        if not text:
            print("FAIL function_acls: empty result")
            return 1
        RESET_DIR.mkdir(parents=True, exist_ok=True)
        acl_path = RESET_DIR / "10_reporting_function_acls.sql"
        acl_path.write_text(text, encoding="utf-8", newline="\n")
        n_lines = sum(1 for line in text.splitlines() if line.startswith("REVOKE ALL ON FUNCTION"))
        print(f"  wrote 10_reporting_function_acls.sql {len(text):>7,} chars ({n_lines} functions)")
    except Exception as exc:  # noqa: BLE001 - a failed capture must not look like success
        print(f"FAIL function_acls: {exc}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
