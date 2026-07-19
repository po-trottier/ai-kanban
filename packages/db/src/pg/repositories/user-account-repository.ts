import {
  ConflictError,
  NotFoundError,
  type User,
  type UserAccountRepository,
  type UserCredentials,
  type UserSearchFilter,
} from '@rivian-kanban/core'
import { and, asc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm'
import { toError } from '../../errors.ts'
import { users } from '../../schema.pg.ts'
import { type PgDb } from '../database.ts'
import { isPgUniqueViolation } from '../errors.ts'

/** Escapes LIKE wildcards so `q` is a literal substring match (`ESCAPE '\'`). */
function escapeLike(needle: string): string {
  return needle.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

/** A duplicate email is the case-insensitive lower(email) unique index (schema.pg). */
function isDuplicateEmail(error: unknown): boolean {
  return isPgUniqueViolation(error, ['users_email_ci_unique'])
}

/** Splits a full row into the hash-free entity + its stored hash. */
function toCredentials(row: typeof users.$inferSelect): UserCredentials {
  const { passwordHash, ...user } = row
  return { user, passwordHash }
}

/** Explicit `User` projection — password_hash absent so it can never ride out of a read. */
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

export class PgUserAccountRepository implements UserAccountRepository {
  private readonly db: PgDb

  constructor(db: PgDb) {
    this.db = db
  }

  /** Case-insensitive via explicit lower() = lower(). */
  async findByEmail(email: string): Promise<UserCredentials | null> {
    const rows = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)
      .limit(1)
    return rows[0] === undefined ? null : toCredentials(rows[0])
  }

  async findById(id: string): Promise<UserCredentials | null> {
    const rows = await this.db.select().from(users).where(eq(users.id, id)).limit(1)
    return rows[0] === undefined ? null : toCredentials(rows[0])
  }

  /** Exact match on the stored Slack binding (docs/architecture/slack.md#identity-mapping). */
  async findBySlackUserId(slackUserId: string): Promise<UserCredentials | null> {
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.slackUserId, slackUserId))
      .limit(1)
    return rows[0] === undefined ? null : toCredentials(rows[0])
  }

  async list(): Promise<User[]> {
    return this.db
      .select(USER_ENTITY_COLUMNS)
      .from(users)
      .orderBy(asc(users.createdAt), asc(users.id))
  }

  /**
   * The async user-picker read (`GET /users/search`): a case-insensitive
   * substring over display name + email (or an `ids` allowlist), `activeOnly`/
   * `excludeId` pushed into SQL, ordered by lower(display_name) then id, capped
   * at `limit`. Empty `q` matches everyone, yielding the first `limit`.
   */
  async search(filter: UserSearchFilter): Promise<User[]> {
    const conditions: SQL[] = []
    if (filter.excludeId !== undefined) conditions.push(ne(users.id, filter.excludeId))
    if (filter.activeOnly === true) conditions.push(eq(users.isActive, true))
    if (filter.ids !== undefined) {
      // Empty allowlist matches nothing; an explicit set resolves exactly those ids.
      if (filter.ids.length === 0) return []
      conditions.push(inArray(users.id, filter.ids))
    } else if (filter.q !== '') {
      const pattern = `%${escapeLike(filter.q)}%`
      conditions.push(
        sql`(lower(${users.displayName}) like lower(${pattern}) escape '\\' or lower(${users.email}) like lower(${pattern}) escape '\\')`,
      )
    }
    return this.db
      .select(USER_ENTITY_COLUMNS)
      .from(users)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(sql`lower(${users.displayName})`, asc(users.id))
      .limit(filter.limit)
  }

  /** COUNT excluding the automation user, any status (first-boot setup guard). */
  async countHumanUsers(excludedSystemUserId: string): Promise<number> {
    const rows = await this.db
      .select({ count: sql<string>`count(*)` })
      .from(users)
      .where(ne(users.id, excludedSystemUserId))
    return Number(rows[0]?.count ?? '0')
  }

  async insert(user: User, passwordHash: string): Promise<void> {
    try {
      await this.db.insert(users).values({ ...user, passwordHash })
    } catch (error) {
      if (isDuplicateEmail(error)) throw new ConflictError('email already in use')
      throw toError(error)
    }
  }

  async update(user: User): Promise<void> {
    let updated
    try {
      updated = await this.db
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
        .returning({ id: users.id })
    } catch (error) {
      if (isDuplicateEmail(error)) throw new ConflictError('email already in use')
      throw toError(error)
    }
    if (updated.length === 0) throw new NotFoundError('user')
  }

  async setPassword(
    userId: string,
    passwordHash: string,
    mustChangePassword: boolean,
  ): Promise<void> {
    const updated = await this.db
      .update(users)
      .set({ passwordHash, mustChangePassword })
      .where(eq(users.id, userId))
      .returning({ id: users.id })
    if (updated.length === 0) throw new NotFoundError('user')
  }
}
