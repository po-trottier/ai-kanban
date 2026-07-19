import { type Actor } from '../domain/entities.ts'
import { type UnitOfWork } from '../ports/repositories.ts'
import { type Clock } from '../ports/runtime.ts'
import { requireFound } from './internal.ts'

export interface CardWatchServiceDeps {
  uow: UnitOfWork
  clock: Clock
}

/**
 * Per-user-per-card WATCH subscriptions (docs/architecture/notifications.md).
 * Watching is who-gets-notified about a card. Reporters/assignees are
 * auto-watched by the card service, a mention auto-watches, and any user can
 * watch/unwatch any accessible card here. Both writes are idempotent (the
 * `(card, user)` row is unique), so the toggle is safe to re-fire.
 */
export class CardWatchService {
  private readonly deps: CardWatchServiceDeps

  constructor(deps: CardWatchServiceDeps) {
    this.deps = deps
  }

  /** Whether the acting user currently watches the card. */
  async isWatching(actor: Actor, cardId: number): Promise<boolean> {
    return this.deps.uow.read(async (tx) => {
      requireFound(await tx.cards.findById(cardId), 'card')
      return tx.cardWatchers.isWatching(cardId, actor.id)
    })
  }

  /** Start watching (idempotent). 404 if the card does not exist. */
  async watch(actor: Actor, cardId: number): Promise<void> {
    await this.deps.uow.run(async (tx) => {
      requireFound(await tx.cards.findById(cardId), 'card')
      await tx.cardWatchers.add(cardId, actor.id, this.deps.clock.now().toISOString())
    })
  }

  /** Stop watching (idempotent). 404 if the card does not exist. */
  async unwatch(actor: Actor, cardId: number): Promise<void> {
    await this.deps.uow.run(async (tx) => {
      requireFound(await tx.cards.findById(cardId), 'card')
      await tx.cardWatchers.remove(cardId, actor.id)
    })
  }
}
