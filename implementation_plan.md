# Implementation Plan — Writing Assessment (DeepSeek Flash) + Report Suite

## Overview

Deliver a **Writing Assessment** capability graded by the **DeepSeek Flash API**, seeded with 8 narrative + 5 persuasive prompts across all platform year levels (Years 2–8), plus a **report suite** that surfaces strengths, weaknesses, and actionable next steps so scores improve on the next attempt.

The platform already has an async marking pipeline (`src/lib/writing/prompt.ts`, `grade-writing.ts`, `/api/jobs/writing-eval`, `/api/cron/writing-backlog`, `WRITING_PENDING` flow, `writing_evaluations`). This plan **extends** it.

### Scope correction discovered during investigation (important)

`015_student_access_remediation.sql` codifies the platform's hardest access rule: **students have no SELECT permission on any results table** (`attempts`, `responses`, `writing_evaluations`). Students see a zero-metric completion screen; parents/tutors/admin see results. Therefore the writing reports and practice feedback are **parent/tutor/admin-facing**; students get qualitative-only encouragement with no numbers. This is the one deliberate deviation from the verbally-agreed default ("student + parent views"); it follows the existing security model.

## Types

New file `mock-tests/src/lib/writing/types.ts`:
- `WritingTextType`, `WritingScoreBand`, `WritingCategoryScores`, `WritingImprovement`, `WritingEvaluationDetail`, `WritingProgressPoint`, `WritingPromptMeta` (specs in the investigation notes).

## Files

### New
- `mock-tests/supabase/migrations/096_writing_assessment_reporting.sql` — enum `WRITING`, first-class `writing_evaluations` columns + backfill, `writing_practice_sessions` table + RLS + indexes (also local record; applied to hosted).
- `mock-tests/supabase/migrations/097_writing_assessment_content.sql` — 13 prompts + 6 tests seed.
- `mock-tests/src/lib/writing/prompts-catalog.ts`, `word-limits.ts`, `types.ts`, `evaluation-detail.ts`
- `mock-tests/src/features/report/components/WritingReportPanel.tsx`, `WritingProgressChart.tsx`, `ParentActionSummary.tsx`
- `mock-tests/src/app/api/reporting/writing/progress/route.ts`
- `mock-tests/src/app/api/ai-practice/route.ts`, `mock-tests/src/app/api/jobs/writing-practice/route.ts`
- `mock-tests/src/app/student/ai-practice/client.tsx`

### Modified
- `src/lib/writing/grade-writing.ts` (deepseek-flash default, new columns, extract `callDeepseekForText`, add `gradePracticeSession`)
- `src/lib/writing/prompt.ts` (rubric v1.1, word-count note)
- `src/lib/report/load-report-data.ts`, `src/features/report/components/TestReportView.tsx`
- `src/app/api/cron/writing-backlog/route.ts` (also sweep practice sessions)
- `src/features/runner/components/TestRunner.tsx` (soft word-count warning)
- `06-env.example` (`DEEPSEEK_MODEL=deepseek-flash`, `QSTASH_WRITING_PRACTICE_ENDPOINT`)

## Reports

- **A. Enhanced Writing Report (parent/tutor)**: score + band, category breakdown bars, technique badges (narrative devices/techniques or persuasive A FOREST/rhetorical/strategic), strengths, improvements with `estimated_score_gain` + grammar rewrites, side-by-side original vs "High Distinction" rewrite, targeted practice exercise.
- **B. Writing Progress Report (parent/tutor)**: SVG trend of overall + per-category scores across tests and practice sessions.
- **C. Parent Action Summary**: plain-English "practise this week" actions.
- **D. Gating**: summary free; detail behind the existing lock patterns (`has_active_subscription`/`LockedInsightCard`).

## Dependencies

No new npm packages. DeepSeek via existing fetch. Charts hand-rolled SVG (matches `ItemScatter.tsx`).

## Implementation order

1. Migration 096 (schema) → 2. Migration 097 (content) → 3. catalog/limits/types → 4. `grade-writing` refactor → 5. practice grading + job + sweeper → 6. `evaluation-detail` + report data → 7. `WritingReportPanel` + `TestReportView` → 8. progress API + chart + parent summary → 9. AI Practice Lab UI → 10. runner warning → 11. build/tests.