import type { YearBand } from './types'

/**
 * Year-scaled writing expectations. Same prompts across all years (the rubric
 * strictness is calibrated by year in prompt.ts); only the word/time scaffolding
 * moves with the band. A soft warning in the runner and practice lab uses these
 * minimums - never a hard block, because a short but strong piece is still a
 * valid piece.
 */
export interface BandScaffold {
  minWords: number
  mins: number
}

const SCAFFOLD: Record<YearBand, BandScaffold> = {
  '2-4': { minWords: 150, mins: 20 },
  '5-6': { minWords: 250, mins: 30 },
  '7-8': { minWords: 400, mins: 40 },
}

/** Map a student year level onto a scaffolding band. Defaults to the middle band. */
export function bandForYear(yearLevel: number | null | undefined): YearBand {
  const n = yearLevel === null || yearLevel === undefined ? NaN : Number(yearLevel)
  const year = Number.isFinite(n) && n > 0 ? n : 5
  if (year <= 4) return '2-4'
  if (year <= 6) return '5-6'
  return '7-8'
}

export function scaffoldForBand(band: YearBand): BandScaffold {
  return SCAFFOLD[band]
}

export function scaffoldForYear(yearLevel: number | null | undefined): BandScaffold {
  return scaffoldForBand(bandForYear(yearLevel))
}

/** Word count of a piece, whitespace-normalised. */
export function countWords(text: string | null | undefined): number {
  if (!text) return 0
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}