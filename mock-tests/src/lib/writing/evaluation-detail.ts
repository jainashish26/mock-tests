import type {
  WritingCategoryScores,
  WritingEvaluationDetail,
  WritingImprovement,
  WritingScoreBand,
  WritingTextType,
} from './types'

type Row = Record<string, unknown>

function toText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((v) => toText(v)).filter(Boolean)
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function normaliseTextType(value: unknown): WritingTextType {
  const t = toText(value).toLowerCase()
  if (t === 'narrative' || t === 'persuasive') return t
  return 'other'
}

function categoryTotal(cat: Record<string, unknown> | undefined | null, keys: string[]): number {
  if (!cat || typeof cat !== 'object') return 0
  if (asNumber(cat.total) > 0) return asNumber(cat.total)
  return keys.reduce((sum, k) => sum + asNumber(cat?.[k]), 0)
}

function normaliseCategoryScores(value: unknown): WritingCategoryScores | null {
  const c = (value && typeof value === 'object' ? value : null) as Record<string, unknown> | null
  if (!c) return null
  const lm = (c.language_mechanics ?? {}) as Record<string, unknown>
  const voc = (c.vocabulary ?? {}) as Record<string, unknown>
  const coh = (c.cohesion_structure ?? {}) as Record<string, unknown>
  const con = (c.content_ideas ?? {}) as Record<string, unknown>
  const eng = (c.engagement_style ?? {}) as Record<string, unknown>
  return {
    language_mechanics: {
      grammar: asNumber(lm.grammar),
      spelling: asNumber(lm.spelling),
      punctuation: asNumber(lm.punctuation),
      total: categoryTotal(lm, ['grammar', 'spelling', 'punctuation']),
    },
    vocabulary: {
      effective_word_choices: asNumber(voc.effective_word_choices),
      varied_word_usage: asNumber(voc.varied_word_usage),
      total: categoryTotal(voc, ['effective_word_choices', 'varied_word_usage']),
    },
    cohesion_structure: {
      cohesiveness: asNumber(coh.cohesiveness),
      structure: asNumber(coh.structure),
      total: categoryTotal(coh, ['cohesiveness', 'structure']),
    },
    content_ideas: {
      relevance: asNumber(con.relevance),
      depth_originality: asNumber(con.depth_originality),
      evidence_support: asNumber(con.evidence_support),
      total: categoryTotal(con, ['relevance', 'depth_originality', 'evidence_support']),
    },
    engagement_style: {
      engagement: asNumber(eng.engagement),
      tone_voice: asNumber(eng.tone_voice),
      language_features: asNumber(eng.language_features),
      total: categoryTotal(eng, ['engagement', 'tone_voice', 'language_features']),
    },
  }
}

/** Rich improvements ({ suggestion, gain, rewrite }); falls back to flat strings. */
function normaliseImprovements(detail: unknown, flat: unknown): WritingImprovement[] {
  const rich = (Array.isArray(detail) ? detail : []).map((item): WritingImprovement | null => {
    if (item == null) return null
    if (typeof item === 'string') return { suggestion: item, estimated_score_gain: 0, rewrite: null }
    if (typeof item !== 'object') return null
    const o = item as Row
    return {
      suggestion: toText(o.suggestion),
      estimated_score_gain: asNumber(o.estimated_score_gain),
      rewrite: o.rewrite ? toText(o.rewrite) : null,
    }
  })

  const filtered = rich.filter((x): x is WritingImprovement => x !== null && Boolean(x.suggestion))
  if (filtered.length > 0) return filtered
  return asStringArray(flat).map((s) => ({ suggestion: s, estimated_score_gain: 0, rewrite: null }))
}

/** Per the rubric band descriptors (90 / 80 / 70 / 60 boundaries). */
export function scoreBand(score: number): WritingScoreBand {
  if (score >= 90) return 'Excellent'
  if (score >= 80) return 'Good'
  if (score >= 70) return 'Satisfactory'
  if (score >= 60) return 'Needs Improvement'
  return 'Unsatisfactory'
}

/** Normalise each category total into a percentage for trend charts. */
export function categoryPercents(cats: WritingCategoryScores | null) {
  const pct = (total: number, max: number) => (cats && max > 0 ? Math.round((total / max) * 100) : null)
  return {
    language_mechanics: pct(cats?.language_mechanics.total ?? NaN, 20),
    vocabulary: pct(cats?.vocabulary.total ?? NaN, 15),
    cohesion_structure: pct(cats?.cohesion_structure.total ?? NaN, 20),
    content_ideas: pct(cats?.content_ideas.total ?? NaN, 25),
    engagement_style: pct(cats?.engagement_style.total ?? NaN, 20),
  }
}

export function toEvaluationDetail(row: Row | null | undefined): WritingEvaluationDetail | null {
  if (!row) return null
  const raw = (row.raw_response && typeof row.raw_response === 'object' ? row.raw_response : {}) as Row

  const categoryScores = normaliseCategoryScores(row.category_scores ?? raw.category_scores)
  const techniques = asStringArray(row.techniques_used ?? raw.techniques_used)
  const practiceExercise = toText(row.practice_exercise ?? raw.practice_exercise) || null

  const wordCount =
    typeof row.word_count === 'number'
      ? row.word_count
      : typeof row.student_word_count === 'number'
        ? row.student_word_count
        : null

  return {
    score_out_of100: Math.max(0, Math.min(100, asNumber(row.score_out_of100))),
    text_type: normaliseTextType(row.text_type ?? raw.text_type),
    category_scores: categoryScores,
    techniques_used: techniques,
    strengths: asStringArray(row.strengths),
    improvements: normaliseImprovements(row.improvements_detail, row.improvements),
    improved_text: toText(row.improved_text) || null,
    practice_exercise: practiceExercise,
    rubric_version: toText(row.rubric_version ?? raw.rubric_version) || null,
    model: toText(row.model ?? raw.model) || null,
    word_count: wordCount,
    created_at: toText(row.created_at ?? row.graded_at),
  }
}

/** Weakest category by percentage, for the parent action summary. */
function weakestCategory(cats: WritingCategoryScores | null): { label: string; focus: string } | null {
  if (!cats) return null
  const rows = [
    { label: 'Language Mechanics', total: cats.language_mechanics.total, max: 20, focus: 'grammar, spelling and punctuation' },
    { label: 'Vocabulary', total: cats.vocabulary.total, max: 15, focus: 'word choice and variety' },
    { label: 'Cohesion & Structure', total: cats.cohesion_structure.total, max: 20, focus: 'paragraph flow and structure' },
    { label: 'Content & Ideas', total: cats.content_ideas.total, max: 25, focus: 'developing ideas and supporting detail' },
    { label: 'Engagement & Style', total: cats.engagement_style.total, max: 20, focus: 'language techniques and voice' },
  ]
  const sorted = [...rows].sort((a, b) => a.total / a.max - b.total / b.max)
  return sorted[0]
}

const ACTION_PREFIX = 'This week, practise'

/**
 * Three plain-English actions for the parent "Practise this week" card.
 * Derived from the single weakest category plus the two strongest improvements
 * (highest estimated score gain), so the advice is specific, not generic.
 */
export function buildParentActions(detail: WritingEvaluationDetail | null): string[] {
  if (!detail) return []
  const actions: string[] = []

  const weakest = weakestCategory(detail.category_scores)
  if (weakest) {
    actions.push(`${ACTION_PREFIX} ${weakest.label.toLowerCase()} — focus on ${weakest.focus}.`)
  }

  const gains = [...detail.improvements]
    .filter((i) => i.estimated_score_gain > 0 && i.suggestion)
    .sort((a, b) => b.estimated_score_gain - a.estimated_score_gain)
    .slice(0, 2)

  for (const g of gains) {
    const suggestion = g.suggestion.charAt(0).toLowerCase() + g.suggestion.slice(1)
    actions.push(`${ACTION_PREFIX} ${suggestion.replace(/\.$/, '')}.`)
  }

  return actions.slice(0, 3)
}