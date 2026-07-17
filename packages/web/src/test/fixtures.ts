import {
  boardCardOf,
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
// The shared neutral-entity defaults (one literal for every harness). Imported
// relatively like core-domain.ts does for domain files: the vite alias maps
// the package name itself, so the /testing subpath is unreachable here.
import { cardWith, commentWith, userWith } from '../../../core/src/testing/defaults.ts'
import { type BoardResponse, type PickerUser } from '../api/schemas.ts'
import { strings } from '../strings.ts'

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

// Labels come from strings.laneNames — the app's own fallback table for the
// seeded lanes — so fixtures render exactly what the app declares (one
// in-package source; db/src/seed.ts stays the canonical origin).
const fixtureLanes: Lane[] = LANE_KEYS.map((key, index) => ({
  id: uid(100 + index),
  boardId: FIXTURE_BOARD_ID,
  key,
  label: strings.laneNames[key],
  position: index + 1,
  wipLimit: key === 'in_progress' ? 3 : key === 'waiting_parts_vendor' ? 5 : null,
}))

export function laneByKey(key: LaneKey): Lane {
  const lane = fixtureLanes.find((candidate) => candidate.key === key)
  if (lane === undefined) throw new Error(`no fixture lane ${key}`)
  return lane
}

export const fixtureAdmin: User = userWith({
  id: uid(1),
  email: 'admin@example.com',
  displayName: 'Ada Admin',
  role: 'admin',
  createdAt: T0,
})

export const fixtureTech: User = userWith({
  id: uid(2),
  email: 'tech@example.com',
  displayName: 'Terry Tech',
  role: 'technician',
  createdAt: T0,
})

export const fixturePickerUsers: PickerUser[] = [
  {
    id: fixtureAdmin.id,
    displayName: fixtureAdmin.displayName,
    role: fixtureAdmin.role,
    email: fixtureAdmin.email,
  },
  {
    id: fixtureTech.id,
    displayName: fixtureTech.displayName,
    role: fixtureTech.role,
    email: fixtureTech.email,
  },
]

let cardCounter = 500

export function makeCard(laneKey: LaneKey, overrides: Partial<Card> = {}): Card {
  cardCounter += 1
  return cardWith({
    id: uid(cardCounter),
    boardId: FIXTURE_BOARD_ID,
    laneId: laneByKey(laneKey).id,
    position: `a${String(cardCounter)}`,
    title: `Card ${String(cardCounter)}`,
    reporterId: fixtureAdmin.id,
    createdAt: T0,
    ...overrides,
  })
}

export function makeBoard(cardsByLane: Partial<Record<LaneKey, Card[]>>): BoardResponse {
  return {
    lanes: fixtureLanes.map((lane) => {
      const cards = cardsByLane[lane.key] ?? []
      return {
        lane,
        // The board carries card SUMMARIES (strict schema) — project like the server.
        cards: cards.map(boardCardOf),
        wipLimitExceeded: lane.wipLimit !== null && cards.length > lane.wipLimit,
      }
    }),
  }
}

export const permissivePolicy: PolicyDocument = DEFAULT_POLICY_DOCUMENT

/**
 * The `GET`/`PUT /policy` response envelope: the server returns the stored
 * policy VERSION record, not the bare document (rest-api.md#admin).
 */
export function policyRecordOf(config: PolicyDocument): Record<string, unknown> {
  return {
    id: uid(9090),
    boardId: FIXTURE_BOARD_ID,
    config,
    createdBy: fixtureAdmin.id,
    createdAt: '2026-07-01T09:00:00.000Z',
  }
}

export const enforcedPolicy: PolicyDocument = {
  ...DEFAULT_POLICY_DOCUMENT,
  transitionEnforcement: true,
}

export function makeComment(overrides: Partial<Comment> & Pick<Comment, 'id' | 'cardId'>): Comment {
  return commentWith({ authorId: fixtureAdmin.id, createdAt: T0, ...overrides })
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
