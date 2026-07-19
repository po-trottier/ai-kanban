import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from './test/support.ts'

/**
 * The per-card watch REST surface (docs/architecture/notifications.md): the
 * reporter is auto-watched on create; watch/unwatch is idempotent and per-user.
 * Real Fastify app, real SQLite, real session auth.
 */

let t: TestApp
let cookie: string

beforeAll(async () => {
  t = await createTestApp()
  ;({ cookie } = await t.asRole('user'))
})

afterAll(async () => {
  await t.cleanup()
})

async function createCard(title: string): Promise<number> {
  const response = await t.request(cookie, {
    method: 'POST',
    url: '/api/v1/cards',
    payload: { title, priority: 'P2' },
  })
  if (response.statusCode !== 201) throw new Error(`create failed: ${response.body}`)
  return response.json<{ id: number }>().id
}

function watching(response: Awaited<ReturnType<typeof t.request>>): boolean {
  return response.json<{ watching: boolean }>().watching
}

describe('card watch REST', () => {
  it('auto-watches the reporter on create; unwatch and re-watch are idempotent', async () => {
    // Arrange
    const id = await createCard('Watch me')
    const url = `/api/v1/cards/${String(id)}/watch`
    const initial = await t.request(cookie, { method: 'GET', url })
    // Act
    const off = await t.request(cookie, { method: 'DELETE', url })
    const afterOff = await t.request(cookie, { method: 'GET', url })
    await t.request(cookie, { method: 'PUT', url })
    const on = await t.request(cookie, { method: 'PUT', url })
    // Assert — auto-watched at first, off after DELETE, on again after PUT.
    expect(watching(initial)).toBe(true)
    expect(watching(off)).toBe(false)
    expect(watching(afterOff)).toBe(false)
    expect(watching(on)).toBe(true)
  })

  it('watch is per-user — another user is not watching until they opt in', async () => {
    // Arrange
    const id = await createCard('Per-user')
    const other = await t.asRole('user')
    const url = `/api/v1/cards/${String(id)}/watch`
    // Act
    const before = await t.request(other.cookie, { method: 'GET', url })
    await t.request(other.cookie, { method: 'PUT', url })
    const after = await t.request(other.cookie, { method: 'GET', url })
    // Assert — a different user starts NOT watching, then opts in independently.
    expect(watching(before)).toBe(false)
    expect(watching(after)).toBe(true)
  })
})
