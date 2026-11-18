# -*- coding: utf-8 -*-
"""Validate the 42 generated mock exams against the design rules and source banks."""
import csv, io, os, re, sys, hashlib
from collections import Counter, defaultdict

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
csv.field_size_limit(10_000_000)
ROOT = r"c:\Users\gmail\OneDrive\Documents\GitHub\mock-tests\mock-tests-1"
BANK = os.path.join(ROOT, "mock-tests", "QuestionBank")
OUT = os.path.join(ROOT, "mock-tests", "MockExams")
DATE_PAT = re.compile(r"^(?:\d{1,2}-[A-Za-z]{3}|[A-Za-z]{3}-\d{1,4}|\d{1,2}/[A-Za-z]{3})$")


def load(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        return [{(k or "").strip(): (v or "") for k, v in r.items()} for r in csv.DictReader(f)]


def norm(s):
    return re.sub(r"\s+", " ", s.strip()).lower()


eng = load(os.path.join(BANK, "English_Comprehension_Questions_expanded.csv"))
math = load(os.path.join(BANK, "Maths_Questions_Combined.csv"))

# source lookups: (year, normalized question) -> list of (options tuple, answer, passage text)
src = defaultdict(list)
for r in eng:
    y = r["Year Level"].strip()
    key = (y, norm(r["Question"]))
    src[key].append((tuple(r.get(f"Option {c}", "").strip() for c in "ABCDE"),
                     r["Correct Answer"].strip().upper(),
                     norm(r["Reading Comprehension Text/Essay/Article"])))
for r in math:
    y = r["Year Level"].strip().replace("Year ", "")
    key = (y, norm(r["Question"]))
    src[key].append((tuple(r.get(f"Option {c}", "").strip() for c in "ABCDE"),
                     r["Correct Answer"].strip().upper(), None))

manifest = load(os.path.join(OUT, "manifest.csv"))
errors, warnings = [], []
seen_q = defaultdict(set)      # (year, subject) -> question hashes across the 3 mocks
seen_passage = defaultdict(set)
total_rows = 0
print(f"{'ExamID':28s} {'Qs':>3s} {'E/M/H':>10s} {'meanDS':>6s}  status")
for m in manifest:
    path = os.path.join(OUT, m["QuestionFile"])
    rows = load(path)
    eid, y, subj = m["ExamID"], m["YearLevel"], m["Subject"]
    n = len(rows)
    total_rows += n
    if n != int(m["QuestionCount"]):
        errors.append(f"{eid}: row count {n} != manifest {m['QuestionCount']}")
    diffs = Counter(r["DifficultyLabel"] for r in rows)
    mean_ds = sum(int(r["DifficultyScore"]) for r in rows) / max(1, n)
    ok = True
    passages = defaultdict(list)
    for i, r in enumerate(rows, 1):
        if r["ExamID"] != eid:
            errors.append(f"{eid} row {i}: ExamID mismatch"); ok = False
        if r["YearLevel"] != y:
            errors.append(f"{eid} row {i}: year mismatch"); ok = False
        o = tuple(r.get(f"Answer{c}", "").strip() for c in "ABCDE")
        ca = r["Correct"].strip().upper()
        if ca not in "ABCDE" or not o["ABCDE".index(ca)]:
            errors.append(f"{eid} row {i}: invalid key"); ok = False
        if sum(1 for x in o if x) < 3:
            errors.append(f"{eid} row {i}: <3 options"); ok = False
        if any(DATE_PAT.match(x) for x in o if x):
            errors.append(f"{eid} row {i}: date-corrupted option"); ok = False
        if not (1 <= int(r["Difficulty"]) <= 5):
            errors.append(f"{eid} row {i}: difficulty out of 1-5"); ok = False
        # Reading items are identified by passage+question (generic stems such as
        # "What is the main idea?" legitimately recur under different texts).
        qkey = norm(r["QuestionText"])
        if subj == "English":
            qkey = norm(r["ComprehensionText"]) + "||" + qkey
        h = hashlib.md5(qkey.encode()).hexdigest()
        if h in seen_q[(y, subj)]:
            errors.append(f"{eid} row {i}: question reused across mocks"); ok = False
        seen_q[(y, subj)].add(h)
        # provenance: exact match against a source row
        cands = src.get((y, norm(r["QuestionText"])), [])
        match = [c for c in cands if c[0] == o and c[1] == ca]
        if not match:
            errors.append(f"{eid} row {i}: no exact source match (content altered?)"); ok = False
        if subj == "English":
            pt = norm(r["ComprehensionText"])
            if not any(c[2] == pt for c in match):
                errors.append(f"{eid} row {i}: passage text differs from source"); ok = False
            passages[r["ExamSection"]].append(pt)
    if subj == "English":
        for sec, texts in passages.items():
            if len(set(texts)) != 1:
                errors.append(f"{eid} {sec}: inconsistent passage text"); ok = False
            ph = hashlib.md5(texts[0].encode()).hexdigest()
            if ph in seen_passage[(y, subj)]:
                errors.append(f"{eid} {sec}: passage reused across mocks"); ok = False
            seen_passage[(y, subj)].add(ph)
    # answer key consistency
    key_rows = load(os.path.join(OUT, m["AnswerKeyFile"]))
    if len(key_rows) != n:
        errors.append(f"{eid}: answer key length mismatch"); ok = False
    for kr, r in zip(key_rows, rows):
        if kr["QuestionID"] != r["QuestionID"] or kr["Correct"] != r["Correct"]:
            errors.append(f"{eid}: answer key mismatch at {kr['QuestionID']}"); ok = False
    emh = f"{diffs.get('Easy',0)}/{diffs.get('Medium',0)}/{diffs.get('Hard',0)}"
    print(f"{eid:28s} {n:3d} {emh:>10s} {mean_ds:6.2f}  {'OK' if ok else 'FAIL'}")

print(f"\nExams: {len(manifest)} | total question rows: {total_rows}")
print(f"ERRORS: {len(errors)}")
for e in errors[:40]:
    print("  -", e)
if len(errors) > 40:
    print(f"  ... and {len(errors)-40} more")
sys.exit(1 if errors else 0)
