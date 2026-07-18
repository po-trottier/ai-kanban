import {
  cardEventSchema,
  DEFAULT_POLICY_DOCUMENT,
  DEFAULT_TIMEZONE,
  ROLES,
  Uuidv7IdGenerator,
  type Card,
  type LaneKey,
  type Role,
  type User,
} from '@rivian-kanban/core'
// The demo dataset IS fixture data (docs/dev/testing.md#fixtures): it shares
// the canonical neutral-entity defaults with every test harness.
import { cardWith, commentWith, userWith } from '@rivian-kanban/core/testing'
import { and, eq } from 'drizzle-orm'
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import {
  attachments,
  boardPolicies,
  boards,
  cards,
  cardEvents,
  cardTags,
  comments,
  lanes,
  locations,
  tags,
  users,
} from './schema.ts'

/**
 * Seeding (data-model.md#seeding, deployment.md#bootstrap):
 * - `structuralSeed` — idempotent, every boot, all environments.
 * - `demoSeed` — the canonical fixture dataset; refused in production mode.
 */

const ids = new Uuidv7IdGenerator()

export const SYSTEM_USER_EMAIL = 'system@rivian-kanban.local'

/**
 * NOT a hash — a sentinel that can never verify, so seeded identities cannot
 * log in until a real password is set. Real argon2id hashing is a server-
 * package concern (native module + tuning); the auth task replaces demo-user
 * placeholders with printed one-time credentials at boot.
 */
export const PLACEHOLDER_PASSWORD_HASH = '!placeholder:not-a-valid-argon2id-hash!'

/** The 7 seeded lanes in board order, labels per docs/product/workflow.md. */
const LANE_SEEDS: readonly { key: LaneKey; label: string; wipLimit: number | null }[] = [
  { key: 'intake', label: 'Intake', wipLimit: null },
  { key: 'waiting_approval', label: 'Waiting for Approval', wipLimit: null },
  { key: 'ready', label: 'Ready', wipLimit: null },
  { key: 'in_progress', label: 'In Progress', wipLimit: 5 },
  { key: 'waiting_parts_vendor', label: 'Waiting on Parts / Vendor', wipLimit: 8 },
  { key: 'review', label: 'Review', wipLimit: 5 },
  { key: 'done', label: 'Done', wipLimit: null },
]

export interface StructuralSeedResult {
  boardId: string
  systemUserId: string
}

/**
 * Board, 7 lanes (seeded WIP limits), the default permissive policy document,
 * and the `system` user. Idempotent by natural keys — safe to run on every
 * boot; never overwrites existing rows (labels and WIP limits stay
 * admin-editable). Inserts NO locations: a fresh/production database starts
 * with an empty locations table so the first-boot setup step (and production)
 * are never pre-populated — the sample tree is demo-only (see demoSeed).
 */
export function structuralSeed(db: BetterSQLite3Database): StructuralSeedResult {
  return db.transaction((tx) => {
    const now = new Date().toISOString()

    let board = tx.select().from(boards).get()
    if (board === undefined) {
      board = { id: ids.newId(), name: 'Facilities', createdAt: now }
      tx.insert(boards).values(board).run()
    }

    let system = tx.select().from(users).where(eq(users.email, SYSTEM_USER_EMAIL)).get()
    if (system === undefined) {
      system = {
        id: ids.newId(),
        email: SYSTEM_USER_EMAIL,
        displayName: 'Automation',
        role: 'admin',
        passwordHash: PLACEHOLDER_PASSWORD_HASH,
        mustChangePassword: false,
        slackUserId: null,
        isActive: true,
        timezone: DEFAULT_TIMEZONE,
        createdAt: now,
      }
      tx.insert(users).values(system).run()
    }

    LANE_SEEDS.forEach((seed, index) => {
      const existing = tx
        .select()
        .from(lanes)
        .where(and(eq(lanes.boardId, board.id), eq(lanes.key, seed.key)))
        .get()
      if (existing === undefined) {
        tx.insert(lanes)
          .values({
            id: ids.newId(),
            boardId: board.id,
            key: seed.key,
            label: seed.label,
            position: index,
            wipLimit: seed.wipLimit,
          })
          .run()
      }
    })

    const policy = tx
      .select({ id: boardPolicies.id })
      .from(boardPolicies)
      .where(eq(boardPolicies.boardId, board.id))
      .limit(1)
      .get()
    if (policy === undefined) {
      tx.insert(boardPolicies)
        .values({
          id: ids.newId(),
          boardId: board.id,
          config: DEFAULT_POLICY_DOCUMENT,
          createdBy: system.id,
          createdAt: now,
        })
        .run()
    }

    return { boardId: board.id, systemUserId: system.id }
  })
}

export function demoUserEmail(role: Role): string {
  return `${role}@demo.rivian-kanban.local`
}

export interface DemoSeedResult {
  /** False when the demo dataset already existed (idempotent re-run). */
  seeded: boolean
  userEmails: string[]
  cardCount: number
}

/** ISO date (`YYYY-MM-DD`) `days` from now — overdue/future resume fixtures. */
function dateFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

/**
 * The base-62 digit alphabet fractional-indexing uses. Append-order seed
 * positions must index into it: naive `a${index}` breaks past index 9 ('a10'
 * sorts between 'a1' and 'a2' and is not a key the library generates, which
 * can make generateKeyBetween throw on the first drag next to it).
 */
const POSITION_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

function appendPosition(index: number): string {
  const digit = POSITION_DIGITS.charAt(index)
  if (digit === '') {
    throw new Error(
      `demo seed supports at most ${POSITION_DIGITS.length.toString()} cards per lane (got index ${index.toString()})`,
    )
  }
  return `a${digit}`
}

/**
 * The canonical demo/fixture dataset (docs/dev/testing.md#fixtures): users of
 * every role, tags, and cards in every lane — including blocked,
 * overdue-waiting, cancelled, and archived examples — each with its audit
 * events. Requires `structuralSeed` first. Refused outright in production
 * mode; idempotent otherwise (skips when demo users already exist).
 */
export function demoSeed(db: BetterSQLite3Database): DemoSeedResult {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('demo seed is refused in production mode (deployment.md#bootstrap)')
  }
  return db.transaction((tx) => {
    const board = tx.select().from(boards).get()
    if (board === undefined) throw new Error('structural seed must run before the demo seed')
    const laneRows = tx.select().from(lanes).where(eq(lanes.boardId, board.id)).all()
    const laneOf = (key: LaneKey) => {
      const lane = laneRows.find((row) => row.key === key)
      if (lane === undefined) throw new Error(`structural seed missing lane ${key}`)
      return lane
    }

    const userEmails = ROLES.map((role) => demoUserEmail(role))
    const already = tx
      .select()
      .from(users)
      .where(eq(users.email, demoUserEmail('admin')))
      .get()
    if (already !== undefined) return { seeded: false, userEmails, cardCount: 0 }

    const nowMs = Date.now()
    const demoUsers = Object.fromEntries(
      ROLES.map((role) => {
        const user = userWith({
          id: ids.newId(),
          email: demoUserEmail(role),
          displayName: `Demo ${role.charAt(0).toUpperCase()}${role.slice(1)}`,
          role,
          createdAt: new Date(nowMs - 30 * 86_400_000).toISOString(),
        })
        tx.insert(users)
          .values({ ...user, passwordHash: PLACEHOLDER_PASSWORD_HASH })
          .run()
        return [role, user] as const
      }),
    ) as Record<Role, User>

    // Sample location tree (buildings → floors → rooms) is demo-only fixture
    // data: production and first-boot setup start empty (BUG 1). Seeded near
    // the top so the located demo cards below can reference a real room.
    const building = (name: string): string => {
      const id = ids.newId()
      tx.insert(locations).values({ id, parentId: null, kind: 'building', name }).run()
      return id
    }
    const floor = (parentId: string, name: string): string => {
      const id = ids.newId()
      tx.insert(locations).values({ id, parentId, kind: 'floor', name }).run()
      return id
    }
    const room = (parentId: string, name: string): string => {
      const id = ids.newId()
      tx.insert(locations).values({ id, parentId, kind: 'room', name }).run()
      return id
    }
    const buildingA = building('Building A')
    const floorA1 = floor(buildingA, 'Floor 1')
    // The canonical sample room every located demo card points at (`sampleRoom`).
    const sampleRoomId = room(floorA1, 'Room 101')
    room(floorA1, 'Room 102')
    const floorA2 = floor(buildingA, 'Floor 2')
    room(floorA2, 'Room 201')
    const buildingB = building('Building B')
    const floorB1 = floor(buildingB, 'Floor 1')
    room(floorB1, 'Boiler Room')

    const tagIdsByName = new Map<string, string>()
    for (const name of ['HVAC', 'plumbing', 'electrical']) {
      const id = ids.newId()
      tx.insert(tags).values({ id, name }).run()
      tagIdsByName.set(name, id)
    }

    const sampleRoom = tx.select().from(locations).where(eq(locations.id, sampleRoomId)).get()

    /** Audit-event helper: validates against the canonical schema (ADR-005). */
    const appendEvent = (raw: unknown): void => {
      tx.insert(cardEvents).values(cardEventSchema.parse(raw)).run()
    }

    const positionCounters = new Map<string, number>()
    let cardCount = 0
    const insertCard = (
      overrides: Partial<Card> & Pick<Card, 'laneId' | 'title'>,
      tagNames: string[] = [],
    ): Card => {
      cardCount += 1
      // Cards get staggered createdAt values (oldest first) so newest-first
      // pagination looks natural in dev; positions are appended per lane.
      const createdAt = new Date(nowMs - (7 * 24 - cardCount) * 3_600_000).toISOString()
      const positionIndex = positionCounters.get(overrides.laneId) ?? 0
      positionCounters.set(overrides.laneId, positionIndex + 1)
      const card = cardWith({
        id: ids.newId(),
        boardId: board.id,
        number: cardCount,
        position: appendPosition(positionIndex),
        reporterId: demoUsers.requester.id,
        createdAt,
        ...overrides,
      })
      tx.insert(cards).values(card).run()
      for (const name of tagNames) {
        const tagId = tagIdsByName.get(name)
        if (tagId !== undefined) tx.insert(cardTags).values({ cardId: card.id, tagId }).run()
      }
      appendEvent({
        id: ids.newId(),
        cardId: card.id,
        actorId: card.reporterId,
        actorKind: 'user',
        eventType: 'card.created',
        payload: { snapshot: { ...card, tags: tagNames } },
        createdAt: card.createdAt,
      })
      return card
    }

    insertCard({ laneId: laneOf('intake').id, title: 'Flickering lights in stairwell B' }, [
      'electrical',
    ])
    insertCard({
      laneId: laneOf('intake').id,
      title: 'Door badge reader intermittently failing',
      priority: 'P1',
      origin: 'slack',
      slackChannelId: 'C0DEMO',
      slackThreadTs: '1752600000.000100',
      slackPermalink: 'https://example.slack.com/archives/C0DEMO/p1752600000000100',
    })
    insertCard({
      laneId: laneOf('waiting_approval').id,
      title: 'Replace break-room refrigerator',
      estimateMinutes: 240,
    })
    const readyCard = insertCard(
      {
        laneId: laneOf('ready').id,
        title: 'Quarterly HVAC filter replacement',
        priority: 'P1',
        assigneeId: demoUsers.technician.id,
        estimateMinutes: 480,
        locationId: sampleRoom?.id ?? null,
      },
      ['HVAC'],
    )
    const inProgressCard = insertCard({
      laneId: laneOf('in_progress').id,
      title: 'Repair loading-dock leveler',
      priority: 'P0',
      assigneeId: demoUsers.technician.id,
      estimateMinutes: 120,
      // In progress for ~90 minutes → a partway work burn-down bar on the card.
      workStartedAt: new Date(nowMs - 90 * 60_000).toISOString(),
    })
    const blockedReason = 'Room occupied until the audit wraps up'
    const blockedAt = new Date(nowMs - 2 * 86_400_000).toISOString()
    const blockedCard = insertCard({
      laneId: laneOf('in_progress').id,
      title: 'Patch drywall in Room 101',
      blocked: true,
      blockedReason,
      blockedAt,
      locationId: sampleRoom?.id ?? null,
    })
    appendEvent({
      id: ids.newId(),
      cardId: blockedCard.id,
      actorId: demoUsers.technician.id,
      actorKind: 'user',
      eventType: 'card.blocked',
      payload: { reason: blockedReason },
      createdAt: blockedAt,
    })
    insertCard({
      laneId: laneOf('waiting_parts_vendor').id,
      title: 'Replace rooftop exhaust fan motor',
      priority: 'P1',
      waitingReason: 'parts',
      expectedResumeAt: dateFromNow(14),
    })
    insertCard({
      laneId: laneOf('waiting_parts_vendor').id,
      title: 'Boiler recalibration by vendor',
      priority: 'P1',
      waitingReason: 'vendor',
      // Already past its expected resume date — the overdue fixture.
      expectedResumeAt: dateFromNow(-7),
    })
    insertCard({
      laneId: laneOf('review').id,
      title: 'Re-lamp parking lot light poles',
      assigneeId: demoUsers.technician.id,
    })
    insertCard({
      laneId: laneOf('done').id,
      title: 'Unclog sink in second-floor kitchen',
      resolution: 'completed',
      assigneeId: demoUsers.technician.id,
    })
    const cancelledCard = insertCard({
      laneId: laneOf('done').id,
      title: 'Repaint east corridor (superseded by renovation)',
      resolution: 'cancelled',
    })
    appendEvent({
      id: ids.newId(),
      cardId: cancelledCard.id,
      actorId: demoUsers.supervisor.id,
      actorKind: 'user',
      eventType: 'card.cancelled',
      payload: { resolution: 'cancelled', fromLane: 'ready' },
      createdAt: cancelledCard.updatedAt,
    })
    insertCard({
      laneId: laneOf('done').id,
      title: 'Annual fire extinguisher inspection',
      resolution: 'completed',
      archivedAt: new Date(nowMs - 10 * 86_400_000).toISOString(),
    })

    const parentComment = commentWith({
      id: ids.newId(),
      cardId: inProgressCard.id,
      authorId: demoUsers.requester.id,
      body: 'Any update? Deliveries are backing up at the dock.',
      createdAt: new Date(nowMs - 3 * 3_600_000).toISOString(),
    })
    tx.insert(comments).values(parentComment).run()
    appendEvent({
      id: ids.newId(),
      cardId: inProgressCard.id,
      actorId: parentComment.authorId,
      actorKind: 'user',
      eventType: 'comment.added',
      payload: { commentId: parentComment.id },
      createdAt: parentComment.createdAt,
    })
    const reply = commentWith({
      id: ids.newId(),
      cardId: inProgressCard.id,
      parentCommentId: parentComment.id,
      authorId: demoUsers.technician.id,
      body: 'Hydraulic pump is out — new seal kit arrives tomorrow morning.',
      createdAt: new Date(nowMs - 2 * 3_600_000).toISOString(),
    })
    tx.insert(comments).values(reply).run()
    appendEvent({
      id: ids.newId(),
      cardId: inProgressCard.id,
      actorId: reply.authorId,
      actorKind: 'user',
      eventType: 'comment.added',
      payload: { commentId: reply.id, parentCommentId: parentComment.id },
      createdAt: reply.createdAt,
    })

    const attachment = {
      id: ids.newId(),
      cardId: readyCard.id,
      filename: 'filter-spec-sheet.pdf',
      mime: 'application/pdf',
      bytes: 184_320,
      sha256: 'deadbeef'.repeat(8),
      storageKey: ids.newId(),
      uploadedBy: demoUsers.technician.id,
      createdAt: readyCard.createdAt,
      deletedAt: null,
    }
    tx.insert(attachments).values(attachment).run()
    appendEvent({
      id: ids.newId(),
      cardId: readyCard.id,
      actorId: attachment.uploadedBy,
      actorKind: 'user',
      eventType: 'attachment.added',
      payload: { attachmentId: attachment.id, filename: attachment.filename },
      createdAt: attachment.createdAt,
    })

    return { seeded: true, userEmails, cardCount }
  })
}
