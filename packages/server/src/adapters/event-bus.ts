import { type EventBus, type SseHint } from '@rivian-kanban/core'

/**
 * In-process EventBus adapter (ADR-008): core services publish committed
 * hints; the SSE route subscribes per connection. Single-node by design —
 * the Postgres migration swaps this for LISTEN/NOTIFY without touching core.
 */
export type SseListener = (hint: SseHint) => void

export class InProcessEventBus implements EventBus {
  private readonly listeners = new Set<SseListener>()

  publish(hint: SseHint): void {
    // Snapshot: a listener unsubscribing mid-dispatch must not skip others.
    for (const listener of [...this.listeners]) listener(hint)
  }

  /** Returns the unsubscribe function. */
  subscribe(listener: SseListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Live subscription count — leak assertions in the SSE tests read this. */
  subscriberCount(): number {
    return this.listeners.size
  }
}
