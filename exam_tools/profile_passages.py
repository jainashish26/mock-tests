# -*- coding: utf-8 -*-
"""Deeper profile: passage feasibility for reading exams; maths item quality filters."""
import csv, re, sys, io, hashlib
from collections import Counter, defaultdict

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
csv.field_size_limit(10_000_000)
BASE = r"c:\Users\gmail\OneDrive\Documents\GitHub\mock-tests\mock-tests-1\mock-tests\QuestionBank"

def load(p):
    with open(p, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))

eng = load(BASE + r"\English_Comprehension_Questions_expanded.csv")
math = load(BASE + r"\Maths_Questions_Combined.csv")

print("ENGLISH Main Topic:", dict(Counter(r["Main Topic"].strip() for r in eng)))
print("ENGLISH Sub-Topic:", dict(Counter(r["Sub-Topic"].strip() for r in eng)))
print()
for y in [str(i) for i in range(2, 9)]:
    rows = [r for r in eng if r["Year Level"].strip() == y]
    pas = defaultdict(list)
    for r in rows:
        pas[r["Comprehension "].strip()].append(r)
    # dedupe by passage text
    seen, uniq = set(), []
    for pid, qs in pas.items():
        txt = qs[0]["Reading Comprehension Text/Essay/Article"].strip()
        h = hashlib.md5(re.sub(r"\s+", " ", txt).encode()).hexdigest()
        if h in seen:
            continue
        seen.add(h)
        uniq.append((pid, qs))
    good = []
    for pid, qs in uniq:
        if all(r["NAPLAN"].strip() in ("1", "2", "3") for r in qs) and 3 <= len(qs) <= 10:
            good.append((pid, qs))
    sizes = Counter(len(qs) for _, qs in good)
    tot = sum(len(qs) for _, qs in good)
    lens = [int(qs[0].get("Length", "0") or 0) for _, qs in good]
    short = sum(1 for L in lens if L < 1000); med = sum(1 for L in lens if 1000 <= L <= 2500); lng = sum(1 for L in lens if L > 2500)
    print(f"Y{y}: passages={len(pas)}, unique={len(uniq)}, usable(3-10q,allNAPLAN>=1)={len(good)} covering {tot}q, sizes={dict(sorted(sizes.items()))}, len buckets S/M/L={short}/{med}/{lng}")

print()
datepat = re.compile(r"^(?:\d{1,2}-[A-Za-z]{3}|[A-Za-z]{3}-\d{1,4}|\d{1,2}/[A-Za-z]{3})$")
strong_vis = re.compile(r"(the|this|these) (picture|diagram|graph|chart|map|image|watch|clock face)|look at the (picture|diagram|graph|chart|map)|shown (in|on) the (picture|diagram|graph|chart|map)|picture below|diagram below|graph below|chart below", re.I)
pairref = re.compile(r"questions?\s+\d+\s+(and|to|–|-)\s+\d+", re.I)
for y in [f"Year {i}" for i in range(2, 9)]:
    rows = [r for r in math if r["Year Level"].strip() == y and r["NAPLAN"].strip() in ("1", "2", "3")]
    optcount = Counter(sum(1 for c in "ABCDE" if r[f"Option {c}"].strip()) for r in rows)
    bad = set()
    corrupt = vis = pairs = 0
    for i, r in enumerate(rows):
        if any(datepat.match(r[f"Option {c}"].strip()) for c in "ABCDE"):
            bad.add(i); corrupt += 1
        if strong_vis.search(r["Question"]):
            bad.add(i); vis += 1
        if pairref.search(r["Question"]):
            bad.add(i); pairs += 1
    clean = [r for i, r in enumerate(rows) if i not in bad and sum(1 for c in "ABCDE" if r[f"Option {c}"].strip()) >= 3]
    dedup = {}
    for r in clean:
        k = re.sub(r"\s+", " ", r["Question"].strip()).lower()
        if k not in dedup:
            dedup[k] = r
    diff = Counter(r["Difficulty"].strip() for r in dedup.values())
    print(f"{y}: NAPLAN>=1 n={len(rows)}, opts={dict(sorted(optcount.items()))}, corrupt={corrupt}, strongVisual={vis}, pairRef={pairs}, cleanUnique={len(dedup)}, diff={dict(diff)}")
