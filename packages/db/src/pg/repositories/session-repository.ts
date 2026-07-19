import { type Session, type SessionRepository } from '@rivian-kanban/core'
import { and, eq, lte, ne } from 'drizzle-orm'
import { toError } from '../../errors.ts'
import { sessions } from '../../schema.pg.ts'
import { type PgDb } from '../database.ts'

/**
 * Server-side session rows (ADR-009). `id` is the sha256 hex of the raw
 * cookie value; `expiresAt` is written pre-folded (`min(lastSeen + idle,
 * createdAt + absolute)`), so lookups compare one timestamp.
 */
export class PgSessionRepository implements SessionRepository {
  private readonly db: PgDb

  constructor(db: PgDb) {
    this.db = db
  }

  async create(session: Session): Promise<void> {
    try {
      await this.db.insert(sessions).values(session)
    } catch (error) {
      throw toError(error)
    }
  }

  async findByHash(idHash: string): Promise<Session | null> {
    const rows = await this.db.select().from(sessions).where(eq(sessions.id, idHash)).limit(1)
    return rows[0] ?? null
  }

  async touch(idHash: string, lastSeenAt: string, expiresAt: string): Promise<void> {
    await this.db.update(sessions).set({ lastSeenAt, expiresAt }).where(eq(sessions.id, idHash))
  }

  async revoke(idHash: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, idHash))
  }

  async revokeOthersForUser(userId: string, exceptIdHash?: string): Promise<void> {
    const scope =
      exceptIdHash === undefined
        ? eq(sessions.userId, userId)
        : and(eq(sessions.userId, userId), ne(sessions.id, exceptIdHash))
    await this.db.delete(sessions).where(scope)
  }

  async deleteExpired(nowIso: string): Promise<number> {
    const deleted = await this.db
      .delete(sessions)
      .where(lte(sessions.expiresAt, nowIso))
      .returning({ id: sessions.id })
    return deleted.length
  }
}
