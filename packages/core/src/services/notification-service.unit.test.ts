import { describe, expect, it } from 'vitest'
import { isNotifiableEvent } from '../domain/notifications.ts'
import { createScenario, fixtureId } from '../testing/index.ts'

describe('isNotifiableEvent', () => {
  it('skips pure-noise events but notifies on real changes', () => {
    // Arrange
    const notifiable = ['card.status_changed', 'comment.added'] as const
    const noise = ['card.reordered', 'comment.edited', 'card.pii_deleted'] as const
    // Act
    const notifiableResults = notifiable.map(isNotifiableEvent)
    const noiseResults = noise.map(isNotifiableEvent)
    // Assert
    expect(notifiableResults).toEqual([true, true])
    expect(noiseResults).toEqual([false, false, false])
  })
})

describe('NotificationService.fanOutForEvent', () => {
  it('notifies watchers EXCEPT the actor, resolving each to a view', async () => {
    // Arrange — the requester files a card assigned to the technician; both
    // auto-watch, and the card.created event's actor is the requester.
    const scenario = createScenario()
    const card = await scenario.cards.create(scenario.actors.requester, {
      title: 'Boiler',
      priority: 'P2',
      assigneeId: scenario.users.technician.id,
    })
    const [event] = scenario.db.eventsFor(card.id)
    if (event === undefined) throw new Error('expected a card.created event')

    // Act
    const recipients = await scenario.notifications.fanOutForEvent(card.id, event.id)

    // Assert — only the technician (a watcher who is NOT the actor) is notified.
    expect(recipients).toEqual([scenario.users.technician.id])
    const inbox = await scenario.notifications.list(scenario.actors.technician)
    expect(inbox).toHaveLength(1)
    expect(inbox[0]).toMatchObject({
      cardId: card.id,
      cardTitle: 'Boiler',
      eventType: 'card.created',
      actorName: 'requester',
      read: false,
    })
    // The actor (the requester) gets nothing — you never notify yourself.
    expect(await scenario.notifications.list(scenario.actors.requester)).toHaveLength(0)
  })

  it('returns [] for an unknown event id', async () => {
    // Arrange
    const scenario = createScenario()
    // Act
    const recipients = await scenario.notifications.fanOutForEvent(1, fixtureId(999))
    // Assert
    expect(recipients).toEqual([])
  })
})

describe('NotificationService inbox', () => {
  it('lists newest-first, filters unread, marks one + all read, and counts', async () => {
    // Arrange — two seeded notifications for the technician.
    const scenario = createScenario()
    const card = scenario.seedCard({ title: 'Card X' })
    const me = scenario.actors.technician
    scenario.db.seedNotification({
      id: fixtureId(101),
      userId: me.id,
      cardId: card.id,
      actorId: scenario.users.requester.id,
      eventType: 'card.status_changed',
      createdAt: '2026-07-10T00:00:00.000Z',
      readAt: null,
    })
    scenario.db.seedNotification({
      id: fixtureId(102),
      userId: me.id,
      cardId: card.id,
      actorId: scenario.users.requester.id,
      eventType: 'comment.added',
      createdAt: '2026-07-11T00:00:00.000Z',
      readAt: null,
    })

    // Act
    const initialCount = await scenario.notifications.unreadCount(me)
    const list = await scenario.notifications.list(me)
    await scenario.notifications.markRead(me, fixtureId(102))
    const afterOneCount = await scenario.notifications.unreadCount(me)
    const unreadList = await scenario.notifications.list(me, { unreadOnly: true })
    const affected = await scenario.notifications.markAllRead(me)
    const finalCount = await scenario.notifications.unreadCount(me)
    // Assert — newest-first, then one read, then all read.
    expect(initialCount).toBe(2)
    expect(list.map((row) => row.id)).toEqual([fixtureId(102), fixtureId(101)])
    expect(afterOneCount).toBe(1)
    expect(unreadList).toHaveLength(1)
    expect(affected).toBe(1)
    expect(finalCount).toBe(0)
  })

  it('flips a read notification back to unread — owner-scoped (markUnread)', async () => {
    // Arrange — one already-read notification for the technician.
    const scenario = createScenario()
    const card = scenario.seedCard()
    const me = scenario.actors.technician
    scenario.db.seedNotification({
      id: fixtureId(106),
      userId: me.id,
      cardId: card.id,
      actorId: scenario.users.requester.id,
      eventType: 'comment.added',
      createdAt: '2026-07-10T00:00:00.000Z',
      readAt: '2026-07-10T01:00:00.000Z',
    })

    // Act — starts read (count 0); flip back to unread; a stranger cannot flip mine.
    const readCount = await scenario.notifications.unreadCount(me)
    await scenario.notifications.markUnread(me, fixtureId(106))
    const afterFlip = await scenario.notifications.unreadCount(me)
    await scenario.notifications.markRead(me, fixtureId(106))
    await scenario.notifications.markUnread(scenario.actors.supervisor, fixtureId(106))
    const afterStranger = await scenario.notifications.unreadCount(me)

    // Assert
    expect(readCount).toBe(0)
    expect(afterFlip).toBe(1) // come-back-later: unread again
    expect(afterStranger).toBe(0) // the stranger's markUnread was a no-op
  })

  it('scopes reads to the owner — a stranger cannot mark my notification read', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard()
    scenario.db.seedNotification({
      id: fixtureId(103),
      userId: scenario.users.technician.id,
      cardId: card.id,
      actorId: scenario.users.requester.id,
      eventType: 'card.status_changed',
      createdAt: '2026-07-10T00:00:00.000Z',
      readAt: null,
    })

    // Act — a different user tries to mark it read.
    await scenario.notifications.markRead(scenario.actors.supervisor, fixtureId(103))

    // Assert — it stays unread for its owner.
    expect(await scenario.notifications.unreadCount(scenario.actors.technician)).toBe(1)
  })

  it('clears one and clears all — owner-scoped, and removes read + unread alike', async () => {
    // Arrange — one read + one unread notification for the technician.
    const scenario = createScenario()
    const card = scenario.seedCard()
    const me = scenario.actors.technician
    scenario.db.seedNotification({
      id: fixtureId(104),
      userId: me.id,
      cardId: card.id,
      actorId: scenario.users.requester.id,
      eventType: 'card.status_changed',
      createdAt: '2026-07-10T00:00:00.000Z',
      readAt: '2026-07-10T01:00:00.000Z',
    })
    scenario.db.seedNotification({
      id: fixtureId(105),
      userId: me.id,
      cardId: card.id,
      actorId: scenario.users.requester.id,
      eventType: 'comment.added',
      createdAt: '2026-07-11T00:00:00.000Z',
      readAt: null,
    })

    // Act — a stranger can't clear mine; clearing one leaves the other; clear all empties.
    await scenario.notifications.clear(scenario.actors.supervisor, fixtureId(105))
    const afterStranger = await scenario.notifications.list(me)
    await scenario.notifications.clear(me, fixtureId(105))
    const afterOne = await scenario.notifications.list(me)
    const cleared = await scenario.notifications.clearAll(me)
    const afterAll = await scenario.notifications.list(me)

    // Assert
    expect(afterStranger).toHaveLength(2) // stranger's clear was a no-op
    expect(afterOne.map((row) => row.id)).toEqual([fixtureId(104)]) // the read one remains
    expect(cleared).toBe(1) // clearAll removed the remaining read row
    expect(afterAll).toHaveLength(0)
  })
})

describe('comment @-mentions', () => {
  it('mention notifies + auto-watches the target, and the fan-out skips them', async () => {
    // Arrange — the requester files a card, then comments mentioning the
    // technician (who does not yet watch it).
    const scenario = createScenario()
    const card = await scenario.cards.create(scenario.actors.requester, {
      title: 'Ping',
      priority: 'P2',
    })

    // Act — comment with an @-mention of the technician.
    const comment = await scenario.comments.add(scenario.actors.requester, card.id, {
      body: 'hey @tech please look',
      mentions: [scenario.users.technician.id],
    })

    // Assert — the technician now watches the card and has ONE `mention` notice
    // that deep-links to the exact comment (its commentId).
    expect(scenario.db.watcherIdsFor(card.id)).toContain(scenario.users.technician.id)
    const inbox = await scenario.notifications.list(scenario.actors.technician)
    expect(inbox).toHaveLength(1)
    expect(inbox[0]).toMatchObject({
      eventType: 'mention',
      cardId: card.id,
      commentId: comment.id,
    })

    // Fanning the comment.added event out must SKIP the mentioned technician
    // (they already got the higher-signal mention), so no duplicate notice.
    const commentEvent = scenario.db
      .eventsFor(card.id)
      .find((event) => event.eventType === 'comment.added')
    if (commentEvent === undefined) throw new Error('expected a comment.added event')
    await scenario.notifications.fanOutForEvent(card.id, commentEvent.id)
    const after = await scenario.notifications.list(scenario.actors.technician)
    expect(after).toHaveLength(1)
    expect(after.filter((row) => row.eventType === 'comment.added')).toHaveLength(0)
  })

  it('commenting on a thread auto-watches it, so the author gets its later notices', async () => {
    // Arrange — the requester files a card; the technician is NOT the reporter,
    // assignee, or @-mentioned — they simply comment.
    const scenario = createScenario()
    const card = await scenario.cards.create(scenario.actors.requester, {
      title: 'Thread',
      priority: 'P2',
    })

    // Act — a plain comment (no @-mention) by the technician.
    await scenario.comments.add(scenario.actors.technician, card.id, { body: 'looking into it' })

    // Assert — commenting alone made them a watcher (they can unwatch to opt out),
    // so any later event on the card now fans out to them.
    expect(scenario.db.watcherIdsFor(card.id)).toContain(scenario.users.technician.id)
  })
})
