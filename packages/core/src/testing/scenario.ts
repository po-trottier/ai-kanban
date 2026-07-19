import { generateKeyBetween } from 'fractional-indexing'
import { LANE_KEYS, type Role, type SeedLaneKey } from '../domain/constants.ts'
import { type Actor, type Card, type Lane, type User } from '../domain/entities.ts'
import { DEFAULT_POLICY_DOCUMENT, type PolicyDocument } from '../domain/policy.ts'
import { AttachmentService } from '../services/attachment-service.ts'
import { BoardQueryService } from '../services/board-query-service.ts'
import { CardRelationService } from '../services/relation-service.ts'
import { CardService } from '../services/card-service.ts'
import { CardWatchService } from '../services/watch-service.ts'
import { CommentService } from '../services/comment-service.ts'
import { NotificationService } from '../services/notification-service.ts'
import { PolicyService } from '../services/policy-service.ts'
import { cardWith, userWith } from './defaults.ts'
import {
  CapturingEventBus,
  CapturingNotifier,
  FixedClock,
  InMemoryBlobStore,
  SequentialIdGenerator,
} from './fakes.ts'
import { InMemoryDb } from './in-memory-db.ts'

/**
 * One fully-wired test world: fakes + services + the structural seed (board,
 * 7 lanes, users of every role, the active policy version). Every test file
 * creates fresh instances — no shared mutable fixtures (docs/dev/testing.md).
 */

/** Stable fixture ids, disjoint from SequentialIdGenerator's `00000000-…` range. */
export function fixtureId(n: number): string {
  return `10000000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`
}

export const SCENARIO_BOARD_ID = fixtureId(1)

/**
 * Distinct fixture-user handles. Roles collapsed to `user | admin`, so these
 * are just four different accounts: requester/technician are regular `user`s,
 * supervisor/admin are `admin`s — the names are kept so the ~dozens of tests
 * that reference `scenario.users.technician` etc. don't churn.
 */
export type FixtureUserKey = 'requester' | 'technician' | 'supervisor' | 'admin'
const FIXTURE_USERS: { key: FixtureUserKey; role: Role }[] = [
  { key: 'requester', role: 'user' },
  { key: 'technician', role: 'user' },
  { key: 'supervisor', role: 'admin' },
  { key: 'admin', role: 'admin' },
]

export interface ScenarioOptions {
  policy?: PolicyDocument
  /**
   * Leave `board_policies` empty to exercise missing-structural-seed behavior:
   * every policy consultation fails with NotFoundError (no silent fallback).
   */
  omitPolicyRecord?: boolean
  wipLimits?: Partial<Record<SeedLaneKey, number>>
  nowIso?: string
}

export interface Scenario {
  db: InMemoryDb
  clock: FixedClock
  ids: SequentialIdGenerator
  eventBus: CapturingEventBus
  notifier: CapturingNotifier
  blobStore: InMemoryBlobStore
  boardId: string
  lanes: Record<SeedLaneKey, Lane>
  users: Record<FixtureUserKey, User>
  systemUser: User
  actors: Record<FixtureUserKey, Actor> & {
    system: Actor
    mcpRead: Actor
    mcpReadWrite: Actor
    /** A Slack-surface actor resolved to the technician board user. */
    slack: Actor
  }
  cards: CardService
  comments: CommentService
  attachments: AttachmentService
  queries: BoardQueryService
  policies: PolicyService
  relations: CardRelationService
  watch: CardWatchService
  notifications: NotificationService
  /** Seeds a card directly into committed state, auto-positioned in its lane. */
  seedCard(overrides?: Partial<Card>): Card
}

export function createScenario(options: ScenarioOptions = {}): Scenario {
  const db = new InMemoryDb()
  const clock = new FixedClock(options.nowIso ?? '2026-07-16T12:00:00.000Z')
  const ids = new SequentialIdGenerator()
  const eventBus = new CapturingEventBus()
  const notifier = new CapturingNotifier()
  const blobStore = new InMemoryBlobStore()
  const boardId = SCENARIO_BOARD_ID
  const nowIso = clock.now().toISOString()

  const wipLimits = new Map(Object.entries(options.wipLimits ?? {}))
  const lanes = Object.fromEntries(
    LANE_KEYS.map((key, index) => {
      const lane: Lane = {
        id: fixtureId(10 + index),
        boardId,
        key,
        label: key,
        position: index,
        wipLimit: wipLimits.get(key) ?? null,
      }
      db.seedLane(lane)
      return [key, lane] as const
    }),
  ) as Record<SeedLaneKey, Lane>

  const users = Object.fromEntries(
    FIXTURE_USERS.map(({ key, role }, index) => {
      const user = userWith({
        id: fixtureId(20 + index),
        email: `${key}@example.com`,
        displayName: key,
        role,
        createdAt: nowIso,
      })
      db.seedUser(user)
      return [key, user] as const
    }),
  ) as Record<FixtureUserKey, User>
  const systemUser = userWith({
    id: fixtureId(29),
    email: 'system@example.com',
    displayName: 'Automation',
    role: 'admin',
    createdAt: nowIso,
  })
  db.seedUser(systemUser)

  if (options.omitPolicyRecord !== true) {
    db.seedPolicy({
      id: fixtureId(30),
      boardId,
      config: options.policy ?? DEFAULT_POLICY_DOCUMENT,
      createdBy: users.admin.id,
      createdAt: nowIso,
    })
  }

  const actorOf = (user: User): Actor => ({ kind: 'user', id: user.id, role: user.role })
  const actors: Scenario['actors'] = {
    requester: actorOf(users.requester),
    technician: actorOf(users.technician),
    supervisor: actorOf(users.supervisor),
    admin: actorOf(users.admin),
    system: { kind: 'system', id: systemUser.id, role: 'admin' },
    mcpRead: { kind: 'mcp', id: fixtureId(40), role: 'user', scope: 'read' },
    mcpReadWrite: { kind: 'mcp', id: fixtureId(41), role: 'user', scope: 'read_write' },
    slack: { kind: 'slack', id: users.technician.id, role: 'user' },
  }

  const shared = { uow: db, clock, ids, eventBus }
  const cards = new CardService({ ...shared, notifier, boardId, systemUserId: systemUser.id })
  const comments = new CommentService(shared)
  const attachments = new AttachmentService({ ...shared, blobStore })
  const queries = new BoardQueryService({ uow: db, clock, boardId })
  const policies = new PolicyService({ ...shared, boardId })
  const relations = new CardRelationService({ uow: db, clock, ids })
  const watch = new CardWatchService({ uow: db, clock })
  const notifications = new NotificationService({ uow: db, clock, ids })

  let seedCounter = 100
  const lastPositionByLane = new Map<string, string>()
  const seedCard = (overrides: Partial<Card> = {}): Card => {
    seedCounter += 1
    const laneId = overrides.laneId ?? lanes.intake.id
    const position =
      overrides.position ?? generateKeyBetween(lastPositionByLane.get(laneId) ?? null, null)
    lastPositionByLane.set(laneId, position)
    const card = cardWith({
      id: seedCounter,
      boardId,
      title: `Card ${seedCounter.toString()}`,
      reporterId: users.requester.id,
      createdAt: nowIso,
      ...overrides,
      laneId,
      position,
    })
    db.seedCard(card)
    return card
  }

  return {
    db,
    clock,
    ids,
    eventBus,
    notifier,
    blobStore,
    boardId,
    lanes,
    users,
    systemUser,
    actors,
    cards,
    comments,
    attachments,
    queries,
    policies,
    relations,
    watch,
    notifications,
    seedCard,
  }
}
