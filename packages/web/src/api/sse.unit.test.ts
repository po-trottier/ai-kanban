import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { nth, uid } from '../test/fixtures.ts'
import { queryKeys } from './keys.ts'
import { connectStream, hintInvalidations, type StreamSource } from './sse.ts'

describe('hintInvalidations', () => {
  it('maps card hints to board, card, and history queries (scoped) plus notifications (global)', () => {
    // Arrange
    const cardId = 1
    const key = String(cardId)
    const hint = {
      type: 'card.status_changed',
      cardId,
      version: 3,
      eventId: uid(2),
    } as const
    // Act
    const result = hintInvalidations(hint)
    // Assert
    expect(result.scoped).toEqual([queryKeys.board, queryKeys.card(key), queryKeys.events(key)])
    expect(result.global).toEqual([['notifications']])
  })

  it('refreshes the Tags facet only for the card events that can mint a tag', () => {
    // Arrange — a create and a field edit can introduce a new free-form tag; a
    // pure status change (a move) never touches the tag vocabulary.
    const cardId = 7
    const key = String(cardId)
    const base = { cardId, version: 3, eventId: uid(2) } as const
    // Act
    const created = hintInvalidations({ ...base, type: 'card.created' })
    const fieldChanged = hintInvalidations({ ...base, type: 'card.field_changed' })
    const statusChanged = hintInvalidations({ ...base, type: 'card.status_changed' })
    // Assert — tags appended for create/field-change, absent for a status move.
    expect(created.scoped).toEqual([
      queryKeys.board,
      queryKeys.card(key),
      queryKeys.events(key),
      queryKeys.tags,
    ])
    expect(fieldChanged.scoped).toContainEqual(queryKeys.tags)
    expect(statusChanged.scoped).not.toContainEqual(queryKeys.tags)
  })

  it('maps comment hints to the comment thread and history (scoped) plus notifications (global)', () => {
    // Arrange
    const cardId = 1
    const key = String(cardId)
    const hint = { type: 'comment.added', cardId, version: 3, eventId: uid(2) } as const
    // Act
    const result = hintInvalidations(hint)
    // Assert
    expect(result.scoped).toEqual([queryKeys.comments(key), queryKeys.events(key)])
    expect(result.global).toEqual([['notifications']])
  })

  it('routes policy/lane/user/location/board hints to the right client', () => {
    // Arrange
    // Act
    const policy = hintInvalidations({ type: 'policy.updated' })
    const lane = hintInvalidations({ type: 'lane.updated' })
    const user = hintInvalidations({ type: 'user.updated' })
    const location = hintInvalidations({ type: 'location.updated' })
    const board = hintInvalidations({ type: 'board.updated' })
    // Assert — policy can change who administers boards, so it also
    // revalidates the (global) catalog; a plain lane/location edit doesn't.
    expect(policy).toEqual({
      scoped: [queryKeys.policy],
      global: [queryKeys.boardCatalog, ['notifications']],
    })
    expect(lane).toEqual({ scoped: [queryKeys.board], global: [] })
    expect(user).toEqual({
      scoped: [queryKeys.users],
      global: [queryKeys.me, queryKeys.boardCatalog, ['notifications']],
    })
    expect(location).toEqual({ scoped: [queryKeys.locations], global: [] })
    expect(board).toEqual({
      scoped: [],
      global: [queryKeys.boardCatalog, queryKeys.groups, ['notifications']],
    })
  })
})

/** Hand-written EventSource fake (docs/dev/testing.md: fakes, not mocks). */
class FakeEventSource implements StreamSource {
  onopen: ((event: Event) => unknown) | null = null
  onerror: ((event: Event) => unknown) | null = null
  onmessage: ((event: MessageEvent) => unknown) | null = null
  readyState = 0 // CONNECTING
  closed = false

  close(): void {
    this.closed = true
  }

  emit(data: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data }))
  }

  open(): void {
    this.readyState = 1 // OPEN
    this.onopen?.(new Event('open'))
  }

  /** A transient drop of an established stream — the browser retries itself. */
  fail(): void {
    this.readyState = 0 // CONNECTING (native auto-reconnect in flight)
    this.onerror?.(new Event('error'))
  }

  /** A failed connect (401/5xx) — readyState CLOSED, the browser never retries. */
  failTerminally(): void {
    this.readyState = 2 // CLOSED
    this.onerror?.(new Event('error'))
  }
}

function seededClient(): QueryClient {
  const queryClient = new QueryClient()
  queryClient.setQueryData(queryKeys.board, { lanes: [] })
  queryClient.setQueryData(queryKeys.policy, {})
  queryClient.setQueryData(queryKeys.me, {})
  queryClient.setQueryData(queryKeys.boardCatalog, {})
  return queryClient
}

/** Immediate scheduler: runs the reconnect synchronously (time is injected). */
const immediateScheduler = (reconnect: () => void): (() => void) => {
  reconnect()
  return () => undefined
}

/** Immediate flush: hint invalidations apply synchronously (time is injected). */
const immediateFlush = (flush: () => void): (() => void) => {
  flush()
  return () => undefined
}

describe('connectStream', () => {
  it('invalidates scoped hints on the scoped client only', () => {
    // Arrange
    const scoped = seededClient()
    const global = seededClient()
    const source = new FakeEventSource()
    connectStream(scoped, global, () => source, immediateScheduler, immediateFlush)
    // Act
    source.emit(JSON.stringify({ type: 'lane.updated' }))
    // Assert
    expect(scoped.getQueryState(queryKeys.board)?.isInvalidated).toBe(true)
    expect(global.getQueryState(queryKeys.board)?.isInvalidated).toBe(false)
  })

  it('invalidates global hints (board.updated) on the global client only', () => {
    // Arrange
    const scoped = seededClient()
    const global = seededClient()
    const source = new FakeEventSource()
    connectStream(scoped, global, () => source, immediateScheduler, immediateFlush)
    // Act
    source.emit(JSON.stringify({ type: 'board.updated' }))
    // Assert
    expect(global.getQueryState(queryKeys.boardCatalog)?.isInvalidated).toBe(true)
    expect(scoped.getQueryState(queryKeys.boardCatalog)?.isInvalidated ?? false).toBe(false)
  })

  it('a policy hint invalidates policy scoped AND the catalog global', () => {
    // Arrange
    const scoped = seededClient()
    const global = seededClient()
    const source = new FakeEventSource()
    connectStream(scoped, global, () => source, immediateScheduler, immediateFlush)
    // Act
    source.emit(JSON.stringify({ type: 'policy.updated' }))
    // Assert
    expect(scoped.getQueryState(queryKeys.policy)?.isInvalidated).toBe(true)
    expect(global.getQueryState(queryKeys.boardCatalog)?.isInvalidated).toBe(true)
  })

  it('coalesces a hint burst into one invalidation pass per window', () => {
    // Arrange — the flush is held until the test releases the window
    const scoped = seededClient()
    const global = seededClient()
    const source = new FakeEventSource()
    const flushes: (() => void)[] = []
    connectStream(
      scoped,
      global,
      () => source,
      immediateScheduler,
      (flush) => {
        flushes.push(flush)
        return () => undefined
      },
    )
    // Act — a bulk-edit burst: three hints land inside one window
    source.emit(
      JSON.stringify({ type: 'card.created', cardId: uid(1), version: 1, eventId: uid(2) }),
    )
    source.emit(
      JSON.stringify({ type: 'card.created', cardId: uid(1), version: 2, eventId: uid(3) }),
    )
    source.emit(JSON.stringify({ type: 'lane.updated' }))
    const scheduledDuringBurst = flushes.length
    const invalidatedBeforeFlush = scoped.getQueryState(queryKeys.board)?.isInvalidated
    flushes[0]?.()
    // Assert — ONE window was scheduled and the board invalidated once, on flush
    expect(scheduledDuringBurst).toBe(1)
    expect(invalidatedBeforeFlush).toBe(false)
    expect(scoped.getQueryState(queryKeys.board)?.isInvalidated).toBe(true)
  })

  it('ignores malformed payloads (hints are validated with the core schema)', () => {
    // Arrange
    const scoped = seededClient()
    const global = seededClient()
    const source = new FakeEventSource()
    connectStream(scoped, global, () => source, immediateScheduler, immediateFlush)
    // Act
    source.emit('not json')
    source.emit(JSON.stringify({ type: 'unknown.hint' }))
    // Assert
    expect(scoped.getQueryState(queryKeys.board)?.isInvalidated).toBe(false)
  })

  it('refetches the board after a reconnect (drop → open), not on first open', () => {
    // Arrange
    const scoped = seededClient()
    const global = seededClient()
    const source = new FakeEventSource()
    connectStream(scoped, global, () => source, immediateScheduler, immediateFlush)
    // Act
    source.open()
    const afterFirstOpen = scoped.getQueryState(queryKeys.board)?.isInvalidated
    source.fail()
    source.open()
    // Assert
    expect(afterFirstOpen).toBe(false)
    expect(scoped.getQueryState(queryKeys.board)?.isInvalidated).toBe(true)
  })

  it('closes the source when disposed', () => {
    // Arrange
    const scoped = seededClient()
    const global = seededClient()
    const source = new FakeEventSource()
    const dispose = connectStream(scoped, global, () => source, immediateScheduler, immediateFlush)
    // Act
    dispose()
    // Assert
    expect(source.closed).toBe(true)
  })

  it('recreates the source after a terminal failure and rechecks the GLOBAL session', () => {
    // Arrange — the reconnect attempt fails permanently (readyState CLOSED)
    const scoped = seededClient()
    const global = seededClient()
    const sources = [new FakeEventSource(), new FakeEventSource()]
    let created = 0
    connectStream(
      scoped,
      global,
      () => {
        const source = sources[created]
        if (source === undefined) throw new Error('created more sources than expected')
        created += 1
        return source
      },
      immediateScheduler,
      immediateFlush,
    )
    nth(sources, 0).open()
    // Act
    nth(sources, 0).failTerminally()
    nth(sources, 1).open()
    // Assert — a second source exists, the dead one was closed, the GLOBAL
    // session query rechecked (not the scoped one), and the board refetches
    // once the replacement stream opens.
    expect(created).toBe(2)
    expect(nth(sources, 0).closed).toBe(true)
    expect(global.getQueryState(queryKeys.me)?.isInvalidated).toBe(true)
    expect(scoped.getQueryState(queryKeys.board)?.isInvalidated).toBe(true)
  })

  it('does not recreate the source on a transient drop (native retry handles it)', () => {
    // Arrange
    const scoped = seededClient()
    const global = seededClient()
    const first = new FakeEventSource()
    let created = 0
    connectStream(
      scoped,
      global,
      () => {
        created += 1
        return first
      },
      immediateScheduler,
      immediateFlush,
    )
    first.open()
    // Act — established stream drops; readyState is CONNECTING, not CLOSED
    first.fail()
    // Assert
    expect(created).toBe(1)
    expect(first.closed).toBe(false)
    expect(global.getQueryState(queryKeys.me)?.isInvalidated).toBe(false)
  })
})
