import { type CardWatcherRepository } from '@rivian-kanban/core'
import { and, eq } from 'drizzle-orm'
import { cardWatchers } from '../../schema.pg.ts'
import { type PgDb } from '../database.ts'

/**
 * Per-user-per-card WATCH subscriptions (docs/architecture/notifications.md).
 * The composite PK `(card_id, user_id)` makes `add` idempotent (insert-or-ignore)
 * and, leading with `card_id`, indexes the `listWatcherIds` fan-out read.
 */
export class PgCardWatcherRepository implements CardWatcherRepository {
  private readonly db: PgDb

  constructor(db: PgDb) {
    this.db = db
  }

  async isWatching(cardId: number, userId: string): Promise<boolean> {
    const rows = await this.db
      .select({ cardId: cardWatchers.cardId })
      .from(cardWatchers)
      .where(and(eq(cardWatchers.cardId, cardId), eq(cardWatchers.userId, userId)))
      .limit(1)
    return rows[0] !== undefined
  }

  async listWatcherIds(cardId: number): Promise<string[]> {
    const rows = await this.db
      .select({ userId: cardWatchers.userId })
      .from(cardWatchers)
      .where(eq(cardWatchers.cardId, cardId))
    return rows.map((row) => row.userId)
  }

  async add(cardId: number, userId: string, createdAt: string): Promise<void> {
    // Idempotent: the composite PK makes a re-watch a no-op.
    await this.db.insert(cardWatchers).values({ cardId, userId, createdAt }).onConflictDoNothing()
  }

  async remove(cardId: number, userId: string): Promise<void> {
    await this.db
      .delete(cardWatchers)
      .where(and(eq(cardWatchers.cardId, cardId), eq(cardWatchers.userId, userId)))
  }
}
