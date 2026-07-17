import { type Clock } from '@rivian-kanban/core'

/**
 * Sliding-window rate limiter — the Socket Mode compensating control
 * (docs/architecture/slack.md#delivery-semantics--abuse-controls): HTTP rate
 * limiting never sees WebSocket events, so the adapter enforces its own
 * per-user and global budgets. Time comes from the Clock port so unit tests
 * inject fixed values instead of faking globals.
 */
export class SlidingWindowLimiter {
  private readonly clock: Clock
  private readonly limit: number
  private readonly windowMs: number
  private readonly hits = new Map<string, number[]>()

  constructor(clock: Clock, limit: number, windowMs: number) {
    this.clock = clock
    this.limit = limit
    this.windowMs = windowMs
  }

  /** Consumes one slot for `key` when under the limit; false when exhausted. */
  tryAcquire(key: string): boolean {
    const now = this.clock.now().getTime()
    const cutoff = now - this.windowMs
    if (this.hits.size > 1_000) this.prune(cutoff)
    const kept = (this.hits.get(key) ?? []).filter((timestamp) => timestamp > cutoff)
    if (kept.length >= this.limit) {
      this.hits.set(key, kept)
      return false
    }
    kept.push(now)
    this.hits.set(key, kept)
    return true
  }

  /** Drops keys whose every hit expired — the map stays bounded by activity. */
  private prune(cutoff: number): void {
    for (const [key, timestamps] of this.hits) {
      if (timestamps.every((timestamp) => timestamp <= cutoff)) this.hits.delete(key)
    }
  }
}
