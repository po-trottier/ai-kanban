import {
  DEFAULT_POLICY_DOCUMENT,
  LANE_KEYS,
  type Card,
  type CardEvent,
  type Comment,
  type Lane,
  type LaneKey,
  type PolicyDocument,
  type User,
} from '@rivian-kanban/core'
import { type BoardCard, type BoardResponse, type PickerUser } from '../api/schemas.ts'

/** Deterministic RFC-9562-shaped ids for fixtures. */
export function uid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

/** Indexed access without non-null assertions (banned by lint). */
export function nth<T>(items: readonly T[], index: number): T {
  const item = items.at(index)
  if (item === undefined) throw new Error(`expected an element at index ${String(index)}`)
  return item
}

const FIXTURE_BOARD_ID = uid(9000)
const T0 = '2026-07-01T10:00:00.000Z'

const fixtureLanes: Lane[] = LANE_KEYS.map((key, index) => ({
  id: uid(100 + index),
  boardId: FIXTURE_BOARD_ID,
  key,
  label: laneLabel(key),
  position: index + 1,
  wipLimit: key === 'in_progress' ? 3 : key === 'waiting_parts_vendor' ? 5 : null,
}))

function laneLabel(key: LaneKey): string {
  const labels: Record<LaneKey, string> = {
    intake: 'Intake',
    waiting_approval: 'Waiting for Approval',
    ready: 'Ready',
    in_progress: 'In Progress',
    waiting_parts_vendor: 'Waiting on Parts / Vendor',
    review: 'Review',
    done: 'Done',
  }
  return labels[key]
}

export function laneByKey(key: LaneKey): Lane {
  const lane = fixtureLanes.find((candidate) => candidate.key === key)
  if (lane === undefined) throw new Error(`no fixture lane ${key}`)
  return lane
}

export const fixtureAdmin: User = {
  id: uid(1),
  email: 'admin@example.com',
  displayName: 'Ada Admin',
  role: 'admin',
  mustChangePassword: false,
  slackUserId: null,
  isActive: true,
  createdAt: T0,
}

export const fixtureTech: User = {
  id: uid(2),
  email: 'tech@example.com',
  displayName: 'Terry Tech',
  role: 'technician',
  mustChangePassword: false,
  slackUserId: null,
  isActive: true,
  createdAt: T0,
}

export const fixturePickerUsers: PickerUser[] = [
  { id: fixtureAdmin.id, displayName: fixtureAdmin.displayName, role: fixtureAdmin.role },
  { id: fixtureTech.id, displayName: fixtureTech.displayName, role: fixtureTech.role },
]

let cardCounter = 500

export function makeCard(laneKey: LaneKey, overrides: Partial<BoardCard> = {}): BoardCard {
  cardCounter += 1
  const id = uid(cardCounter)
  return {
    id,
    boardId: FIXTURE_BOARD_ID,
    laneId: laneByKey(laneKey).id,
    position: `a${String(cardCounter)}`,
    title: `Card ${String(cardCounter)}`,
    description: '',
    priority: 'P2',
    estimateMinutes: null,
    reporterId: fixtureAdmin.id,
    assigneeId: null,
    locationId: null,
    origin: 'manual',
    resolution: null,
    blocked: false,
    blockedReason: null,
    blockedAt: null,
    waitingReason: null,
    expectedResumeAt: null,
    resumeAlertedAt: null,
    slackChannelId: null,
    slackThreadTs: null,
    slackPermalink: null,
    version: 1,
    createdAt: T0,
    updatedAt: T0,
    archivedAt: null,
    tags: [],
    ...overrides,
  }
}

/** The strict core card (no board-only `tags`) for `GET /cards/:id` fixtures. */
export function coreCard(boardCard: BoardCard): Card {
  const { tags, ...card } = boardCard
  void tags // rest-destructured off; the strict cardSchema rejects unknown keys
  return card
}

export function makeBoard(cardsByLane: Partial<Record<LaneKey, BoardCard[]>>): BoardResponse {
  return {
    lanes: fixtureLanes.map((lane) => {
      const cards = cardsByLane[lane.key] ?? []
      return {
        lane,
        cards,
        wipLimitExceeded: lane.wipLimit !== null && cards.length > lane.wipLimit,
      }
    }),
  }
}

export const permissivePolicy: PolicyDocument = DEFAULT_POLICY_DOCUMENT

export const enforcedPolicy: PolicyDocument = {
  ...DEFAULT_POLICY_DOCUMENT,
  transitionEnforcement: true,
}

export function makeComment(overrides: Partial<Comment> & Pick<Comment, 'id' | 'cardId'>): Comment {
  return {
    parentCommentId: null,
    authorId: fixtureAdmin.id,
    body: 'A comment',
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    ...overrides,
  }
}

export function makeStatusChangedEvent(
  card: Card,
  n: number,
  from: LaneKey,
  to: LaneKey,
): CardEvent {
  return {
    id: uid(8000 + n),
    cardId: card.id,
    actorId: fixtureAdmin.id,
    actorKind: 'user',
    createdAt: T0,
    eventType: 'card.status_changed',
    payload: { fromLane: from, toLane: to },
  }
}
