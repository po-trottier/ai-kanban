import { describe, expect, it } from 'vitest'
import { createScenario } from '../testing/index.ts'
import { BoardService } from './board-service.ts'
import { BoardQueryService } from './board-query-service.ts'
import { PolicyService } from './policy-service.ts'
import { DEFAULT_POLICY_DOCUMENT } from '../domain/policy.ts'

describe('board access and administration', () => {
  it('runs maintenance across active boards and excludes revoked alert recipients', async () => {
    // Arrange
    const s = createScenario()
    const boards = new BoardService({ uow: s.db, clock: s.clock, ids: s.ids, eventBus: s.eventBus })
    const board = await boards.create(s.actors.admin, {
      name: 'Private maintenance',
      accessMode: 'restricted',
      allowedRoleKeys: [],
      allowedUserIds: [],
    })
    const lanes = await s.db.read((tx) => tx.lanes.listByBoard(board.id))
    const done = lanes.find((lane) => lane.key === 'done')?.id ?? 'missing done'
    const waiting =
      lanes.find((lane) => lane.key === 'waiting_parts_vendor')?.id ?? 'missing waiting'
    s.seedCard({ boardId: board.id, laneId: done, updatedAt: '2025-01-01T00:00:00.000Z' })
    const overdue = s.seedCard({
      boardId: board.id,
      laneId: waiting,
      assigneeId: s.actors.requester.id,
      waitingReason: 'parts',
      expectedResumeAt: '2025-01-01',
    })
    // Act
    const archived = await s.cards.archiveExpired(s.actors.system)
    const alerts = await s.cards.claimOverdueWaitingAlerts()
    await boards.remove(s.actors.admin, board.id)
    s.seedCard({ boardId: board.id, laneId: done, updatedAt: '2025-01-01T00:00:00.000Z' })
    // Assert
    expect(archived).toEqual({ archived: 1 })
    expect(alerts.map((alert) => alert.card.id)).toEqual([overdue.id])
    expect(alerts.flatMap((alert) => alert.recipients.map((user) => user.id))).toEqual([
      s.actors.supervisor.id,
      s.actors.admin.id,
    ])
    expect(await s.cards.archiveExpired(s.actors.system)).toEqual({ archived: 0 })
    expect(await s.cards.claimOverdueWaitingAlerts()).toEqual([])
  })

  it('grants groups and revokes access immediately when a user leaves a group', async () => {
    // Arrange
    const s = createScenario()
    const boards = new BoardService({ uow: s.db, clock: s.clock, ids: s.ids, eventBus: s.eventBus })
    const group = await boards.saveGroup(s.actors.admin, null, {
      name: 'Facilities crew',
      userIds: [s.actors.requester.id, s.actors.technician.id],
    })
    const board = await boards.create(s.actors.admin, {
      name: 'Crew',
      accessMode: 'restricted',
      allowedRoleKeys: [],
      allowedUserIds: [],
      allowedGroupIds: [group.id],
    })
    expect(
      (await boards.list(s.actors.requester)).items.find((item) => item.id === board.id),
    ).toMatchObject({ id: board.id, allowedRoleKeys: [], allowedUserIds: [], allowedGroupIds: [] })
    // Act
    await boards.saveGroup(s.actors.admin, group.id, {
      name: 'Facilities crew',
      userIds: [s.actors.technician.id],
    })
    // Assert
    await expect(boards.requireAccess(s.actors.requester, board.id)).rejects.toThrow('board')
    expect((await boards.list(s.actors.technician)).items.map((item) => item.id)).toContain(
      board.id,
    )
    await expect(boards.removeGroup(s.actors.admin, group.id)).rejects.toThrow('group-in-use')
    await expect(
      boards.saveGroup(s.actors.requester, null, {
        name: 'Escalation',
        userIds: [s.actors.requester.id],
      }),
    ).rejects.toThrow('managePolicy')
    await expect(boards.listGroups(s.actors.requester)).rejects.toThrow('managePolicy')
    await boards.update(s.actors.admin, board.id, {
      name: 'Crew',
      accessMode: 'restricted',
      allowedRoleKeys: [],
      allowedUserIds: [],
      allowedGroupIds: [],
    })
    await boards.removeGroup(s.actors.admin, group.id)
    expect(await boards.listGroups(s.actors.admin)).toEqual([])
  })

  it('restricts collections and direct card IDs, including stale writes, to allowed boards', async () => {
    // Arrange
    const s = createScenario()
    const boards = new BoardService({ uow: s.db, clock: s.clock, ids: s.ids, eventBus: s.eventBus })
    const board = await boards.create(s.actors.admin, {
      name: 'Private',
      accessMode: 'restricted',
      allowedRoleKeys: [],
      allowedUserIds: [],
    })
    const lanes = await s.db.read((tx) => tx.lanes.listByBoard(board.id))
    const card = s.seedCard({ boardId: board.id, laneId: lanes.at(0)?.id ?? 'missing lane' })
    const queries = new BoardQueryService({ uow: s.db, clock: s.clock, boardId: board.id })
    // Act
    const visible = await boards.list(s.actors.requester)
    // Assert
    expect(visible.items.map((item) => item.id)).toEqual([s.boardId])
    await expect(queries.boardSnapshot(s.actors.requester)).rejects.toThrow('board')
    await expect(s.queries.cardDetail(s.actors.requester, card.id)).rejects.toThrow('board')
    await expect(
      s.cards.update(s.actors.requester, card.id, { expectedVersion: 999, title: 'Leak' }),
    ).rejects.toThrow('board')
    expect((await s.queries.cardDetail(s.actors.admin, card.id)).card.id).toBe(card.id)
  })

  it('grants selected users, keeps admins authoritative, and archives without deleting cards', async () => {
    // Arrange
    const s = createScenario()
    const boards = new BoardService({ uow: s.db, clock: s.clock, ids: s.ids, eventBus: s.eventBus })
    const input = {
      name: 'Team',
      accessMode: 'restricted',
      allowedRoleKeys: [],
      allowedUserIds: [s.actors.requester.id],
    }
    const board = await boards.create(s.actors.admin, input)
    // Act
    const visible = await boards.list(s.actors.requester)
    await boards.remove(s.actors.admin, board.id)
    // Assert
    expect(visible.items.map((item) => item.id)).toContain(board.id)
    expect((await boards.list(s.actors.requester)).items.map((item) => item.id)).not.toContain(
      board.id,
    )
    await expect(boards.create(s.actors.requester, input)).rejects.toThrow('managePolicy')
    await expect(boards.remove(s.actors.admin, s.boardId)).rejects.toThrow('last board')
  })

  it('revokes threads, downloads, links, watching, notifications, mentions and stream hints together', async () => {
    // Arrange
    const s = createScenario()
    const boards = new BoardService({ uow: s.db, clock: s.clock, ids: s.ids, eventBus: s.eventBus })
    const input = {
      name: 'Private',
      accessMode: 'restricted',
      allowedRoleKeys: [],
      allowedUserIds: [s.actors.requester.id],
    }
    const board = await boards.create(s.actors.admin, input)
    const lanes = await s.db.read((tx) => tx.lanes.listByBoard(board.id))
    const card = s.seedCard({ boardId: board.id, laneId: lanes.at(0)?.id ?? 'missing lane' })
    const comment = await s.comments.add(s.actors.requester, card.id, { body: 'Private thread' })
    const file = await s.attachments.add(s.actors.admin, card.id, {
      filename: 'private.txt',
      mime: 'text/plain',
      content: new Uint8Array([1]),
      sha256: 'a'.repeat(64),
    })
    await s.comments.add(s.actors.admin, card.id, {
      body: 'Mention',
      mentions: [s.actors.requester.id],
    })
    expect(await s.notifications.unreadCount(s.actors.requester)).toBeGreaterThan(0)
    // Act
    await boards.update(s.actors.admin, board.id, { ...input, allowedUserIds: [] })
    // Assert
    for (const attempt of [
      () => s.comments.listForCard(s.actors.requester, card.id),
      () => s.comments.edit(s.actors.requester, comment.id, { body: 'Edit' }),
      () => s.attachments.getActive(s.actors.requester, file.id),
      () => s.queries.cardHistory(s.actors.requester, card.id),
      () => s.relations.list(s.actors.requester, card.id),
      () => s.watch.watch(s.actors.requester, card.id),
      () => boards.acceptsHint(s.actors.requester, board.id, { type: 'lane.updated' }),
    ])
      await expect(attempt()).rejects.toThrow('board')
    expect(await s.notifications.list(s.actors.requester)).toEqual([])
    expect(await s.notifications.unreadCount(s.actors.requester)).toBe(0)
    expect(await s.notifications.markAllRead(s.actors.requester)).toBe(0)
    expect(await s.notifications.clearAll(s.actors.requester)).toBe(0)
    const suppressed = await s.comments.add(s.actors.admin, card.id, {
      body: 'Suppressed mention',
      mentions: [s.actors.requester.id],
    })
    const event = s.db
      .eventsFor(card.id)
      .find(
        (item) => item.eventType === 'comment.added' && item.payload.commentId === suppressed.id,
      )
    expect(event?.eventType === 'comment.added' && event.payload.mentionedUserIds).toBeUndefined()
  })

  it('uses global roles while keeping workflow settings local and token ACLs role-based', async () => {
    // Arrange
    const s = createScenario()
    const boards = new BoardService({ uow: s.db, clock: s.clock, ids: s.ids, eventBus: s.eventBus })
    const board = await boards.create(s.actors.admin, {
      name: 'Private',
      accessMode: 'restricted',
      allowedRoleKeys: [],
      allowedUserIds: [s.actors.requester.id],
    })
    const policies = new PolicyService({
      uow: s.db,
      clock: s.clock,
      ids: s.ids,
      eventBus: s.eventBus,
      boardId: board.id,
    })
    // Act
    await policies.apply(s.actors.admin, {
      ...DEFAULT_POLICY_DOCUMENT,
      waitingReasons: [{ key: 'inspection', label: 'Inspection', active: true }],
      roles: DEFAULT_POLICY_DOCUMENT.roles.map((role) =>
        role.key === 'user'
          ? {
              ...role,
              permissions: Object.fromEntries(
                Object.entries(role.permissions).filter(([key]) => key !== 'card.update'),
              ),
            }
          : role,
      ),
    })
    // Assert
    expect(
      (await s.policies.getActive()).config.roles.find((role) => role.key === 'user')?.permissions[
        'card.update'
      ],
    ).toBeUndefined()
    expect(
      (await s.policies.getActive()).config.waitingReasons.some(
        (reason) => reason.key === 'inspection',
      ),
    ).toBe(false)
    expect(
      (await policies.getActive()).config.waitingReasons.some(
        (reason) => reason.key === 'inspection',
      ),
    ).toBe(true)
    await expect(
      boards.requireAccess({ ...s.actors.mcpRead, id: s.actors.requester.id }, board.id),
    ).rejects.toThrow('board')
    await boards.update(s.actors.admin, board.id, {
      name: 'Private',
      accessMode: 'restricted',
      allowedRoleKeys: ['user'],
      allowedUserIds: [],
    })
    expect((await boards.list(s.actors.mcpRead)).items.map((item) => item.id)).toContain(board.id)
  })
})
