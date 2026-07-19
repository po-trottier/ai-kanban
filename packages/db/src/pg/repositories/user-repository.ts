import { type User, type UserRepository } from '@rivian-kanban/core'
import { eq } from 'drizzle-orm'
import { users } from '../../schema.pg.ts'
import { type PgDb } from '../database.ts'

export class PgUserRepository implements UserRepository {
  private readonly db: PgDb

  constructor(db: PgDb) {
    this.db = db
  }

  async findById(id: string): Promise<User | null> {
    // Explicit column list: password_hash must never leak into the User entity.
    const rows = await this.db
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
      .limit(1)
    return rows[0] ?? null
  }
}
