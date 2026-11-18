# -*- coding: utf-8 -*-
"""
NAPLAN-style mock exam generator (Years 2-8, Reading + Numeracy, 3 mocks each).

Panel design rules
------------------
* NO questions are authored here. Every item is copied verbatim from the two
  source banks in mock-tests/QuestionBank (text, options and answer key).
* Only items flagged NAPLAN >= 1 in the source bank are eligible.
* Defective items are excluded, never repaired: Excel date-corrupted options,
  references to images that do not exist in the bank, cross-question
  references ("For questions 10 and 11..."), fewer than 3 options, invalid keys.
* Reading papers are built from WHOLE comprehension passages (never split).
* Numeracy papers: balanced topic coverage, ~30% Easy / 45% Medium / 25% Hard,
  difficulty ramp; Year 5+ has a non-calculator Part A (NAPLAN structure).
* The 3 mocks within a year+subject share NO questions / passages.
* Selection is deterministic (fixed seeds) so re-runs reproduce identical papers.
* Output CSVs follow the platform importer schema (upload-questions route):
  extra provenance columns are ignored by the importer.
"""
import csv, io, math, os, random, re, sys, hashlib
from collections import Counter, defaultdict

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
csv.field_size_limit(10_000_000)

ROOT = r"c:\Users\gmail\OneDrive\Documents\GitHub\mock-tests\mock-tests-1"
BANK = os.path.join(ROOT, "mock-tests", "QuestionBank")
OUT = os.path.join(ROOT, "mock-tests", "MockExams")
ENG_PATH = os.path.join(BANK, "English_Comprehension_Questions_expanded.csv")
MATH_PATH = os.path.join(BANK, "Maths_Questions_Combined.csv")

YEARS = list(range(2, 9))
READ_TARGET = {2: 25, 3: 30, 4: 32, 5: 35, 6: 38, 7: 42, 8: 45}
READ_TOL = 2
READ_K = {2: (5, 5), 3: (5, 6), 4: (5, 6), 5: (5, 7), 6: (5, 7), 7: (6, 7), 8: (5, 6)}
NUM_TARGET = {2: 25, 3: 35, 4: 36, 5: 40, 6: 42, 7: 48, 8: 48}
READ_TIME = {2: 40, 3: 45, 4: 45, 5: 50, 6: 55, 7: 65, 8: 65}
NUM_TIME = {2: 40, 3: 45, 4: 50, 5: 50, 6: 55, 7: 65, 8: 65}
PART_A_N = {5: 8, 6: 8, 7: 10, 8: 10}
DIFF_MIX = {"Easy": 0.30, "Medium": 0.45, "Hard": 0.25}
READING_SKILLS = {"Reading Comprehension", "Inference", "Vocabulary",
                  "Literary Techniques", "Persuasive Language", "Verbal Reasoning"}
MENTAL_SUBTOPICS = {"Mental Computation", "Place Value", "Rounding and Estimation",
                    "Addition and Subtraction", "Multiplication and Division",
                    "Number Sequences", "Patterns", "Fractions", "Decimals",
                    "Time", "Units and Conversion", "Money and Change"}

DATE_PAT = re.compile(r"^(?:\d{1,2}-[A-Za-z]{3}|[A-Za-z]{3}-\d{1,4}|\d{1,2}/[A-Za-z]{3})$")
STRONG_VIS = re.compile(
    r"(the|this|these) (picture|diagram|graph|chart|map|image|watch|clock face)"
    r"|look at the (picture|diagram|graph|chart|map)"
    r"|shown (in|on) the (picture|diagram|graph|chart|map)"
    r"|(picture|diagram|graph|chart) below", re.I)
PAIR_REF = re.compile(r"questions?\s+\d+\s+(and|to|–|-)\s+\d+", re.I)


def load(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    return [{(k or "").strip(): (v or "") for k, v in r.items()} for r in rows]


def norm(s):
    return re.sub(r"\s+", " ", s.strip()).lower()


def opts(r):
    return [r.get(f"Option {c}", "").strip() for c in "ABCDE"]


def item_ok(r, allow_pair_ref=False):
    """Quality gate shared by both banks. Returns True if the item is usable."""
    q = r.get("Question", "").strip()
    if not q or r.get("NAPLAN", "").strip() not in ("1", "2", "3"):
        return False
    ca = r.get("Correct Answer", "").strip().upper()
    o = opts(r)
    if len(ca) != 1 or ca not in "ABCDE" or not o["ABCDE".index(ca)]:
        return False
    if sum(1 for x in o if x) < 3:
        return False
    if any(DATE_PAT.match(x) for x in o if x):
        return False
    if STRONG_VIS.search(q):
        return False
    if not allow_pair_ref and PAIR_REF.search(q):
        return False
    return True


def diff5(score):
    """Map source Difficulty Score (1-10) onto the platform 1-5 scale."""
    try:
        s = int(float(score))
    except (TypeError, ValueError):
        s = 4
    return max(1, min(5, math.ceil(s / 2)))


def dscore(r):
    try:
        return int(float(r.get("Difficulty Score", "4")))
    except (TypeError, ValueError):
        return 4


def dlabel(r):
    lab = r.get("Difficulty", "").strip()
    return lab if lab in DIFF_MIX else "Medium"


def napflag(r):
    try:
        return int(r.get("NAPLAN", "1"))
    except ValueError:
        return 1


def weighted_shuffle(items, weight_fn, rng):
    """Efraimidis-Spirakis weighted sampling without replacement (deterministic)."""
    keyed = [(rng.random() ** (1.0 / max(0.01, weight_fn(it))), it) for it in items]
    keyed.sort(key=lambda t: -t[0])
    return [it for _, it in keyed]


def largest_remainder(shares, total):
    """Integer quotas summing to total, proportional to shares (dict name->weight)."""
    s = sum(shares.values())
    if s <= 0:
        return {k: 0 for k in shares}
    raw = {k: total * v / s for k, v in shares.items()}
    base = {k: int(v) for k, v in raw.items()}
    rem = total - sum(base.values())
    for k in sorted(raw, key=lambda k: -(raw[k] - base[k]))[:rem]:
        base[k] += 1
    return base


# ────────────────────────── NUMERACY ──────────────────────────
def build_math_pool(rows):
    pools, stats = {}, {}
    for y in YEARS:
        ys = f"Year {y}"
        raw = [r for r in rows if r["Year Level"].strip() == ys]
        cand = [r for r in raw if item_ok(r)]
        best = {}
        for r in cand:
            k = norm(r["Question"])
            rank = (napflag(r), sum(1 for x in opts(r) if x))
            cur = best.get(k)
            if cur is None or rank > (napflag(cur), sum(1 for x in opts(cur) if x)):
                best[k] = r
        pools[y] = list(best.values())
        stats[y] = (len(raw), len(cand), len(pools[y]))
    return pools, stats


def select_math(pool, target, rng):
    strata = defaultdict(lambda: defaultdict(list))
    for r in pool:
        strata[r["Main Topic"].strip()][dlabel(r)].append(r)
    for t in strata:
        for d in strata[t]:
            strata[t][d] = weighted_shuffle(strata[t][d], lambda r: 1 + napflag(r), rng)
    shares = {t: sum(len(v) for v in strata[t].values()) for t in strata}
    quotas = largest_remainder(shares, target)
    selected = []

    def pop(t, d):
        lst = strata.get(t, {}).get(d)
        return lst.pop() if lst else None

    for t, q in quotas.items():
        if q <= 0:
            continue
        want = {"Easy": round(q * DIFF_MIX["Easy"]), "Hard": round(q * DIFF_MIX["Hard"])}
        want["Medium"] = q - want["Easy"] - want["Hard"]
        got = 0
        for d in ("Easy", "Medium", "Hard"):
            for _ in range(want[d]):
                r = pop(t, d)
                if r:
                    selected.append(r); got += 1
        while got < q:
            r = pop(t, "Medium") or pop(t, "Easy") or pop(t, "Hard")
            if not r:
                break
            selected.append(r); got += 1
    if len(selected) < target:
        have = Counter(dlabel(r) for r in selected)
        need = {d: round(target * p) for d, p in DIFF_MIX.items()}
        left = [r for t in strata for d in strata[t] for r in strata[t][d]]
        left = weighted_shuffle(left, lambda r: 1 + napflag(r), rng)
        left.sort(key=lambda r: -max(0, need.get(dlabel(r), 0) - have.get(dlabel(r), 0)))
        for r in left:
            if len(selected) >= target:
                break
            selected.append(r)
    return selected[:target]


def order_math(selected, year, rng):
    jit = {id(r): rng.random() for r in selected}
    key = lambda r: (dscore(r), jit[id(r)])
    if year >= 5:
        n_a = PART_A_N[year]
        elig = sorted([r for r in selected if dscore(r) <= 3 and len(r["Question"]) <= 220
                       and r["Sub-Topic"].strip() in MENTAL_SUBTOPICS], key=key)
        part_a = elig[:n_a]
        if len(part_a) < n_a:
            aids = {id(r) for r in part_a}
            rest = sorted([r for r in selected if id(r) not in aids], key=key)
            part_a += rest[:n_a - len(part_a)]
        aids = {id(r) for r in part_a}
        part_b = sorted([r for r in selected if id(r) not in aids], key=key)
        return [("Part A - Non-Calculator", sorted(part_a, key=key)),
                ("Part B - Calculator Allowed", part_b)]
    return [("Numeracy - No Calculator", sorted(selected, key=key))]


# ────────────────────────── READING ──────────────────────────
def build_reading_pool(rows):
    pools, stats = {}, {}
    for y in YEARS:
        groups = defaultdict(list)
        for r in rows:
            if r["Year Level"].strip() == str(y):
                groups[r["Comprehension"].strip()].append(r)
        seen, usable = set(), []
        for pid, qs in groups.items():
            if not (3 <= len(qs) <= 10):
                continue
            if not all(item_ok(r, allow_pair_ref=True) for r in qs):
                continue
            if not all(r["Main Topic"].strip() in READING_SKILLS for r in qs):
                continue
            if any(r["Sub-Topic"].strip() == "Visual Literacy" for r in qs):
                continue
            text = qs[0]["Reading Comprehension Text/Essay/Article"].strip()
            if not text:
                continue
            h = hashlib.md5(norm(text).encode()).hexdigest()
            if h in seen:
                continue
            seen.add(h)

            def qorder(r):
                try:
                    return int(r["Question Number"].strip().split(".")[-1])
                except ValueError:
                    return 999

            qs = sorted(qs, key=qorder)
            # drop duplicate question rows within the same passage (bank artefact)
            seenq, uq = set(), []
            for r in qs:
                k = norm(r["Question"])
                if k in seenq:
                    continue
                seenq.add(k)
                uq.append(r)
            qs = uq
            if not (3 <= len(qs) <= 10):
                continue
            try:
                length = int(qs[0].get("Length", "0") or 0)
            except ValueError:
                length = 0
            if length <= 0:
                length = len(text)
            usable.append({
                "pid": pid, "qs": qs, "text": text, "n": len(qs),
                "mean": sum(dscore(r) for r in qs) / len(qs),
                "flag": sum(napflag(r) for r in qs) / len(qs),
                "bucket": "S" if length < 1000 else ("M" if length <= 2500 else "L"),
                "skills": {r["Sub-Topic"].strip() for r in qs},
            })
        pools[y] = usable
        stats[y] = (len(groups), len(usable))
    return pools, stats


def select_reading(pool, year, rng):
    target, tol = READ_TARGET[year], READ_TOL
    kmin, kmax = READ_K[year]
    counts = Counter(p["bucket"] for p in pool)
    required = [b for b in ("S", "M", "L") if counts.get(b, 0) >= 6]

    def attempt_pass(tol_, required_, attempts):
        best = None
        for att in range(attempts):
            cand = weighted_shuffle(pool, lambda p: 1 + p["flag"], rng)
            chosen, ids, total, used = [], set(), 0, set()
            for b in required_:
                fit = [p for p in cand if p["bucket"] == b and id(p) not in ids
                       and total + p["n"] <= target + tol_ and len(chosen) < kmax]
                if fit:
                    p = fit[0]
                    chosen.append(p); ids.add(id(p)); total += p["n"]; used.add(b)
            for p in cand:
                if len(chosen) >= kmax:
                    break
                if id(p) in ids or total + p["n"] > target + tol_:
                    continue
                if (total >= target - tol_ and len(chosen) >= kmin
                        and all(b in used for b in required_)):
                    break
                chosen.append(p); ids.add(id(p)); total += p["n"]; used.add(p["bucket"])
            if not (target - tol_ <= total <= target + tol_ and kmin <= len(chosen) <= kmax
                    and all(b in used for b in required_)):
                continue
            means = sorted(p["mean"] for p in chosen)
            spread = means[-1] - means[0]
            skill_div = len(set().union(*(p["skills"] for p in chosen)))
            labs = Counter(dlabel(q) for p in chosen for q in p["qs"])
            mix_pen = sum(abs(labs.get(d, 0) - DIFF_MIX[d] * total) for d in DIFF_MIX)
            score = abs(total - target) * 3 + mix_pen * 0.8 - spread * 0.5 - skill_div * 0.1
            if best is None or score < best[0]:
                best = (score, chosen)
            if (best and abs(total - target) == 0 and spread >= 2
                    and mix_pen <= 0.15 * total and att > 120):
                break
        return best

    best = attempt_pass(tol, required, 600)
    if best is None:
        best = attempt_pass(tol + 2, [], 400)
    if best is None:
        raise RuntimeError(f"No feasible reading selection for Year {year}")
    return sorted(best[1], key=lambda p: p["mean"])


# ────────────────────────── OUTPUT ──────────────────────────
CSV_COLS = ["QuestionID", "ExamID", "ExamType", "ExamSection", "YearLevel", "Subject",
            "Topic", "SubTopic", "QuestionType", "ComprehensionText", "QuestionText",
            "QuestionMedia", "Correct", "AnswerA", "AnswerB", "AnswerC", "AnswerD",
            "AnswerE", "Difficulty", "IsActive", "CorrectAnswerScore", "Tags",
            "SourceBank", "SourceQuestionNumber", "SourceComprehensionID",
            "NAPLANFlag", "DifficultyScore", "DifficultyLabel"]
KEY_COLS = ["QuestionNumber", "QuestionID", "ExamSection", "Correct", "CorrectAnswerText",
            "Topic", "SubTopic", "DifficultyLabel", "DifficultyScore", "SourceQuestionNumber"]
MAN_COLS = ["ExamID", "Title", "YearLevel", "Subject", "ExamType", "QuestionCount",
            "Sections", "TimeLimitMinutes", "EasyCount", "MediumCount", "HardCount",
            "MeanDifficultyScore", "QuestionFile", "AnswerKeyFile"]


def write_csv(path, cols, rows):
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def write_exam(year, subject, exam_no, exam_type, qtype, bank_name, sections, time_limit):
    """sections: list of (section_name, items, passage_text). Returns (manifest, rows)."""
    short = "READING" if subject == "English" else "NUMERACY"
    tag = "RD" if subject == "English" else "NU"
    exam_id = f"NAPLAN-Y{year}-{short}-M{exam_no}"
    folder = "Reading" if subject == "English" else "Maths"
    base = f"Y{year}_{folder}_Mock{exam_no}"
    exam_dir = os.path.join(OUT, f"Year {year}", folder)
    os.makedirs(exam_dir, exist_ok=True)
    title = f"Year {year} NAPLAN-style {'Reading' if subject == 'English' else 'Numeracy (Maths)'} - Mock Exam {exam_no}"
    rows, keys = [], []
    qn = 0
    for sec_name, items, passage_text in sections:
        for r in items:
            qn += 1
            o = opts(r)
            ca = r["Correct Answer"].strip().upper()
            qid = f"{exam_id}-Q{qn:02d}"
            rows.append({
                "QuestionID": qid, "ExamID": exam_id, "ExamType": exam_type,
                "ExamSection": sec_name, "YearLevel": str(year), "Subject": subject,
                "Topic": r["Main Topic"].strip(), "SubTopic": r["Sub-Topic"].strip(),
                "QuestionType": qtype, "ComprehensionText": passage_text,
                "QuestionText": r["Question"].strip(), "QuestionMedia": "",
                "Correct": ca, "AnswerA": o[0], "AnswerB": o[1], "AnswerC": o[2],
                "AnswerD": o[3], "AnswerE": o[4], "Difficulty": str(diff5(dscore(r))),
                "IsActive": "1", "CorrectAnswerScore": "1",
                "Tags": f"NAPLAN,Year {year},Mock {exam_no}",
                "SourceBank": bank_name,
                "SourceQuestionNumber": r["Question Number"].strip(),
                "SourceComprehensionID": r.get("Comprehension", "").strip(),
                "NAPLANFlag": r["NAPLAN"].strip(), "DifficultyScore": str(dscore(r)),
                "DifficultyLabel": dlabel(r),
            })
            keys.append({
                "QuestionNumber": str(qn), "QuestionID": qid, "ExamSection": sec_name,
                "Correct": ca, "CorrectAnswerText": o["ABCDE".index(ca)],
                "Topic": r["Main Topic"].strip(), "SubTopic": r["Sub-Topic"].strip(),
                "DifficultyLabel": dlabel(r), "DifficultyScore": str(dscore(r)),
                "SourceQuestionNumber": r["Question Number"].strip(),
            })
    qrel = os.path.relpath(os.path.join(exam_dir, base + ".csv"), OUT)
    krel = os.path.relpath(os.path.join(exam_dir, base + "_AnswerKey.csv"), OUT)
    write_csv(os.path.join(exam_dir, base + ".csv"), CSV_COLS, rows)
    write_csv(os.path.join(exam_dir, base + "_AnswerKey.csv"), KEY_COLS, keys)
    diffs = Counter(r["DifficultyLabel"] for r in rows)
    sec_desc = "; ".join(f"{name} ({len(items)}q)" for name, items, _ in sections)
    man = {
        "ExamID": exam_id, "Title": title, "YearLevel": str(year), "Subject": subject,
        "ExamType": exam_type, "QuestionCount": str(len(rows)), "Sections": sec_desc,
        "TimeLimitMinutes": str(time_limit),
        "EasyCount": str(diffs.get("Easy", 0)), "MediumCount": str(diffs.get("Medium", 0)),
        "HardCount": str(diffs.get("Hard", 0)),
        "MeanDifficultyScore": f"{sum(int(x['DifficultyScore']) for x in rows) / max(1, len(rows)):.2f}",
        "QuestionFile": qrel, "AnswerKeyFile": krel,
    }
    return man, rows


# ────────────────────────── MAIN ──────────────────────────
def main():
    os.makedirs(OUT, exist_ok=True)
    eng = load(ENG_PATH)
    math_rows = load(MATH_PATH)
    rpools, rstats = build_reading_pool(eng)
    mpools, mstats = build_math_pool(math_rows)
    print("Reading pools (passages):", {y: len(rpools[y]) for y in YEARS})
    print("Maths pools (items):", {y: len(mpools[y]) for y in YEARS})
    manifest, all_rows = [], []
    for y in YEARS:
        for e in (1, 2, 3):
            rng = random.Random(f"NAPLAN-Y{y}-READING-M{e}-v1")
            chosen = select_reading(rpools[y], y, rng)
            ids = {id(p) for p in chosen}
            rpools[y] = [p for p in rpools[y] if id(p) not in ids]
            sections = [(f"Text {i}", p["qs"], p["text"]) for i, p in enumerate(chosen, 1)]
            man, rows = write_exam(y, "English", e, "NAPLAN_STYLE_READING",
                                   "ReadingComprehension",
                                   "English_Comprehension_Questions_expanded.csv",
                                   sections, READ_TIME[y])
            manifest.append(man)
            all_rows.extend(rows)
            print(f"{man['ExamID']}: {man['QuestionCount']}q / {len(chosen)} texts, "
                  f"E/M/H={man['EasyCount']}/{man['MediumCount']}/{man['HardCount']}, "
                  f"meanDS={man['MeanDifficultyScore']}")
        for e in (1, 2, 3):
            rng = random.Random(f"NAPLAN-Y{y}-NUMERACY-M{e}-v1")
            sel = select_math(mpools[y], NUM_TARGET[y], rng)
            ids = {id(r) for r in sel}
            mpools[y] = [r for r in mpools[y] if id(r) not in ids]
            sections = [(name, items, "") for name, items in order_math(sel, y, rng)]
            man, rows = write_exam(y, "Mathematics", e, "NAPLAN_STYLE_NUMERACY",
                                   "Multiple Choice", "Maths_Questions_Combined.csv",
                                   sections, NUM_TIME[y])
            manifest.append(man)
            all_rows.extend(rows)
            print(f"{man['ExamID']}: {man['QuestionCount']}q, "
                  f"E/M/H={man['EasyCount']}/{man['MediumCount']}/{man['HardCount']}, "
                  f"meanDS={man['MeanDifficultyScore']}")
    write_csv(os.path.join(OUT, "manifest.csv"), MAN_COLS, manifest)
    write_csv(os.path.join(OUT, "all_mock_exams_questions.csv"), CSV_COLS, all_rows)
    write_readme(manifest, rstats, mstats)
    print(f"\nDone: {len(manifest)} exams, {len(all_rows)} question rows -> {OUT}")


def write_readme(manifest, rstats, mstats):
    L = []
    a = L.append
    a("# NAPLAN-Style Mock Exams — Years 2–8 (Reading + Numeracy)")
    a("")
    a("**42 exams: 3 mock exams × 2 subjects × 7 year levels.** Every question, option and")
    a("answer key is copied verbatim from the two source banks — **no questions were authored**:")
    a("")
    a("- `mock-tests/QuestionBank/English_Comprehension_Questions_expanded.csv` (Reading)")
    a("- `mock-tests/QuestionBank/Maths_Questions_Combined.csv` (Numeracy)")
    a("")
    a("Regenerate with `python exam_tools/generate_mock_exams.py`; verify with")
    a("`python exam_tools/validate_mock_exams.py`. Selection is deterministic (fixed seeds).")
    a("")
    a("## Paper specifications (NAPLAN-aligned)")
    a("")
    a("NAPLAN officially assesses Years 3/5/7/9; Years 2/4/6/8 are bridging years scaled")
    a("between the adjacent official specifications. Reading papers are assembled from")
    a("**whole comprehension passages** (a passage's question set is never split), so totals")
    a("land within ±2 of target. Year 5+ Numeracy mirrors NAPLAN's non-calculator Part A.")
    a("")
    a("| Year | Reading texts | Reading questions | Reading time | Numeracy questions | Numeracy time | Numeracy sections |")
    a("|---|---|---|---|---|---|---|")
    for y in YEARS:
        rm = [m for m in manifest if m["YearLevel"] == str(y) and m["Subject"] == "English"]
        nm = [m for m in manifest if m["YearLevel"] == str(y) and m["Subject"] != "English"]
        rq = ", ".join(m["QuestionCount"] for m in rm)
        nq = ", ".join(m["QuestionCount"] for m in nm)
        texts = ", ".join(str(m["Sections"].count("Text ")) for m in rm)
        secs = "No calculator" if y < 5 else f"Part A ({PART_A_N[y]}q, non-calc) + Part B (calc)"
        a(f"| {y} | {texts} | {rq} | {READ_TIME[y]} min | {nq} | {NUM_TIME[y]} min | {secs} |")
    a("")
    a("## Selection rules (exam-panel blueprint)")
    a("")
    a("1. **Eligibility:** only items with source `NAPLAN` flag ≥ 1 (higher flags weighted")
    a("   more heavily in sampling). Flags are treated as NAPLAN-suitability ratings.")
    a("2. **Quality exclusions (items are dropped, never repaired):** Excel date-corrupted")
    a("   options (e.g. `1-Apr` where a fraction belongs); items depending on images that do")
    a("   not exist in the bank (`Image Name` is empty bank-wide); cross-question references")
    a("   (\"For questions 10 and 11…\"); fewer than 3 options; invalid answer keys; duplicate")
    a("   question text within a year (best NAPLAN flag kept). Reading passages containing")
    a("   Grammar/Punctuation/Spelling/Writing or Visual-Literacy items are reserved for other")
    a("   test families and excluded here.")
    a("3. **Difficulty:** target mix ≈ 30% Easy / 45% Medium / 25% Hard per paper; questions")
    a("   ramp easy→hard (Numeracy by Difficulty Score; Reading texts ordered by mean")
    a("   difficulty). Source scores (1–10) map to the platform 1–5 scale via ceil(score/2).")
    a("4. **Coverage:** Numeracy topic quotas are proportional to the eligible pool (Number,")
    a("   Measurement, Geometry, Algebra, Problem Solving, Statistics, Probability, Financial")
    a("   Maths). Reading papers balance short/medium/long texts where the year's pool allows")
    a("   and maximise sub-topic (skill) diversity.")
    a("5. **No reuse:** the 3 mocks within a year+subject share no questions and no passages.")
    a("")
    a("## Eligible pools after quality filtering")
    a("")
    a("| Year | Reading passages (total → usable) | Maths items (raw → NAPLAN≥1 & clean → unique) |")
    a("|---|---|---|")
    for y in YEARS:
        rt, ru = rstats[y]
        mr, mc, mu = mstats[y]
        a(f"| {y} | {rt} → {ru} | {mr} → {mc} → {mu} |")
    a("")
    a("## Files")
    a("")
    a("- `Year N/Reading/Y{N}_Reading_Mock{1..3}.csv` + `..._AnswerKey.csv`")
    a("- `Year N/Maths/Y{N}_Maths_Mock{1..3}.csv` + `..._AnswerKey.csv`")
    a("- `manifest.csv` — one row per exam (counts, sections, time limits, difficulty mix)")
    a("- `all_mock_exams_questions.csv` — all 42 exams concatenated for bulk import")
    a("")
    a("Question CSVs follow the platform importer schema (`upload-questions` route):")
    a("`ExamID, ExamType, ExamSection, YearLevel, Subject, Topic, SubTopic, QuestionType,")
    a("ComprehensionText, QuestionText, Correct, AnswerA–E, Difficulty (1–5), IsActive,")
    a("CorrectAnswerScore, Tags`. Extra provenance columns (`SourceBank,")
    a("SourceQuestionNumber, SourceComprehensionID, NAPLANFlag, DifficultyScore,")
    a("DifficultyLabel`) are ignored by the importer and preserve full traceability.")
    a("")
    a("**Import note:** create the 42 tests in the platform first, then replace each CSV's")
    a("human-readable `ExamID` (e.g. `NAPLAN-Y3-READING-M1`) with the created test's UUID so")
    a("the importer attaches questions to the right test. `ExamSection` becomes the section")
    a("name (Reading: Text 1…Text k; Numeracy: Part A / Part B).")
    a("")
    a("## Limitations")
    a("")
    a("- The banks contain no usable image files; strongly image-dependent items were")
    a("  excluded. A few retained items mention stimuli that are described inline in the")
    a("  text and remain answerable as-is.")
    a("- Year 8 reading passages in the bank are almost all long texts (~8 questions each),")
    a("  so Year 8 papers contain 5–6 long texts rather than a short/long mix.")
    a("- Difficulty labels/scores are the source authors' ratings, not empirically calibrated.")
    a("- Year 2 Hard items are scarce in the bank (31 eligible); the 25% Hard target is")
    a("  met as closely as the pool allows.")
    with open(os.path.join(OUT, "README.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")


if __name__ == "__main__":
    main()





