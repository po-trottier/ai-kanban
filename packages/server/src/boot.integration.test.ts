import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { registerSchemaGuard } from './plugins/schema-guard.ts'
import { parseEnv } from './env.ts'
import { wireApp } from './wiring/wire.ts'
import { buildApp } from './app.ts'
import { createTestApp, TEST_ARGON2, type TestApp } from './test/support.ts'

/**
 * Composition-root boot behavior: demo seeding with one-time credentials
 * (placeholders replaced exactly once), the boot-time schema guard, static
 * SPA serving with index.html fallback, and the production demo-seed gate.
 */

describe('demo seed boot (SEED_DEMO_DATA)', () => {
  let t: TestApp

  beforeAll(async () => {
    t = await createTestApp({ seedDemoData: true })
  })

  afterAll(async () => {
    await t.cleanup()
  })

  it('mints one-time credentials for every demo role and they can log in', async () => {
    expect(t.wired.demoCredentials).toHaveLength(4)
    const admin = t.wired.demoCredentials.find((credential) =>
      credential.email.startsWith('admin@'),
    )
    if (admin === undefined) throw new Error('no demo admin credential')

    const cookie = await t.login(admin.email, admin.password)
    const me = await t.request(cookie, { method: 'GET', url: '/api/v1/auth/me' })

    expect(me.statusCode).toBe(200)
    expect(me.json<{ role: string }>().role).toBe('admin')
  })

  it('seeds the demo board content behind the real routes', async () => {
    const admin = t.wired.demoCredentials.find((credential) =>
      credential.email.startsWith('admin@'),
    )
    if (admin === undefined) throw new Error('no demo admin credential')
    const cookie = await t.login(admin.email, admin.password)

    const board = await t.request(cookie, { method: 'GET', url: '/api/v1/board' })
    const lanes = board.json<{ lanes: { cards: unknown[] }[] }>().lanes
    expect(lanes.some((lane) => lane.cards.length > 0)).toBe(true)
  })

  it('replaces placeholder hashes exactly once — a re-boot mints nothing', async () => {
    const again = await wireApp(t.env, {
      hasherParams: TEST_ARGON2,
      logLevel: 'silent',
      spaRoot: null,
    })
    try {
      expect(again.demoCredentials).toEqual([])
    } finally {
      again.connection.close()
    }
  })
})

describe('deterministic demo credentials (SEED_DEMO_PASSWORD)', () => {
  it('mints the fixed password for every demo role and it can log in', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rivian-kanban-fixed-'))
    const env = parseEnv({
      NODE_ENV: 'development',
      DATABASE_PATH: join(dir, 'fixed.sqlite'),
      BLOB_DIR: join(dir, 'blobs'),
      SEED_DEMO_DATA: 'true',
      SEED_DEMO_PASSWORD: 'fixed-demo-password',
    })
    const wired = await wireApp(env, {
      hasherParams: TEST_ARGON2,
      logLevel: 'silent',
      spaRoot: null,
    })
    const app = await buildApp(wired.deps)
    try {
      expect(wired.demoCredentials).toHaveLength(4)
      expect(wired.demoCredentials.every((c) => c.password === 'fixed-demo-password')).toBe(true)

      const login = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { 'content-type': 'application/json' },
        payload: { email: 'admin@demo.rivian-kanban.local', password: 'fixed-demo-password' },
      })
      expect(login.statusCode).toBe(200)
    } finally {
      await app.close()
      wired.connection.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses to boot in production mode when SEED_DEMO_PASSWORD is set', () => {
    expect(() =>
      parseEnv({
        NODE_ENV: 'production',
        SEED_DEMO_PASSWORD: 'fixed-demo-password',
      }),
    ).toThrow(/SEED_DEMO_PASSWORD is refused in production mode/)
  })
})

describe('production gate on demo data', () => {
  it('skips the demo seed in production mode even when SEED_DEMO_DATA=true', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rivian-kanban-prod-'))
    const env = parseEnv({
      NODE_ENV: 'production',
      DATABASE_PATH: join(dir, 'prod.sqlite'),
      BLOB_DIR: join(dir, 'blobs'),
      SEED_DEMO_DATA: 'true',
    })

    const wired = await wireApp(env, {
      hasherParams: TEST_ARGON2,
      logLevel: 'silent',
      spaRoot: null,
    })
    try {
      expect(wired.demoCredentials).toEqual([])
      const demoUser = await wired.deps.uow.run((tx) =>
        tx.userAccounts.findByEmail('admin@demo.rivian-kanban.local'),
      )
      expect(demoUser).toBeNull()
    } finally {
      wired.connection.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('boot-time schema guard', () => {
  it('fails registration of an /api/v1 route without a response schema', async () => {
    const app = Fastify({ logger: false })
    registerSchemaGuard(app)

    expect(() => {
      app.get('/api/v1/rogue', () => 'no schema here')
    }).toThrow(/missing a response schema/)
    await app.close()
  })

  it('fails a mutating route without a body schema and params without a params schema', async () => {
    const app = Fastify({ logger: false })
    registerSchemaGuard(app)

    expect(() => {
      app.post('/api/v1/rogue', { schema: { response: {} } }, () => 'x')
    }).toThrow(/missing a body schema/)
    expect(() => {
      app.get('/api/v1/rogue/:id', { schema: { response: {} } }, () => 'x')
    }).toThrow(/missing a params schema/)
    await app.close()
  })

  it('leaves non-API routes (SPA, operational) alone', async () => {
    const app = Fastify({ logger: false })
    registerSchemaGuard(app)

    expect(() => {
      app.get('/anything', () => 'ok')
    }).not.toThrow()
    await app.ready()
    await app.close()
  })
})

describe('static SPA serving', () => {
  it('serves index.html at / and as the fallback for client routes', async () => {
    const spaDir = mkdtempSync(join(tmpdir(), 'rivian-kanban-spa-'))
    mkdirSync(join(spaDir, 'assets'), { recursive: true })
    writeFileSync(join(spaDir, 'index.html'), '<!doctype html><title>rivian-kanban spa</title>')
    writeFileSync(join(spaDir, 'assets', 'app.js'), 'console.log("spa")')
    const t = await createTestApp({ spaRoot: spaDir })
    try {
      const root = await t.app.inject({ method: 'GET', url: '/' })
      const asset = await t.app.inject({ method: 'GET', url: '/assets/app.js' })
      const clientRoute = await t.app.inject({ method: 'GET', url: '/board/some/route' })
      const api404 = await t.app.inject({ method: 'GET', url: '/api/v1/missing-thing' })

      expect(root.statusCode).toBe(200)
      expect(root.body).toContain('rivian-kanban spa')
      expect(asset.statusCode).toBe(200)
      expect(clientRoute.statusCode).toBe(200)
      expect(clientRoute.body).toContain('rivian-kanban spa')
      // Unknown API paths stay problem+json — never the HTML fallback.
      expect(api404.statusCode).toBe(404)
      expect(api404.headers['content-type']).toContain('application/problem+json')
    } finally {
      await t.cleanup()
      rmSync(spaDir, { recursive: true, force: true })
    }
  })

  it('boots API-only when no SPA build exists', async () => {
    const t = await createTestApp({ spaRoot: null })
    try {
      const root = await t.app.inject({ method: 'GET', url: '/' })
      expect(root.statusCode).toBe(404)
      expect(root.headers['content-type']).toContain('application/problem+json')
    } finally {
      await t.cleanup()
    }
  })
})

describe('the app factory used by production wiring', () => {
  it('builds from a wired env exactly like main.ts does', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rivian-kanban-boot-'))
    const env = parseEnv({
      NODE_ENV: 'development',
      DATABASE_PATH: join(dir, 'boot.sqlite'),
      BLOB_DIR: join(dir, 'blobs'),
      APP_VERSION: '1.2.3',
      GIT_SHA: 'abc123',
      BUILT_AT: '2026-07-16T00:00:00Z',
    })
    const wired = await wireApp(env, {
      hasherParams: TEST_ARGON2,
      logLevel: 'silent',
      spaRoot: null,
    })
    const app = await buildApp(wired.deps)
    try {
      const version = await app.inject({ method: 'GET', url: '/version' })
      expect(version.json()).toEqual({
        version: '1.2.3',
        gitSha: 'abc123',
        builtAt: '2026-07-16T00:00:00Z',
      })
    } finally {
      await app.close()
      wired.connection.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
