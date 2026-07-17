import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApp, nextClientIp, sessionCookieOf, type TestApp } from './test/support.ts'

/**
 * First-boot setup flow (docs/architecture/rest-api.md#auth--users,
 * docs/architecture/deployment.md#bootstrap): while zero non-system users
 * exist, GET /setup reports required and POST /setup creates the first admin
 * (signed in immediately); afterwards the flow is gone forever.
 *
 * The lifecycle suite runs against the default createTestApp — structural
 * seed ONLY (board, lanes, policy, `system` user; no demo users), which is
 * exactly the fresh-database state of a first production boot.
 *
 * No e2e coverage on purpose: the Playwright suite boots demo-seeded, so the
 * setup page can never appear there (docs/dev/testing.md#fixtures).
 */

function postSetup(t: TestApp, payload: Record<string, unknown>) {
  return t.app.inject({
    method: 'POST',
    url: '/api/v1/setup',
    remoteAddress: nextClientIp(),
    headers: { 'content-type': 'application/json' },
    payload,
  })
}

function getSetup(t: TestApp) {
  return t.app.inject({ method: 'GET', url: '/api/v1/setup', remoteAddress: nextClientIp() })
}

describe('first-boot setup lifecycle (fresh db, structural seed only)', () => {
  let t: TestApp

  beforeAll(async () => {
    t = await createTestApp()
  })

  afterAll(async () => {
    await t.cleanup()
  })

  it('GET /setup reports required=true on a fresh database (system user excluded)', async () => {
    const response = await getSetup(t)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ required: true })
  })

  it('rejects a policy-violating password with 400 and leaves setup open', async () => {
    const short = await postSetup(t, {
      email: 'first@org.example',
      displayName: 'First Admin',
      password: 'short',
    })
    const common = await postSetup(t, {
      email: 'first@org.example',
      displayName: 'First Admin',
      // 12 chars AND on the top-10k list — only the deny list rejects it.
      password: 'Unbelievable',
    })

    expect(short.statusCode).toBe(400)
    expect(short.json<{ type: string; detail: string }>().type).toBe(
      'urn:rivian-kanban:problem:password-policy',
    )
    expect(short.json<{ detail: string }>().detail).toContain('at least 12 characters')
    expect(common.statusCode).toBe(400)
    const probe = await getSetup(t)
    expect(probe.json()).toEqual({ required: true })
  })

  it('rejects a malformed body with a 400 validation problem', async () => {
    const response = await postSetup(t, { email: 'not-an-email', displayName: '', password: '' })

    expect(response.statusCode).toBe(400)
    expect(response.json<{ type: string }>().type).toBe('urn:rivian-kanban:problem:validation')
  })

  it('POST /setup creates the first admin and issues a working session', async () => {
    const response = await postSetup(t, {
      email: 'First@org.example',
      displayName: 'First Admin',
      password: 'a-strong-first-password',
    })

    expect(response.statusCode).toBe(200)
    const body = response.json<Record<string, unknown>>()
    // Response mirrors login: the user entity, no secrets, admin role, no
    // forced change — they just chose this password themselves.
    expect(body.email).toBe('first@org.example')
    expect(body.role).toBe('admin')
    expect(body.mustChangePassword).toBe(false)
    expect(body).not.toHaveProperty('passwordHash')
    const cookie = response.cookies.find((candidate) => candidate.name === 'sid')
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' })

    const me = await t.request(sessionCookieOf(response), {
      method: 'GET',
      url: '/api/v1/auth/me',
    })
    expect(me.statusCode).toBe(200)
    expect(me.json<{ email: string; role: string }>()).toMatchObject({
      email: 'first@org.example',
      role: 'admin',
    })
  })

  it('GET /setup reports required=false once the admin exists', async () => {
    const response = await getSetup(t)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ required: false })
  })

  it('a second POST /setup is refused with the documented 409 problem', async () => {
    const response = await postSetup(t, {
      email: 'second@org.example',
      displayName: 'Second Admin',
      password: 'another-strong-password',
    })

    expect(response.statusCode).toBe(409)
    expect(response.json<{ type: string }>().type).toBe(
      'urn:rivian-kanban:problem:setup-already-complete',
    )
  })

  it('the created admin can log in through the normal login route', async () => {
    const cookie = await t.login('first@org.example', 'a-strong-first-password')

    const me = await t.request(cookie, { method: 'GET', url: '/api/v1/auth/me' })

    expect(me.statusCode).toBe(200)
  })
})

describe('setup on a demo-seeded database', () => {
  let t: TestApp

  beforeAll(async () => {
    t = await createTestApp({ seedDemoData: true })
  })

  afterAll(async () => {
    await t.cleanup()
  })

  it('never offers setup: required=false and POST is a 409', async () => {
    const probe = await getSetup(t)
    const attempt = await postSetup(t, {
      email: 'late@org.example',
      displayName: 'Latecomer',
      password: 'a-strong-late-password',
    })

    expect(probe.json()).toEqual({ required: false })
    expect(attempt.statusCode).toBe(409)
    expect(attempt.json<{ type: string }>().type).toBe(
      'urn:rivian-kanban:problem:setup-already-complete',
    )
  })

  it('deactivating every user still keeps setup closed (any status counts)', async () => {
    // Directly flip every demo user inactive — the guard counts rows, not
    // active rows, so break-glass stays the create-admin CLI, never /setup.
    const users = await t.wired.deps.uow.read((tx) => tx.userAccounts.list())
    await t.wired.deps.uow.run(async (tx) => {
      for (const user of users.filter((candidate) => candidate.id !== t.wired.systemUserId)) {
        await tx.userAccounts.update({ ...user, isActive: false })
      }
    })

    const probe = await getSetup(t)
    const attempt = await postSetup(t, {
      email: 'reopen@org.example',
      displayName: 'Reopener',
      password: 'a-strong-reopen-password',
    })

    expect(probe.json()).toEqual({ required: false })
    expect(attempt.statusCode).toBe(409)
  })
})
