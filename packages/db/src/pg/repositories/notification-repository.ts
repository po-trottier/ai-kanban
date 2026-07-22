import { type Notification, type NotificationRepository } from '@rivian-kanban/core'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { notifications } from '../../schema.pg.ts'
import { type PgDb } from '../database.ts'

/**
 * In-app notifications (docs/architecture/notifications.md). Insert-only until
 * read; every read/write is scoped to the recipient (`user_id`), so a user only
 * ever sees or marks their own. Newest-first on `(created_at DESC, id DESC)`.
 */
export class PgNotificationRepository implements NotificationRepository {
  private readonly db: PgDb

  constructor(db: PgDb) {
    this.db = db
  }

  private static hydrate(row: typeof notifications.$inferSelect): Notification {
    return { ...row, eventType: row.eventType }
  }

  async insert(notification: Notification): Promise<void> {
    await this.db.insert(notifications).values(notification)
  }

  async listForUser(
    userId: string,
    options: { limit: number; unreadOnly?: boolean },
  ): Promise<Notification[]> {
    const where =
      options.unreadOnly === true
        ? and(eq(notifications.userId, userId), isNull(notifications.readAt))
        : eq(notifications.userId, userId)
    const rows = await this.db
      .select()
      .from(notifications)
      .where(where)
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(options.limit)
    return rows.map((row) => PgNotificationRepository.hydrate(row))
  }

  async unreadCount(userId: string): Promise<number> {
    const rows = await this.db
      .select({ count: sql<string>`count(*)` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    return Number(rows[0]?.count ?? '0')
  }

  async markRead(id: string, userId: string, readAt: string): Promise<void> {
    await this.db
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
  }

  async markUnread(id: string, userId: string): Promise<void> {
    await this.db
      .update(notifications)
      .set({ readAt: null })
      // Only the owner's own row; idempotent if already unread.
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
  }

  async markAllRead(userId: string, readAt: string): Promise<number> {
    const updated = await this.db
      .update(notifications)
      .set({ readAt })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
      .returning({ id: notifications.id })
    return updated.length
  }

  async clear(id: string, userId: string): Promise<void> {
    // Only the owner's own row — a wrong id/user is a silent no-op.
    await this.db
      .delete(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
  }

  async clearAll(userId: string): Promise<number> {
    const deleted = await this.db
      .delete(notifications)
      .where(eq(notifications.userId, userId))
      .returning({ id: notifications.id })
    return deleted.length
  }
}
