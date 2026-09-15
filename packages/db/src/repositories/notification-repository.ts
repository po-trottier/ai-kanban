import { type Notification, type NotificationRepository } from '@rivian-kanban/core'
import { and, desc, eq, exists, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { cards, notifications } from '../schema.ts'

/**
 * In-app notifications (docs/architecture/notifications.md). Insert-only until
 * read; every read/write is scoped to the recipient (`user_id`), so a user only
 * ever sees or marks their own. Newest-first on `(created_at DESC, id DESC)`.
 */
export class SqliteNotificationRepository implements NotificationRepository {
  private readonly db: BetterSQLite3Database

  constructor(db: BetterSQLite3Database) {
    this.db = db
  }

  private static hydrate(row: typeof notifications.$inferSelect): Notification {
    return { ...row, eventType: row.eventType }
  }

  insert(notification: Notification): Promise<void> {
    this.db.insert(notifications).values(notification).run()
    return Promise.resolve()
  }

  /**
   * `boardIds` filters through the notification's card (an `exists` subquery,
   * not a join, so no row multiplication) — undefined means unscoped, an
   * empty array matches nothing (no leakage), mirroring EventRepository's
   * `actorIds` allowlist contract.
   */
  private boardScope(boardIds: readonly string[]): SQL {
    return exists(
      this.db
        .select({ one: sql`1` })
        .from(cards)
        .where(and(eq(cards.id, notifications.cardId), inArray(cards.boardId, [...boardIds]))),
    )
  }

  listForUser(
    userId: string,
    options: { limit: number; unreadOnly?: boolean; boardIds?: readonly string[] },
  ): Promise<Notification[]> {
    if (options.boardIds?.length === 0) return Promise.resolve([])
    const conditions: (SQL | undefined)[] = [eq(notifications.userId, userId)]
    if (options.unreadOnly === true) conditions.push(isNull(notifications.readAt))
    if (options.boardIds !== undefined) {
      conditions.push(this.boardScope(options.boardIds))
    }
    const rows = this.db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(options.limit)
      .all()
    return Promise.resolve(rows.map((row) => SqliteNotificationRepository.hydrate(row)))
  }

  unreadCount(userId: string, boardIds?: readonly string[]): Promise<number> {
    if (boardIds?.length === 0) return Promise.resolve(0)
    const conditions: (SQL | undefined)[] = [
      eq(notifications.userId, userId),
      isNull(notifications.readAt),
    ]
    if (boardIds !== undefined) conditions.push(this.boardScope(boardIds))
    const row = this.db
      .select({ count: sql<number>`count(*)` })
      .from(notifications)
      .where(and(...conditions))
      .get()
    return Promise.resolve(row?.count ?? 0)
  }

  markRead(id: string, userId: string, readAt: string): Promise<void> {
    this.db
      .update(notifications)
      .set({ readAt })
      // Only the owner's own row, and only while unread (idempotent).
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
        ),
      )
      .run()
    return Promise.resolve()
  }

  markUnread(id: string, userId: string): Promise<void> {
    this.db
      .update(notifications)
      .set({ readAt: null })
      // Only the owner's own row; idempotent if already unread.
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .run()
    return Promise.resolve()
  }

  markAllRead(userId: string, readAt: string, boardIds?: readonly string[]): Promise<number> {
    if (boardIds?.length === 0) return Promise.resolve(0)
    const conditions: (SQL | undefined)[] = [
      eq(notifications.userId, userId),
      isNull(notifications.readAt),
    ]
    if (boardIds !== undefined) conditions.push(this.boardScope(boardIds))
    const result = this.db
      .update(notifications)
      .set({ readAt })
      .where(and(...conditions))
      .run()
    return Promise.resolve(result.changes)
  }

  clear(id: string, userId: string): Promise<void> {
    // Only the owner's own row — a wrong id/user is a silent no-op.
    this.db
      .delete(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .run()
    return Promise.resolve()
  }

  clearAll(userId: string, boardIds?: readonly string[]): Promise<number> {
    if (boardIds?.length === 0) return Promise.resolve(0)
    const conditions: (SQL | undefined)[] = [eq(notifications.userId, userId)]
    if (boardIds !== undefined) conditions.push(this.boardScope(boardIds))
    const result = this.db
      .delete(notifications)
      .where(and(...conditions))
      .run()
    return Promise.resolve(result.changes)
  }
}
