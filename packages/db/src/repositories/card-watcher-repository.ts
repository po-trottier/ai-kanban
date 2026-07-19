import { type CardWatcherRepository } from '@rivian-kanban/core'
import { and, eq } from 'drizzle-orm'
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { cardWatchers } from '../schema.ts'

/**
 * Per-user-per-card WATCH subscriptions (docs/architecture/notifications.md).
 * The composite PK `(card_id, user_id)` makes `add` idempotent (insert-or-ignore)
 * and, leading with `card_id`, indexes the `listWatcherIds` fan-out read.
 */
export class SqliteCardWatcherRepository implements CardWatcherRepository {
  private readonly db: BetterSQLite3Database

  constructor(db: BetterSQLite3Database) {
    this.db = db
  }

  isWatching(cardId: number, userId: string): Promise<boolean> {
    const row = this.db
      .select({ cardId: cardWatchers.cardId })
      .from(cardWatchers)
      .where(and(eq(cardWatchers.cardId, cardId), eq(cardWatchers.userId, userId)))
      .get()
    return Promise.resolve(row !== undefined)
  }

  listWatcherIds(cardId: number): Promise<string[]> {
    const rows = this.db
      .select({ userId: cardWatchers.userId })
      .from(cardWatchers)
      .where(eq(cardWatchers.cardId, cardId))
      .all()
    return Promise.resolve(rows.map((row) => row.userId))
  }

  add(cardId: number, userId: string, createdAt: string): Promise<void> {
    // Idempotent: the composite PK makes a re-watch a no-op.
    this.db.insert(cardWatchers).values({ cardId, userId, createdAt }).onConflictDoNothing().run()
    return Promise.resolve()
  }

  remove(cardId: number, userId: string): Promise<void> {
    this.db
      .delete(cardWatchers)
      .where(and(eq(cardWatchers.cardId, cardId), eq(cardWatchers.userId, userId)))
      .run()
    return Promise.resolve()
  }
}
