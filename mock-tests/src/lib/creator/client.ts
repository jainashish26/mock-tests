import type {
  CreatorStats,
  DuplicateQuestionResponse,
  DuplicateTestResponse,
  ListParams,
  ListResponse,
  QuestionDetail,
  QuestionInput,
  QuestionListParams,
  QuestionRow,
  TestDetail,
  TestInput,
  TestRow,
  UploadQuestionsResult,
  WritingPromptInput,
  WritingPromptListParams,
  WritingPromptRow,
} from './types'

/**
 * Client-side wrapper around the `/api/creator/*` routes.
 *
 * Every route answers with either a JSON body or `{ error }` plus a meaningful
 * HTTP status, so this module turns non-2xx responses into an
 * `ApiClientError` whose `message` is already safe to show a creator in a toast.
 * Nothing here touches Supabase directly: all authorisation stays server-side.
 */

export class ApiClientError extends Error {
  status: number
  details?: unknown

  constructor(status: number, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
    if (details !== undefined) this.details = details
  }
}

/**
 * Builds a query string, skipping empty/null/undefined values so the route's own
 * defaults apply. Typed param interfaces have no index signature, hence `object`.
 */
export function buildQuery(params: object = {}): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (value === null || value === undefined || value === '') continue
    search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}

interface FetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  signal?: AbortSignal
}

async function request<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { body, headers, ...init } = options

  // `FormData` (CSV upload) must reach the browser's own multipart encoder, so it
  // is passed through untouched and without a Content-Type header.
  const isForm = body instanceof FormData

  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    })
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err
    throw new ApiClientError(0, 'We could not reach the server. Check your connection and try again.')
  }

  // DELETE and some POSTs may legitimately return an empty body.
  const text = await response.text()
  let payload: Record<string, unknown> = {}
  if (text) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>
    } catch {
      // A non-JSON body means we were redirected to a login/error page.
      payload = {}
    }
  }

  if (!response.ok) {
    const message =
      typeof payload.error === 'string' && payload.error
        ? payload.error
        : response.status === 401
          ? 'Your session has expired. Please sign in again.'
          : response.status === 403
            ? 'Your account does not have content-creator access.'
            : `Request failed (${response.status}).`
    throw new ApiClientError(response.status, message, payload.details)
  }

  return payload as T
}

export const creatorApi = {
  stats: () => request<CreatorStats>('/api/creator/stats'),

  listTests: (params: ListParams = {}, signal?: AbortSignal) =>
    request<ListResponse<TestRow>>(`/api/creator/tests${buildQuery(params)}`, { signal }),

  getTest: (id: string) => request<TestDetail>(`/api/creator/tests/${id}`),

  createTest: (payload: TestInput) =>
    request<{ id: string; test: TestRow }>('/api/creator/tests', { method: 'POST', body: payload }),

  updateTest: (id: string, payload: TestInput) =>
    request<{ test: TestRow }>(`/api/creator/tests/${id}`, { method: 'PUT', body: payload }),

  deleteTest: (id: string) =>
    request<{ success: true; id: string; title: string }>(`/api/creator/tests/${id}`, {
      method: 'DELETE',
    }),

  duplicateTest: (id: string) =>
    request<DuplicateTestResponse>(`/api/creator/tests/${id}/duplicate`, { method: 'POST' }),

  listQuestions: (params: QuestionListParams = {}, signal?: AbortSignal) =>
    request<ListResponse<QuestionRow>>(`/api/creator/questions${buildQuery(params)}`, { signal }),

  getQuestion: (id: string) => request<QuestionDetail>(`/api/creator/questions/${id}`),

  createQuestion: (payload: QuestionInput) =>
    request<{ id: string; question: QuestionRow }>('/api/creator/questions', {
      method: 'POST',
      body: payload,
    }),

  updateQuestion: (id: string, payload: QuestionInput) =>
    request<{ question: QuestionRow }>(`/api/creator/questions/${id}`, {
      method: 'PUT',
      body: payload,
    }),

  deleteQuestion: (id: string) =>
    request<{ success: true; id: string; detached_from: number }>(`/api/creator/questions/${id}`, {
      method: 'DELETE',
    }),

  duplicateQuestion: (id: string) =>
    request<DuplicateQuestionResponse>(`/api/creator/questions/${id}/duplicate`, { method: 'POST' }),

  /* Writing prompts — the AI Practice Lab bank (Quiz Master / admin managed). */
  listWritingPrompts: (params: WritingPromptListParams = {}, signal?: AbortSignal) =>
    request<ListResponse<WritingPromptRow>>(`/api/creator/writing-prompts${buildQuery(params)}`, { signal }),

  createWritingPrompt: (payload: WritingPromptInput) =>
    request<{ id: string; prompt: WritingPromptRow }>('/api/creator/writing-prompts', {
      method: 'POST',
      body: payload,
    }),

  updateWritingPrompt: (id: string, payload: WritingPromptInput) =>
    request<{ prompt: WritingPromptRow }>(`/api/creator/writing-prompts/${id}`, {
      method: 'PUT',
      body: payload,
    }),

  deleteWritingPrompt: (id: string) =>
    request<{ success: true; id: string }>(`/api/creator/writing-prompts/${id}`, {
      method: 'DELETE',
    }),

  /** Bulk CSV import; see `POST /api/creator/upload-questions`. */
  uploadQuestions: (file: File, signal?: AbortSignal) => {
    const form = new FormData()
    form.append('file', file)
    return request<UploadQuestionsResult>('/api/creator/upload-questions', {
      method: 'POST',
      body: form,
      signal,
    })
  },
}

/** Reads the `error` message out of anything thrown by `creatorApi`. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof ApiClientError) return err.message
  if (err instanceof Error && err.message) return err.message
  return fallback
}
