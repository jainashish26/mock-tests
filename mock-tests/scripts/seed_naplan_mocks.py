# -*- coding: utf-8 -*-
"""
Seed the 42 NAPLAN-style mock exams (MockExams/) into Supabase.

Usage:
    python scripts/seed_naplan_mocks.py --dry-run   # show the plan, no writes
    python scripts/seed_naplan_mocks.py             # upsert into the database

Conventions (verified against the live schema of project ekdjrvjgrhpqolthbznr):
  * tests:      status=PUBLISHED, is_free=true, created_by=TEST_CREATOR,
                approved_by=ADMIN, year_level_min=max=year (mirrors the existing
                published NAPLAN Language Conventions tests). Free+published means
                can_access_published_test() grants every logged-in user access.
  * questions:  type=READING_COMPREHENSION (reading) / MCQ (numeracy),
                correct_answer = option letter (the scorer canonicalises letters),
                comprehension_text + answer_a..e feed the runner,
                difficulty 1-5, is_active=true, correct_answer_score=1,
                exam_id = human-readable ExamID (text column), skill_* populated.
  * test_questions: base_difficulty is CHECK 1-4 in the live DB -> clamped to 4;
                question_order preserves the paper's difficulty ramp;
                upsert on (test_id, question_id).
  * test_sections: one row per ExamSection (Text 1..k / Part A / Part B).

Ids are deterministic UUIDv5 values, so re-running converges (upsert) instead of
duplicating. Credentials are read from .env.local and never printed.
Teardown: supabase/seeds/998_cleanup_naplan_mock_exams.sql
"""
import csv
import json
import os
import sys
import uuid
import urllib.request
import urllib.error
from collections import Counter
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
MOCKS = os.path.join(APP, "MockExams")
ENV_PATH = os.path.join(APP, ".env.local")

# Verified live accounts (app_user_roles): TEST_CREATOR owns content, ADMIN approves.
CREATOR_ID = "f34c58ab-46a4-4693-8bb1-f36de4da0f46"
APPROVER_ID = "e434b9f9-c2a5-4099-9200-e8e156aa57d1"
NS = uuid.uuid5(uuid.NAMESPACE_URL, "https://mocktests.local/naplan-mock-exams")

SKILL_COLS = ["skill_grammar", "skill_spelling", "skill_vocabulary", "skill_reading",
              "skill_writing", "skill_algebra", "skill_word_problems", "skill_geometry",
              "skill_statistics", "skill_mental_maths", "skill_problem_solving",
              "skill_numerical_reasoning", "skill_verbal_reasoning",
              "skill_logical_reasoning", "skill_critical_thinking"]


def read_env(path):
    env = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def load_csv(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def primary_skill(subject, topic, sub_topic):
    """One primary skill weight (1.0) per item, per QuestionBankFieldGLossary."""
    if subject == "English":
        return "skill_reading"
    if topic == "Algebra":
        return "skill_algebra"
    if topic == "Geometry":
        return "skill_geometry"
    if topic == "Statistics":
        return "skill_statistics"
    if topic == "Financial Mathematics":
        return "skill_word_problems"
    if topic == "Number":
        return "skill_mental_maths" if sub_topic == "Mental Computation" else "skill_numerical_reasoning"
    if topic == "Problem Solving":
        return "skill_logical_reasoning" if sub_topic in ("Logical Reasoning", "Direction Sense") else "skill_problem_solving"
    return "skill_numerical_reasoning"  # Measurement, Probability


def rest_upsert(url, key, table, rows, on_conflict=None, batch=100):
    total = 0
    for i in range(0, len(rows), batch):
        chunk = rows[i:i + batch]
        endpoint = f"{url}/rest/v1/{table}"
        if on_conflict:
            endpoint += f"?on_conflict={on_conflict}"
        req = urllib.request.Request(
            endpoint,
            data=json.dumps(chunk).encode("utf-8"),
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates,return=minimal",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                resp.read()
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")
            sys.exit(f"FAILED {table} batch {i // batch + 1}: HTTP {e.code} {body[:800]}")
        total += len(chunk)
        print(f"  {table}: {total}/{len(rows)} rows")
    return total


def build_payloads():
    manifest = load_csv(os.path.join(MOCKS, "manifest.csv"))
    now = datetime.now(timezone.utc).isoformat()
    tests, questions, sections, mappings = [], [], [], []
    for m in manifest:
        eid = m["ExamID"]
        year = int(m["YearLevel"])
        tid = str(uuid.uuid5(NS, eid))
        tests.append({
            "id": tid, "title": m["Title"], "exam_type": m["ExamType"],
            "year_level_min": year, "year_level_max": year,
            "time_limit_mins": int(m["TimeLimitMinutes"]),
            "is_free": True, "status": "PUBLISHED",
            "created_by": CREATOR_ID, "approved_by": APPROVER_ID,
            "published_at": now, "updated_at": now,
        })
        rows = load_csv(os.path.join(MOCKS, m["QuestionFile"]))
        sec_order, sec_counts = {}, Counter()
        for r in rows:
            s = r["ExamSection"]
            if s not in sec_order:
                sec_order[s] = len(sec_order) + 1
            sec_counts[s] += 1
        for s, o in sec_order.items():
            sections.append({
                "id": str(uuid.uuid5(NS, f"{eid}:section:{o}")),
                "test_id": tid, "name": s, "section_order": o,
                "time_limit_mins": None, "question_count": sec_counts[s],
            })
        for idx, r in enumerate(rows, 1):
            qid = str(uuid.uuid5(NS, r["QuestionID"]))
            diff = int(r["Difficulty"])
            skills = {c: 0.0 for c in SKILL_COLS}
            skills[primary_skill(r["Subject"], r["Topic"], r["SubTopic"])] = 1.0
            qtype = "READING_COMPREHENSION" if r["QuestionType"] == "ReadingComprehension" else "MCQ"
            q = {
                "id": qid, "type": qtype, "stem": r["QuestionText"],
                "comprehension_text": r["ComprehensionText"] or None,
                "image_url": None, "correct_answer": r["Correct"],
                "explanation": None,
                "tags": [t.strip() for t in r["Tags"].split(",") if t.strip()],
                "status": "PUBLISHED", "created_by": CREATOR_ID, "updated_at": now,
                "exam_id": eid, "exam_type": m["ExamType"], "exam_section": r["ExamSection"],
                "year_level": year, "subject": r["Subject"],
                "topic": r["Topic"], "sub_topic": r["SubTopic"],
                "answer_a": r["AnswerA"] or None, "answer_b": r["AnswerB"] or None,
                "answer_c": r["AnswerC"] or None, "answer_d": r["AnswerD"] or None,
                "answer_e": r["AnswerE"] or None,
                "difficulty": diff, "is_active": True, "correct_answer_score": 1,
            }
            q.update(skills)  # uniform keys across all rows (PostgREST requirement)
            questions.append(q)
            mappings.append({
                "test_id": tid, "question_id": qid,
                "section_name": r["ExamSection"],
                "base_difficulty": min(4, diff),  # live CHECK constraint is 1-4
                "question_order": idx,
            })
    return tests, questions, sections, mappings


def main():
    dry = "--dry-run" in sys.argv
    tests, questions, sections, mappings = build_payloads()
    print(f"Plan: {len(tests)} tests, {len(questions)} questions, "
          f"{len(sections)} sections, {len(mappings)} mappings")
    by_type = Counter(t["exam_type"] for t in tests)
    print(f"  exam types: {dict(by_type)}")
    print(f"  question types: {dict(Counter(q['type'] for q in questions))}")
    print(f"  base_difficulty range: {min(m['base_difficulty'] for m in mappings)}-"
          f"{max(m['base_difficulty'] for m in mappings)}")
    if dry:
        print("Dry run - nothing written.")
        return
    env = read_env(ENV_PATH)
    url = env.get("NEXT_PUBLIC_SUPABASE_URL")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY") or env.get("SUPABASE_SECRET_KEY")
    if not url or not key:
        sys.exit("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local")
    print(f"Uploading to {url} ...")
    rest_upsert(url, key, "tests", tests, batch=50)
    rest_upsert(url, key, "questions", questions, batch=100)
    rest_upsert(url, key, "test_sections", sections, batch=200)
    rest_upsert(url, key, "test_questions", mappings,
                on_conflict="test_id,question_id", batch=500)
    print("Done. Verify with: python scripts/seed_naplan_mocks.py --dry-run (plan) "
          "or SQL counts in Supabase.")


if __name__ == "__main__":
    main()

