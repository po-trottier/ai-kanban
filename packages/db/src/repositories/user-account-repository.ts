import {
  ConflictError,
  NotFoundError,
  type User,
  type UserAccountRepository,
  type UserCredentials,
} from '@rivian-kanban/core'
import { asc, eq, sql } from 'drizzle-orm'
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { isUniqueViolation, toError } from '../errors.ts'
import { users } from '../schema.ts'

/**
 * True for either spelling of a duplicate email: the plain column UNIQUE
 * (`users.email`) or the case-insensitive lower(email) unique index — SQLite
 * names expression-index violations by index, not table.column.
 */
function isDuplicateEmail(error: unknown): boolean {
  return (
    isUniqueViolation(error, ['users.email']) || isUniqueViolation(error, ['users_email_ci_unique'])
  )
}

/** Splits a full row into the hash-free entity + its stored hash. */
function toCredentials(row: typeof users.$inferSelect): UserCredentials {
  const { passwordHash, ...user } = row
  return { user, passwordHash }
}

/**
 * The auth/admin user surface (login, change-password, users CRUD). The only
 * adapter that reads `password_hash`; every read returns it separated from
 * the `User` entity so response schemas can never carry it.
 */
export class SqliteUserAccountRepository implements UserAccountRepository {
  private readonly db: BetterSQLite3Database

  constructor(db: BetterSQLite3Database) {
    this.db = db
  }

  /** Case-insensitive via explicit lower() = lower() (matches the fake's fold). */
  findByEmail(email: string): Promise<UserCredentials | null> {
    const row = this.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)
      .get()
    return Promise.resolve(row === undefined ? null : toCredentials(row))
  }

  findById(id: string): Promise<UserCredentials | null> {
    const row = this.db.select().from(users).where(eq(users.id, id)).get()
    return Promise.resolve(row === undefined ? null : toCredentials(row))
  }

  /** Exact match on the stored Slack binding (docs/architecture/slack.md#identity-mapping). */
  findBySlackUserId(slackUserId: string): Promise<UserCredentials | null> {
    const row = this.db.select().from(users).where(eq(users.slackUserId, slackUserId)).get()
    return Promise.resolve(row === undefined ? null : toCredentials(row))
  }

  list(): Promise<User[]> {
    const rows = this.db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        mustChangePassword: users.mustChangePassword,
        slackUserId: users.slackUserId,
        isActive: users.isActive,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(asc(users.createdAt), asc(users.id))
      .all()
    return Promise.resolve(rows)
  }

  insert(user: User, passwordHash: string): Promise<void> {
    try {
      this.db
        .insert(users)
        .values({ ...user, passwordHash })
        .run()
      return Promise.resolve()
    } catch (error) {
      if (isDuplicateEmail(error)) {
        return Promise.reject(new ConflictError('email already in use'))
      }
      return Promise.reject(toError(error))
    }
  }

  update(user: User): Promise<void> {
    try {
      const result = this.db
        .update(users)
        .set({
          email: user.email,
          displayName: user.displayName,
          role: user.role,
          mustChangePassword: user.mustChangePassword,
          slackUserId: user.slackUserId,
          isActive: user.isActive,
        })
        .where(eq(users.id, user.id))
        .run()
      if (result.changes === 0) return Promise.reject(new NotFoundError('user'))
      return Promise.resolve()
    } catch (error) {
      if (isDuplicateEmail(error)) {
        return Promise.reject(new ConflictError('email already in use'))
      }
      return Promise.reject(toError(error))
    }
  }

  setPassword(userId: string, passwordHash: string, mustChangePassword: boolean): Promise<void> {
    const result = this.db
      .update(users)
      .set({ passwordHash, mustChangePassword })
      .where(eq(users.id, userId))
      .run()
    if (result.changes === 0) return Promise.reject(new NotFoundError('user'))
    return Promise.resolve()
  }
}
