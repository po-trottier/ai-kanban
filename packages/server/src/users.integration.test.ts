import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from './test/support.ts'

/**
 * Admin users CRUD (docs/architecture/rest-api.md#auth--users): pickers list,
 * one-time temp passwords, role/deactivation session revocation, and the
 * last-active-admin guard (409, named rule).
 */

let t: TestApp

beforeAll(async () => {
  t = await createTestApp()
})

afterAll(async () => {
  await t.cleanup()
})

describe('GET /users', () => {
  it('lists active users with exactly id/displayName/role — system user excluded', async () => {
    const { user, cookie } = await t.asRole('user')

    const response = await t.request(cookie, { method: 'GET', url: '/api/v1/users' })

    expect(response.statusCode).toBe(200)
    const users = response.json<Record<string, unknown>[]>()
    const me = users.find((row) => row.id === user.id)
    expect(me).toEqual({ id: user.id, displayName: user.displayName, role: 'user' })
    expect(users.map((row) => row.id)).not.toContain(t.wired.systemUserId)
  })

  it('omits deactivated users', async () => {
    const admin = await t.asRole('admin')
    const { user } = await t.createUser('user', { isActive: false })

    const response = await t.request(admin.cookie, { method: 'GET', url: '/api/v1/users' })

    expect(response.json<{ id: string }[]>().map((row) => row.id)).not.toContain(user.id)
  })

  it('includes emails for admins only (the users admin table)', async () => {
    const admin = await t.asRole('admin')
    const requester = await t.asRole('user')

    const adminView = await t.request(admin.cookie, { method: 'GET', url: '/api/v1/users' })
    const requesterView = await t.request(requester.cookie, { method: 'GET', url: '/api/v1/users' })

    const adminRow = adminView
      .json<Record<string, unknown>[]>()
      .find((row) => row.id === admin.user.id)
    expect(adminRow?.email).toBe(admin.user.email)
    const sameRowForRequester = requesterView
      .json<Record<string, unknown>[]>()
      .find((row) => row.id === admin.user.id)
    expect(sameRowForRequester).not.toHaveProperty('email')
  })
})

describe('POST /users', () => {
  it('creates a user with a one-time temp password and must_change_password set', async () => {
    const admin = await t.asRole('admin')

    const response = await t.request(admin.cookie, {
      method: 'POST',
      url: '/api/v1/users',
      payload: { email: 'newbie@test.example', displayName: 'Newbie', role: 'user' },
    })

    expect(response.statusCode).toBe(201)
    const body = response.json<{ user: Record<string, unknown>; tempPassword: string }>()
    expect(body.tempPassword.length).toBeGreaterThanOrEqual(12)
    expect(body.user.mustChangePassword).toBe(true)
    expect(body.user).not.toHaveProperty('passwordHash')

    const cookie = await t.login('newbie@test.example', body.tempPassword)
    expect(cookie).toBeTruthy()
  })

  it('requires manageUsers (403, named rule) and validates the body (400)', async () => {
    const tech = await t.asRole('user')
    const admin = await t.asRole('admin')

    const denied = await t.request(tech.cookie, {
      method: 'POST',
      url: '/api/v1/users',
      payload: { email: 'x@test.example', displayName: 'X', role: 'user' },
    })
    const invalid = await t.request(admin.cookie, {
      method: 'POST',
      url: '/api/v1/users',
      payload: { email: 'not-an-email', displayName: '', role: 'user' },
    })

    expect(denied.statusCode).toBe(403)
    expect(denied.json<{ rule: string }>().rule).toBe('permission:manageUsers')
    expect(invalid.statusCode).toBe(400)
  })

  it('rejects a duplicate email with 409', async () => {
    const admin = await t.asRole('admin')
    const { user } = await t.createUser('user')

    const response = await t.request(admin.cookie, {
      method: 'POST',
      url: '/api/v1/users',
      payload: { email: user.email.toUpperCase(), displayName: 'Dup', role: 'user' },
    })

    expect(response.statusCode).toBe(409)
  })
})

describe('PATCH /users/:id', () => {
  it('changes the role and revokes the user sessions immediately', async () => {
    const admin = await t.asRole('admin')
    const victim = await t.asRole('user')

    const response = await t.request(admin.cookie, {
      method: 'PATCH',
      url: `/api/v1/users/${victim.user.id}`,
      payload: { role: 'admin' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json<{ user: { role: string } }>().user.role).toBe('admin')
    const meAfter = await t.request(victim.cookie, { method: 'GET', url: '/api/v1/auth/me' })
    expect(meAfter.statusCode).toBe(401)
  })

  it('resetPassword issues a fresh temp password and kills the old one', async () => {
    const admin = await t.asRole('admin')
    const victim = await t.asRole('user')

    const response = await t.request(admin.cookie, {
      method: 'PATCH',
      url: `/api/v1/users/${victim.user.id}`,
      payload: { resetPassword: true },
    })

    expect(response.statusCode).toBe(200)
    const { tempPassword } = response.json<{ tempPassword: string }>()
    expect(tempPassword).toBeTruthy()

    // Temp-password login first: a failed attempt would arm the backoff.
    const newCookie = await t.login(victim.user.email, tempPassword)
    const me = await t.request(newCookie, { method: 'GET', url: '/api/v1/auth/me' })
    expect(me.json<{ mustChangePassword: boolean }>().mustChangePassword).toBe(true)

    const oldLogin = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: '10.98.0.1',
      headers: { 'content-type': 'application/json' },
      payload: { email: victim.user.email, password: victim.password },
    })
    expect(oldLogin.statusCode).toBe(401)
  })

  it('404s an unknown user and 400s an empty patch', async () => {
    const admin = await t.asRole('admin')

    const missing = await t.request(admin.cookie, {
      method: 'PATCH',
      url: '/api/v1/users/00000000-0000-7000-8000-000000000123',
      payload: { role: 'user' },
    })
    const empty = await t.request(admin.cookie, {
      method: 'PATCH',
      url: `/api/v1/users/${admin.user.id}`,
      payload: {},
    })

    expect(missing.statusCode).toBe(404)
    expect(empty.statusCode).toBe(400)
  })

  it('requires manageUsers (403 for a plain user)', async () => {
    const tech = await t.asRole('user')

    const response = await t.request(tech.cookie, {
      method: 'PATCH',
      url: `/api/v1/users/${tech.user.id}`,
      payload: { displayName: 'Sneaky' },
    })

    expect(response.statusCode).toBe(403)
  })
})

describe('last-active-admin guard', () => {
  it('refuses to demote or deactivate the last active admin with 409', async () => {
    // A dedicated app: the shared one accumulates admins from other tests.
    const solo = await createTestApp()
    try {
      const admin = await solo.asRole('admin')

      const demote = await solo.request(admin.cookie, {
        method: 'PATCH',
        url: `/api/v1/users/${admin.user.id}`,
        payload: { role: 'user' },
      })
      const deactivate = await solo.request(admin.cookie, {
        method: 'PATCH',
        url: `/api/v1/users/${admin.user.id}`,
        payload: { isActive: false },
      })

      expect(demote.statusCode).toBe(409)
      expect(demote.json<{ rule: string }>().rule).toBe('last-active-admin')
      expect(deactivate.statusCode).toBe(409)
      // The system automation user (role admin) must not count as an admin.
      const me = await solo.request(admin.cookie, { method: 'GET', url: '/api/v1/auth/me' })
      expect(me.json<{ role: string }>().role).toBe('admin')
    } finally {
      await solo.cleanup()
    }
  })

  it('allows demotion once another active admin exists', async () => {
    const solo = await createTestApp()
    try {
      const first = await solo.asRole('admin')
      await solo.createUser('admin')

      const demote = await solo.request(first.cookie, {
        method: 'PATCH',
        url: `/api/v1/users/${first.user.id}`,
        payload: { role: 'user' },
      })

      expect(demote.statusCode).toBe(200)
    } finally {
      await solo.cleanup()
    }
  })
})
