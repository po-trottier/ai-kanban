import {
  type CardRelation,
  type CardRelationRepository,
  type RelationType,
} from '@rivian-kanban/core'
import { and, desc, eq, or } from 'drizzle-orm'
import { cardRelations } from '../../schema.pg.ts'
import { type PgDb } from '../database.ts'

/**
 * Typed card-to-card relations (docs/architecture/card-relations.md). One
 * directed row per relation; `listByCard` returns every row touching the card
 * on either end (`from_card_id = ? OR to_card_id = ?`), newest-first.
 */
export class PgCardRelationRepository implements CardRelationRepository {
  private readonly db: PgDb

  constructor(db: PgDb) {
    this.db = db
  }

  async listByCard(cardId: number): Promise<CardRelation[]> {
    return this.db
      .select()
      .from(cardRelations)
      .where(or(eq(cardRelations.fromCardId, cardId), eq(cardRelations.toCardId, cardId)))
      .orderBy(desc(cardRelations.createdAt), desc(cardRelations.id))
  }

  async findById(id: string): Promise<CardRelation | null> {
    const rows = await this.db
      .select()
      .from(cardRelations)
      .where(eq(cardRelations.id, id))
      .limit(1)
    return rows[0] ?? null
  }

  async exists(fromCardId: number, toCardId: number, type: RelationType): Promise<boolean> {
    const rows = await this.db
      .select({ id: cardRelations.id })
      .from(cardRelations)
      .where(
        and(
          eq(cardRelations.fromCardId, fromCardId),
          eq(cardRelations.toCardId, toCardId),
          eq(cardRelations.type, type),
        ),
      )
      .limit(1)
    return rows.length > 0
  }

  async insert(relation: CardRelation): Promise<void> {
    await this.db.insert(cardRelations).values(relation)
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(cardRelations).where(eq(cardRelations.id, id))
  }
}
