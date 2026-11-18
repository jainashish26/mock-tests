# NAPLAN-Style Mock Exams — Years 2–8 (Reading + Numeracy)

**42 exams: 3 mock exams × 2 subjects × 7 year levels.** Every question, option and
answer key is copied verbatim from the two source banks — **no questions were authored**:

- `mock-tests/QuestionBank/English_Comprehension_Questions_expanded.csv` (Reading)
- `mock-tests/QuestionBank/Maths_Questions_Combined.csv` (Numeracy)

Regenerate with `python exam_tools/generate_mock_exams.py`; verify with
`python exam_tools/validate_mock_exams.py`. Selection is deterministic (fixed seeds).

## Paper specifications (NAPLAN-aligned)

NAPLAN officially assesses Years 3/5/7/9; Years 2/4/6/8 are bridging years scaled
between the adjacent official specifications. Reading papers are assembled from
**whole comprehension passages** (a passage's question set is never split), so totals
land within ±2 of target. Year 5+ Numeracy mirrors NAPLAN's non-calculator Part A.

| Year | Reading texts | Reading questions | Reading time | Numeracy questions | Numeracy time | Numeracy sections |
|---|---|---|---|---|---|---|
| 2 | 5, 5, 5 | 25, 25, 25 | 40 min | 25, 25, 25 | 40 min | No calculator |
| 3 | 6, 6, 5 | 30, 30, 30 | 45 min | 35, 35, 35 | 45 min | No calculator |
| 4 | 6, 6, 6 | 32, 32, 32 | 45 min | 36, 36, 36 | 50 min | No calculator |
| 5 | 6, 6, 6 | 35, 35, 35 | 50 min | 40, 40, 40 | 50 min | Part A (8q, non-calc) + Part B (calc) |
| 6 | 7, 6, 7 | 38, 38, 37 | 55 min | 42, 42, 42 | 55 min | Part A (8q, non-calc) + Part B (calc) |
| 7 | 7, 7, 7 | 42, 42, 42 | 65 min | 48, 48, 48 | 65 min | Part A (10q, non-calc) + Part B (calc) |
| 8 | 6, 6, 6 | 44, 46, 43 | 65 min | 48, 48, 48 | 65 min | Part A (10q, non-calc) + Part B (calc) |

## Selection rules (exam-panel blueprint)

1. **Eligibility:** only items with source `NAPLAN` flag ≥ 1 (higher flags weighted
   more heavily in sampling). Flags are treated as NAPLAN-suitability ratings.
2. **Quality exclusions (items are dropped, never repaired):** Excel date-corrupted
   options (e.g. `1-Apr` where a fraction belongs); items depending on images that do
   not exist in the bank (`Image Name` is empty bank-wide); cross-question references
   ("For questions 10 and 11…"); fewer than 3 options; invalid answer keys; duplicate
   question text within a year (best NAPLAN flag kept). Reading passages containing
   Grammar/Punctuation/Spelling/Writing or Visual-Literacy items are reserved for other
   test families and excluded here.
3. **Difficulty:** target mix ≈ 30% Easy / 45% Medium / 25% Hard per paper; questions
   ramp easy→hard (Numeracy by Difficulty Score; Reading texts ordered by mean
   difficulty). Source scores (1–10) map to the platform 1–5 scale via ceil(score/2).
4. **Coverage:** Numeracy topic quotas are proportional to the eligible pool (Number,
   Measurement, Geometry, Algebra, Problem Solving, Statistics, Probability, Financial
   Maths). Reading papers balance short/medium/long texts where the year's pool allows
   and maximise sub-topic (skill) diversity.
5. **No reuse:** the 3 mocks within a year+subject share no questions and no passages.

## Eligible pools after quality filtering

| Year | Reading passages (total → usable) | Maths items (raw → NAPLAN≥1 & clean → unique) |
|---|---|---|
| 2 | 250 → 193 | 1285 → 731 → 731 |
| 3 | 250 → 170 | 2672 → 1652 → 1651 |
| 4 | 250 → 149 | 2275 → 1378 → 1378 |
| 5 | 300 → 168 | 3155 → 1907 → 1905 |
| 6 | 300 → 165 | 2711 → 1559 → 1558 |
| 7 | 200 → 127 | 2595 → 1403 → 1403 |
| 8 | 200 → 123 | 2360 → 919 → 919 |

## Files

- `Year N/Reading/Y{N}_Reading_Mock{1..3}.csv` + `..._AnswerKey.csv`
- `Year N/Maths/Y{N}_Maths_Mock{1..3}.csv` + `..._AnswerKey.csv`
- `manifest.csv` — one row per exam (counts, sections, time limits, difficulty mix)
- `all_mock_exams_questions.csv` — all 42 exams concatenated for bulk import

Question CSVs follow the platform importer schema (`upload-questions` route):
`ExamID, ExamType, ExamSection, YearLevel, Subject, Topic, SubTopic, QuestionType,
ComprehensionText, QuestionText, Correct, AnswerA–E, Difficulty (1–5), IsActive,
CorrectAnswerScore, Tags`. Extra provenance columns (`SourceBank,
SourceQuestionNumber, SourceComprehensionID, NAPLANFlag, DifficultyScore,
DifficultyLabel`) are ignored by the importer and preserve full traceability.

## Supabase integration (LIVE)

Seeded into project `ekdjrvjgrhpqolthbznr` on 2026-11-17 by
`mock-tests/scripts/seed_naplan_mocks.py` (stdlib-only, reads `.env.local` locally;
credentials are never printed). Re-running is idempotent: all ids are deterministic
UUIDv5 values and every write is an upsert.

| Table | Rows | Notes |
|---|---|---|
| `tests` | 42 | `status=PUBLISHED`, `is_free=true`, `year_level_min=max=year`, `created_by`=TEST_CREATOR, `approved_by`=ADMIN, `published_at` set |
| `questions` | 1,560 | `PUBLISHED`, `is_active=true`, `correct_answer`=letter (scorer canonicalises), `comprehension_text`+`answer_a–e` feed the runner, `difficulty` 1–5, `correct_answer_score=1`, primary `skill_*`=1.0, `exam_id`=human-readable ExamID |
| `test_sections` | 160 | Reading: Text 1…Text k; Numeracy: Part A / Part B (or single no-calculator section for Y2–4) |
| `test_questions` | 1,560 | `question_order` preserves the difficulty ramp; `base_difficulty` clamped to the live CHECK 1–4 |

**Access model:** free + published means `can_access_published_test()` grants every
logged-in user access (verified by simulating a student JWT under RLS: all 42 tests,
all 1,560 mappings, and the runner's question+passage join returned correctly).

**Where the exams appear in the app:** parent → child → "Assign a New Test";
student runner (`/student/test/[assignmentId]`) and reports; admin/creator
catalogues; the nightly reporting ETL picks them up automatically. No app code
changes were required.

**Re-seed / update:** `python mock-tests/scripts/seed_naplan_mocks.py`
(`--dry-run` shows the plan without writing).
**Teardown:** `mock-tests/supabase/seeds/998_cleanup_naplan_mock_exams.sql`
(deletes only these exams; guarded statements for assignments/attempts included).

To make any mock paid instead of free: set `tests.is_free=false` and map it to a
product via `product_tests` (admin → Catalog); access then requires an entitlement
or active subscription.

## Limitations

- The banks contain no usable image files; strongly image-dependent items were
  excluded. A few retained items mention stimuli that are described inline in the
  text and remain answerable as-is.
- Year 8 reading passages in the bank are almost all long texts (~8 questions each),
  so Year 8 papers contain 5–6 long texts rather than a short/long mix.
- Difficulty labels/scores are the source authors' ratings, not empirically calibrated.
- Year 2 Hard items are scarce in the bank (31 eligible); the 25% Hard target is
  met as closely as the pool allows.
