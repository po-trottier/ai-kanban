import {
  BoardQueryService,
  CardService,
  CommentService,
  ConflictError,
  SystemClock,
  Uuidv7IdGenerator,
  type Actor,
  type Card,
} from '@rivian-kanban/core'
import {
  CapturingEventBus,
  CapturingNotifier,
  InMemoryBlobStore,
  userWith,
} from '@rivian-kanban/core/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openPgliteConnection, type PgConnection } from './connection.ts'
import { structuralSeedPg } from './seed.ts'
import { PostgresUnitOfWork } from './unit-of-work.ts'

/**
 * The Postgres drift net (ADR-020): the REAL core services running against the
 * REAL Postgres adapters via PGlite (an in-process WASM Postgres — real pg SQL,
 * no server or Docker), mirroring `db/src/services.integration.test.ts` which
 * proves the same flows against SQLite. If these pass, the pg repositories, the
 * pg unit of work, the `COLLATE "C"` fractional ordering, and the pg
 * DuplicatePositionError mapping all match the SQLite behavior the app relies on.
 */

let conn: PgConnection
let boardId: string
let cardService: CardService
let commentService: CommentService
let queries: BoardQueryService
let notifier: CapturingNotifier
let technician: Actor
let supervisor: Actor

const ids = new Uuidv7IdGenerator()

beforeAll(async () => {
  conn = await openPgliteConnection()
  const structural = await structuralSeedPg(conn.db)
  boardId = structural.boardId
  const uow = new PostgresUnitOfWork(conn.db)

  const technicianId = ids.newId()
  const supervisorId = ids.newId()
  const nowIso = new Date().toISOString()
  await uow.run((tx) =>
    tx.userAccounts.insert(
      userWith({
        id: technicianId,
        email: 'tech@pg.test',
        displayName: 'Technician',
        role: 'user',
        createdAt: nowIso,
      }),
      'hash',
    ),
  )
  await uow.run((tx) =>
    tx.userAccounts.insert(
      userWith({
        id: supervisorId,
        email: 'super@pg.test',
        displayName: 'Supervisor',
        role: 'admin',
        createdAt: nowIso,
      }),
      'hash',
    ),
  )
  technician = { kind: 'user', id: technicianId, role: 'user' }
  supervisor = { kind: 'user', id: supervisorId, role: 'admin' }

  const clock = new SystemClock()
  const eventBus = new CapturingEventBus()
  notifier = new CapturingNotifier()
  cardService = new CardService({
    uow,
    clock,
    ids,
    eventBus,
    notifier,
    blobStore: new InMemoryBlobStore(),
    boardId,
    systemUserId: structural.systemUserId,
  })
  commentService = new CommentService({ uow, clock, ids, eventBus })
  queries = new BoardQueryService({ uow, clock, boardId })
})

afterAll(async () => {
  await conn.close()
})

async function laneKeyOf(card: Card): Promise<string> {
  const snapshot = await queries.boardSnapshot()
  return snapshot.lanes.find((entry) => entry.lane.id === card.laneId)?.lane.key ?? '<unknown lane>'
}

describe('card lifecycle against the real Postgres adapters', () => {
  it('create → move → cancel → reopen leaves the full audit trail in order', async () => {
    const created = await cardService.create(technician, {
      title: 'Grease the freight elevator rails',
      tags: ['Elevator', 'safety'],
    })
    const moved = await cardService.move(technician, created.id, {
      toLane: 'in_progress',
      expectedVersion: 1,
    })
    const cancelled = await cardService.cancel(supervisor, created.id, {
      resolution: 'duplicate',
      expectedVersion: moved.version,
    })
    const reopened = await cardService.reopen(supervisor, created.id, {
      expectedVersion: cancelled.version,
    })

    const history = await queries.cardHistory(created.id)
    expect(history.items.map((event) => event.eventType)).toEqual([
      'card.created',
      'card.status_changed',
      'card.cancelled',
      'card.reopened',
    ])
    expect(history.items.at(0)?.payload).toMatchObject({
      snapshot: { title: 'Grease the freight elevator rails', tags: ['Elevator', 'safety'] },
    })
    expect(cancelled.resolution).toBe('duplicate')
    expect(reopened).toMatchObject({ resolution: null, version: 4 })
    // Reopen restores the card to the lane it was cancelled from (in_progress),
    // not a blanket ready.
    await expect(laneKeyOf(reopened)).resolves.toBe('in_progress')
  })

  it('non-cancel entry into done completes the card and notifies the requester', async () => {
    const created = await cardService.create(technician, { title: 'Swap lobby air filter' })

    const done = await cardService.move(supervisor, created.id, {
      toLane: 'done',
      expectedVersion: 1,
    })

    expect(done.resolution).toBe('completed')
    expect(notifier.completedCards.map((card) => card.id)).toContain(created.id)
  })

  it('entering the waiting lane demands reason + resume date and clears them on exit', async () => {
    const created = await cardService.create(technician, { title: 'Wait on compressor part' })

    const missingFields = cardService.move(technician, created.id, {
      toLane: 'waiting_parts_vendor',
      expectedVersion: 1,
    })
    await expect(missingFields).rejects.toMatchObject({ name: 'ZodError' })

    const waiting = await cardService.move(technician, created.id, {
      toLane: 'waiting_parts_vendor',
      waitingReason: 'parts',
      expectedResumeAt: '2026-08-01',
      expectedVersion: 1,
    })
    // Resume into `ready` (not `in_progress`): this file shares one DB across
    // tests, and a neighbor-less move computes `keyBetween(null, null)`, so the
    // target lane must be empty to avoid colliding with a card an earlier test
    // left behind. Exiting the waiting lane clears its fields regardless of where.
    const resumed = await cardService.move(technician, created.id, {
      toLane: 'ready',
      expectedVersion: waiting.version,
    })

    expect(waiting).toMatchObject({ waitingReason: 'parts', expectedResumeAt: '2026-08-01' })
    expect(resumed).toMatchObject({ waitingReason: null, expectedResumeAt: null })
  })

  it('the UNIQUE(lane,position) backstop maps to a ConflictError (DuplicatePositionError path)', async () => {
    const anchorA = await cardService.create(technician, { title: 'Anchor A' })
    const anchorB = await cardService.create(technician, { title: 'Anchor B' })
    const winner = await cardService.create(technician, { title: 'Winner' })
    const loser = await cardService.create(technician, { title: 'Loser' })
    await cardService.move(technician, anchorA.id, { toLane: 'review', expectedVersion: 1 })
    await cardService.move(technician, anchorB.id, {
      toLane: 'review',
      prevCardId: anchorA.id,
      expectedVersion: 1,
    })
    await cardService.move(technician, winner.id, {
      toLane: 'review',
      prevCardId: anchorA.id,
      nextCardId: anchorB.id,
      expectedVersion: 1,
    })

    const error: unknown = await cardService
      .move(technician, loser.id, {
        toLane: 'review',
        prevCardId: anchorA.id,
        nextCardId: anchorB.id,
        expectedVersion: 1,
      })
      .then(
        () => null,
        (reason: unknown) => reason,
      )

    expect(error).toBeInstanceOf(ConflictError)
    expect((error as ConflictError).current).toMatchObject({ id: loser.id, version: 1 })
  })

  it('optimistic lock: a stale expectedVersion conflicts and changes nothing', async () => {
    const created = await cardService.create(technician, { title: 'Original title' })
    await cardService.update(technician, created.id, { title: 'First edit', expectedVersion: 1 })

    const error: unknown = await cardService
      .update(supervisor, created.id, { title: 'Second edit', expectedVersion: 1 })
      .then(
        () => null,
        (reason: unknown) => reason,
      )

    expect(error).toBeInstanceOf(ConflictError)
    expect((error as ConflictError).current).toMatchObject({ title: 'First edit', version: 2 })
    const detail = await queries.cardDetail(created.id)
    expect(detail.card.title).toBe('First edit')
  })

  it('threaded comments flow through the real repositories with audit events', async () => {
    const created = await cardService.create(technician, { title: 'Card with a thread' })

    const parent = await commentService.add(technician, created.id, { body: 'Parts ordered.' })
    const reply = await commentService.add(supervisor, created.id, {
      body: 'ETA?',
      parentCommentId: parent.id,
    })

    expect(reply.parentCommentId).toBe(parent.id)
    const thread = await commentService.listForCard(created.id)
    expect(thread.map((comment) => comment.id)).toEqual([parent.id, reply.id])
  })

  it('boardSnapshot reflects lanes in order with cards positioned by fractional key', async () => {
    const snapshot = await queries.boardSnapshot()

    expect(snapshot.lanes.map((entry) => entry.lane.key)).toEqual([
      'intake',
      'waiting_approval',
      'ready',
      'in_progress',
      'waiting_parts_vendor',
      'review',
      'done',
    ])
    const review = snapshot.lanes.find((entry) => entry.lane.key === 'review')
    const positions = review?.cards.map((card) => card.position) ?? []
    expect(positions).toEqual([...positions].sort())
  })
})
