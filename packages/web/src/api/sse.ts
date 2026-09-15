import { sseHintSchema, type SseHint } from '@rivian-kanban/core'
import { type QueryClient } from '@tanstack/react-query'
import { queryKeys } from './keys.ts'

/**
 * SSE hints are invalidation signals, never data (ADR-008). `scoped` keys
 * belong on the board-scoped QueryClient (board/card/policy/lane/location
 * data); `global` keys belong on the root client (session, board catalog,
 * notifications) — the two clients are separate instances, so an
 * invalidation on the wrong one is a silent no-op.
 */
export interface HintInvalidations {
  scoped: readonly (readonly string[])[]
  global: readonly (readonly string[])[]
}

const NOTIFICATIONS = ['notifications'] as const

export function hintInvalidations(hint: SseHint): HintInvalidations {
  switch (hint.type) {
    case 'board.updated':
      return { scoped: [], global: [queryKeys.boardCatalog, queryKeys.groups, NOTIFICATIONS] }
    case 'policy.updated':
      // A role's grants can change who administers boards.
      return { scoped: [queryKeys.policy], global: [queryKeys.boardCatalog, NOTIFICATIONS] }
    case 'lane.updated':
      return { scoped: [queryKeys.board], global: [] }
    case 'user.updated':
      return {
        scoped: [queryKeys.users],
        global: [queryKeys.me, queryKeys.boardCatalog, NOTIFICATIONS],
      }
    case 'location.updated':
      return { scoped: [queryKeys.locations], global: [] }
    case 'comment.added':
    case 'comment.edited':
    case 'comment.deleted': {
      const cardId = String(hint.cardId)
      return {
        scoped: [queryKeys.comments(cardId), queryKeys.events(cardId)],
        global: [NOTIFICATIONS],
      }
    }
    case 'attachment.added':
    case 'attachment.removed': {
      const cardId = String(hint.cardId)
      return {
        scoped: [queryKeys.card(cardId), queryKeys.events(cardId)],
        global: [NOTIFICATIONS],
      }
    }
    default: {
      const cardId = String(hint.cardId)
      const scoped: (readonly string[])[] = [
        queryKeys.board,
        queryKeys.card(cardId),
        queryKeys.events(cardId),
      ]
      // A create or a field edit can mint a new free-form tag (the tags table
      // is insert-only, so no other card event alters the vocabulary).
      if (hint.type === 'card.created' || hint.type === 'card.field_changed') {
        scoped.push(queryKeys.tags)
      }
      return { scoped, global: [NOTIFICATIONS] }
    }
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
 * Injectable coalescing window for hint invalidations (like RetryScheduler,
 * so tests stay timer-free): batch flows — the archival loop, MCP bulk edits
 * — emit one hint per mutation, and invalidating per hint would refetch the
 * board once per hint per client. Keys collected within one window dedupe
 * into a single refetch per query key. Returns a cancel function.
 */
export type FlushScheduler = (flush: () => void) => () => void

const COALESCE_WINDOW_MS = 150

const flushAfterWindow: FlushScheduler = (flush) => {
  const id = setTimeout(flush, COALESCE_WINDOW_MS)
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
  scopedQueryClient: QueryClient,
  globalQueryClient: QueryClient,
  createSource: () => StreamSource,
  schedule: RetryScheduler = scheduleWithBackoff,
  scheduleFlush: FlushScheduler = flushAfterWindow,
): () => void {
  let disposed = false
  let dropped = false
  let attempt = 0
  let cancelRetry: (() => void) | null = null
  let cancelFlush: (() => void) | null = null
  let source: StreamSource

  // One coalescing window per hint burst: keys dedupe in the map, and the
  // flush invalidates each pending key exactly once against its own client.
  const pendingKeys = new Map<string, { client: QueryClient; key: readonly string[] }>()
  let flushPending = false
  const queueInvalidations = (hint: SseHint) => {
    const { scoped, global } = hintInvalidations(hint)
    for (const key of scoped) {
      pendingKeys.set(`scoped:${key.join('|')}`, { client: scopedQueryClient, key })
    }
    for (const key of global) {
      pendingKeys.set(`global:${key.join('|')}`, { client: globalQueryClient, key })
    }
    if (flushPending) return
    flushPending = true
    cancelFlush = scheduleFlush(() => {
      flushPending = false
      const entries = [...pendingKeys.values()]
      pendingKeys.clear()
      for (const { client, key } of entries) {
        void client.invalidateQueries({ queryKey: key })
      }
    })
  }

  const connect = () => {
    const current = createSource()
    source = current
    current.onopen = () => {
      attempt = 0
      if (!dropped) return
      dropped = false
      void scopedQueryClient.invalidateQueries({ queryKey: queryKeys.board })
    }
    current.onerror = () => {
      dropped = true
      if (current.readyState !== CLOSED || disposed) return
      current.close()
      // An expired session surfaces promptly: /auth/me refetch → 401 → login.
      void globalQueryClient.invalidateQueries({ queryKey: queryKeys.me })
      void globalQueryClient.invalidateQueries({ queryKey: queryKeys.boardCatalog })
      void globalQueryClient.invalidateQueries({ queryKey: NOTIFICATIONS })
      attempt += 1
      cancelRetry = schedule(connect, attempt)
    }
    current.onmessage = (event) => {
      const hint = parseHint(event.data)
      if (hint === null) return
      queueInvalidations(hint)
    }
  }

  connect()
  return () => {
    disposed = true
    cancelRetry?.()
    cancelFlush?.()
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
