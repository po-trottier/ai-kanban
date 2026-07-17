import { type FetchLike } from '../api/client.ts'

/**
 * Hand-written fetch fake (docs/dev/testing.md: fakes, never mocking
 * libraries). Routes are `"METHOD /api/v1/path"` → a JSON-serializable body,
 * a Response, or a handler. Unmatched requests fail the test loudly. This is
 * dependency injection through `ApiContext`, not network interception — the
 * real network path is Playwright's job.
 */

export type FakeRouteResult = unknown
type FakeRouteHandler = (init: RequestInit | undefined, url: string) => FakeRouteResult

interface RecordedCall {
  method: string
  url: string
  init: RequestInit | undefined
}

export interface FakeFetch {
  fetch: FetchLike
  calls: RecordedCall[]
  /** The most recent JSON request body sent to `method path`. */
  lastBody: (method: string, path: string) => unknown
}

export function createFakeFetch(routes: Record<string, FakeRouteResult>): FakeFetch {
  const calls: RecordedCall[] = []

  const fetchImpl: FetchLike = (input, init) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = input.split('?')[0] ?? input
    calls.push({ method, url: input, init })
    const handler = routes[`${method} ${path}`]
    if (handler === undefined) {
      return Promise.reject(new Error(`fake fetch: unmatched route ${method} ${input}`))
    }
    const result =
      typeof handler === 'function' ? (handler as FakeRouteHandler)(init, input) : handler
    if (result instanceof Response) return Promise.resolve(result)
    return Promise.resolve(jsonResponse(result))
  }

  return {
    fetch: fetchImpl,
    calls,
    lastBody: (method, path) => {
      const call = calls.findLast(
        (candidate) =>
          candidate.method === method.toUpperCase() &&
          (candidate.url.split('?')[0] ?? candidate.url) === path,
      )
      const body = call?.init?.body
      return typeof body === 'string' ? (JSON.parse(body) as unknown) : undefined
    },
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** An RFC 9457 problem+json response for error-path tests. */
export function problemResponse(status: number, problem: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ status, ...problem }), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  })
}
