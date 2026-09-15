import { describe, expect, it } from 'vitest'
import { createScenario } from '../testing/index.ts'
import { BoardService } from './board-service.ts'

const assignments = { application: false, roleKeys: [], groupIds: [] }
const input = {
  name: 'Board',
  accessMode: 'all',
  allowedRoleKeys: [],
  allowedUserIds: [],
  allowedGroupIds: [],
}

function setup() {
  const s = createScenario()
  const service = new BoardService({ uow: s.db, clock: s.clock, ids: s.ids, eventBus: s.eventBus })
  return { s, service }
}

describe('default boards', () => {
  it('skips invalid defaults at every level, then uses the first available board or none', async () => {
    // Arrange
    const { s, service } = setup()
    const user = s.actors.requester
    const group = await service.saveGroup(s.actors.admin, null, {
      name: 'Crew',
      userIds: [user.id],
    })
    const personal = await service.create(s.actors.admin, input)
    const crew = await service.create(s.actors.admin, {
      ...input,
      defaultAssignments: { ...assignments, groupIds: [group.id] },
    })
    const role = await service.create(s.actors.admin, {
      ...input,
      defaultAssignments: { ...assignments, roleKeys: [user.role] },
    })
    const global = await service.create(s.actors.admin, {
      ...input,
      defaultAssignments: { ...assignments, application: true },
    })
    await service.setPreference(user, { boardId: personal.id })
    // Act — revoked access and archived choices each fall through.
    await service.update(s.actors.admin, personal.id, { ...input, accessMode: 'restricted' })
    // Assert
    expect((await service.list(user)).defaultBoardId).toBe(crew.id)
    await service.remove(s.actors.admin, crew.id)
    expect((await service.list(user)).defaultBoardId).toBe(role.id)
    await service.update(s.actors.admin, role.id, { ...input, accessMode: 'restricted' })
    expect((await service.list(user)).defaultBoardId).toBe(global.id)
    await service.update(s.actors.admin, global.id, { ...input, accessMode: 'restricted' })
    const fallback = await service.list(user)
    expect(fallback.defaultBoardId).toBe(fallback.items[0]?.id)
    await service.update(s.actors.admin, s.boardId, { ...input, accessMode: 'restricted' })
    expect(await service.list(user)).toMatchObject({
      items: [],
      preferredBoardId: null,
      defaultBoardId: null,
      defaultSource: 'fallback',
    })
  })

  it('cleans group and role defaults when their definitions are removed', async () => {
    // Arrange
    const { s, service } = setup()
    const original = (await s.policies.getActive()).config
    await s.policies.apply(s.actors.admin, {
      ...original,
      roles: [...original.roles, { key: 'crew', name: 'Crew', permissions: {} }],
    })
    const group = await service.saveGroup(s.actors.admin, null, { name: 'Crew', userIds: [] })
    await service.create(s.actors.admin, {
      ...input,
      defaultAssignments: { ...assignments, roleKeys: ['crew'], groupIds: [group.id] },
    })
    // Act
    await service.removeGroup(s.actors.admin, group.id)
    await s.policies.apply(s.actors.admin, original)
    // Assert
    expect((await service.list(s.actors.admin)).defaultAssignments).toEqual([])
  })
  it('resolves User > Group > Role > Global without changing the authority board', async () => {
    // Arrange
    const { s, service } = setup()
    const user = s.actors.requester
    const group = await service.saveGroup(s.actors.admin, null, {
      name: 'Crew',
      userIds: [user.id],
    })
    const global = await service.create(s.actors.admin, {
      ...input,
      defaultAssignments: { ...assignments, application: true },
    })
    const role = await service.create(s.actors.admin, {
      ...input,
      defaultAssignments: { ...assignments, roleKeys: [user.role] },
    })
    const crew = await service.create(s.actors.admin, {
      ...input,
      defaultAssignments: { ...assignments, groupIds: [group.id] },
    })
    // Act
    // Assert
    expect(await service.list(user)).toMatchObject({
      defaultBoardId: crew.id,
      defaultSource: 'group',
    })
    await service.setPreference(user, { boardId: global.id })
    expect(await service.list(user)).toMatchObject({
      defaultBoardId: global.id,
      defaultSource: 'personal',
    })
    await service.setPreference(user, { boardId: null })
    await service.remove(s.actors.admin, crew.id)
    expect(await service.list(user)).toMatchObject({
      defaultBoardId: role.id,
      defaultSource: 'role',
    })
    await service.remove(s.actors.admin, role.id)
    expect(await service.list(user)).toMatchObject({
      defaultBoardId: global.id,
      defaultSource: 'application',
    })
    expect((await s.db.read((tx) => tx.boards.getDefault()))?.id).toBe(s.boardId)
  })

  it('deduplicates group choices and falls through to role when groups conflict', async () => {
    // Arrange
    const { s, service } = setup()
    const user = s.actors.requester
    const a = await service.saveGroup(s.actors.admin, null, { name: 'A', userIds: [user.id] })
    const b = await service.saveGroup(s.actors.admin, null, { name: 'B', userIds: [user.id] })
    const role = await service.create(s.actors.admin, {
      ...input,
      defaultAssignments: { ...assignments, roleKeys: [user.role] },
    })
    const crew = await service.create(s.actors.admin, {
      ...input,
      defaultAssignments: { ...assignments, groupIds: [a.id, b.id] },
    })
    // Act
    // Assert
    expect((await service.list(user)).defaultBoardId).toBe(crew.id)
    await service.create(s.actors.admin, {
      ...input,
      defaultAssignments: { ...assignments, groupIds: [b.id] },
    })
    expect((await service.list(user)).defaultBoardId).toBe(role.id)
  })

  it('never grants access through defaults or reveals others preferences', async () => {
    // Arrange
    const { s, service } = setup()
    const user = s.actors.requester
    const board = await service.create(s.actors.admin, { ...input })
    await service.setPreference(user, { boardId: board.id })
    // Act
    await service.update(s.actors.admin, board.id, {
      ...input,
      accessMode: 'restricted',
      defaultAssignments: { ...assignments, roleKeys: [user.role] },
    })
    // Assert
    await expect(service.setPreference(user, { boardId: board.id })).rejects.toThrow('board')
    expect(await service.list(user)).toMatchObject({
      defaultBoardId: s.boardId,
      preferredBoardId: null,
      defaultAssignments: [],
    })
    expect(
      (await service.list(s.actors.admin)).defaultAssignments.every(
        (item) => item.scope !== 'user',
      ),
    ).toBe(true)
    await expect(
      service.update(user, s.boardId, { ...input, defaultAssignments: assignments }),
    ).rejects.toThrow('managePolicy')
    await expect(
      service.setPreference(user, { boardId: s.boardId, subject: s.actors.admin.id }),
    ).rejects.toThrow()
  })

  it('preserves reassigned defaults when saving stale assignments on a different board', async () => {
    // Arrange
    const { s, service } = setup()
    const a = await service.create(s.actors.admin, {
      ...input,
      defaultAssignments: { ...assignments, application: true },
    })
    const b = await service.create(s.actors.admin, {
      ...input,
      defaultAssignments: { ...assignments, application: true },
    })
    // Act
    await service.update(s.actors.admin, a.id, { ...input, defaultAssignments: assignments })
    // Assert
    expect((await service.list(s.actors.requester)).defaultBoardId).toBe(b.id)
    await expect(
      service.create(s.actors.admin, {
        ...input,
        defaultAssignments: { ...assignments, roleKeys: ['missing'] },
      }),
    ).rejects.toThrow('role')
  })
})
