# -*- coding: utf-8 -*-
"""Profile the two question bank CSVs to inform NAPLAN mock exam design."""
import csv, re, sys, io
from collections import Counter, defaultdict

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
csv.field_size_limit(10_000_000)

BASE = r"c:\Users\gmail\OneDrive\Documents\GitHub\mock-tests\mock-tests-1\mock-tests\QuestionBank"
ENG = BASE + r"\English_Comprehension_Questions_expanded.csv"
MATH = BASE + r"\Maths_Questions_Combined.csv"

def load(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))

eng = load(ENG)
math = load(MATH)
print("=== ENGLISH ===")
print("rows:", len(eng))
print("columns:", list(eng[0].keys()))
print("Year Level values:", Counter(r["Year Level"].strip() for r in eng))
print("NAPLAN flags:", Counter(r["NAPLAN"].strip() for r in eng))
print("Difficulty:", Counter(r["Difficulty"].strip() for r in eng))
print("Difficulty Score:", Counter(r["Difficulty Score"].strip() for r in eng))
print("Length:", Counter(r.get("Length", "").strip() for r in eng))
print("Main Topic:", Counter(r["Main Topic"].strip() for r in eng))
print("sample Question Numbers:", [r["Question Number"] for r in eng[:5]], [r["Question Number"] for r in eng[-5:]])

# group passages per year
for y in sorted({r["Year Level"].strip() for r in eng}):
    rows = [r for r in eng if r["Year Level"].strip() == y]
    passages = defaultdict(list)
    for r in rows:
        key = (r["Comprehension "].strip() if "Comprehension " in r else r.get("Comprehension", "").strip(),
               r["Reading Comprehension Text/Essay/Article"].strip()[:80])
        passages[key].append(r)
    sizes = Counter(len(v) for v in passages.values())
    nap = Counter(r["NAPLAN"].strip() for r in rows)
    print(f"Year {y}: questions={len(rows)}, passages={len(passages)}, passage-size histogram={dict(sorted(sizes.items()))}, NAPLAN={dict(nap)}")

# check answer integrity + missing options
bad_ans = 0
for r in eng:
    ca = r["Correct Answer"].strip().upper()
    opts = [r.get(f"Option {c}", "").strip() for c in "ABCDE"]
    if ca not in "ABCDE" or len(ca) != 1 or not opts["ABCDE".index(ca)]:
        bad_ans += 1
print("English rows with invalid correct answer:", bad_ans)
img_ref = sum(1 for r in eng if re.search(r"\b(image|picture|diagram|photo|graph|table below|chart)\b", r["Question"], re.I))
print("English questions referencing visuals:", img_ref)

print()
print("=== MATHS ===")
print("rows:", len(math))
print("columns:", list(math[0].keys()))
print("Year Level values:", Counter(r["Year Level"].strip() for r in math))
print("NAPLAN flags:", Counter(r["NAPLAN"].strip() for r in math))
print("Difficulty:", Counter(r["Difficulty"].strip() for r in math))
print("Difficulty Score:", Counter(r["Difficulty Score"].strip() for r in math))
print("Main Topic:", Counter(r["Main Topic"].strip() for r in math))
print("Image Name non-empty:", sum(1 for r in math if r["Image Name"].strip()))

datepat = re.compile(r"^(?:\d{1,2}-[A-Za-z]{3}|[A-Za-z]{3}-\d{1,2}|\d{1,2}/[A-Za-z]{3})$")
for y in sorted({r["Year Level"].strip() for r in math}):
    rows = [r for r in math if r["Year Level"].strip() == y]
    nap = Counter(r["NAPLAN"].strip() for r in rows)
    topics = Counter(r["Main Topic"].strip() for r in rows)
    dup = len(rows) - len({r["Question"].strip() for r in rows})
    corrupt = sum(1 for r in rows if any(datepat.match(r.get(f"Option {c}", "").strip()) for c in "ABCDE"))
    imgname = sum(1 for r in rows if r["Image Name"].strip())
    visref = sum(1 for r in rows if re.search(r"\b(image|picture|diagram|photo|shown|below|graph|chart|table)\b", r["Question"], re.I))
    print(f"{y}: n={len(rows)}, NAPLAN={dict(sorted(nap.items()))}, dupQ={dup}, dateCorruptOpts={corrupt}, imgName={imgname}, visualWords={visref}")
    print(f"   topics={dict(topics)}")

bad_ans = 0
for r in math:
    ca = r["Correct Answer"].strip().upper()
    opts = [r.get(f"Option {c}", "").strip() for c in "ABCDE"]
    if ca not in "ABCDE" or len(ca) != 1 or not opts["ABCDE".index(ca)]:
        bad_ans += 1
print("Maths rows with invalid correct answer:", bad_ans)
