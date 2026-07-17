import { type Session, type SessionRepository } from '@rivian-kanban/core'
import { and, eq, lte, ne } from 'drizzle-orm'
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { toError } from '../errors.ts'
import { sessions } from '../schema.ts'

/**
 * Server-side session rows (ADR-009). `id` is the sha256 hex of the raw
 * cookie value; `expiresAt` is written pre-folded (`min(lastSeen + idle,
 * createdAt + absolute)`), so lookups compare one timestamp.
 */
export class SqliteSessionRepository implements SessionRepository {
  private readonly db: BetterSQLite3Database

  constructor(db: BetterSQLite3Database) {
    this.db = db
  }

  create(session: Session): Promise<void> {
    try {
      this.db.insert(sessions).values(session).run()
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(toError(error))
    }
  }

  findByHash(idHash: string): Promise<Session | null> {
    const row = this.db.select().from(sessions).where(eq(sessions.id, idHash)).get()
    return Promise.resolve(row ?? null)
  }

  touch(idHash: string, lastSeenAt: string, expiresAt: string): Promise<void> {
    this.db.update(sessions).set({ lastSeenAt, expiresAt }).where(eq(sessions.id, idHash)).run()
    return Promise.resolve()
  }

  revoke(idHash: string): Promise<void> {
    this.db.delete(sessions).where(eq(sessions.id, idHash)).run()
    return Promise.resolve()
  }

  revokeOthersForUser(userId: string, exceptIdHash?: string): Promise<void> {
    const scope =
      exceptIdHash === undefined
        ? eq(sessions.userId, userId)
        : and(eq(sessions.userId, userId), ne(sessions.id, exceptIdHash))
    this.db.delete(sessions).where(scope).run()
    return Promise.resolve()
  }

  deleteExpired(nowIso: string): Promise<number> {
    const result = this.db.delete(sessions).where(lte(sessions.expiresAt, nowIso)).run()
    return Promise.resolve(result.changes)
  }
}
