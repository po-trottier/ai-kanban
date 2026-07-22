import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from './test/support.ts'

/**
 * The end-to-end notification flow (docs/architecture/notifications.md): a
 * watcher (here the card's reporter) is notified when SOMEONE ELSE acts on the
 * card, never for their own actions. Fan-out is a post-commit, best-effort
 * subscriber, so the inbox is polled until it lands. Real Fastify app, real
 * SQLite, real session auth.
 */

interface NotifRow {
  id: string
  cardId: number
  eventType: string
  read: boolean
  commentId: string | null
}

let t: TestApp

beforeAll(async () => {
  t = await createTestApp()
})

afterAll(async () => {
  await t.cleanup()
})

async function listNotifications(cookie: string): Promise<NotifRow[]> {
  const response = await t.request(cookie, { method: 'GET', url: '/api/v1/notifications' })
  return response.json<NotifRow[]>()
}

async function unreadCount(cookie: string): Promise<number> {
  const response = await t.request(cookie, {
    method: 'GET',
    url: '/api/v1/notifications/unread-count',
  })
  return response.json<{ unread: number }>().unread
}

/** Poll the inbox until `predicate` holds — the fan-out is async/best-effort. */
async function waitForNotifications(
  cookie: string,
  predicate: (list: NotifRow[]) => boolean,
): Promise<NotifRow[]> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const list = await listNotifications(cookie)
    if (predicate(list)) return list
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('notification never arrived')
}

async function createCard(cookie: string, title: string): Promise<number> {
  const response = await t.request(cookie, {
    method: 'POST',
    url: '/api/v1/cards',
    payload: { title, priority: 'P2' },
  })
  return response.json<{ id: number }>().id
}

describe('notifications (watch → fan-out → inbox)', () => {
  it('notifies a watcher when someone ELSE acts, never for their own action', async () => {
    // Arrange — Alice files a card (auto-watching it); Bob is a second user.
    const alice = await t.asRole('user')
    const bob = await t.asRole('user')
    const cardId = await createCard(alice.cookie, 'Leaky pipe')

    // Act — Bob comments on Alice's card.
    const comment = await t.request(bob.cookie, {
      method: 'POST',
      url: `/api/v1/cards/${String(cardId)}/comments`,
      payload: { body: 'On it' },
    })
    expect(comment.statusCode).toBe(201)

    // Assert — Alice (a watcher who is not the actor) is notified…
    const list = await waitForNotifications(alice.cookie, (rows) =>
      rows.some((row) => row.cardId === cardId),
    )
    const notification = list.find((row) => row.cardId === cardId)
    expect(notification?.eventType).toBe('comment.added')

    // …Bob (the actor) is NOT notified for it.
    expect((await listNotifications(bob.cookie)).some((row) => row.cardId === cardId)).toBe(false)

    // Marking it read drops Alice's unread count by one and returns the fresh count.
    const before = await unreadCount(alice.cookie)
    expect(before).toBeGreaterThan(0)
    const read = await t.request(alice.cookie, {
      method: 'POST',
      url: `/api/v1/notifications/${String(notification?.id)}/read`,
    })
    expect(read.json<{ unread: number }>().unread).toBe(before - 1)
  })

  it('a comment notification carries the comment id and can be flipped read ↔ unread', async () => {
    // Arrange — Alice files a card (auto-watching it); Bob comments on it.
    const alice = await t.asRole('user')
    const bob = await t.asRole('user')
    const cardId = await createCard(alice.cookie, 'Deep-link job')
    const comment = await t.request(bob.cookie, {
      method: 'POST',
      url: `/api/v1/cards/${String(cardId)}/comments`,
      payload: { body: 'Take a look' },
    })
    const commentId = comment.json<{ id: string }>().id

    // Assert — Alice's `comment.added` notification deep-links to that exact comment.
    const list = await waitForNotifications(alice.cookie, (rows) =>
      rows.some((row) => row.cardId === cardId),
    )
    const notification = list.find((row) => row.cardId === cardId)
    expect(notification?.eventType).toBe('comment.added')
    expect(notification?.commentId).toBe(commentId)

    // Read it…
    await t.request(alice.cookie, {
      method: 'POST',
      url: `/api/v1/notifications/${String(notification?.id)}/read`,
    })
    const afterRead = await listNotifications(alice.cookie)
    expect(afterRead.find((row) => row.id === notification?.id)?.read).toBe(true)

    // …then flip it BACK to unread (come-back-later): the row is unread again and
    // the response returns the fresh, non-zero badge count.
    const reopened = await t.request(alice.cookie, {
      method: 'POST',
      url: `/api/v1/notifications/${String(notification?.id)}/unread`,
    })
    expect(reopened.statusCode).toBe(200)
    expect(reopened.json<{ unread: number }>().unread).toBeGreaterThan(0)
    const afterUnread = await listNotifications(alice.cookie)
    expect(afterUnread.find((row) => row.id === notification?.id)?.read).toBe(false)
  })

  it('commenting auto-watches, so a later reply notifies the commenter without an @-tag', async () => {
    // Arrange — Alice files a card; Bob comments (he is NOT the reporter, is not
    // @-mentioned, and never pressed watch) — commenting now auto-watches him.
    const alice = await t.asRole('user')
    const bob = await t.asRole('user')
    const cardId = await createCard(alice.cookie, 'Threaded job')
    const bobComment = await t.request(bob.cookie, {
      method: 'POST',
      url: `/api/v1/cards/${String(cardId)}/comments`,
      payload: { body: 'looking into it' },
    })
    const parentId = bobComment.json<{ id: string }>().id
    // Wait for Bob's comment to fan out to Alice first (deterministic ordering).
    await waitForNotifications(alice.cookie, (rows) => rows.some((row) => row.cardId === cardId))

    // Act — Alice REPLIES to Bob, WITHOUT @-tagging him.
    await t.request(alice.cookie, {
      method: 'POST',
      url: `/api/v1/cards/${String(cardId)}/comments`,
      payload: { body: 'thanks, keep me posted', parentCommentId: parentId },
    })

    // Assert — Bob, now a watcher via his own comment, is notified of the reply.
    const bobInbox = await waitForNotifications(bob.cookie, (rows) =>
      rows.some((row) => row.cardId === cardId && row.eventType === 'comment.added'),
    )
    expect(bobInbox.some((row) => row.cardId === cardId)).toBe(true)
  })

  it('mark-all-read clears the badge', async () => {
    // Arrange
    const alice = await t.asRole('user')
    const bob = await t.asRole('user')
    const cardId = await createCard(alice.cookie, 'Another job')
    await t.request(bob.cookie, {
      method: 'POST',
      url: `/api/v1/cards/${String(cardId)}/comments`,
      payload: { body: 'hi' },
    })
    await waitForNotifications(alice.cookie, (rows) => rows.some((row) => row.cardId === cardId))

    // Act
    const cleared = await t.request(alice.cookie, {
      method: 'POST',
      url: '/api/v1/notifications/read-all',
    })

    // Assert — the bulk action zeroes the badge.
    expect(cleared.json<{ unread: number }>().unread).toBe(0)
    expect(await unreadCount(alice.cookie)).toBe(0)
  })

  it('clears one notification and clears the whole inbox', async () => {
    // Arrange — Alice watches a card Bob acts on twice, so she has two notices.
    const alice = await t.asRole('user')
    const bob = await t.asRole('user')
    const cardId = await createCard(alice.cookie, 'Clearable job')
    for (const body of ['first', 'second']) {
      await t.request(bob.cookie, {
        method: 'POST',
        url: `/api/v1/cards/${String(cardId)}/comments`,
        payload: { body },
      })
    }
    const seeded = await waitForNotifications(
      alice.cookie,
      (rows) => rows.filter((row) => row.cardId === cardId).length >= 2,
    )
    const first = seeded.find((row) => row.cardId === cardId)

    // Act — clear one, then clear all.
    const clearedOne = await t.request(alice.cookie, {
      method: 'DELETE',
      url: `/api/v1/notifications/${String(first?.id)}`,
    })
    const afterOne = await listNotifications(alice.cookie)
    const clearedAll = await t.request(alice.cookie, {
      method: 'DELETE',
      url: '/api/v1/notifications',
    })

    // Assert — the deleted one is gone, then the inbox is empty.
    expect(clearedOne.statusCode).toBe(200)
    expect(afterOne.some((row) => row.id === first?.id)).toBe(false)
    expect(afterOne.length).toBeLessThan(seeded.length)
    expect(clearedAll.json<{ unread: number }>().unread).toBe(0)
    expect(await listNotifications(alice.cookie)).toHaveLength(0)
  })
})
