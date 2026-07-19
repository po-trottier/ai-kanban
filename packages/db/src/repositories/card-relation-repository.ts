import {
  type CardRelation,
  type CardRelationRepository,
  type RelationType,
} from '@rivian-kanban/core'
import { and, desc, eq, or } from 'drizzle-orm'
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { cardRelations } from '../schema.ts'

/**
 * Typed card-to-card relations (docs/architecture/card-relations.md). One
 * directed row per relation; `listByCard` returns every row touching the card
 * on either end (`from_card_id = ? OR to_card_id = ?`), newest-first.
 */
export class SqliteCardRelationRepository implements CardRelationRepository {
  private readonly db: BetterSQLite3Database

  constructor(db: BetterSQLite3Database) {
    this.db = db
  }

  listByCard(cardId: number): Promise<CardRelation[]> {
    const rows = this.db
      .select()
      .from(cardRelations)
      .where(or(eq(cardRelations.fromCardId, cardId), eq(cardRelations.toCardId, cardId)))
      .orderBy(desc(cardRelations.createdAt), desc(cardRelations.id))
      .all()
    return Promise.resolve(rows)
  }

  findById(id: string): Promise<CardRelation | null> {
    const row = this.db.select().from(cardRelations).where(eq(cardRelations.id, id)).get()
    return Promise.resolve(row ?? null)
  }

  exists(fromCardId: number, toCardId: number, type: RelationType): Promise<boolean> {
    const row = this.db
      .select({ id: cardRelations.id })
      .from(cardRelations)
      .where(
        and(
          eq(cardRelations.fromCardId, fromCardId),
          eq(cardRelations.toCardId, toCardId),
          eq(cardRelations.type, type),
        ),
      )
      .get()
    return Promise.resolve(row !== undefined)
  }

  insert(relation: CardRelation): Promise<void> {
    this.db.insert(cardRelations).values(relation).run()
    return Promise.resolve()
  }

  delete(id: string): Promise<void> {
    this.db.delete(cardRelations).where(eq(cardRelations.id, id)).run()
    return Promise.resolve()
  }
}
