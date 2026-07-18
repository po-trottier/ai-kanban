import { type User, type UserRepository } from '@rivian-kanban/core'
import { eq } from 'drizzle-orm'
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { users } from '../schema.ts'

export class SqliteUserRepository implements UserRepository {
  private readonly db: BetterSQLite3Database

  constructor(db: BetterSQLite3Database) {
    this.db = db
  }

  findById(id: string): Promise<User | null> {
    // Explicit column list: password_hash must never leak into the User entity.
    const row = this.db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        mustChangePassword: users.mustChangePassword,
        slackUserId: users.slackUserId,
        isActive: users.isActive,
        timezone: users.timezone,
        theme: users.theme,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, id))
      .get()
    return Promise.resolve(row ?? null)
  }
}
