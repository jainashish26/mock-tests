/**
 * Regression tests for the writing-assessment pure modules.
 *
 * These pin the behaviour that fails silently if it breaks: band boundaries on
 * word-limit scaffolding, prompt-catalog invariants, score-band thresholds, and
 * the evaluation-detail normaliser that must read BOTH the new first-class
 * columns and legacy raw_response-only rows.
 *
 * Run with:
 *   npm run test:writing
 */

import { WRITING_PROMPTS, writingPromptById, promptsFor, calibrationFor, markingCriteria, normalizeYear, randomPrompt } from '@/lib/writing/prompts-catalog'
import { bandForYear, scaffoldForYear, countWords } from '@/lib/writing/word-limits'
import { scoreBand, toEvaluationDetail, buildParentActions, categoryPercents } from '@/lib/writing/evaluation-detail'
import type { WritingCategoryScores } from '@/lib/writing/types'

let pass = 0
let fail = 0
const eq = (label: string, actual: unknown, expected: unknown) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
    console.log('  PASS  ' + label)
  } else {
    fail++
    console.log('  FAIL  ' + label + '\n          actual   ' + a + '\n          expected ' + e)
  }
}
const ok = (label: string, cond: boolean) => eq(label, cond, true)

// ---- prompt catalog (MECE: Years 2-9, 15 cells per year) -------------------
eq('catalog seeds 120 prompts', WRITING_PROMPTS.length, 120)
eq('prompt ids are unique', new Set(WRITING_PROMPTS.map((p) => p.id)).size, 120)
eq('8 year levels present', new Set(WRITING_PROMPTS.map((p) => p.year)).size, 8)
ok(
  'every year has exactly 15 prompts',
  [2, 3, 4, 5, 6, 7, 8, 9].every((y) => WRITING_PROMPTS.filter((p) => p.year === y).length === 15)
)
eq('year 5 has 10 narrative', promptsFor(5, 'narrative').length, 10)
eq('year 5 has 5 persuasive', promptsFor(5, 'persuasive').length, 5)
eq('year 5 has 15 total', promptsFor(5).length, 15)
eq('y2-n1 resolves', writingPromptById('y2-n1')?.type, 'narrative')
eq('y9-s5 resolves', writingPromptById('y9-s5')?.type, 'persuasive')
eq('unknown prompt returns undefined', writingPromptById('nope'), undefined)

// ---- calibration -----------------------------------------------------------
eq('year 5 target min words', calibrationFor(5).minWords, 200)
eq('year 5 target max words', calibrationFor(5).maxWords, 275)
eq('year 5 time (mins)', calibrationFor(5).mins, 30)
eq('year 2 time (mins)', calibrationFor(2).mins, 15)
eq('normalizeYear(null) -> 5', normalizeYear(null), 5)
eq('normalizeYear(1) -> 5', normalizeYear(1), 5)
eq('normalizeYear(10) -> 9', normalizeYear(10), 9)
eq('normalizeYear(3) -> 3', normalizeYear(3), 3)

// ---- marking criteria + random --------------------------------------------
ok(
  'narrative criteria for year 5 is a short list',
  markingCriteria(5, 'narrative').length > 0 && markingCriteria(5, 'narrative').length <= 5
)
ok(
  'persuasive criteria for year 7 is a short list',
  markingCriteria(7, 'persuasive').length > 0 && markingCriteria(7, 'persuasive').length <= 5
)
const rnd = randomPrompt(6, 'narrative')
ok('randomPrompt returns a year-6 narrative', !!rnd && rnd.year === 6 && rnd.type === 'narrative')

// ---- word limits -----------------------------------------------------------
eq('year 2 -> 2-4 band', bandForYear(2), '2-4')
eq('year 4 -> 2-4 band', bandForYear(4), '2-4')
eq('year 5 -> 5-6 band', bandForYear(5), '5-6')
eq('year 8 -> 7-8 band', bandForYear(8), '7-8')
eq('missing year -> middle band', bandForYear(null), '5-6')
eq('year 4 min words', scaffoldForYear(4).minWords, 150)
eq('year 8 min words', scaffoldForYear(8).minWords, 400)
eq('year 4 minutes', scaffoldForYear(4).mins, 20)
eq('countWords collapses whitespace', countWords('  one   two\nthree  '), 3)
eq('countWords empty', countWords('   '), 0)
eq('countWords null', countWords(null), 0)

// ---- score bands -----------------------------------------------------------
eq('95 -> Excellent', scoreBand(95), 'Excellent')
eq('85 -> Good', scoreBand(85), 'Good')
eq('75 -> Satisfactory', scoreBand(75), 'Satisfactory')
eq('65 -> Needs Improvement', scoreBand(65), 'Needs Improvement')
eq('55 -> Unsatisfactory', scoreBand(55), 'Unsatisfactory')

// ---- evaluation detail -----------------------------------------------------
const cats: WritingCategoryScores = {
  language_mechanics: { grammar: 8, spelling: 4, punctuation: 4, total: 16 },
  vocabulary: { effective_word_choices: 8, varied_word_usage: 4, total: 12 },
  cohesion_structure: { cohesiveness: 8, structure: 8, total: 16 },
  content_ideas: { relevance: 8, depth_originality: 8, evidence_support: 4, total: 20 },
  engagement_style: { engagement: 4, tone_voice: 4, language_features: 6, total: 14 },
}

const newRow = {
  score_out_of100: 78,
  text_type: 'narrative',
  category_scores: cats,
  techniques_used: ['Sensory Detail', 'First-Person Narrator'],
  strengths: ['Strong, specific opening'],
  improvements_detail: [{ suggestion: 'Keep verb tense consistent', estimated_score_gain: 3, rewrite: 'The water was cold.' }],
  improved_text: 'polished text',
  practice_exercise: 'tense drill',
  rubric_version: 'v1.1',
  model: 'deepseek-flash',
  word_count: 210,
  created_at: '2026-01-01T00:00:00.000Z',
}

const newDetail = toEvaluationDetail(newRow)
ok('new-column row parses', newDetail !== null)
eq('new-column score', newDetail?.score_out_of100, 78)
eq('new-column text type', newDetail?.text_type, 'narrative')
eq('category total derived from parts', newDetail?.category_scores?.language_mechanics.total, 16)
eq('techniques survive', newDetail?.techniques_used.length, 2)
eq('rich improvement gain', newDetail?.improvements[0]?.estimated_score_gain, 3)
eq('rich improvement rewrite', newDetail?.improvements[0]?.rewrite, 'The water was cold.')

const legacyRow = {
  score_out_of100: 60,
  raw_response: { text_type: 'persuasive', category_scores: cats, techniques_used: ['Rule of Three'] },
}
const legacyDetail = toEvaluationDetail(legacyRow)
ok('legacy raw_response row parses', legacyDetail !== null)
eq('legacy text type from raw_response', legacyDetail?.text_type, 'persuasive')
eq('legacy category scores from raw_response', legacyDetail?.category_scores?.content_ideas.total, 20)

eq('null row -> null', toEvaluationDetail(null), null)

// ---- category percentages --------------------------------------------------
const pct = categoryPercents(cats)
eq('language mechanics normalised to 80%', pct.language_mechanics, 80)
eq('vocabulary normalised to 80%', pct.vocabulary, 80)
eq('content ideas normalised to 80%', pct.content_ideas, 80)

// ---- parent actions ----------------------------------------------------------
const actions = buildParentActions(newDetail)
ok('parent actions non-empty', actions.length > 0)
ok('parent actions capped at three', actions.length <= 3)
eq('no detail -> no actions', buildParentActions(null).length, 0)

console.log(`\n${'-'.repeat(58)}`)
console.log(`PASSED: ${pass}   FAILED: ${fail}`)
console.log(`${'-'.repeat(58)}\n`)
if (fail > 0) process.exit(1)