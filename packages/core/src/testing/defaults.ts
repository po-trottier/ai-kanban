import { type Card, type Comment, type User } from '../domain/entities.ts'

/**
 * The neutral entity defaults every harness shares (core scenario, db/server
 * test support, web fixtures, the demo seed) — spelled exactly once so a
 * schema change is a one-file edit. Harness-specific identity — id scheme,
 * position scheme, titles, timestamps — stays at each call site via the
 * required keys.
 */

/** Auto-incrementing default ticket number so fixtures never collide on the
 * UNIQUE(board_id, number) index; callers that care set `number` explicitly. */
let nextDefaultNumber = 0

/** A neutral Card: P2, manual, unblocked, no slack metadata, version 1, live. */
export function cardWith(
  overrides: Partial<Card> &
    Pick<Card, 'id' | 'boardId' | 'laneId' | 'position' | 'reporterId' | 'createdAt'>,
): Card {
  nextDefaultNumber += 1
  return {
    number: nextDefaultNumber,
    title: 'Card',
    description: '',
    priority: 'P2',
    estimateMinutes: null,
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
    workStartedAt: null,
    slackChannelId: null,
    slackThreadTs: null,
    slackPermalink: null,
    version: 1,
    updatedAt: overrides.createdAt,
    archivedAt: null,
    ...overrides,
  }
}

/** A neutral active User with no Slack binding and no pending password change. */
export function userWith(
  overrides: Partial<User> & Pick<User, 'id' | 'email' | 'displayName' | 'role' | 'createdAt'>,
): User {
  return {
    mustChangePassword: false,
    slackUserId: null,
    isActive: true,
    ...overrides,
  }
}

/** A neutral top-level Comment: never edited (updatedAt = createdAt), live. */
export function commentWith(
  overrides: Partial<Comment> & Pick<Comment, 'id' | 'cardId' | 'authorId' | 'createdAt'>,
): Comment {
  return {
    parentCommentId: null,
    body: 'A comment',
    updatedAt: overrides.createdAt,
    deletedAt: null,
    ...overrides,
  }
}
