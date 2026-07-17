import { type Tag, type TagRepository } from '@rivian-kanban/core'
import { asc, eq, sql } from 'drizzle-orm'
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { toError } from '../errors.ts'
import { cardTags, tags } from '../schema.ts'

export class SqliteTagRepository implements TagRepository {
  private readonly db: BetterSQLite3Database

  constructor(db: BetterSQLite3Database) {
    this.db = db
  }

  /**
   * Case-insensitive name lookup. Explicit lower() = lower() rather than
   * relying on the column's NOCASE collation, so the comparison is portable
   * and matches the in-memory fake's toLowerCase semantics (ASCII fold — the
   * NOCASE column collation is ASCII-only too).
   */
  findByNameCi(name: string): Promise<Tag | null> {
    const row = this.db
      .select()
      .from(tags)
      .where(sql`lower(${tags.name}) = lower(${name})`)
      .get()
    return Promise.resolve(row ?? null)
  }

  insert(tag: Tag): Promise<void> {
    try {
      this.db.insert(tags).values(tag).run()
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(toError(error))
    }
  }

  /**
   * The card's tags in stored (case-preserved) form. Ordered by name (NOCASE)
   * for determinism — card_tags carries no ordering column.
   */
  listByCard(cardId: string): Promise<Tag[]> {
    const rows = this.db
      .select({ id: tags.id, name: tags.name })
      .from(cardTags)
      .innerJoin(tags, eq(cardTags.tagId, tags.id))
      .where(eq(cardTags.cardId, cardId))
      .orderBy(asc(tags.name))
      .all()
    return Promise.resolve(rows)
  }

  /** Full-replacement of the card_tags rows. */
  setCardTags(cardId: string, tagIds: string[]): Promise<void> {
    try {
      this.db.delete(cardTags).where(eq(cardTags.cardId, cardId)).run()
      if (tagIds.length > 0) {
        this.db
          .insert(cardTags)
          .values(tagIds.map((tagId) => ({ cardId, tagId })))
          .run()
      }
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(toError(error))
    }
  }
}
