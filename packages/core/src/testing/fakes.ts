import { type Card, type User } from '../domain/entities.ts'
import { type SseHint } from '../domain/sse.ts'
import {
  type BlobStorePort,
  type Clock,
  type EventBus,
  type IdGenerator,
  type NotifierPort,
} from '../ports/runtime.ts'

/** Fixed, test-controlled time — tests inject values instead of faking globals. */
export class FixedClock implements Clock {
  private current: Date

  constructor(iso = '2026-07-16T12:00:00.000Z') {
    this.current = new Date(iso)
  }

  now(): Date {
    return new Date(this.current.getTime())
  }

  advanceDays(days: number): void {
    this.current = new Date(this.current.getTime() + days * 86_400_000)
  }
}

/** Deterministic UUID-shaped ids: …-000000000001, …-000000000002, … */
export class SequentialIdGenerator implements IdGenerator {
  private counter = 0

  newId(): string {
    this.counter += 1
    return testId(this.counter)
  }
}

/** The id the SequentialIdGenerator returns for its n-th call (for asserting). */
export function testId(n: number): string {
  return `00000000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`
}

/** Captures published SSE hints for assertion. */
export class CapturingEventBus implements EventBus {
  readonly published: SseHint[] = []

  publish(hint: SseHint): void {
    this.published.push(hint)
  }
}

/** Captures notifications (completion + waiting-overdue DMs) for assertion. */
export class CapturingNotifier implements NotifierPort {
  readonly completedCards: Card[] = []
  readonly overdueAlerts: { card: Card; recipients: User[] }[] = []
  /** Fault injection: when set, both methods reject (Slack-outage simulation). */
  failWith: Error | null = null

  cardCompleted(card: Card): Promise<void> {
    if (this.failWith !== null) return Promise.reject(this.failWith)
    this.completedCards.push(card)
    return Promise.resolve()
  }

  waitingOverdue(card: Card, recipients: User[]): Promise<void> {
    if (this.failWith !== null) return Promise.reject(this.failWith)
    this.overdueAlerts.push({ card, recipients })
    return Promise.resolve()
  }
}

/** Blob store over a Map; exposes the stored keys for assertion. */
export class InMemoryBlobStore implements BlobStorePort {
  readonly blobs = new Map<string, Uint8Array>()
  /** Fault injection: the next delete rejects once (unreachable-store simulation). */
  failNextDelete = false

  put(key: string, content: Uint8Array): Promise<void> {
    this.blobs.set(key, content)
    return Promise.resolve()
  }

  get(key: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.blobs.get(key) ?? null)
  }

  delete(key: string): Promise<void> {
    if (this.failNextDelete) {
      this.failNextDelete = false
      return Promise.reject(new Error('blob store unreachable'))
    }
    this.blobs.delete(key)
    return Promise.resolve()
  }
}
