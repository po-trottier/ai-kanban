import { ConflictError, NotFoundError, type Group, type GroupRepository } from '@rivian-kanban/core'
import { asc, eq } from 'drizzle-orm'
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { isUniqueIndexViolation, toError } from '../errors.ts'
import { groups } from '../schema.ts'

/**
 * Global user groups (docs/superpowers/plans/2026-09-15-multiple-boards.md).
 * Not board-scoped: a group can gate several boards via their
 * `allowedGroupIds`. BoardService owns the duplicate-name check (under the
 * global default-board lock); `groups_name_ci_unique` is only the race
 * backstop, mapped here to ConflictError like every other DB-enforced
 * uniqueness backstop (service tokens, user emails).
 */
export class SqliteGroupRepository implements GroupRepository {
  private readonly db: BetterSQLite3Database

  constructor(db: BetterSQLite3Database) {
    this.db = db
  }

  list(): Promise<Group[]> {
    const rows = this.db.select().from(groups).orderBy(asc(groups.name), asc(groups.id)).all()
    return Promise.resolve(rows)
  }

  findById(id: string): Promise<Group | null> {
    const row = this.db.select().from(groups).where(eq(groups.id, id)).get()
    return Promise.resolve(row ?? null)
  }

  insert(group: Group): Promise<void> {
    try {
      this.db.insert(groups).values(group).run()
      return Promise.resolve()
    } catch (error) {
      if (isUniqueIndexViolation(error, 'groups_name_ci_unique')) {
        return Promise.reject(new ConflictError('group name already exists'))
      }
      return Promise.reject(toError(error))
    }
  }

  update(group: Group): Promise<void> {
    try {
      const result = this.db.update(groups).set(group).where(eq(groups.id, group.id)).run()
      if (result.changes === 0) return Promise.reject(new NotFoundError('group'))
      return Promise.resolve()
    } catch (error) {
      if (isUniqueIndexViolation(error, 'groups_name_ci_unique')) {
        return Promise.reject(new ConflictError('group name already exists'))
      }
      return Promise.reject(toError(error))
    }
  }

  /** Hard-deletes the row; the caller (BoardService) has already verified it is unassigned. */
  remove(id: string): Promise<void> {
    this.db.delete(groups).where(eq(groups.id, id)).run()
    return Promise.resolve()
  }
}
