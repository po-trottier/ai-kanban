import {
  cardEventSchema,
  type Card,
  type CardEvent,
  type Clock,
  type IdGenerator,
  type UnitOfWork,
} from '@rivian-kanban/core'
import { type AdapterLogger } from '../types.ts'

/**
 * Daily done-archival job (docs/product/workflow.md#archival): done cards
 * (completed and cancelled) archive 90 days after entering Done. "Entered
 * Done" is the newest matching audit event — `card.status_changed` into
 * `done` or `card.cancelled` — falling back to `updatedAt` for rows that
 * carry no trail (fixtures, imports). Each archival appends a
 * `card.archived` event as the system actor in the same transaction
 * (ADR-005). Idempotent: the candidate query excludes archived cards in SQL
 * (the ever-growing archive never re-enters the nightly working set), so a
 * missed night simply catches up on the next run.
 */

const ARCHIVE_AFTER_DAYS = 90

export interface DoneArchivalDeps {
  uow: UnitOfWork
  clock: Clock
  ids: IdGenerator
  logger: AdapterLogger
  boardId: string
}

/** When the card last entered Done, from its audit trail. */
function enteredDoneAt(card: Card, events: CardEvent[]): string {
  const entries = events.filter(
    (event) =>
      event.eventType === 'card.cancelled' ||
      (event.eventType === 'card.status_changed' && event.payload.toLane === 'done'),
  )
  return entries.at(-1)?.createdAt ?? card.updatedAt
}

export async function runDoneArchival(deps: DoneArchivalDeps): Promise<{ archived: number }> {
  const now = deps.clock.now()
  const nowIso = now.toISOString()
  const cutoffIso = new Date(now.getTime() - ARCHIVE_AFTER_DAYS * 86_400_000).toISOString()

  const archived = await deps.uow.run(async (tx) => {
    const done = await tx.lanes.findByKey(deps.boardId, 'done')
    if (done === null) return 0
    // query() excludes archived rows by default — the scan stays proportional
    // to the LIVE done lane, not the unbounded archive history.
    const candidates = await tx.cards.query({ laneId: done.id })
    let count = 0
    for (const card of candidates) {
      const trail = await tx.events.listByCard(card.id, {
        types: ['card.status_changed', 'card.cancelled'],
      })
      if (enteredDoneAt(card, trail) > cutoffIso) continue

      await tx.cards.update({
        ...card,
        archivedAt: nowIso,
        version: card.version + 1,
        updatedAt: nowIso,
      })
      await tx.events.append(
        cardEventSchema.parse({
          id: deps.ids.newId(),
          cardId: card.id,
          actorId: null,
          actorKind: 'system',
          createdAt: nowIso,
          eventType: 'card.archived',
          payload: {},
        }),
      )
      count += 1
    }
    return count
  })

  if (archived > 0) deps.logger.info({ archived }, 'done cards archived')
  return { archived }
}
