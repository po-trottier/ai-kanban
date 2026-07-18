import {
  ConflictError,
  NotFoundError,
  type User,
  type UserAccountRepository,
  type UserCredentials,
  type UserSearchFilter,
} from '@rivian-kanban/core'
import { and, asc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm'
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { isUniqueViolation, toError } from '../errors.ts'
import { users } from '../schema.ts'

/** Escapes LIKE wildcards so `q` is a literal substring match (`ESCAPE '\'`). */
function escapeLike(needle: string): string {
  return needle.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

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
 * Explicit `User` column projection — password_hash is deliberately absent so
 * the hash can never ride out of a `list`/`search` read into a response.
 */
const USER_ENTITY_COLUMNS = {
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
} as const

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
      .select(USER_ENTITY_COLUMNS)
      .from(users)
      .orderBy(asc(users.createdAt), asc(users.id))
      .all()
    return Promise.resolve(rows)
  }

  /**
   * The async user-picker read (`GET /users/search`). Index-backed and bounded:
   * a case-insensitive substring over display name + email (or an `ids`
   * allowlist), `activeOnly`/`excludeId` pushed into SQL, ordered by
   * lower(display_name) then id, capped at `limit` — so it never hydrates a
   * 10k-user roster. Empty `q` matches everyone, yielding the first `limit`.
   */
  search(filter: UserSearchFilter): Promise<User[]> {
    const conditions: SQL[] = []
    if (filter.excludeId !== undefined) conditions.push(ne(users.id, filter.excludeId))
    if (filter.activeOnly === true) conditions.push(eq(users.isActive, true))
    if (filter.ids !== undefined) {
      // Empty allowlist matches nothing (never a bare `id IN ()` — SQLite would
      // reject it); an explicit set resolves exactly those ids.
      if (filter.ids.length === 0) return Promise.resolve([])
      conditions.push(inArray(users.id, filter.ids))
    } else if (filter.q !== '') {
      // Both sides folded by SQLite's lower() (ASCII-only without ICU) so the
      // needle and columns collapse the same way — ASCII matching stays
      // case-insensitive and an exact non-ASCII substring still matches.
      const pattern = `%${escapeLike(filter.q)}%`
      // One raw `sql` clause (always `SQL`, never the `SQL | undefined` that
      // `or(...)` returns) matches the substring against display name OR email.
      conditions.push(
        sql`(lower(${users.displayName}) like lower(${pattern}) escape '\\' or lower(${users.email}) like lower(${pattern}) escape '\\')`,
      )
    }
    const rows = this.db
      .select(USER_ENTITY_COLUMNS)
      .from(users)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(sql`lower(${users.displayName})`, asc(users.id))
      .limit(filter.limit)
      .all()
    return Promise.resolve(rows)
  }

  /** COUNT excluding the automation user, any status (first-boot setup guard). */
  countHumanUsers(excludedSystemUserId: string): Promise<number> {
    const row = this.db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(ne(users.id, excludedSystemUserId))
      .get()
    return Promise.resolve(row?.count ?? 0)
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
          timezone: user.timezone,
          theme: user.theme,
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
