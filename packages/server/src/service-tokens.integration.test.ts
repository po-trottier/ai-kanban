import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from './test/support.ts'

/**
 * Admin MCP credentials (docs/architecture/rest-api.md#admin, ADR-009): the
 * raw token is shown exactly once at creation; only metadata is ever listed;
 * DELETE = revoke (rows persist). Token consumption is the MCP task.
 */

let t: TestApp
let adminCookie: string

beforeAll(async () => {
  t = await createTestApp()
  ;({ cookie: adminCookie } = await t.asRole('admin'))
})

afterAll(async () => {
  await t.cleanup()
})

describe('POST /service-tokens', () => {
  it('returns the raw rkb_ token once with hash-free metadata', async () => {
    const response = await t.request(adminCookie, {
      method: 'POST',
      url: '/api/v1/service-tokens',
      payload: { name: 'ci-agent', role: 'user', scope: 'read_write' },
    })

    expect(response.statusCode).toBe(201)
    const body = response.json<{ rawToken: string; token: Record<string, unknown> }>()
    expect(body.rawToken).toMatch(/^rkb_[A-Za-z0-9_-]{43}$/)
    expect(body.token).toMatchObject({ name: 'ci-agent', role: 'user', scope: 'read_write' })
    expect(body.token).not.toHaveProperty('tokenHash')
  })

  it('validates the body (unknown role rejected) and requires manageTokens', async () => {
    const tech = await t.asRole('user')

    const invalid = await t.request(adminCookie, {
      method: 'POST',
      url: '/api/v1/service-tokens',
      payload: { name: 'x', role: 'root', scope: 'read' },
    })
    const denied = await t.request(tech.cookie, {
      method: 'POST',
      url: '/api/v1/service-tokens',
      payload: { name: 'sneaky', role: 'admin', scope: 'read_write' },
    })

    expect(invalid.statusCode).toBe(400)
    expect(denied.statusCode).toBe(403)
    expect(denied.json<{ rule: string }>().rule).toBe('permission:manageTokens')
  })
})

describe('GET /service-tokens', () => {
  it('lists metadata only — never a raw token or hash', async () => {
    await t.request(adminCookie, {
      method: 'POST',
      url: '/api/v1/service-tokens',
      payload: { name: 'reader', role: 'user', scope: 'read' },
    })

    const response = await t.request(adminCookie, { method: 'GET', url: '/api/v1/service-tokens' })

    expect(response.statusCode).toBe(200)
    const tokens = response.json<Record<string, unknown>[]>()
    expect(tokens.length).toBeGreaterThanOrEqual(1)
    for (const token of tokens) {
      expect(token).not.toHaveProperty('tokenHash')
      expect(token).not.toHaveProperty('rawToken')
    }
    expect(response.body).not.toContain('rkb_')
  })

  it('requires manageTokens (403 for a plain user)', async () => {
    const requester = await t.asRole('user')

    const response = await t.request(requester.cookie, {
      method: 'GET',
      url: '/api/v1/service-tokens',
    })

    expect(response.statusCode).toBe(403)
  })
})

describe('DELETE /service-tokens/:id', () => {
  it('revokes (sets revokedAt) without deleting the row', async () => {
    const created = await t.request(adminCookie, {
      method: 'POST',
      url: '/api/v1/service-tokens',
      payload: { name: 'to-revoke', role: 'user', scope: 'read' },
    })
    const id = created.json<{ token: { id: string } }>().token.id

    const response = await t.request(adminCookie, {
      method: 'DELETE',
      url: `/api/v1/service-tokens/${id}`,
    })
    expect(response.statusCode).toBe(204)

    const listed = await t.request(adminCookie, { method: 'GET', url: '/api/v1/service-tokens' })
    const revoked = listed
      .json<{ id: string; revokedAt: string | null }[]>()
      .find((token) => token.id === id)
    expect(revoked?.revokedAt).not.toBeNull()
  })

  it('404s unknown tokens and denies non-admins', async () => {
    const tech = await t.asRole('user')

    const missing = await t.request(adminCookie, {
      method: 'DELETE',
      url: '/api/v1/service-tokens/00000000-0000-7000-8000-00000000dead',
    })
    const denied = await t.request(tech.cookie, {
      method: 'DELETE',
      url: '/api/v1/service-tokens/00000000-0000-7000-8000-00000000dead',
    })

    expect(missing.statusCode).toBe(404)
    expect(denied.statusCode).toBe(403)
  })
})
