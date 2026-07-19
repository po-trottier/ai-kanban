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
} from '@rivian-kanban/core/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { structuralSeed } from './seed.ts'
import { insertUser, openTestDb, type TestDb } from './test/support.ts'

/**
 * The fake-vs-real drift net: the REAL core services running against the REAL
 * SQLite adapters, mirroring the flows the core unit suite proves against the
 * in-memory fakes (docs/dev/testing.md). No mocks anywhere — a real temp
 * database, real migrations, the real UnitOfWork transaction bridge.
 */

let db: TestDb
let boardId: string
let cardService: CardService
let commentService: CommentService
let queries: BoardQueryService
let notifier: CapturingNotifier
let technician: Actor
let supervisor: Actor

beforeAll(() => {
  db = openTestDb()
  const structural = structuralSeed(db.connection.db)
  boardId = structural.boardId
  const technicianUser = insertUser(db.connection, { role: 'user' })
  const supervisorUser = insertUser(db.connection, { role: 'admin' })
  technician = { kind: 'user', id: technicianUser.id, role: 'user' }
  supervisor = { kind: 'user', id: supervisorUser.id, role: 'admin' }

  const clock = new SystemClock()
  const ids = new Uuidv7IdGenerator()
  const eventBus = new CapturingEventBus()
  notifier = new CapturingNotifier()
  cardService = new CardService({
    uow: db.uow,
    clock,
    ids,
    eventBus,
    notifier,
    blobStore: new InMemoryBlobStore(),
    boardId,
    systemUserId: structural.systemUserId,
  })
  commentService = new CommentService({ uow: db.uow, clock, ids, eventBus })
  queries = new BoardQueryService({ uow: db.uow, clock, boardId })
})

afterAll(() => {
  db.cleanup()
})

async function laneKeyOf(card: Card): Promise<string> {
  const snapshot = await queries.boardSnapshot()
  return snapshot.lanes.find((entry) => entry.lane.id === card.laneId)?.lane.key ?? '<unknown lane>'
}

describe('card lifecycle against the real adapters', () => {
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
    expect(history.items.at(2)?.payload).toEqual({
      resolution: 'duplicate',
      fromLane: 'in_progress',
    })
    expect(cancelled.resolution).toBe('duplicate')
    expect(reopened).toMatchObject({ resolution: null, version: 4 })
    await expect(laneKeyOf(reopened)).resolves.toBe('ready')
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
    const resumed = await cardService.move(technician, created.id, {
      toLane: 'in_progress',
      expectedVersion: waiting.version,
    })

    expect(waiting).toMatchObject({ waitingReason: 'parts', expectedResumeAt: '2026-08-01' })
    expect(resumed).toMatchObject({ waitingReason: null, expectedResumeAt: null })
    const history = await queries.cardHistory(created.id, { type: 'card.status_changed' })
    expect(history.items.at(-1)?.payload).toMatchObject({ clearedWaiting: true })
  })

  it('two moves aiming at the same gap: the loser retries, then conflicts with current state', async () => {
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

    // Same stale neighbors → the same fractional key → UNIQUE backstop fires;
    // the in-transaction retry re-reads the same neighbors and collides again,
    // surfacing as a 409 carrying the loser's current (unchanged) state.
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
    const unchanged = (error as ConflictError).current
    await expect(laneKeyOf(unchanged ?? loser)).resolves.toBe('intake')
  })

  it('optimistic lock: a stale expectedVersion conflicts and changes nothing', async () => {
    const created = await cardService.create(technician, { title: 'Original title' })
    await cardService.update(technician, created.id, {
      title: 'First edit',
      expectedVersion: 1,
    })

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
    const history = await queries.cardHistory(created.id, { type: 'comment.added' })
    expect(history.items).toHaveLength(2)
    expect(history.items.at(1)?.payload).toMatchObject({ parentCommentId: parent.id })
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
