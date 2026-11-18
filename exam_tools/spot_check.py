# -*- coding: utf-8 -*-
"""Human-readable spot check of generated exam papers."""
import csv, io, os, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
csv.field_size_limit(10_000_000)
OUT = r"c:\Users\gmail\OneDrive\Documents\GitHub\mock-tests\mock-tests-1\mock-tests\MockExams"


def load(p):
    with open(p, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


for rel in [r"Year 3\Reading\Y3_Reading_Mock1.csv", r"Year 7\Maths\Y7_Maths_Mock1.csv"]:
    rows = load(os.path.join(OUT, rel))
    print("=" * 25, rel, f"({len(rows)} rows)")
    for r in rows[:8]:
        print(r["QuestionID"], "|", r["ExamSection"], "|", r["Topic"], "/", r["SubTopic"],
              "| DS", r["DifficultyScore"], r["DifficultyLabel"], "| ans", r["Correct"],
              "| src#", r["SourceQuestionNumber"])
        print("   Q:", r["QuestionText"][:110].replace("\n", " "))
        print("   A:", r["AnswerA"][:38], "| B:", r["AnswerB"][:38],
              "| C:", r["AnswerC"][:38], "| D:", r["AnswerD"][:38])
    if "Reading" in rel:
        secs = {}
        for r in rows:
            secs.setdefault(r["ExamSection"], r["ComprehensionText"])
        for s, t in secs.items():
            print(f"   {s}: passage {len(t)} chars | title: {t.splitlines()[0][:70]}")

print("\n--- manifest (first 6 rows) ---")
for m in load(os.path.join(OUT, "manifest.csv"))[:6]:
    print(m["ExamID"], "|", m["QuestionCount"], "q |", m["TimeLimitMinutes"], "min |", m["Sections"])

n = sum(len(files) for _, _, files in os.walk(OUT))
print("\ntotal files under MockExams:", n)
