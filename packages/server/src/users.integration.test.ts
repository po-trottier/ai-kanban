import { DEFAULT_POLICY_DOCUMENT, type PolicyDocument } from '@rivian-kanban/core'
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

  it('includes emails for any role granting manageUsers, not just "admin" (ADR-013)', async () => {
    // A dedicated app: this PUTs a custom policy the shared app's tests must not
    // see. Proves the email gate is the manageUsers PERMISSION, not a role key.
    const solo = await createTestApp()
    try {
      const admin = await solo.asRole('admin')
      // A custom role keyed 'auditor' (not 'admin') granting only manageUsers.
      const withAuditor: PolicyDocument = {
        ...DEFAULT_POLICY_DOCUMENT,
        roles: [
          ...DEFAULT_POLICY_DOCUMENT.roles,
          { key: 'auditor', name: 'Auditor', permissions: { manageUsers: true } },
        ],
      }
      const applied = await solo.request(admin.cookie, {
        method: 'PUT',
        url: '/api/v1/policy',
        payload: withAuditor,
      })
      expect(applied.statusCode).toBe(200)

      const auditor = await solo.asRole('auditor')
      const view = await solo.request(auditor.cookie, { method: 'GET', url: '/api/v1/users' })
      const adminRow = view
        .json<Record<string, unknown>[]>()
        .find((row) => row.id === admin.user.id)
      expect(adminRow?.email).toBe(admin.user.email)
    } finally {
      await solo.cleanup()
    }
  })
})

describe('GET /users/search (async user-picker)', () => {
  it('requires auth (401 without a session)', async () => {
    const anon = await t.request(null, { method: 'GET', url: '/api/v1/users/search?q=x' })
    expect(anon.statusCode).toBe(401)
  })

  it('matches display name and email, case-insensitively', async () => {
    // A dedicated app so the seeded set is known and small.
    const solo = await createTestApp()
    try {
      const { cookie } = await solo.asRole('admin')
      const alice = await solo.createUser('user', {
        displayName: 'Alice Pickerton',
        email: 'alice-pick@test.example',
      })
      await solo.createUser('user', { displayName: 'Bob Other', email: 'bob@test.example' })

      const byName = await solo.request(cookie, {
        method: 'GET',
        url: '/api/v1/users/search?q=PICKERTON',
      })
      const byEmail = await solo.request(cookie, {
        method: 'GET',
        url: '/api/v1/users/search?q=alice-pick@test',
      })

      expect(byName.json<{ id: string }[]>().map((u) => u.id)).toEqual([alice.user.id])
      expect(byEmail.json<{ id: string }[]>().map((u) => u.id)).toEqual([alice.user.id])
    } finally {
      await solo.cleanup()
    }
  })

  it('empty q returns the first N, the limit bounds results, and the system user is excluded', async () => {
    const solo = await createTestApp()
    try {
      const { cookie } = await solo.asRole('admin')
      // Seed comfortably more than the page size to prove the limit bounds it.
      for (let i = 0; i < 25; i += 1) await solo.createUser('user')

      const firstPage = await solo.request(cookie, {
        method: 'GET',
        url: '/api/v1/users/search?limit=5',
      })
      const overCap = await solo.request(cookie, {
        method: 'GET',
        url: '/api/v1/users/search?limit=999',
      })

      expect(firstPage.json<unknown[]>()).toHaveLength(5)
      // limit above the hard cap is a validation error (mirrors /cards).
      expect(overCap.statusCode).toBe(400)
      const capped = await solo.request(cookie, {
        method: 'GET',
        url: '/api/v1/users/search?limit=50',
      })
      const ids = capped.json<{ id: string }[]>().map((u) => u.id)
      expect(ids.length).toBeLessThanOrEqual(50)
      expect(ids).not.toContain(solo.wired.systemUserId)
    } finally {
      await solo.cleanup()
    }
  })

  it('search omits deactivated users but id-resolution returns them', async () => {
    const solo = await createTestApp()
    try {
      const { cookie } = await solo.asRole('admin')
      const gone = await solo.createUser('user', {
        displayName: 'Departed Deactron',
        isActive: false,
      })

      const searched = await solo.request(cookie, {
        method: 'GET',
        url: '/api/v1/users/search?q=Deactron',
      })
      const resolved = await solo.request(cookie, {
        method: 'GET',
        url: `/api/v1/users/search?ids=${gone.user.id}`,
      })

      expect(searched.json<unknown[]>()).toHaveLength(0)
      expect(resolved.json<{ id: string }[]>().map((u) => u.id)).toEqual([gone.user.id])
    } finally {
      await solo.cleanup()
    }
  })

  it('resolves a comma-separated id set, ignoring unknown ids', async () => {
    const solo = await createTestApp()
    try {
      const { cookie } = await solo.asRole('admin')
      const a = await solo.createUser('user')
      const b = await solo.createUser('user')
      const unknown = '00000000-0000-7000-8000-000000000abc'

      const resolved = await solo.request(cookie, {
        method: 'GET',
        url: `/api/v1/users/search?ids=${a.user.id},${unknown},${b.user.id}`,
      })

      expect(resolved.statusCode).toBe(200)
      expect(
        resolved
          .json<{ id: string }[]>()
          .map((u) => u.id)
          .sort(),
      ).toEqual([a.user.id, b.user.id].sort())
    } finally {
      await solo.cleanup()
    }
  })

  it('includes email for manageUsers actors only (matches GET /users)', async () => {
    const solo = await createTestApp()
    try {
      const admin = await solo.asRole('admin')
      const requester = await solo.asRole('user')
      const target = await solo.createUser('user', {
        displayName: 'Emailcase Target',
        email: 'emailcase@test.example',
      })

      const adminView = await solo.request(admin.cookie, {
        method: 'GET',
        url: '/api/v1/users/search?q=Emailcase',
      })
      const requesterView = await solo.request(requester.cookie, {
        method: 'GET',
        url: '/api/v1/users/search?q=Emailcase',
      })

      const adminRow = adminView
        .json<Record<string, unknown>[]>()
        .find((u) => u.id === target.user.id)
      const requesterRow = requesterView
        .json<Record<string, unknown>[]>()
        .find((u) => u.id === target.user.id)
      expect(adminRow?.email).toBe('emailcase@test.example')
      expect(requesterRow).not.toHaveProperty('email')
    } finally {
      await solo.cleanup()
    }
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
