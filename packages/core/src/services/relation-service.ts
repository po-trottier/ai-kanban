import {
  createCardRelationInputSchema,
  isSymmetricRelation,
  type CardRelation,
  type CardRelationView,
  type RelationDirection,
} from '../domain/relations.ts'
import { ConflictError, NotFoundError } from '../domain/errors.ts'
import { type TransactionContext, type UnitOfWork } from '../ports/repositories.ts'
import { type Clock, type IdGenerator } from '../ports/runtime.ts'
import { requireFound } from './internal.ts'

export interface CardRelationServiceDeps {
  uow: UnitOfWork
  clock: Clock
  ids: IdGenerator
}

/**
 * Typed card-to-card relations (docs/architecture/card-relations.md). Stored as
 * ONE directed row (`from → to` + type); a card's relations are every row
 * touching it, each resolved to the OTHER card plus the direction so the client
 * can label it. Managing relations is collaborative card metadata available to
 * any authenticated user (like adding a comment) — no RBAC gate, and no audit
 * event (a link carries no lifecycle weight). Cards are never hard-deleted, so a
 * relation never dangles; a defensive skip drops any that somehow would.
 */
export class CardRelationService {
  private readonly deps: CardRelationServiceDeps

  constructor(deps: CardRelationServiceDeps) {
    this.deps = deps
  }

  /** The card's relations, each resolved to the other card + the viewing direction. */
  async list(cardId: number): Promise<CardRelationView[]> {
    return this.deps.uow.read(async (tx) => {
      requireFound(await tx.cards.findById(cardId), 'card')
      const relations = await tx.cardRelations.listByCard(cardId)
      const views: CardRelationView[] = []
      for (const relation of relations) {
        const view = await this.toView(tx, cardId, relation)
        if (view !== null) views.push(view)
      }
      return views
    })
  }

  /**
   * Links the route card (`from`) to `toCardId`. Rejects a self-link and a
   * duplicate (409); a missing target card is a 404. For a symmetric type the
   * reverse row counts as the same relation, so `A relates B` blocks `B relates A`.
   */
  async create(cardId: number, rawInput: unknown): Promise<CardRelationView> {
    const input = createCardRelationInputSchema.parse(rawInput)
    if (input.toCardId === cardId) {
      throw new ConflictError('a card cannot be related to itself')
    }
    return this.deps.uow.run(async (tx) => {
      const from = requireFound(await tx.cards.findById(cardId), 'card')
      const to = requireFound(await tx.cards.findById(input.toCardId), 'card')
      const duplicate =
        (await tx.cardRelations.exists(from.id, to.id, input.type)) ||
        (isSymmetricRelation(input.type) &&
          (await tx.cardRelations.exists(to.id, from.id, input.type)))
      if (duplicate) throw new ConflictError('that relation already exists')

      const relation: CardRelation = {
        id: this.deps.ids.newId(),
        fromCardId: from.id,
        toCardId: to.id,
        type: input.type,
        createdAt: this.deps.clock.now().toISOString(),
      }
      await tx.cardRelations.insert(relation)
      // The creating card is always the `from`, so it views the relation outgoing.
      return {
        id: relation.id,
        type: relation.type,
        direction: 'outgoing',
        card: { id: to.id, title: to.title },
      }
    })
  }

  /** Removes a relation — scoped to one that actually touches `cardId` (else 404). */
  async delete(cardId: number, relationId: string): Promise<void> {
    await this.deps.uow.run(async (tx) => {
      const relation = requireFound(await tx.cardRelations.findById(relationId), 'relation')
      if (relation.fromCardId !== cardId && relation.toCardId !== cardId) {
        // Not this card's relation — indistinguishable from missing.
        throw new NotFoundError('relation')
      }
      await tx.cardRelations.delete(relationId)
    })
  }

  /** Resolves a stored row into the viewing card's perspective (null if the other card vanished). */
  private async toView(
    tx: TransactionContext,
    cardId: number,
    relation: CardRelation,
  ): Promise<CardRelationView | null> {
    const direction: RelationDirection = relation.fromCardId === cardId ? 'outgoing' : 'incoming'
    const otherId = direction === 'outgoing' ? relation.toCardId : relation.fromCardId
    const other = await tx.cards.findById(otherId)
    if (other === null) return null
    return {
      id: relation.id,
      type: relation.type,
      direction,
      card: { id: other.id, title: other.title },
    }
  }
}
