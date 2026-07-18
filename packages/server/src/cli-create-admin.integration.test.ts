import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ActiveAdminExistsError, createAdminUser } from './wiring/create-admin.ts'
import { createTestApp, type TestApp } from './test/support.ts'

/**
 * The bootstrap/break-glass CLI flow (docs/architecture/deployment.md):
 * `users create-admin --email` against a real temp database — the handler
 * the thin cli.ts entrypoint invokes.
 */

let t: TestApp

beforeAll(async () => {
  t = await createTestApp()
})

afterAll(async () => {
  await t.cleanup()
})

function cliDeps() {
  return {
    uow: t.wired.deps.uow,
    clock: t.wired.deps.clock,
    hasher: t.wired.hasher,
    systemUserId: t.wired.systemUserId,
  }
}

describe('users create-admin', () => {
  it('creates the first admin with a one-time temp password that forces a change', async () => {
    const result = await createAdminUser(cliDeps(), 'Boot@Org.example')

    expect(result.created).toBe(true)
    expect(result.user).toMatchObject({
      email: 'boot@org.example',
      role: 'admin',
      isActive: true,
      mustChangePassword: true,
    })
    expect(result.tempPassword.length).toBeGreaterThanOrEqual(12)

    // The temp password logs in through the real route; the gate is armed.
    const cookie = await t.login('boot@org.example', result.tempPassword)
    const board = await t.request(cookie, { method: 'GET', url: '/api/v1/board' })
    expect(board.statusCode).toBe(403)
    const me = await t.request(cookie, { method: 'GET', url: '/api/v1/auth/me' })
    expect(me.statusCode).toBe(200)
  })

  it('refuses while an active admin exists unless forced (idempotence guard)', async () => {
    await expect(createAdminUser(cliDeps(), 'second@org.example')).rejects.toBeInstanceOf(
      ActiveAdminExistsError,
    )

    const forced = await createAdminUser(cliDeps(), 'second@org.example', true)
    expect(forced.created).toBe(true)
  })

  it('resets an existing account as break-glass recovery (promote + fresh password)', async () => {
    const { user } = await t.createUser('user')

    const result = await createAdminUser(cliDeps(), user.email, true)

    expect(result.created).toBe(false)
    expect(result.user).toMatchObject({ id: user.id, role: 'admin', mustChangePassword: true })
    const cookie = await t.login(user.email, result.tempPassword)
    expect(cookie).toBeTruthy()
  })

  it('revokes existing sessions when force-resetting an account', async () => {
    const victim = await t.asRole('user')

    await createAdminUser(cliDeps(), victim.user.email, true)

    const me = await t.request(victim.cookie, { method: 'GET', url: '/api/v1/auth/me' })
    expect(me.statusCode).toBe(401)
  })

  it('the system automation user never counts as an active admin', async () => {
    // A fresh database: only the structural seed's system user exists, and
    // its admin role must not trip the guard.
    const fresh = await createTestApp()
    try {
      const result = await createAdminUser(
        {
          uow: fresh.wired.deps.uow,
          clock: fresh.wired.deps.clock,
          hasher: fresh.wired.hasher,
          systemUserId: fresh.wired.systemUserId,
        },
        'first@org.example',
      )
      expect(result.created).toBe(true)
    } finally {
      await fresh.cleanup()
    }
  })
})
