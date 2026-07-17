import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { nth, uid } from '../test/fixtures.ts'
import { queryKeys } from './keys.ts'
import { connectStream, hintInvalidations, type StreamSource } from './sse.ts'

describe('hintInvalidations', () => {
  it('maps card hints to board, card, and history queries', () => {
    // Arrange
    const cardId = uid(1)
    const hint = {
      type: 'card.status_changed',
      cardId,
      version: 3,
      eventId: uid(2),
    } as const
    // Act
    const keys = hintInvalidations(hint)
    // Assert
    expect(keys).toEqual([queryKeys.board, queryKeys.card(cardId), queryKeys.events(cardId)])
  })

  it('maps comment hints to the comment thread and history only', () => {
    // Arrange
    const cardId = uid(1)
    const hint = { type: 'comment.added', cardId, version: 3, eventId: uid(2) } as const
    // Act
    const keys = hintInvalidations(hint)
    // Assert
    expect(keys).toEqual([queryKeys.comments(cardId), queryKeys.events(cardId)])
  })

  it('maps board-scoped hints to their config caches (ADR-008)', () => {
    // Arrange
    const policyHint = { type: 'policy.updated' } as const
    const userHint = { type: 'user.updated' } as const
    // Act
    const policyKeys = hintInvalidations(policyHint)
    const userKeys = hintInvalidations(userHint)
    // Assert
    expect(policyKeys).toEqual([queryKeys.policy])
    expect(userKeys).toEqual([queryKeys.users, queryKeys.me])
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
  return queryClient
}

/** Immediate scheduler: runs the reconnect synchronously (time is injected). */
const immediateScheduler = (reconnect: () => void): (() => void) => {
  reconnect()
  return () => undefined
}

describe('connectStream', () => {
  it('invalidates the mapped queries when a valid hint arrives', () => {
    // Arrange
    const queryClient = seededClient()
    const source = new FakeEventSource()
    connectStream(queryClient, () => source)
    // Act
    source.emit(JSON.stringify({ type: 'lane.updated' }))
    // Assert
    expect(queryClient.getQueryState(queryKeys.board)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(queryKeys.policy)?.isInvalidated).toBe(false)
  })

  it('ignores malformed payloads (hints are validated with the core schema)', () => {
    // Arrange
    const queryClient = seededClient()
    const source = new FakeEventSource()
    connectStream(queryClient, () => source)
    // Act
    source.emit('not json')
    source.emit(JSON.stringify({ type: 'unknown.hint' }))
    // Assert
    expect(queryClient.getQueryState(queryKeys.board)?.isInvalidated).toBe(false)
  })

  it('refetches the board after a reconnect (drop → open), not on first open', () => {
    // Arrange
    const queryClient = seededClient()
    const source = new FakeEventSource()
    connectStream(queryClient, () => source)
    // Act
    source.open()
    const afterFirstOpen = queryClient.getQueryState(queryKeys.board)?.isInvalidated
    source.fail()
    source.open()
    // Assert
    expect(afterFirstOpen).toBe(false)
    expect(queryClient.getQueryState(queryKeys.board)?.isInvalidated).toBe(true)
  })

  it('closes the source when disposed', () => {
    // Arrange
    const queryClient = seededClient()
    const source = new FakeEventSource()
    const dispose = connectStream(queryClient, () => source)
    // Act
    dispose()
    // Assert
    expect(source.closed).toBe(true)
  })

  it('recreates the source after a terminal failure and refetches on the new open', () => {
    // Arrange — the reconnect attempt fails permanently (readyState CLOSED)
    const queryClient = seededClient()
    const sources = [new FakeEventSource(), new FakeEventSource()]
    let created = 0
    connectStream(
      queryClient,
      () => {
        const source = sources[created]
        if (source === undefined) throw new Error('created more sources than expected')
        created += 1
        return source
      },
      immediateScheduler,
    )
    nth(sources, 0).open()
    // Act
    nth(sources, 0).failTerminally()
    nth(sources, 1).open()
    // Assert — a second source exists, the dead one was closed, session rechecked,
    // and the board refetches once the replacement stream opens
    expect(created).toBe(2)
    expect(nth(sources, 0).closed).toBe(true)
    expect(queryClient.getQueryState(queryKeys.me)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(queryKeys.board)?.isInvalidated).toBe(true)
  })

  it('does not recreate the source on a transient drop (native retry handles it)', () => {
    // Arrange
    const queryClient = seededClient()
    const first = new FakeEventSource()
    let created = 0
    connectStream(
      queryClient,
      () => {
        created += 1
        return first
      },
      immediateScheduler,
    )
    first.open()
    // Act — established stream drops; readyState is CONNECTING, not CLOSED
    first.fail()
    // Assert
    expect(created).toBe(1)
    expect(first.closed).toBe(false)
    expect(queryClient.getQueryState(queryKeys.me)?.isInvalidated).toBe(false)
  })
})
