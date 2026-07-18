import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApp, nextClientIp, sessionCookieOf, type TestApp } from './test/support.ts'

/**
 * Session lifecycle per docs/architecture/security.md#authentication and
 * ADR-009: login → cookie → me → logout → 401; uniform login failures;
 * per-account backoff; password change semantics; must_change_password gate;
 * deactivation killing live sessions.
 */

let t: TestApp

beforeAll(async () => {
  t = await createTestApp()
})

afterAll(async () => {
  await t.cleanup()
})

async function loginRaw(email: string, password: string, ip = nextClientIp()) {
  return t.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    remoteAddress: ip,
    headers: { 'content-type': 'application/json' },
    payload: { email, password },
  })
}

describe('POST /auth/login', () => {
  it('issues an httpOnly SameSite=Lax session cookie and returns the user', async () => {
    const { user, password } = await t.createUser('technician')

    const response = await loginRaw(user.email, password)

    expect(response.statusCode).toBe(200)
    const body = response.json<Record<string, unknown>>()
    expect(body.email).toBe(user.email)
    expect(body).not.toHaveProperty('passwordHash')
    const cookie = response.cookies.find((c) => c.name === 'sid')
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' })
    // Not Secure outside production (test env) — Secure is set in production.
    expect(cookie?.secure).toBeUndefined()
  })

  it('accepts the email case-insensitively', async () => {
    const { user, password } = await t.createUser('requester')

    const response = await loginRaw(user.email.toUpperCase(), password)

    expect(response.statusCode).toBe(200)
  })

  it('fails uniformly for a wrong password and an unknown email', async () => {
    const { user } = await t.createUser('technician')

    const wrongPassword = await loginRaw(user.email, 'not-the-password')
    const unknownEmail = await loginRaw('nobody@test.example', 'not-the-password')

    expect(wrongPassword.statusCode).toBe(401)
    expect(unknownEmail.statusCode).toBe(401)
    expect(wrongPassword.json()).toEqual(unknownEmail.json())
  })

  it('fails uniformly for a deactivated account with the right password', async () => {
    const { user, password } = await t.createUser('technician', { isActive: false })

    const response = await loginRaw(user.email, password)

    expect(response.statusCode).toBe(401)
    expect(response.json<Record<string, unknown>>().type).toBe(
      'urn:rivian-kanban:problem:unauthenticated',
    )
  })

  it('rejects a malformed body with a 400 validation problem', async () => {
    const response = await loginRaw('not-an-email', 'x')

    expect(response.statusCode).toBe(400)
    const body = response.json<{ type: string; issues: unknown[] }>()
    expect(body.type).toBe('urn:rivian-kanban:problem:validation')
    expect(body.issues.length).toBeGreaterThan(0)
  })

  it('issues a fresh session id on every login (anti-fixation)', async () => {
    const { user, password } = await t.createUser('technician')

    const first = sessionCookieOf(await loginRaw(user.email, password))
    const second = sessionCookieOf(await loginRaw(user.email, password))

    expect(first).not.toBe(second)
    expect(first.length).toBeGreaterThanOrEqual(43) // 32 bytes base64url
  })
})

describe('session lifecycle', () => {
  it('login → me → logout → 401', async () => {
    const { user, cookie } = await t.asRole('supervisor')

    const me = await t.request(cookie, { method: 'GET', url: '/api/v1/auth/me' })
    expect(me.statusCode).toBe(200)
    expect(me.json<{ id: string }>().id).toBe(user.id)

    const logout = await t.request(cookie, { method: 'POST', url: '/api/v1/auth/logout' })
    expect(logout.statusCode).toBe(204)

    const meAfter = await t.request(cookie, { method: 'GET', url: '/api/v1/auth/me' })
    expect(meAfter.statusCode).toBe(401)
  })

  it('rejects requests without a cookie and with a garbage cookie', async () => {
    const noCookie = await t.request(null, { method: 'GET', url: '/api/v1/auth/me' })
    const badCookie = await t.request('garbage-session-id', {
      method: 'GET',
      url: '/api/v1/auth/me',
    })

    expect(noCookie.statusCode).toBe(401)
    expect(badCookie.statusCode).toBe(401)
  })

  it('kills the session the moment the user is deactivated', async () => {
    const admin = await t.asRole('admin')
    const victim = await t.asRole('technician')

    const deactivate = await t.request(admin.cookie, {
      method: 'PATCH',
      url: `/api/v1/users/${victim.user.id}`,
      payload: { isActive: false },
    })
    expect(deactivate.statusCode).toBe(200)

    const me = await t.request(victim.cookie, { method: 'GET', url: '/api/v1/auth/me' })
    expect(me.statusCode).toBe(401)
  })
})

describe('POST /auth/change-password', () => {
  it('rejects a wrong current password with 403', async () => {
    const { cookie } = await t.asRole('technician')

    const response = await t.request(cookie, {
      method: 'POST',
      url: '/api/v1/auth/change-password',
      payload: { currentPassword: 'wrong-current-password', newPassword: 'a-perfectly-fine-pw' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json<{ type: string }>().type).toBe(
      'urn:rivian-kanban:problem:invalid-current-password',
    )
  })

  it('arms the per-account backoff after a wrong current password (429 + Retry-After)', async () => {
    // change-password is the second password-verification surface: without
    // the shared backoff, a session-holding attacker could guess the account
    // password here without ever tripping the login control (security.md).
    const { cookie } = await t.asRole('technician')
    const guess = (attempt: number) =>
      t.request(cookie, {
        method: 'POST',
        url: '/api/v1/auth/change-password',
        payload: {
          currentPassword: `wrong-guess-${String(attempt)}`,
          newPassword: 'a-perfectly-fine-pw',
        },
      })

    const first = await guess(1)
    const second = await guess(2)

    expect(first.statusCode).toBe(403)
    expect(second.statusCode).toBe(429)
    expect(Number(second.headers['retry-after'])).toBeGreaterThan(0)
  })

  it('enforces the password policy: too short and top-10k common are 400', async () => {
    const { password, cookie } = await t.asRole('technician')

    const short = await t.request(cookie, {
      method: 'POST',
      url: '/api/v1/auth/change-password',
      payload: { currentPassword: password, newPassword: 'short' },
    })
    const common = await t.request(cookie, {
      method: 'POST',
      url: '/api/v1/auth/change-password',
      // 12 chars AND on the top-10k list — only the deny list rejects it.
      payload: { currentPassword: password, newPassword: 'Unbelievable' },
    })

    expect(short.statusCode).toBe(400)
    expect(common.statusCode).toBe(400)
    expect(common.json<{ type: string }>().type).toBe('urn:rivian-kanban:problem:password-policy')
  })

  it('changes the password and revokes every other session', async () => {
    const { user, password, cookie } = await t.asRole('technician')
    const otherCookie = await t.login(user.email, password)

    const change = await t.request(cookie, {
      method: 'POST',
      url: '/api/v1/auth/change-password',
      payload: { currentPassword: password, newPassword: 'a-brand-new-passphrase' },
    })
    expect(change.statusCode).toBe(204)

    // The changing session survives; the other one is revoked.
    const meCurrent = await t.request(cookie, { method: 'GET', url: '/api/v1/auth/me' })
    const meOther = await t.request(otherCookie, { method: 'GET', url: '/api/v1/auth/me' })
    expect(meCurrent.statusCode).toBe(200)
    expect(meOther.statusCode).toBe(401)

    // New password first: a failed attempt would arm the backoff window.
    const newLogin = await loginRaw(user.email, 'a-brand-new-passphrase')
    expect(newLogin.statusCode).toBe(200)
    const oldLogin = await loginRaw(user.email, password)
    expect(oldLogin.statusCode).toBe(401)
  })
})

describe('must_change_password gate', () => {
  it('restricts a temp-password session to change-password/logout/me until cleared', async () => {
    const admin = await t.asRole('admin')
    const created = await t.request(admin.cookie, {
      method: 'POST',
      url: '/api/v1/users',
      payload: { email: 'fresh@test.example', displayName: 'Fresh', role: 'requester' },
    })
    expect(created.statusCode).toBe(201)
    const { user, tempPassword } = created.json<{
      user: { id: string }
      tempPassword: string
    }>()

    const cookie = await t.login('fresh@test.example', tempPassword)
    const me = await t.request(cookie, { method: 'GET', url: '/api/v1/auth/me' })
    expect(me.json<{ mustChangePassword: boolean }>().mustChangePassword).toBe(true)

    const board = await t.request(cookie, { method: 'GET', url: '/api/v1/board' })
    expect(board.statusCode).toBe(403)
    expect(board.json<{ type: string }>().type).toBe(
      'urn:rivian-kanban:problem:password-change-required',
    )

    const change = await t.request(cookie, {
      method: 'POST',
      url: '/api/v1/auth/change-password',
      payload: { currentPassword: tempPassword, newPassword: 'my-new-real-password' },
    })
    expect(change.statusCode).toBe(204)

    const boardAfter = await t.request(cookie, { method: 'GET', url: '/api/v1/board' })
    expect(boardAfter.statusCode).toBe(200)
    expect(user.id).toBeTruthy()
  })

  it('blocks the self-service profile update until the temp password is changed', async () => {
    const admin = await t.asRole('admin')
    const created = await t.request(admin.cookie, {
      method: 'POST',
      url: '/api/v1/users',
      payload: { email: 'fresh-tz@test.example', displayName: 'Fresh TZ', role: 'requester' },
    })
    const { tempPassword } = created.json<{ tempPassword: string }>()
    const cookie = await t.login('fresh-tz@test.example', tempPassword)

    // PATCH /auth/me is NOT allowWithPasswordChange — the locked session can't reach it.
    const patch = await t.request(cookie, {
      method: 'PATCH',
      url: '/api/v1/auth/me',
      payload: { timezone: 'UTC' },
    })
    expect(patch.statusCode).toBe(403)
    expect(patch.json<{ type: string }>().type).toBe(
      'urn:rivian-kanban:problem:password-change-required',
    )
  })
})

describe('PATCH /auth/me (self-service profile)', () => {
  it('updates only the caller’s own time zone and persists it to the session', async () => {
    const user = await t.asRole('technician')
    const before = await t.request(user.cookie, { method: 'GET', url: '/api/v1/auth/me' })
    // Fresh users default to PST (data-model.md#users).
    expect(before.json<{ timezone: string }>().timezone).toBe('America/Los_Angeles')

    const patched = await t.request(user.cookie, {
      method: 'PATCH',
      url: '/api/v1/auth/me',
      payload: { timezone: 'America/New_York' },
    })
    expect(patched.statusCode).toBe(200)
    expect(patched.json<{ timezone: string }>().timezone).toBe('America/New_York')

    const after = await t.request(user.cookie, { method: 'GET', url: '/api/v1/auth/me' })
    expect(after.json<{ timezone: string }>().timezone).toBe('America/New_York')
  })

  it('rejects an unknown IANA zone with a 400 validation problem', async () => {
    const user = await t.asRole('technician')
    const bad = await t.request(user.cookie, {
      method: 'PATCH',
      url: '/api/v1/auth/me',
      payload: { timezone: 'Mars/Olympus_Mons' },
    })
    expect(bad.statusCode).toBe(400)
  })

  it('refuses any field other than the time zone — no privilege escalation via the profile route', async () => {
    const user = await t.asRole('technician')
    // strictObject body: the extra `role` is a 400, never a silent promotion.
    const escalate = await t.request(user.cookie, {
      method: 'PATCH',
      url: '/api/v1/auth/me',
      payload: { timezone: 'UTC', role: 'admin' },
    })
    expect(escalate.statusCode).toBe(400)

    const after = await t.request(user.cookie, { method: 'GET', url: '/api/v1/auth/me' })
    expect(after.json<{ role: string }>().role).toBe('technician')
  })

  it('rejects an unauthenticated request with 401', async () => {
    const anon = await t.request(null, {
      method: 'PATCH',
      url: '/api/v1/auth/me',
      payload: { timezone: 'UTC' },
    })
    expect(anon.statusCode).toBe(401)
  })
})

describe('per-account login backoff', () => {
  it('returns 429 with Retry-After after repeated failures (across IPs)', async () => {
    const { user } = await t.createUser('technician')

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await loginRaw(user.email, 'wrong-password')
      // Attempts spaced by growing backoff would be needed to keep failing
      // with 401; here later attempts may already hit the backoff 429 —
      // either way they never succeed.
      expect([401, 429]).toContain(failed.statusCode)
    }

    const blocked = await loginRaw(user.email, 'wrong-password')
    expect(blocked.statusCode).toBe(429)
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1)
    expect(blocked.json<{ type: string }>().type).toBe('urn:rivian-kanban:problem:login-backoff')
  })

  it('resets the counter on a successful login', async () => {
    const { user, password } = await t.createUser('technician')

    const failed = await loginRaw(user.email, 'wrong-password')
    expect(failed.statusCode).toBe(401)
    // Wait out the 1 s first-failure backoff, then succeed → counter resets.
    await new Promise((resolve) => setTimeout(resolve, 1_100))
    const success = await loginRaw(user.email, password)
    expect(success.statusCode).toBe(200)

    // If the counter had NOT reset, this immediate attempt would be 429.
    const after = await loginRaw(user.email, 'wrong-password')
    expect(after.statusCode).toBe(401)
  })

  it('serializes simultaneous guesses for one account: a burst cannot bypass the backoff', async () => {
    // Check-then-record with argon2 awaited in between would let every
    // request of a concurrent burst read "no failures yet" — the exact
    // cross-IP attack the per-account backoff exists to stop. Attempts for
    // one email are queued, so the second sees the first recorded failure.
    const { user } = await t.createUser('technician')

    const [first, second] = await Promise.all([
      loginRaw(user.email, 'wrong-password'),
      loginRaw(user.email, 'wrong-password'),
    ])

    expect([first.statusCode, second.statusCode].sort()).toEqual([401, 429])
  })

  it('keeps simultaneous CORRECT logins for one account working (both 200)', async () => {
    // Serialization must not turn two tabs signing in at once into a 429:
    // the first success resets the counter before the second attempt runs.
    const { user, password } = await t.createUser('technician')

    const [first, second] = await Promise.all([
      loginRaw(user.email, password),
      loginRaw(user.email, password),
    ])

    expect([first.statusCode, second.statusCode]).toEqual([200, 200])
  })
})
