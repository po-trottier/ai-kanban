import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { boardSchema, cardSchema, groupSchema, type Actor } from '@rivian-kanban/core'
import { createTestApp, type TestApp } from './test/support.ts'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(async () => {
  await t.cleanup()
})

describe('boards and groups over REST', () => {
  it('persists a caller-only preference and rejects default administration by regular users', async () => {
    // Arrange
    const admin = await t.asRole('admin')
    const member = await t.asRole('user')
    const response = await t.request(admin.cookie, {
      method: 'POST',
      url: '/api/v1/boards',
      payload: {
        name: 'Default test',
        accessMode: 'all',
        allowedRoleKeys: [],
        allowedUserIds: [],
        allowedGroupIds: [],
        defaultAssignments: { application: true, roleKeys: [], groupIds: [] },
      },
    })
    const board = boardSchema.parse(response.json())
    // Act
    const saved = await t.request(member.cookie, {
      method: 'PUT',
      url: '/api/v1/boards/preference',
      payload: { boardId: board.id },
    })
    const refreshed = await t.request(member.cookie, { method: 'GET', url: '/api/v1/boards' })
    const escalation = await t.request(member.cookie, {
      method: 'PUT',
      url: `/api/v1/boards/${board.id}`,
      payload: {
        ...board,
        defaultAssignments: { application: true, roleKeys: ['admin'], groupIds: [] },
      },
    })
    const forged = await t.request(member.cookie, {
      method: 'PUT',
      url: '/api/v1/boards/preference',
      payload: { boardId: board.id, userId: admin.user.id },
    })
    // Assert
    expect(saved.statusCode).toBe(200)
    expect(refreshed.json()).toMatchObject({
      preferredBoardId: board.id,
      defaultBoardId: board.id,
      defaultSource: 'personal',
      defaultAssignments: [{ scope: 'application', subject: 'all', boardId: board.id }],
    })
    expect([escalation.statusCode, forged.statusCode]).toEqual([400, 400])
    const denied = await t.request(member.cookie, {
      method: 'PUT',
      url: `/api/v1/boards/${board.id}`,
      payload: {
        name: board.name,
        accessMode: 'all',
        allowedRoleKeys: [],
        allowedUserIds: [],
        allowedGroupIds: [],
        defaultAssignments: { application: true, roleKeys: [], groupIds: [] },
      },
    })
    expect(denied.statusCode).toBe(403)
    expect(
      (await t.request(admin.cookie, { method: 'GET', url: '/api/v1/boards' })).json(),
    ).toMatchObject({ preferredBoardId: null, defaultSource: 'application' })
  })
  it('isolates cached snapshots, searches and direct resources and revokes group access', async () => {
    // Arrange
    const admin = await t.asRole('admin')
    const member = await t.asRole('user')
    const outsider = await t.asRole('user')
    const actor: Actor = { kind: 'user', id: admin.user.id, role: admin.user.role }
    const groupResponse = await t.request(admin.cookie, {
      method: 'POST',
      url: '/api/v1/groups',
      payload: { name: 'Crew', userIds: [member.user.id] },
    })
    const group = groupSchema.parse(groupResponse.json())
    const input = {
      name: 'Private work',
      accessMode: 'restricted',
      allowedRoleKeys: [],
      allowedUserIds: [],
      allowedGroupIds: [group.id],
    }
    const response = await t.request(admin.cookie, {
      method: 'POST',
      url: '/api/v1/boards',
      payload: input,
    })
    const board = boardSchema.parse(response.json())
    const created = await t.request(admin.cookie, {
      method: 'POST',
      url: '/api/v1/cards',
      headers: { 'x-board-id': board.id },
      payload: { title: 'Private motor', priority: 'P2', tags: ['private-tag'] },
    })
    const card = cardSchema.parse(created.json())
    const file = await t.wired.deps.services.attachments.add(actor, card.id, {
      filename: 'private.txt',
      mime: 'text/plain',
      content: new Uint8Array([1]),
      sha256: 'a'.repeat(64),
    })
    // Act
    const allowed = await t.request(member.cookie, {
      method: 'GET',
      url: '/api/v1/board',
      headers: { 'x-board-id': board.id },
    })
    const forbidden = await t.request(outsider.cookie, {
      method: 'GET',
      url: '/api/v1/board',
      headers: { 'x-board-id': board.id, 'if-none-match': String(allowed.headers.etag) },
    })
    // Assert
    expect([
      groupResponse.statusCode,
      response.statusCode,
      created.statusCode,
      allowed.statusCode,
      forbidden.statusCode,
    ]).toEqual([201, 201, 201, 200, 404])
    expect(allowed.body).toContain('Private motor')
    for (const path of [
      `/cards/${String(card.id)}`,
      `/cards/${String(card.id)}/events`,
      `/cards/${String(card.id)}/comments`,
      `/cards/${String(card.id)}/relations`,
      `/cards/${String(card.id)}/watch`,
      `/attachments/${file.id}`,
    ]) {
      const denied = await t.request(outsider.cookie, { method: 'GET', url: `/api/v1${path}` })
      expect(denied.statusCode).toBe(404)
      expect(denied.body).not.toContain('Private motor')
    }
    for (const path of ['/cards?q=Private', '/tags', '/events']) {
      const publicRead = await t.request(member.cookie, { method: 'GET', url: `/api/v1${path}` })
      expect(publicRead.statusCode).toBe(200)
      expect(publicRead.body).not.toMatch(/Private motor|private-tag/)
    }
    const stale = await t.request(outsider.cookie, {
      method: 'PATCH',
      url: `/api/v1/cards/${String(card.id)}`,
      headers: { 'if-match': '"999"' },
      payload: { title: 'Forbidden' },
    })
    const revoke = await t.request(admin.cookie, {
      method: 'PUT',
      url: `/api/v1/groups/${group.id}`,
      payload: { name: 'Crew', userIds: [] },
    })
    expect([
      stale.statusCode,
      revoke.statusCode,
      (await t.request(member.cookie, { method: 'GET', url: `/api/v1/cards/${String(card.id)}` }))
        .statusCode,
    ]).toEqual([404, 200, 404])
    expect(
      (await t.request(member.cookie, { method: 'GET', url: '/api/v1/boards' })).body,
    ).not.toContain(board.name)
  })

  it('keeps board and group management admin-only and preserves the last board', async () => {
    // Arrange
    const admin = await t.asRole('admin')
    const user = await t.asRole('user')
    const input = { name: 'Board', accessMode: 'all', allowedRoleKeys: [], allowedUserIds: [] }
    // Act
    const denied = await t.request(user.cookie, {
      method: 'POST',
      url: '/api/v1/boards',
      payload: input,
    })
    const last = await t.request(admin.cookie, {
      method: 'DELETE',
      url: `/api/v1/boards/${t.wired.boardId}`,
    })
    // Assert
    expect(denied.statusCode).toBe(403)
    expect(last.statusCode).toBe(409)
    expect(
      (await t.request(user.cookie, { method: 'GET', url: '/api/v1/groups' })).statusCode,
    ).toBe(403)
    expect(
      (
        await t.request(user.cookie, {
          method: 'POST',
          url: '/api/v1/groups',
          payload: { name: 'Own admin group', userIds: [user.user.id] },
        })
      ).statusCode,
    ).toBe(403)
  })
})
