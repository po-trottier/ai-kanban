import { type Tag, type TagRepository } from '@rivian-kanban/core'
import { asc, eq, sql } from 'drizzle-orm'
import { toError } from '../../errors.ts'
import { cardTags, tags } from '../../schema.pg.ts'
import { type PgDb } from '../database.ts'

export class PgTagRepository implements TagRepository {
  private readonly db: PgDb

  constructor(db: PgDb) {
    this.db = db
  }

  /**
   * Case-insensitive name lookup. sqlite served this with a plain `name = ?`
   * over a TEXT COLLATE NOCASE column; pg has no per-column collation here, so
   * the fold is made explicit as `lower(name) = lower(?)` — matched by the
   * `tags_name_ci_unique` expression index (schema.pg.ts), so it stays an
   * index lookup rather than a full scan. Same ASCII fold as the in-memory
   * fake's toLowerCase, so the semantics are unchanged.
   */
  async findByNameCi(name: string): Promise<Tag | null> {
    const rows = await this.db
      .select()
      .from(tags)
      .where(eq(sql`lower(${tags.name})`, name.toLowerCase()))
      .limit(1)
    return rows[0] ?? null
  }

  async insert(tag: Tag): Promise<void> {
    try {
      await this.db.insert(tags).values(tag)
    } catch (error) {
      throw toError(error)
    }
  }

  /**
   * The card's tags in stored (case-preserved) form. Ordered by name for
   * determinism — card_tags carries no ordering column.
   */
  async listByCard(cardId: number): Promise<Tag[]> {
    return this.db
      .select({ id: tags.id, name: tags.name })
      .from(cardTags)
      .innerJoin(tags, eq(cardTags.tagId, tags.id))
      .where(eq(cardTags.cardId, cardId))
      .orderBy(asc(tags.name))
  }

  /** Every known tag, name order (autocomplete). */
  async listAll(): Promise<Tag[]> {
    return this.db.select().from(tags).orderBy(asc(tags.name), asc(tags.id))
  }

  /** Full-replacement of the card_tags rows. */
  async setCardTags(cardId: number, tagIds: string[]): Promise<void> {
    try {
      await this.db.delete(cardTags).where(eq(cardTags.cardId, cardId))
      if (tagIds.length > 0) {
        await this.db.insert(cardTags).values(tagIds.map((tagId) => ({ cardId, tagId })))
      }
    } catch (error) {
      throw toError(error)
    }
  }
}
