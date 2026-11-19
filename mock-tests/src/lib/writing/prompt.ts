/**
 * The writing-evaluation prompt (rubric + output contract).
 *
 * SOURCE OF TRUTH
 *   `DeepSeek Writing Prompt.txt` at the repo root - the business-authored
 *   rubric: five weighted categories (Language Mechanics /20, Vocabulary /15,
 *   Cohesion & Structure /20, Content & Ideas /25, Engagement & Style /20),
 *   band descriptors, narrative/persuasive technique detection, strengths,
 *   improvements with estimated score gains and grammar rewrites, a polished
 *   rewrite of the whole text, and a targeted practice exercise.
 *
 * TWO DELIBERATE, DOCUMENTED ADAPTATIONS
 *   1. YEAR LEVEL IS PARAMETERISED. The source text addresses "a VCE student
 *      (Year 10-12)"; this platform serves Years 2-8. Grading a Year 4 essay
 *      against senior-secondary expectations would produce uniformly crushing
 *      scores - a child-safety and refund problem (15-...md §1.2). The rubric,
 *      weights and strictness instruction are kept; only the year expectation
 *      follows the actual student.
 *   2. OUTPUT IS STRICT JSON. The source specifies a human-readable report;
 *      the pipeline needs machine-readable marks. Every element of the source
 *      output format maps onto a JSON key below - nothing was dropped, the
 *      prose sections became arrays/strings.
 *
 * VERSIONING
 *   WRITING_RUBRIC_PROMPT_VERSION (env, default v1.0) is stamped into every
 *   evaluation's raw_response so a mark can always be traced to the rubric
 *   that produced it (07-implementation-plan.md Q5). When the rubric changes,
 *   bump the version - do not edit silently.
 */

/** Rubric version stamped into every stored evaluation. */
export const WRITING_RUBRIC_VERSION =
  process.env.WRITING_RUBRIC_PROMPT_VERSION?.trim() || 'v1.1'

/**
 * The JSON contract the model must satisfy. Keys mirror the source rubric's
 * output format one-for-one; `category_scores` sub-keys mirror its point
 * splits so a category total can be cross-checked against its parts.
 */
export const WRITING_JSON_CONTRACT = `{
  "score_out_of100": <number 0-100, the sum of the five category totals>,
  "text_type": "narrative" | "persuasive" | "other",
  "category_scores": {
    "language_mechanics": { "grammar": <0-10>, "spelling": <0-5>, "punctuation": <0-5>, "total": <0-20> },
    "vocabulary": { "effective_word_choices": <0-10>, "varied_word_usage": <0-5>, "total": <0-15> },
    "cohesion_structure": { "cohesiveness": <0-10>, "structure": <0-10>, "total": <0-20> },
    "content_ideas": { "relevance": <0-10>, "depth_originality": <0-10>, "evidence_support": <0-5>, "total": <0-25> },
    "engagement_style": { "engagement": <0-5>, "tone_voice": <0-5>, "language_features": <0-10>, "total": <0-20> }
  },
  "techniques_used": [<names of narrative devices or persuasive techniques actually present>],
  "strengths": [<what the text does well>],
  "improvements": [
    { "suggestion": <specific, actionable>, "estimated_score_gain": <number>, "rewrite": <the fixed sentence(s), or null> }
  ],
  "improved_text": "<polished rewrite keeping the original idea>",
  "practice_exercise": "<section-wise tailored exercise targeting the student's actual errors>"
}`

/**
 * System prompt for one evaluation.
 *
 * @param yearLevel the writing student's year (2-8); anything unusable falls
 *   back to a mid-primary expectation rather than the source document's VCE
 *   default - an uncalibrated harshness on a young child is the failure mode
 *   this guard exists to prevent.
 */
export function writingSystemPrompt(yearLevel: number | null): string {
  const year = Number.isFinite(yearLevel) && (yearLevel as number) > 0 ? yearLevel : 5
  return `You are an experienced Australian English teacher evaluating a text (narrative or persuasive) written by a student in Year ${year} of an Australian school. Grade strictly against that year level - do not be lenient, but do not apply senior-secondary (VCE) expectations to a primary/early-secondary student.
Expect a length appropriate to Year ${year} (longer for higher years), but judge quality before quantity: do not penalise a short, strong piece merely for length, and note in "improvements" when the length limited what the writing could achieve.

EVALUATION RUBRIC (100 points total)

1. Language Mechanics (20): Grammar (10) - sentence structure, parts of speech, tenses, subject-verb agreement, phrasal verbs. Spelling (5). Punctuation (5) - capitals, commas, periods, apostrophes, quotation marks, sentence boundaries.
2. Vocabulary and Word Choice (15): Effective, precise word choices (10), including appropriate Australian English. Varied/advanced vocabulary used naturally, avoiding repetition (5).
3. Cohesion and Structure (20): Cohesiveness (10) - logical flow, transitions. Structure (10) - introduction/body/conclusion for persuasive; narrative arc with a developed complication for narrative; well-developed paragraphs.
4. Content and Ideas (25): Relevance to the prompt (10) - persuasive: all ideas support the argument; narrative: setting and object qualities integrated. Depth and originality (10). Evidence/support (5) - persuasive: facts, statistics, examples, reasoning; narrative: sensory detail, dialogue, vivid description.
5. Engagement and Style (20): Engagement (5). Tone and voice (5). Language features (10) - rule of three, emotive language, figurative language, rhetorical questions, clear stance, repetition, alliteration, hyperbole, idioms, modal verbs, metaphor, simile, irony.

SCORING BANDS
90-100 Excellent (mastery, few errors, highly engaging/original). 80-89 Good (competent, minor issues). 70-79 Satisfactory (meets basics, noticeable weaknesses). 60-69 Needs improvement (significant issues). Below 60 Unsatisfactory.

TECHNIQUE DETECTION
For narrative texts, identify which devices are used from: Freytag's Pyramid, Foreshadowing, Cliffhanger, Flashback/Flash Forward, Red Herring, Epiphany, First-Person Narrator, Backstory, Author Surrogate, Repetitive Designation, Self-Fulfilling Prophecy, Unreliable Narrator, Narrative Hook, Allegory, Hyperbole, Sensory Detail, Onomatopoeia, Parody, Oxymoron, Anthropomorphism/Personification, Pathetic Fallacy, Multiperspectivity, Metaphor, Plot Twist, Satire, direct address ("dear reader"), epistolary/diary form, story-within-a-story, stream of consciousness.
For persuasive texts, identify which are used from: Alliteration, Facts, Opinion, Rhetorical Questions, Repetition, Exaggeration/Hyperbole, Statistics/Evidence, Rule of Three (the A FOREST set); Emotive Language, Inclusive Language, Metaphor/Simile, Anecdotes, Colloquial Language, High/Low Modality; Ethos, Pathos, Logos, Call to Action, Addressing Counterarguments (rebuttal), Humour, Flattery.

OUTPUT FORMAT
Return ONLY a single JSON object - no prose, no code fences - exactly matching this contract:
${WRITING_JSON_CONTRACT}

Every "improvements" entry that fixes grammar MUST include the corrected sentence(s) in "rewrite". The "improved_text" must polish mechanics, vocabulary, cohesion, engagement, structure, content and style without deviating from the soul or idea of the student's text.`
}