import { type ZodType } from 'zod'
import { ApiError, problemDetailsSchema, type ProblemDetails } from './problem.ts'

/** Injectable fetch so tests supply a hand-written fake (docs/dev/testing.md — no mocks). */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface RequestOptions {
  body?: unknown
  /** Card version for `If-Match: "<version>"` optimistic locking (ADR-012). */
  ifMatch?: number
  query?: Record<string, string | number | boolean | undefined>
  /** Multipart payload (attachment upload); mutually exclusive with `body`. */
  formData?: FormData
}

export const API_BASE = '/api/v1'

/**
 * Typed REST client. Every response body is parsed with a Zod schema composed
 * from `@rivian-kanban/core` (single-schema rule); non-2xx responses become
 * `ApiError`s carrying the problem+json document.
 */
export class ApiClient {
  private readonly fetchFn: FetchLike

  constructor(fetchFn?: FetchLike) {
    this.fetchFn = fetchFn ?? ((input, init) => globalThis.fetch(input, init))
  }

  async get<T>(path: string, schema: ZodType<T>, options: RequestOptions = {}): Promise<T> {
    return this.parse(await this.send('GET', path, options), schema)
  }

  async post<T>(path: string, schema: ZodType<T>, options: RequestOptions = {}): Promise<T> {
    return this.parse(await this.send('POST', path, options), schema)
  }

  async patch<T>(path: string, schema: ZodType<T>, options: RequestOptions = {}): Promise<T> {
    return this.parse(await this.send('PATCH', path, options), schema)
  }

  async put<T>(path: string, schema: ZodType<T>, options: RequestOptions = {}): Promise<T> {
    return this.parse(await this.send('PUT', path, options), schema)
  }

  /** Fire-and-parse-nothing variants for routes whose body the app ignores. */
  async postVoid(path: string, options: RequestOptions = {}): Promise<void> {
    await this.send('POST', path, options)
  }

  async deleteVoid(path: string, options: RequestOptions = {}): Promise<void> {
    await this.send('DELETE', path, options)
  }

  private async send(method: string, path: string, options: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = {}
    const init: RequestInit = { method, headers, credentials: 'same-origin' }
    if (options.ifMatch !== undefined) headers['If-Match'] = `"${String(options.ifMatch)}"`
    if (options.formData !== undefined) {
      init.body = options.formData
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(options.body)
    }
    const response = await this.fetchFn(buildUrl(path, options.query), init)
    if (!response.ok) throw new ApiError(response.status, await readProblem(response))
    return response
  }

  private async parse<T>(response: Response, schema: ZodType<T>): Promise<T> {
    return schema.parse(await response.json())
  }
}

/** Joins base path, resource path, and defined query params. */
export function buildUrl(
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): string {
  const url = `${API_BASE}${path}`
  if (query === undefined) return url
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value))
  }
  const search = params.toString()
  return search === '' ? url : `${url}?${search}`
}

async function readProblem(response: Response): Promise<ProblemDetails> {
  try {
    const parsed = problemDetailsSchema.safeParse(await response.json())
    if (parsed.success) return parsed.data
  } catch {
    // Non-JSON error body (proxy error page, empty body) — fall through.
  }
  return { status: response.status }
}
