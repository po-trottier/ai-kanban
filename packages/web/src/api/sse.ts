import { sseHintSchema, type SseHint } from '@rivian-kanban/core'
import { type QueryClient } from '@tanstack/react-query'
import { queryKeys } from './keys.ts'

/**
 * SSE hints are invalidation signals, never data (ADR-008): map each hint to
 * the query keys to refetch, keeping REST the single serialization path.
 */
export function hintInvalidations(hint: SseHint): readonly (readonly string[])[] {
  switch (hint.type) {
    case 'policy.updated':
      return [queryKeys.policy]
    case 'lane.updated':
      return [queryKeys.board]
    case 'user.updated':
      return [queryKeys.users, queryKeys.me]
    case 'location.updated':
      return [queryKeys.locations]
    case 'comment.added':
    case 'comment.edited':
    case 'comment.deleted':
      return [queryKeys.comments(hint.cardId), queryKeys.events(hint.cardId)]
    case 'attachment.added':
    case 'attachment.removed':
      return [queryKeys.card(hint.cardId), queryKeys.events(hint.cardId)]
    default:
      // card.* — board summaries, the card detail, and its history all change.
      return [queryKeys.board, queryKeys.card(hint.cardId), queryKeys.events(hint.cardId)]
  }
}

/** The EventSource surface the stream needs — injectable for hand-written fakes. */
export interface StreamSource {
  readonly readyState: number
  onopen: ((event: Event) => unknown) | null
  onerror: ((event: Event) => unknown) | null
  onmessage: ((event: MessageEvent) => unknown) | null
  close: () => void
}

/** `EventSource.CLOSED` — the terminal state after a failed (non-200) connect. */
const CLOSED = 2

/** Injectable reconnect timer (time is a port — no fake timers in tests). */
export type RetryScheduler = (reconnect: () => void, attempt: number) => () => void

const scheduleWithBackoff: RetryScheduler = (reconnect, attempt) => {
  const delayMs = Math.min(1_000 * 2 ** (attempt - 1), 30_000)
  const id = setTimeout(reconnect, delayMs)
  return () => {
    clearTimeout(id)
  }
}

/**
 * Wires a stream source to targeted query invalidation. Native `EventSource`
 * retries dropped-but-established streams itself; after a drop the whole board
 * is refetched on reconnect because missed hints are irrelevant once state is
 * refetched (ADR-008). A CLOSED readyState is terminal (401/5xx/proxy error on
 * connect — the browser never retries), so a fresh source is created with
 * capped backoff.
 */
export function connectStream(
  queryClient: QueryClient,
  createSource: () => StreamSource,
  schedule: RetryScheduler = scheduleWithBackoff,
): () => void {
  let disposed = false
  let dropped = false
  let attempt = 0
  let cancelRetry: (() => void) | null = null
  let source: StreamSource

  const connect = () => {
    const current = createSource()
    source = current
    current.onopen = () => {
      attempt = 0
      if (!dropped) return
      dropped = false
      void queryClient.invalidateQueries({ queryKey: queryKeys.board })
    }
    current.onerror = () => {
      dropped = true
      if (current.readyState !== CLOSED || disposed) return
      current.close()
      // An expired session surfaces promptly: /auth/me refetch → 401 → login.
      void queryClient.invalidateQueries({ queryKey: queryKeys.me })
      attempt += 1
      cancelRetry = schedule(connect, attempt)
    }
    current.onmessage = (event) => {
      const hint = parseHint(event.data)
      if (hint === null) return
      for (const key of hintInvalidations(hint)) {
        void queryClient.invalidateQueries({ queryKey: key })
      }
    }
  }

  connect()
  return () => {
    disposed = true
    cancelRetry?.()
    source.close()
  }
}

function parseHint(data: unknown): SseHint | null {
  if (typeof data !== 'string') return null
  let json: unknown
  try {
    json = JSON.parse(data)
  } catch {
    return null
  }
  const parsed = sseHintSchema.safeParse(json)
  return parsed.success ? parsed.data : null
}
