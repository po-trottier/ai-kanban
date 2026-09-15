import { ConflictError, NotFoundError, type Group, type GroupRepository } from '@rivian-kanban/core'
import { asc, eq } from 'drizzle-orm'
import { toError } from '../../errors.ts'
import { isPgUniqueViolation } from '../errors.ts'
import { groups } from '../../schema.pg.ts'
import { type PgDb } from '../database.ts'

/** Global user groups — pg twin of `repositories/group-repository.ts` (see its header comment). */
export class PgGroupRepository implements GroupRepository {
  private readonly db: PgDb

  constructor(db: PgDb) {
    this.db = db
  }

  async list(): Promise<Group[]> {
    return this.db.select().from(groups).orderBy(asc(groups.name), asc(groups.id))
  }

  async findById(id: string): Promise<Group | null> {
    const rows = await this.db.select().from(groups).where(eq(groups.id, id)).limit(1)
    return rows[0] ?? null
  }

  async insert(group: Group): Promise<void> {
    try {
      await this.db.insert(groups).values(group)
    } catch (error) {
      if (isPgUniqueViolation(error, ['groups_name_ci_unique'])) {
        throw new ConflictError('group name already exists')
      }
      throw toError(error)
    }
  }

  async update(group: Group): Promise<void> {
    let updated: { id: string }[]
    try {
      updated = await this.db
        .update(groups)
        .set(group)
        .where(eq(groups.id, group.id))
        .returning({ id: groups.id })
    } catch (error) {
      if (isPgUniqueViolation(error, ['groups_name_ci_unique'])) {
        throw new ConflictError('group name already exists')
      }
      throw toError(error)
    }
    if (updated.length === 0) throw new NotFoundError('group')
  }

  /** Hard-deletes the row; the caller (BoardService) has already verified it is unassigned. */
  async remove(id: string): Promise<void> {
    await this.db.delete(groups).where(eq(groups.id, id))
  }
}
