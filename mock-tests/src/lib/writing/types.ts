/**
 * Writing-assessment value types.
 *
 * These describe the AI evaluation shape (mirrors the rubric in
 * src/lib/writing/prompt.ts) and the progress/word-limit helpers. They are the
 * single shape both the report UI and the practice flow consume, so the
 * per-attempt report and the practice report cannot drift.
 */

export type WritingTextType = 'narrative' | 'persuasive' | 'other'

export type WritingScoreBand =
  | 'Excellent'
  | 'Good'
  | 'Satisfactory'
  | 'Needs Improvement'
  | 'Unsatisfactory'

/** Year bands used for word/time scaffolding. Years map 2-4 / 5-6 / 7-8. */
export type YearBand = '2-4' | '5-6' | '7-8'

export interface WritingCategoryScores {
  language_mechanics: {
    grammar: number
    spelling: number
    punctuation: number
    total: number
  }
  vocabulary: {
    effective_word_choices: number
    varied_word_usage: number
    total: number
  }
  cohesion_structure: {
    cohesiveness: number
    structure: number
    total: number
  }
  content_ideas: {
    relevance: number
    depth_originality: number
    evidence_support: number
    total: number
  }
  engagement_style: {
    engagement: number
    tone_voice: number
    language_features: number
    total: number
  }
}

export interface WritingImprovement {
  suggestion: string
  estimated_score_gain: number
  rewrite: string | null
}

/**
 * Normalised evaluation for a single piece of writing. Either a test attempt's
 * writing_evaluations row or a writing_practice_sessions row is shaped into
 * this via `toEvaluationDetail`.
 */
export interface WritingEvaluationDetail {
  score_out_of100: number
  text_type: WritingTextType
  category_scores: WritingCategoryScores | null
  techniques_used: string[]
  strengths: string[]
  improvements: WritingImprovement[]
  improved_text: string | null
  practice_exercise: string | null
  rubric_version: string | null
  model: string | null
  word_count: number | null
  created_at: string
}

export interface WritingProgressPoint {
  source: 'test' | 'practice'
  attempt_id: string | null
  practice_session_id: string | null
  test_title: string | null
  text_type: WritingTextType | null
  date: string
  score: number
  /** Normalised to percentages (0-100) so categories can be trended together. */
  categories: Record<
    'language_mechanics' | 'vocabulary' | 'cohesion_structure' | 'content_ideas' | 'engagement_style',
    number | null
  >
}

export interface WritingPromptMeta {
  id: string
  text_type: 'narrative' | 'persuasive'
  prompt: string
  year_bands: YearBand[]
  min_words: Record<YearBand, number>
  suggested_mins: Record<YearBand, number>
}