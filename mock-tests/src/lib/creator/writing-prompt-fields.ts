import { ApiError, enumParam, intOr } from './api'
import { CONTENT_STATUSES } from './content-meta'

/**
 * Normalises a writing-prompt payload before it reaches PostgREST, mirroring
 * `questionPayload` for the questions CMS. Shared by the create (POST) and
 * update (PUT) routes so both validate identically.
 */

export const WRITING_PROMPT_TYPES = ['narrative', 'persuasive'] as const
export type WritingPromptType = (typeof WRITING_PROMPT_TYPES)[number]

export function writingPromptPayload(
  body: Record<string, unknown>,
  opts: { partial?: boolean } = {}
): Record<string, unknown> {
  const partial = opts.partial ?? false
  const patch: Record<string, unknown> = {}
  const has = (key: string) => !partial || body[key] !== undefined

  if (has('year_level')) {
    const year = intOr(body.year_level, null, 2, 9, 'Year level')
    if (year === null) throw new ApiError(400, 'Year level is required (2-9).')
    patch.year_level = year
  }

  if (has('type')) {
    const type = enumParam(body.type == null ? '' : String(body.type), WRITING_PROMPT_TYPES)
    if (!type) throw new ApiError(400, 'Type must be narrative or persuasive.')
    patch.type = type
  }

  if (has('territory')) {
    const territory = typeof body.territory === 'string' ? body.territory.trim() : ''
    if (!territory) throw new ApiError(400, 'Territory is required (e.g. Courage, Fairness).')
    patch.territory = territory
  }

  if (has('text')) {
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    if (!text) throw new ApiError(400, 'The prompt text is required.')
    patch.text = text
  }

  if (has('status')) {
    patch.status = enumParam(body.status == null ? 'DRAFT' : String(body.status), CONTENT_STATUSES) ?? 'DRAFT'
  }

  return patch
}