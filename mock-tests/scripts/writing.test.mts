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

import { WRITING_PROMPTS, writingPromptById, writingPromptsForBand } from '@/lib/writing/prompts-catalog'
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

// ---- prompt catalog --------------------------------------------------------
eq('catalog seeds 13 prompts', WRITING_PROMPTS.length, 13)
eq('catalog has 8 narrative prompts', WRITING_PROMPTS.filter((p) => p.text_type === 'narrative').length, 8)
eq('catalog has 5 persuasive prompts', WRITING_PROMPTS.filter((p) => p.text_type === 'persuasive').length, 5)
eq('prompt ids are unique', new Set(WRITING_PROMPTS.map((p) => p.id)).size, WRITING_PROMPTS.length)
ok('every prompt targets all three year bands', WRITING_PROMPTS.every((p) => p.year_bands.length === 3))
eq('nar-01 resolves', writingPromptById('nar-01')?.text_type, 'narrative')
eq('per-05 resolves', writingPromptById('per-05')?.text_type, 'persuasive')
eq('unknown prompt returns undefined', writingPromptById('nope'), undefined)
eq('band 2-4 returns all 13 prompts', writingPromptsForBand('2-4').length, 13)

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