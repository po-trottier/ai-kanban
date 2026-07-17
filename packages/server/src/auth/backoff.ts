import { type Clock } from '@rivian-kanban/core'

/**
 * Per-account exponential login backoff (docs/architecture/security.md):
 * 1 s after the first failure, doubling per failure, capped at 60 s, reset on
 * success. Complements the per-IP rate limit — neither IP rotation nor a
 * single IP can brute-force. Backoff, not lockout, so accounts cannot be
 * DoS'd shut.
 *
 * State is **in-memory by design**: the deployment is a single Node process
 * (deployment.md), so there is no second instance to share with; a restart
 * resetting counters is acceptable because the per-IP limit still stands.
 * Unknown emails are tracked too (uniform behavior — backoff presence must
 * not leak account existence), bounded by an LRU cap against memory-fill.
 */

const BACKOFF_BASE_MS = 1_000
const BACKOFF_CAP_MS = 60_000

/** Delay required after `failures` consecutive failures (pure math). */
export function backoffDelayMs(failures: number): number {
  if (failures <= 0) return 0
  return Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_CAP_MS)
}

interface BackoffEntry {
  failures: number
  lastFailureAtMs: number
}

export class LoginBackoff {
  private readonly clock: Clock
  private readonly maxEntries: number
  private readonly entries = new Map<string, BackoffEntry>()

  constructor(clock: Clock, maxEntries = 10_000) {
    this.clock = clock
    this.maxEntries = maxEntries
  }

  /** Milliseconds the account must still wait; 0 when an attempt is allowed. */
  retryAfterMs(account: string): number {
    const entry = this.entries.get(this.key(account))
    if (entry === undefined) return 0
    const readyAt = entry.lastFailureAtMs + backoffDelayMs(entry.failures)
    return Math.max(0, readyAt - this.clock.now().getTime())
  }

  recordFailure(account: string): void {
    const key = this.key(account)
    const entry = this.entries.get(key)
    // Refresh insertion order so the LRU cap evicts the stalest account.
    this.entries.delete(key)
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next()
      if (!oldest.done) this.entries.delete(oldest.value)
    }
    this.entries.set(key, {
      failures: (entry?.failures ?? 0) + 1,
      lastFailureAtMs: this.clock.now().getTime(),
    })
  }

  reset(account: string): void {
    this.entries.delete(this.key(account))
  }

  private key(account: string): string {
    return account.toLowerCase()
  }
}
