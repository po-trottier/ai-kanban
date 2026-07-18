import { type Tag, type TagRepository } from '@rivian-kanban/core'
import { asc, eq } from 'drizzle-orm'
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { toError } from '../errors.ts'
import { cardTags, tags } from '../schema.ts'

export class SqliteTagRepository implements TagRepository {
  private readonly db: BetterSQLite3Database

  constructor(db: BetterSQLite3Database) {
    this.db = db
  }

  /**
   * Case-insensitive name lookup. A plain `name = ?` comparison: the column
   * is declared TEXT COLLATE NOCASE (schema.ts), so the comparison is
   * case-insensitive AND served by the UNIQUE index — a `lower() = lower()`
   * expression would force a full tags scan inside every card-create/update
   * write transaction (tags grow for the product's lifetime). NOCASE and the
   * in-memory fake's toLowerCase share the same ASCII-only fold, so the
   * semantics are unchanged.
   */
  findByNameCi(name: string): Promise<Tag | null> {
    const row = this.db.select().from(tags).where(eq(tags.name, name)).get()
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
  listByCard(cardId: number): Promise<Tag[]> {
    const rows = this.db
      .select({ id: tags.id, name: tags.name })
      .from(cardTags)
      .innerJoin(tags, eq(cardTags.tagId, tags.id))
      .where(eq(cardTags.cardId, cardId))
      .orderBy(asc(tags.name))
      .all()
    return Promise.resolve(rows)
  }

  /** Every known tag, name order (autocomplete). */
  listAll(): Promise<Tag[]> {
    const rows = this.db.select().from(tags).orderBy(asc(tags.name), asc(tags.id)).all()
    return Promise.resolve(rows)
  }

  /** Full-replacement of the card_tags rows. */
  setCardTags(cardId: number, tagIds: string[]): Promise<void> {
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
