import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Exam readiness engine (funnel step 4).
 *
 * WHAT THIS IS FOR
 *   The readiness report is the single highest-leverage asset in the funnel.
 *   It is the moment the platform stops being "a test website" and becomes
 *   "an expert who has looked at my child". Behaviourally it does three things
 *   at once:
 *     1. Reciprocity   - a genuinely useful artefact given before any ask
 *     2. Loss aversion - a named topic gap is a loss the parent now wants to
 *        avoid, which is a far stronger motivator than a promised gain
 *     3. Authority     - a banded score invites comparison against a standard
 *
 * WHAT IS FREE VS LOCKED (the step-6 mechanic)
 *   Free, always: the headline readiness score, the band per exam, and the top
 *   topic gaps. Withholding these would break the reciprocity the offer depends
 *   on - a parent who feels the free report was stingy does not buy.
 *   Locked: time-per-question diagnostics, per-question review, longitudinal
 *   trend and the adaptive study plan. These are the "deeper analytics" named
 *   in the spec, and they are what the paywall sells.
 *
 * DATA SOURCES
 *   attempts.score_out_of100 + attempts.section_scores (written by
 *   `scoreAttempt`), joined to responses/questions for the tag-level rollup.
 *   `questions.tags` is the jsonb blob documented in 04-mock-tests-db-schema.md:
 *   { year, subject, topic, skill, difficulty, reasoning_type, exam_type }.
 */

/** Exams the report can score a child against. */
export type ReadinessExam = 'NAPLAN' | 'SCHOLARSHIP' | 'SELECTIVE' | 'OLYMPIAD'

export const READINESS_EXAMS: ReadinessExam[] = [
  'NAPLAN',
  'SCHOLARSHIP',
  'SELECTIVE',
  'OLYMPIAD',
]

/**
 * Maps the platform's `exam_type` enum onto a readiness exam.
 *
 * BENCHMARK is the diagnostic itself, so it feeds every exam rather than being
 * an exam in its own right - which is why it is absent from this map and
 * handled separately by `attemptWeight`.
 *
 * BUG FIXED: this map previously listed `NAPLAN_STYLE` and `OLYMPIAD`, neither of
 * which exists in the live `public.exam_type` enum. Migration 20260328045141
 * ("update_exam_types") expanded the enum to 17 values and split both of those
 * into per-domain members, but this map was never updated. Only `SELECTIVE` still
 * matched, so every NAPLAN-style and Olympiad attempt fell through to
 * `attemptWeight`'s cross-exam fallback (0.15 for Olympiad, 0.35 otherwise)
 * instead of being weighted as direct evidence. The readiness report - the single
 * highest-leverage artefact in the funnel - was therefore systematically
 * under-weighting exactly the tests it exists to interpret.
 *
 * The 17 live values, and how each is treated:
 *   BENCHMARK                          -> absent on purpose (diagnostic, 0.6)
 *   NAPLAN_STYLE_READING               -> NAPLAN
 *   NAPLAN_STYLE_NUMERACY              -> NAPLAN
 *   NAPLAN_STYLE_LANGUAGE_CONVENTION   -> NAPLAN
 *   MATHS_OLYMPIAD                     -> OLYMPIAD
 *   ENGLISH_OLYMPIAD                   -> OLYMPIAD
 *   SELECTIVE                          -> SELECTIVE
 *   GRAMMAR, SPELLING, VOCABULARY, VERBAL_REASONING, NUMERICAL_REASONING,
 *   MENTAL_MATHS, GEOMETRY, WORD_PROBLEMS, PROBLEM_SOLVING, CRITICAL_THINKING
 *                                      -> deliberately UNMAPPED (see below)
 *
 * The last group are skill categories rather than exam families, and they are
 * stored in the same enum. Mapping them onto a readiness exam would assert an
 * assessment relationship that nobody has decided - e.g. claiming that a GEOMETRY
 * practice item is evidence of Selective readiness. That is a product decision,
 * not something to infer here, so they fall through to the existing cross-exam
 * weight and are logged for review. Logged as assumption A-21 in
 * 14-bi-reporting-assurance-roadmap.md.
 *
 * Keep the bare `NAPLAN_STYLE` / `OLYMPIAD` keys: they cost nothing, and if the
 * enum is ever collapsed back the mapping still resolves.
 */
const EXAM_TYPE_TO_READINESS: Record<string, ReadinessExam> = {
  // Legacy spellings, retained defensively. Not present in the live enum.
  NAPLAN_STYLE: 'NAPLAN',
  OLYMPIAD: 'OLYMPIAD',
  SELECTIVE: 'SELECTIVE',

  // Live NAPLAN-style members, split by domain.
  NAPLAN_STYLE_READING: 'NAPLAN',
  NAPLAN_STYLE_NUMERACY: 'NAPLAN',
  NAPLAN_STYLE_LANGUAGE_CONVENTION: 'NAPLAN',

  // Live Olympiad members, split by subject.
  MATHS_OLYMPIAD: 'OLYMPIAD',
  ENGLISH_OLYMPIAD: 'OLYMPIAD',
}

/**
 * `exam_type` values that are skill categories rather than exam families.
 *
 * Exported so a test can assert that every enum member is either mapped to a
 * readiness exam, is BENCHMARK, or is listed here. Without that assertion the
 * enum can gain an 18th value and silently fall through to the weakest weight -
 * which is precisely how the bug above survived.
 */
export const SKILL_EXAM_TYPES: readonly string[] = [
  'GRAMMAR',
  'SPELLING',
  'VOCABULARY',
  'VERBAL_REASONING',
  'NUMERICAL_REASONING',
  'MENTAL_MATHS',
  'GEOMETRY',
  'WORD_PROBLEMS',
  'PROBLEM_SOLVING',
  'CRITICAL_THINKING',
] as const

/**
 * The reviewed mapping from migration 113, as the engine consumes it.
 *
 * WHY THIS IS READ AT ALL, WHEN NOTHING IS APPLIED YET
 *   A configuration table that nothing queries is the defect this project has now
 *   found four times - `sla_basis`, `checkout_abandon_minutes`,
 *   `resolution_sla_hours`, `min_enquiries_for_rate` all existed while changing
 *   nothing. So the mapping is loaded and consulted on every report. What is
 *   gated is not the reading but the *effect*: a row only moves a weight once a
 *   human sets `applied_to_readiness`, which is the difference between a proposal
 *   sitting in a table and a proposal quietly scoring children.
 *
 * Fail-closed by construction. `loadSkillExamMapping` returns an empty mapping on
 * any error, so a database hiccup produces the same scores as before 113 existed
 * rather than a report where half the skill evidence vanished.
 */
export interface SkillExamRow {
  skill: string
  readiness_exam: string
  rationale: string
  is_validated: boolean
  applied_to_readiness: boolean
}

export interface SkillExamMapping {
  /** skill -> exams, restricted to rows a human has applied. */
  applied: Map<string, Set<ReadinessExam>>
  /** Every row, so a surface can show what is proposed and what is live. */
  rows: SkillExamRow[]
}

export const EMPTY_SKILL_MAPPING: SkillExamMapping = {
  applied: new Map<string, Set<ReadinessExam>>(),
  rows: [],
}

const READINESS_EXAM_SET = new Set<string>(READINESS_EXAMS)

/**
 * Fold raw rows into the lookup the engine uses.
 *
 * Separated from the fetch so the filtering rule - applied only, and unknown exam
 * names dropped - is testable without a database. An unapplied row is ignored
 * here rather than checked at every call site, because "forgot to check the gate"
 * is the only way this could leak into a score by accident.
 */
export function skillMappingFromRows(rows: SkillExamRow[]): SkillExamMapping {
  const applied = new Map<string, Set<ReadinessExam>>()
  for (const r of rows) {
    if (!r.applied_to_readiness) continue
    if (!READINESS_EXAM_SET.has(r.readiness_exam)) continue
    const exam = r.readiness_exam as ReadinessExam
    const existing = applied.get(r.skill)
    if (existing) existing.add(exam)
    else applied.set(r.skill, new Set([exam]))
  }
  return { applied, rows }
}

export async function loadSkillExamMapping(
  supabase: SupabaseClient
): Promise<SkillExamMapping> {
  try {
    const { data, error } = await supabase.rpc('readiness_skill_exam_map')
    if (error || !Array.isArray(data)) return EMPTY_SKILL_MAPPING
    return skillMappingFromRows(data as SkillExamRow[])
  } catch {
    return EMPTY_SKILL_MAPPING
  }
}

/**
 * Selective entry is only meaningful for children actually approaching it.
 *
 * The spec calls out Year 7 and Year 8 specifically. Showing a "Selective
 * readiness" band to a Year 3 parent would be noise at best and misleading at
 * worst, and a report that says something irrelevant loses the authority that
 * makes the rest of it persuasive.
 */
const SELECTIVE_MIN_YEAR = 7

/** Scholarships and Olympiads are senior-primary onwards. */
const SCHOLARSHIP_MIN_YEAR = 5

export function isEligibleForExam(exam: ReadinessExam, yearLevel: number): boolean {
  switch (exam) {
    case 'NAPLAN':
      return yearLevel >= 3 && yearLevel <= 9
    case 'SELECTIVE':
      return yearLevel >= SELECTIVE_MIN_YEAR
    case 'SCHOLARSHIP':
    case 'OLYMPIAD':
      return yearLevel >= SCHOLARSHIP_MIN_YEAR
    default:
      return false
  }
}

/** Parent-facing label. Never expose the raw enum spelling. */
export const EXAM_LABEL: Record<ReadinessExam, string> = {
  NAPLAN: 'NAPLAN',
  SCHOLARSHIP: 'Scholarship (EduTest / ACER / AAS)',
  SELECTIVE: 'Selective School Entry',
  OLYMPIAD: 'Maths Olympiad (AMC / AIMO)',
}

/**
 * NAPLAN's proficiency vocabulary, extended with the two directional bands
 * parents actually ask about. Using ACARA's own wording matters: a report that
 * invents a scale cannot be compared against the real result the family
 * receives in August, and un-comparable is un-convincing.
 */
export type ReadinessBand =
  | 'Needs support'
  | 'Developing'
  | 'Exceeding'
  | 'Strongly exceeding'

export function bandForScore(score: number): ReadinessBand {
  if (score < 50) return 'Needs support'
  if (score < 75) return 'Developing'
  if (score < 90) return 'Exceeding'
  return 'Strongly exceeding'
}

/**
 * How much to trust a band.
 *
 * A score computed from four questions is not a measurement, it is an anecdote.
 * Publishing a confident band off thin data is the fastest way to lose a
 * parent's trust - and it is the kind of claim that invites an Australian
 * Consumer Law complaint about misleading conduct. Label thin results as
 * indicative and say what would firm them up, which also gives the parent a
 * concrete reason to sit another test.
 */
export type Confidence = 'low' | 'medium' | 'high'

export function confidenceForSample(questionsAnswered: number): Confidence {
  if (questionsAnswered < 20) return 'low'
  if (questionsAnswered < 60) return 'medium'
  return 'high'
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  low: 'Indicative - based on a small sample',
  medium: 'Reasonably reliable',
  high: 'High confidence',
}

/** Severity of a topic gap, derived from accuracy. */
export type GapSeverity = 'critical' | 'watch' | 'secure'

export function severityForAccuracy(accuracy: number): GapSeverity {
  if (accuracy < 50) return 'critical'
  if (accuracy < 75) return 'watch'
  return 'secure'
}

/** A single topic's rollup, used for both gaps and strengths. */
export interface TopicRollup {
  topic: string
  subject: string
  attempted: number
  correct: number
  /** 0-100, rounded to a whole number for display. */
  accuracy: number
  severity: GapSeverity
  /** Average difficulty actually served, 1-4. A rising figure means real progress. */
  avgDifficulty: number
}

/** One exam's readiness verdict. */
export interface ExamReadiness {
  exam: ReadinessExam
  label: string
  score: number
  band: ReadinessBand
  confidence: Confidence
  questionsAnswered: number
  /** One sentence the parent can act on. */
  summary: string
  /** False when the child is too young for this exam to mean anything yet. */
  eligible: boolean
  /** Why it is ineligible, when it is not. */
  eligibilityNote?: string
}

/** What the free report withholds, surfaced as the paywall. */
export interface LockedInsights {
  timePerQuestion: boolean
  questionLevelReview: boolean
  progressTrend: boolean
  adaptivePlan: boolean
  aiWritingMarks: boolean
  cohortPercentile: boolean
}

export interface ReadinessReport {
  studentId: string
  yearLevel: number
  generatedAt: string
  /** 0-100 across everything the child has sat. */
  overallScore: number
  overallBand: ReadinessBand
  attemptsUsed: number
  questionsAnswered: number
  exams: ExamReadiness[]
  /** Worst topics first - the gap list is the emotional core of the report. */
  gaps: TopicRollup[]
  /** Best topics first - a report that is only criticism gets deleted. */
  strengths: TopicRollup[]
  locked: LockedInsights
  /** True once the parent has paid or holds an active subscription. */
  unlocked: boolean
}

/** Raw shapes as PostgREST returns them. */
type Row = Record<string, unknown>

/** Safely read a jsonb tags blob that may be an object, a string or null. */
function parseTags(raw: unknown): Row {
  if (!raw) return {}
  if (typeof raw === 'object') return raw as Row
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? (parsed as Row) : {}
    } catch {
      return {}
    }
  }
  return {}
}

/** Tags store topic/skill inconsistently; normalise so grouping is stable. */
function normalizeLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (!trimmed) return fallback
  // "fraction_operations" -> "Fraction operations"
  const words = trimmed.replace(/[_-]+/g, ' ').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Clamp to a 0-100 integer score. */
function clampScore(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

/**
 * How much one attempt should count towards a given exam's readiness score.
 *
 * A purpose-built Selective paper is strong evidence of Selective readiness. A
 * BENCHMARK diagnostic is weaker but not worthless evidence, because it is
 * deliberately broad. Weighting rather than filtering is what lets a family
 * who has only sat the free diagnostic still get a real (if indicative) number
 * instead of an empty report - and an empty report converts nobody.
 */
function attemptWeight(
  examType: string | null,
  exam: ReadinessExam,
  skillMap?: SkillExamMapping
): number {
  if (!examType) return 0.4
  if (EXAM_TYPE_TO_READINESS[examType] === exam) return 1
  if (examType === 'BENCHMARK') return 0.6
  // An applied skill mapping. Deliberately 0.8 rather than 1: a GEOMETRY item
  // being treated as evidence of Selective readiness is a reviewed *inference*,
  // and inference is not the same strength of evidence as a paper built for that
  // exam. Scoring it as 1 would let an editorial row outrank a purpose-built test.
  if (skillMap && skillMap.applied.get(examType)?.has(exam)) return 0.8
  // A NAPLAN paper still says something about scholarship readiness, less about
  // Olympiad. Cross-exam transfer decays with how different the skill mix is.
  return exam === 'OLYMPIAD' ? 0.15 : 0.35
}

/** Mutable accumulator used while folding responses into topic rollups. */
interface TopicAccumulator {
  attempted: number
  correct: number
  difficultySum: number
  difficultyCount: number
  subject: string
}

/** Build a one-line, actionable summary for an exam band. */
function summarise(exam: ReadinessExam, score: number, topGap: string | null): string {
  const label = EXAM_LABEL[exam].split(' (')[0]
  if (score >= 90) {
    return `Performing strongly against the ${label} standard. Focus now on speed and accuracy under timed conditions rather than new content.`
  }
  if (score >= 75) {
    const target = topGap ? ` Closing the gap in ${topGap} is the fastest route to the top band.` : ''
    return `Above the expected ${label} standard, with room to reach the top band.${target}`
  }
  if (score >= 50) {
    const target = topGap ? ` Prioritise ${topGap}.` : ''
    return `At the expected ${label} standard but not yet ahead of it.${target} Consistent timed practice is what moves this band.`
  }
  const target = topGap ? ` Start with ${topGap}.` : ''
  return `Below the expected ${label} standard right now, which is exactly what practice is for.${target} Foundations first, then exam technique.`
}


/**
 * Build the readiness report for one child.
 *
 * Access control is the caller's job (RLS on `attempts`/`responses` plus
 * `requireRole(['PARENT'])` in the route), so this function only shapes data.
 * It is passed the already-authorised Supabase client rather than creating one,
 * matching `loadReportData`.
 *
 * Returns null when the child has no completed attempt: a report with no data
 * behind it is worse than no report, because a parent who receives "readiness
 * 0%" for a child who simply has not sat anything yet will not come back.
 */
export async function buildReadinessReport(
  supabase: SupabaseClient,
  studentId: string,
  options: { unlocked?: boolean } = {}
): Promise<ReadinessReport | null> {
  const { data: profile, error: profileError } = await supabase
    .from('student_profiles')
    .select('id, year_level')
    .eq('id', studentId)
    .maybeSingle()

  if (profileError || !profile) return null
  const yearLevel = Number((profile as Row).year_level) || 0

  // Only finished attempts count. An abandoned IN_PROGRESS attempt has a
  // partial denominator and would drag every accuracy figure down.
  const { data: attempts, error: attemptsError } = await supabase
    .from('attempts')
    .select('id, score_out_of100, section_scores, submitted_at, tests(exam_type, title)')
    .eq('student_id', studentId)
    .in('status', ['COMPLETE', 'SUBMITTED'])
    .order('submitted_at', { ascending: false })

  if (attemptsError) return null
  const completed = (attempts ?? []) as unknown as Row[]
  if (completed.length === 0) return null

  const attemptIds = completed.map((a) => String(a.id))

  // One query for every response across every attempt, with the question's tags
  // inlined. Fetching per attempt would be N+1 round trips on a serverless
  // function, where each one costs latency the parent is waiting through.
  const { data: responses, error: responsesError } = await supabase
    .from('responses')
    .select(
      'attempt_id, question_id, is_correct, time_spent_seconds, difficulty_served, questions(tags)'
    )
    .in('attempt_id', attemptIds)

  if (responsesError) return null
  const rows = (responses ?? []) as unknown as Row[]

  // Read once per report, never per attempt. Fails closed to an empty mapping, so
  // a database error here cannot change a child's score - it simply reproduces the
  // pre-113 weighting.
  const skillMapping = await loadSkillExamMapping(supabase)

  // ---- Topic rollup --------------------------------------------------------
  const topics = new Map<string, TopicAccumulator>()
  let totalAnswered = 0
  let totalCorrect = 0

  for (const row of rows) {
    const tags = parseTags((row.questions as Row | null)?.tags)
    const topic = normalizeLabel(tags.topic ?? tags.skill, 'General')
    const subject = normalizeLabel(tags.subject, 'General')
    const key = `${subject}::${topic}`

    const accumulator = topics.get(key) ?? {
      attempted: 0,
      correct: 0,
      difficultySum: 0,
      difficultyCount: 0,
      subject,
    }

    accumulator.attempted += 1
    if (row.is_correct === true) accumulator.correct += 1

    const difficulty = Number(row.difficulty_served)
    if (Number.isFinite(difficulty) && difficulty > 0) {
      accumulator.difficultySum += difficulty
      accumulator.difficultyCount += 1
    }

    topics.set(key, accumulator)
    totalAnswered += 1
    if (row.is_correct === true) totalCorrect += 1
  }

  const rollups: TopicRollup[] = [...topics.entries()]
    .map(([key, acc]) => {
      const [subject, topic] = key.split('::')
      const accuracy = acc.attempted > 0 ? Math.round((acc.correct / acc.attempted) * 100) : 0
      return {
        topic,
        subject,
        attempted: acc.attempted,
        correct: acc.correct,
        accuracy,
        severity: severityForAccuracy(accuracy),
        avgDifficulty:
          acc.difficultyCount > 0
            ? Math.round((acc.difficultySum / acc.difficultyCount) * 10) / 10
            : 0,
      }
    })
    // A topic seen once is not a gap, it is a coincidence. Require two attempts
    // before the report is willing to name it as a weakness.
    .filter((r) => r.attempted >= 2)

  // Worst first for the gap list; cap it, because a report listing eighteen
  // gaps produces paralysis rather than action. Three to five is the range in
  // which a parent can actually hold a plan in their head.
  const gaps = [...rollups]
    .filter((r) => r.severity !== 'secure')
    .sort((a, b) => a.accuracy - b.accuracy || b.attempted - a.attempted)
    .slice(0, 5)

  const strengths = [...rollups]
    .filter((r) => r.severity === 'secure')
    .sort((a, b) => b.accuracy - a.accuracy || b.attempted - a.attempted)
    .slice(0, 3)

  const topGap = gaps.length > 0 ? gaps[0].topic : null
  const overallScore = totalAnswered > 0 ? clampScore((totalCorrect / totalAnswered) * 100) : 0

  return {
    studentId,
    yearLevel,
    generatedAt: new Date().toISOString(),
    overallScore,
    overallBand: bandForScore(overallScore),
    attemptsUsed: completed.length,
    questionsAnswered: totalAnswered,
    exams: buildExamReadiness(completed, rows, yearLevel, topGap, skillMapping),
    gaps,
    strengths,
    // The step-6 paywall surface. `unlocked` flips once the parent has an
    // entitlement or an active subscription; until then these are the things
    // the offer actually buys.
    locked: {
      timePerQuestion: !options.unlocked,
      questionLevelReview: !options.unlocked,
      progressTrend: !options.unlocked,
      adaptivePlan: !options.unlocked,
      aiWritingMarks: !options.unlocked,
      cohortPercentile: !options.unlocked,
    },
    unlocked: Boolean(options.unlocked),
  }
}


/**
 * Score the child against every readiness exam.
 *
 * Split out of `buildReadinessReport` purely for readability - the weighting
 * loop is dense enough that burying it inside a 150-line function would make it
 * unreviewable, and this is the arithmetic a parent's purchasing decision rests
 * on.
 */
function buildExamReadiness(
  completed: Row[],
  rows: Row[],
  yearLevel: number,
  topGap: string | null,
  skillMapping: SkillExamMapping
): ExamReadiness[] {
  return READINESS_EXAMS.map((exam) => {
    const eligible = isEligibleForExam(exam, yearLevel)

    let weightedSum = 0
    let weightTotal = 0
    let questionsAnswered = 0

    for (const attempt of completed) {
      const nested = attempt.tests as Row | null
      // `exam_type` arrives as unknown from the jsonb-typed row shape, so coerce
      // rather than cast: a non-string value must degrade to null (no weighting)
      // rather than silently becoming "[object Object]" and matching nothing.
      const examType =
        typeof nested?.exam_type === 'string' ? (nested.exam_type as string) : null
      const weight = attemptWeight(examType, exam, skillMapping)
      if (weight <= 0) continue

      weightedSum += clampScore(attempt.score_out_of100) * weight
      weightTotal += weight

      // Attribute this attempt's response count to the exams it informs, scaled
      // by the same weight so `confidence` reflects evidence quality rather
      // than raw volume.
      const attemptRows = rows.filter((r) => String(r.attempt_id) === String(attempt.id))
      questionsAnswered += Math.round(attemptRows.length * weight)
    }

    const score = weightTotal > 0 ? clampScore(weightedSum / weightTotal) : 0

    return {
      exam,
      label: EXAM_LABEL[exam],
      score,
      band: bandForScore(score),
      confidence: confidenceForSample(questionsAnswered),
      questionsAnswered,
      summary: eligible
        ? summarise(exam, score, topGap)
        : exam === 'SELECTIVE'
          ? `Selective entry becomes relevant from Year ${SELECTIVE_MIN_YEAR}. This child is in Year ${yearLevel}, so there is no selective band to report yet - the diagnostic still builds the foundations that will matter later.`
          : `Not yet applicable in Year ${yearLevel}.`,
      eligible,
      ...(eligible
        ? {}
        : {
            eligibilityNote:
              'Available from Year ' +
              (exam === 'SELECTIVE' ? SELECTIVE_MIN_YEAR : SCHOLARSHIP_MIN_YEAR),
          }),
    }
  })
}

/**
 * Flatten a report into the tokens an email template needs.
 *
 * Kept separate from the builder so the same report object can drive the web
 * page, the email and (later) a PDF without the three disagreeing about what a
 * band is called - which is exactly how a report ends up saying "Developing"
 * in one place and "Band 3" in another.
 */
export function readinessEmailTokens(report: ReadinessReport, childLabel: string) {
  const primary =
    report.exams.find((e) => e.eligible && e.exam === 'NAPLAN') ??
    report.exams.find((e) => e.eligible) ??
    report.exams[0]

  return {
    childLabel,
    yearLevel: report.yearLevel,
    overallScore: report.overallScore,
    overallBand: report.overallBand,
    primaryExam: primary?.label ?? EXAM_LABEL.NAPLAN,
    primaryScore: primary?.score ?? 0,
    primaryBand: primary?.band ?? 'Developing',
    confidence: CONFIDENCE_LABEL[primary?.confidence ?? 'low'],
    summary: primary?.summary ?? '',
    gapLines: report.gaps.map(
      (g) => `${g.topic} - ${g.accuracy}% correct across ${g.attempted} questions`
    ),
    strengthLines: report.strengths.map((s) => `${s.topic} - ${s.accuracy}% correct`),
    attemptsUsed: report.attemptsUsed,
    questionsAnswered: report.questionsAnswered,
  }
}

