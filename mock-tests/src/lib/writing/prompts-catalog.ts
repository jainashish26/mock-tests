import type { WritingPromptMeta, YearBand } from './types'

/**
 * The writing prompt catalog - the single code-side source of truth for the
 * AI Practice Lab. These are the same 13 prompts seeded as WRITING questions in
 * migration 097/098; the practice lab serves them directly here (by slug) so it
 * does not depend on question-bank rows existing.
 */

const ALL_BANDS: YearBand[] = ['2-4', '5-6', '7-8']

const NARRATIVE_MIN_WORDS = { '2-4': 150, '5-6': 250, '7-8': 400 } as const
const NARRATIVE_MINS = { '2-4': 20, '5-6': 30, '7-8': 40 } as const
const PERSUASIVE_MIN_WORDS = { '2-4': 120, '5-6': 220, '7-8': 350 } as const
const PERSUASIVE_MINS = { '2-4': 20, '5-6': 30, '7-8': 40 } as const

function narrative(id: string, prompt: string): WritingPromptMeta {
  return { id, text_type: 'narrative', prompt, year_bands: ALL_BANDS, min_words: NARRATIVE_MIN_WORDS, suggested_mins: NARRATIVE_MINS }
}

function persuasive(id: string, prompt: string): WritingPromptMeta {
  return { id, text_type: 'persuasive', prompt, year_bands: ALL_BANDS, min_words: PERSUASIVE_MIN_WORDS, suggested_mins: PERSUASIVE_MINS }
}

export const WRITING_PROMPTS: WritingPromptMeta[] = [
  narrative(
    'nar-01',
    'A photograph shows a child sitting alone on the edge of a swimming pool, goggles pushed up on their forehead, everyone else already in the water. Write a narrative inspired by this image.'
  ),
  narrative('nar-02', 'Begin your narrative with this sentence: "On my first morning, nobody could say my name."'),
  narrative(
    'nar-03',
    'Your best friend hands you the answers to tomorrow\u2019s test. You need that mark. Write a narrative about what happens next.'
  ),
  narrative('nar-04', 'End your narrative with this sentence: "I looked back once, then I didn\u2019t."'),
  narrative(
    'nar-05',
    'In the pocket of a second-hand coat, you find a key and a folded note with an address on it. Write a narrative.'
  ),
  narrative('nar-06', '"It would have been easier to say nothing." Use this line anywhere in a narrative of your own.'),
  narrative(
    'nar-07',
    'You broke something that mattered to someone else, and nobody saw you do it. Write a narrative.'
  ),
  narrative('nar-08', 'For one hour every day, the whole world stops moving, except you. Write a narrative set in that hour.'),
  persuasive(
    'per-01',
    'Some schools want to replace marks and grades with written feedback only. Write a persuasive text for your school newsletter arguing whether grades should be kept.'
  ),
  persuasive('per-02', '"Children under fourteen should not own a smartphone." Do you agree? Write a persuasive text.'),
  persuasive(
    'per-03',
    'Your council plans to remove fifty street trees to widen a road and cut travel times. As a local student, write a speech to the council meeting.'
  ),
  persuasive('per-04', '"Treating everyone the same is not the same as treating everyone fairly." Write a persuasive text responding to this idea.'),
  persuasive(
    'per-05',
    'Competitive sport teaches children to win at any cost. Others say it builds character. Argue whether competitive sport should be compulsory in primary school.'
  ),
]

export function writingPromptById(id: string): WritingPromptMeta | undefined {
  return WRITING_PROMPTS.find((p) => p.id === id)
}

export function writingPromptsForBand(band: YearBand): WritingPromptMeta[] {
  return WRITING_PROMPTS.filter((p) => p.year_bands.includes(band))
}