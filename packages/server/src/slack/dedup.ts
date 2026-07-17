/**
 * Bounded LRU id set for Slack delivery dedup: Socket Mode redelivers
 * unacknowledged events, and redelivery must never double-create tickets
 * (docs/architecture/slack.md#delivery-semantics--abuse-controls). A Set
 * keeps insertion order, so the oldest entry is always first.
 */
export class BoundedLruSet {
  private readonly capacity: number
  private readonly entries = new Set<string>()

  constructor(capacity: number) {
    if (capacity < 1) throw new Error('BoundedLruSet capacity must be at least 1')
    this.capacity = capacity
  }

  /** True when `key` is new (and now remembered); false on a duplicate. */
  addIfAbsent(key: string): boolean {
    if (this.entries.has(key)) {
      // Refresh recency so hot duplicates are not evicted before cold ids.
      this.entries.delete(key)
      this.entries.add(key)
      return false
    }
    this.entries.add(key)
    if (this.entries.size > this.capacity) {
      const oldest = this.entries.values().next().value
      if (oldest !== undefined) this.entries.delete(oldest)
    }
    return true
  }
}
