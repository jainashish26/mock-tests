/**
 * Per-year-level daily practice limits — the pure half.
 *
 * WHY THIS IS SEPARATE FROM `admin-year-caps.ts`
 *   The reader has to import `./connection`, which imports `next/headers`, so
 *   anything that lives there cannot be exercised by the Node test suites this
 *   project depends on (`npm run test:reporting` and friends run with no Next
 *   runtime). Validation and wording are exactly the parts worth testing without
 *   a server: they are the difference between an admin being told "violates check
 *   constraint dim_year_level_cap_tests_target_coherence" and being told
 *   "Year 2: the recommended target cannot exceed the ceiling of 10".
 *
 * WHAT THE TWO NUMBERS MEAN, AND WHY IT IS SAID OUT LOUD HERE
 *   Decision 4-A produced a CEILING and a RECOMMENDED TARGET, and they are not two
 *   guesses at the same thing:
 *
 *   - the ceiling is a guard. `mv_student_daily_target.effective_cap` clamps a
 *     child's daily target to it, and exceeding it is what raises the parent's
 *     plan-adjustment notice (rule B7). It is intentionally high — 10 to 25 full
 *     papers — because a guard that fires at plausible study levels is a nag, not a
 *     guard.
 *   - the recommended target is advice. 2 to 3 papers a day, which is what a parent
 *     would recognise as a reasonable plan. It is enforced by nothing today.
 *
 *   `CAP_ENFORCEMENT_NOTE` below states that gap in the UI rather than leaving it
 *   implicit, because a settings screen with a column labelled "recommended" beside
 *   one labelled "maximum" invites the assumption that both do something. Only one
 *   does. Pretending otherwise is how an unused field becomes a policy nobody
 *   implemented — the same shape of problem as `checkout_abandon_minutes`, which sat
 *   configured while nothing read it.
 */

export interface YearLevelCap {
  year_level: number
  max_tests_per_day: number
  max_questions_per_day: number
  recommended_tests_per_day: number
  recommended_questions_per_day: number
  updated_at: string | null
}

/** The shape an admin submits, before it has been checked or coerced. */
export interface YearLevelCapDraft {
  year_level: number
  max_tests: number
  max_questions: number
  recommended_tests: number
  recommended_questions: number
}

/**
 * The bounds the database enforces, mirrored here so the form can refuse early.
 *
 * Duplicated on purpose, and pinned by a test that compares the two: the table
 * CHECK constraints remain the guarantee, and a client-side copy is only allowed to
 * make the message nicer. If they ever disagree the table wins, so a mismatch is a
 * bug in this file rather than a hole — but it would surface as a form that accepts
 * values the server then rejects, which is the friction that teaches an operator to
 * stop trusting an interface.
 */
export const CAP_BOUNDS = {
  yearLevelMin: 2,
  yearLevelMax: 9,
  testsMin: 1,
  testsMax: 40,
  questionsMin: 1,
  questionsMax: 2000,
  /** Decision 4-A: a recommended target below 2 was explicitly ruled out. */
  recommendedMin: 2,
} as const

export type CapRejection =
  | 'YEAR_LEVEL_OUT_OF_RANGE'
  | 'CEILING_TESTS_OUT_OF_RANGE'
  | 'CEILING_QUESTIONS_OUT_OF_RANGE'
  | 'TARGET_TESTS_TOO_LOW'
  | 'TARGET_TESTS_EXCEEDS_CEILING'
  | 'TARGET_QUESTIONS_TOO_LOW'
  | 'TARGET_QUESTIONS_EXCEEDS_CEILING'

export interface CapValidationFailure {
  field: keyof YearLevelCapDraft
  code: CapRejection
  /** Written for a person, and names the year level: an admin editing a table of
   *  eight rows needs to know which row they are being refused on. */
  message: string
}

/**
 * Refuse an incoherent cap before it reaches Postgres.
 *
 * Returns every problem with the draft, not just the first: an admin setting up a
 * year level has several fields to get right at once, and one-error-per-keystroke
 * turns a two-minute job into a guessing game.
 */
export function validateYearLevelCap(draft: YearLevelCapDraft): CapValidationFailure[] {
  const failures: CapValidationFailure[] = []
  const y = draft.year_level

  const fail = (
    field: keyof YearLevelCapDraft,
    code: CapRejection,
    message: string
  ): void => {
    failures.push({ field, code, message })
  }

  if (!Number.isInteger(y) || y < CAP_BOUNDS.yearLevelMin || y > CAP_BOUNDS.yearLevelMax) {
    fail(
      'year_level',
      'YEAR_LEVEL_OUT_OF_RANGE',
      `Year level ${y} is outside the configured range ${CAP_BOUNDS.yearLevelMin}–${CAP_BOUNDS.yearLevelMax}.`
    )
  }

  // Each numeric field is checked for wholeness before any comparison uses it, so
  // a blank or a fraction produces a message about that field rather than about an
  // unrelated comparison against NaN.
  const wholeTests = Number.isInteger(draft.max_tests)
  const wholeQuestions = Number.isInteger(draft.max_questions)
  const wholeRecTests = Number.isInteger(draft.recommended_tests)
  const wholeRecQuestions = Number.isInteger(draft.recommended_questions)

  if (!wholeTests || draft.max_tests < CAP_BOUNDS.testsMin || draft.max_tests > CAP_BOUNDS.testsMax) {
    fail(
      'max_tests',
      'CEILING_TESTS_OUT_OF_RANGE',
      `Year ${y}: the daily test ceiling must be a whole number between ${CAP_BOUNDS.testsMin} and ${CAP_BOUNDS.testsMax}.`
    )
  }

  if (
    !wholeQuestions ||
    draft.max_questions < CAP_BOUNDS.questionsMin ||
    draft.max_questions > CAP_BOUNDS.questionsMax
  ) {
    fail(
      'max_questions',
      'CEILING_QUESTIONS_OUT_OF_RANGE',
      `Year ${y}: the daily question ceiling must be a whole number between ${CAP_BOUNDS.questionsMin} and ${CAP_BOUNDS.questionsMax}.`
    )
  }

  if (!wholeRecTests || draft.recommended_tests < CAP_BOUNDS.recommendedMin) {
    fail(
      'recommended_tests',
      'TARGET_TESTS_TOO_LOW',
      `Year ${y}: the recommended daily test target must be a whole number of at least ${CAP_BOUNDS.recommendedMin}.`
    )
  } else if (wholeTests && draft.recommended_tests > draft.max_tests) {
    fail(
      'recommended_tests',
      'TARGET_TESTS_EXCEEDS_CEILING',
      `Year ${y}: the recommended target (${draft.recommended_tests}) cannot exceed the ceiling (${draft.max_tests}). The ceiling is the most the system will ever ask of a child, so advice above it is not advice — it is a second ceiling.`
    )
  }

  if (!wholeRecQuestions || draft.recommended_questions < CAP_BOUNDS.recommendedMin) {
    fail(
      'recommended_questions',
      'TARGET_QUESTIONS_TOO_LOW',
      `Year ${y}: the recommended daily question target must be a whole number of at least ${CAP_BOUNDS.recommendedMin}.`
    )
  } else if (wholeQuestions && draft.recommended_questions > draft.max_questions) {
    fail(
      'recommended_questions',
      'TARGET_QUESTIONS_EXCEEDS_CEILING',
      `Year ${y}: the recommended question target (${draft.recommended_questions}) cannot exceed the question ceiling (${draft.max_questions}).`
    )
  }

  return failures
}

/** True when the draft would be accepted. */
export function isCapDraftValid(draft: YearLevelCapDraft): boolean {
  return validateYearLevelCap(draft).length === 0
}

/**
 * The one sentence in this screen that could otherwise be quietly wrong.
 *
 * Rendered beside the recommended-target column so the gap between "configured"
 * and "enforced" is visible where the number is entered, not only in a migration
 * comment nobody reads.
 */
export const CAP_ENFORCEMENT_NOTE =
  'Only the ceilings are enforced. A student’s daily target is clamped to the ceiling by ' +
  'mv_student_daily_target, and needing more than the ceiling is what raises the parent’s ' +
  'plan-adjustment notice. The recommended target is stored and displayed, but nothing clamps ' +
  'to it yet — changing it does not change what any child is asked to do.'

/** How the question ceilings were derived, stated so a reader can disagree with it. */
export const QUESTION_MULTIPLIER_NOTE =
  'Question ceilings are derived as ceiling-tests × 25, per decision 4-A. Published tests have a ' +
  'median of 35 items, so 25 is a policy floor rather than a measurement: it makes the question ' +
  'ceiling bind sooner than the test ceiling for a typical paper.'

/** Column labels, exported so the table and any future CSV export cannot diverge. */
export const CAP_COLUMN_LABELS = {
  max_tests_per_day: 'Ceiling: tests/day',
  max_questions_per_day: 'Ceiling: questions/day',
  recommended_tests_per_day: 'Recommended: tests/day',
  recommended_questions_per_day: 'Recommended: questions/day',
} as const

/**
 * Every year level that must be present, and therefore every one the editor must
 * be able to show.
 *
 * WHY A FULL SET IS ASSERTED RATHER THAN THE ROWS HAPPENING TO EXIST
 *   `admin_year_level_caps()` returns zero rows in two very different situations:
 *   nobody configured anything, and — far more likely, since migration 107 seeds
 *   all eight and makes them NOT NULL — *the caller was refused*. The RPC answers
 *   HTTP 200 with `[]` for a service-role read, because `has_role('ADMIN')` needs
 *   a user JWT and `auth.uid()` is null under the admin client. That response is
 *   indistinguishable from an empty table by shape alone.
 *
 *   Treated as "no limits configured", the page would tell an operator that nothing
 *   is set on a database where every limit is set, and the natural remedy —
 *   configuring them — is one they already took. So the expected set is declared
 *   here and compared against, which converts a silently wrong empty state into a
 *   specific diagnostic about the read.
 */
export const EXPECTED_YEAR_LEVELS = Object.freeze([2, 3, 4, 5, 6, 7, 8, 9])

/** Which mandated year levels are absent from a read result. */
export function missingYearLevels(present: number[]): number[] {
  const seen = new Set(present);
  return EXPECTED_YEAR_LEVELS.filter((y) => !seen.has(y));
}


/** A one-line summary of a row, for the saved banner and any audit trail. */
export function describeCap(cap: YearLevelCap): string {
  return (
    `Year ${cap.year_level}: ceiling ${cap.max_tests_per_day} tests ` +
    `(${cap.max_questions_per_day} questions)/day, recommended ` +
    `${cap.recommended_tests_per_day} tests (${cap.recommended_questions_per_day} questions)`
  )
}

