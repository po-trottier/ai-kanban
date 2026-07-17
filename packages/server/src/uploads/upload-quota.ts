import { utcDayOf, type Clock } from '@rivian-kanban/core'

/**
 * Per-user daily upload quota (docs/architecture/security.md#uploads:
 * 500 MB/day/user against disk-fill DoS). Counters are **in-memory by
 * design** — single Node process (deployment.md), and a restart forgiving a
 * partial day is acceptable because the blob-dir high-water mark still caps
 * total disk usage. Keyed by UTC day so the window resets at midnight.
 */
export class UploadQuota {
  private readonly clock: Clock
  private readonly limitBytes: number
  private day = ''
  private byUser = new Map<string, number>()

  constructor(clock: Clock, limitBytes: number) {
    this.clock = clock
    this.limitBytes = limitBytes
  }

  private rollover(): void {
    const today = utcDayOf(this.clock.now())
    if (today !== this.day) {
      this.day = today
      this.byUser = new Map()
    }
  }

  /**
   * Atomically checks AND counts `bytes` (reserve-then-settle): a synchronous
   * check+add cannot interleave with another request's, so concurrent uploads
   * from one user cannot all pass a separate check before any records —
   * callers `release` the reservation when the upload later fails.
   */
  reserve(userId: string, bytes: number): boolean {
    this.rollover()
    const used = this.byUser.get(userId) ?? 0
    if (used + bytes > this.limitBytes) return false
    this.byUser.set(userId, used + bytes)
    return true
  }

  /** Refunds a reservation after a failed upload (clamped at zero). */
  release(userId: string, bytes: number): void {
    this.rollover()
    this.byUser.set(userId, Math.max(0, (this.byUser.get(userId) ?? 0) - bytes))
  }
}
