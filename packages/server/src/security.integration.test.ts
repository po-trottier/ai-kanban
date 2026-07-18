import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApp, nextClientIp, type TestApp } from './test/support.ts'

/**
 * HTTP hardening (docs/architecture/security.md#web-platform-hardening):
 * helmet headers, deny-all CORS, the layered CSRF checks, rate limits with
 * Retry-After problem+json, problem-formatted 404s, and the session-gated
 * OpenAPI/docs endpoints.
 */

let t: TestApp

beforeAll(async () => {
  t = await createTestApp()
})

afterAll(async () => {
  await t.cleanup()
})

describe('security headers (helmet)', () => {
  it('sets CSP with default-src self and frame-ancestors none, plus nosniff', async () => {
    const response = await t.app.inject({ method: 'GET', url: '/healthz' })

    const csp = String(response.headers['content-security-policy'])
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(response.headers['x-content-type-options']).toBe('nosniff')
  })
})

describe('CORS deny-all', () => {
  it('returns no access-control-allow-origin for cross-origin requests', async () => {
    const response = await t.app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { origin: 'https://evil.example' },
    })

    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })
})

describe('CSRF layers', () => {
  it('rejects a state-changing request without JSON content type or X-Requested-With', async () => {
    const { cookie } = await t.asRole('user')

    const response = await t.app.inject({
      method: 'POST',
      url: '/api/v1/cards',
      headers: { cookie: `sid=${cookie}`, 'content-type': 'text/plain' },
      payload: '{"title":"sneaky form"}',
    })

    expect(response.statusCode).toBe(403)
    expect(response.json<{ type: string }>().type).toBe('urn:rivian-kanban:problem:csrf')
  })

  it('rejects a bodyless POST without X-Requested-With and accepts it with', async () => {
    const { cookie } = await t.asRole('user')

    const rejected = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: `sid=${cookie}` },
    })
    expect(rejected.statusCode).toBe(403)

    const accepted = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: `sid=${cookie}`, 'x-requested-with': 'fetch' },
    })
    expect(accepted.statusCode).toBe(204)
  })

  it('accepts application/json without the custom header (layer satisfied)', async () => {
    const { cookie } = await t.asRole('user')

    const response = await t.app.inject({
      method: 'POST',
      url: '/api/v1/cards',
      headers: { cookie: `sid=${cookie}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ title: 'JSON is fine' }),
    })

    expect(response.statusCode).toBe(201)
  })
})

describe('rate limiting', () => {
  it('429s past the global per-IP budget with Retry-After problem+json', async () => {
    const tight = await createTestApp({
      rateLimits: { global: { max: 3, timeWindowMs: 60_000 } },
    })
    try {
      const ip = nextClientIp()
      const hit = () => tight.app.inject({ method: 'GET', url: '/healthz', remoteAddress: ip })

      const first = await hit()
      expect(first.statusCode).toBe(200)
      expect(first.headers['x-ratelimit-limit']).toBeDefined()
      await hit()
      await hit()

      const blocked = await hit()
      expect(blocked.statusCode).toBe(429)
      expect(blocked.headers['content-type']).toContain('application/problem+json')
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
      expect(blocked.json<{ type: string }>().type).toBe('urn:rivian-kanban:problem:rate-limited')
    } finally {
      await tight.cleanup()
    }
  })

  it('counts unauthenticated and garbage-cookie floods against the global bucket', async () => {
    // The bucket must fire BEFORE session auth: 401-flood traffic (no or
    // invalid cookie) is exactly the DoS profile the blanket per-IP limit
    // exists to stop — a route-level limiter would never see it.
    const tight = await createTestApp({
      rateLimits: { global: { max: 3, timeWindowMs: 60_000 } },
    })
    try {
      const flood = async (headers: Record<string, string>) => {
        const ip = nextClientIp()
        const statuses: number[] = []
        for (let hit = 0; hit < 5; hit += 1) {
          const response = await tight.app.inject({
            method: 'GET',
            url: '/api/v1/board',
            remoteAddress: ip,
            headers,
          })
          statuses.push(response.statusCode)
        }
        return statuses
      }

      const noCookie = await flood({})
      const garbageCookie = await flood({ cookie: 'sid=garbage-session-id' })

      expect(noCookie).toEqual([401, 401, 401, 429, 429])
      expect(garbageCookie).toEqual([401, 401, 401, 429, 429])
    } finally {
      await tight.cleanup()
    }
  })

  it('counts unknown-route floods (404s) against the global bucket', async () => {
    const tight = await createTestApp({
      rateLimits: { global: { max: 3, timeWindowMs: 60_000 } },
    })
    try {
      const ip = nextClientIp()
      const statuses: number[] = []
      for (let hit = 0; hit < 5; hit += 1) {
        const response = await tight.app.inject({
          method: 'GET',
          url: '/no/such/route',
          remoteAddress: ip,
        })
        statuses.push(response.statusCode)
      }

      expect(statuses).toEqual([404, 404, 404, 429, 429])
    } finally {
      await tight.cleanup()
    }
  })

  it('applies the tighter login bucket per IP', async () => {
    const tight = await createTestApp({
      rateLimits: { login: { max: 2, timeWindowMs: 60_000 } },
    })
    try {
      const ip = nextClientIp()
      let probe = 0
      // Distinct emails per attempt: the per-ACCOUNT backoff must not fire —
      // this test pins the per-IP bucket alone.
      const attempt = () => {
        probe += 1
        return tight.app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          remoteAddress: ip,
          headers: { 'content-type': 'application/json' },
          payload: { email: `probe-${String(probe)}@test.example`, password: 'wrong-password' },
        })
      }

      expect((await attempt()).statusCode).toBe(401)
      expect((await attempt()).statusCode).toBe(401)
      const blocked = await attempt()
      expect(blocked.statusCode).toBe(429)
      expect(blocked.headers['retry-after']).toBeDefined()
    } finally {
      await tight.cleanup()
    }
  })
})

describe('problem+json everywhere', () => {
  it('formats unknown /api routes as problem 404', async () => {
    const { cookie } = await t.asRole('user')

    const response = await t.request(cookie, { method: 'GET', url: '/api/v1/does-not-exist' })

    expect(response.statusCode).toBe(404)
    expect(response.headers['content-type']).toContain('application/problem+json')
  })

  it('formats validation failures with an issues array', async () => {
    const { cookie } = await t.asRole('user')

    const response = await t.request(cookie, {
      method: 'POST',
      url: '/api/v1/cards',
      payload: { title: '' },
    })

    expect(response.statusCode).toBe(400)
    const body = response.json<{ type: string; issues: { path: string; message: string }[] }>()
    expect(body.type).toBe('urn:rivian-kanban:problem:validation')
    expect(body.issues.length).toBeGreaterThan(0)
  })
})

describe('OpenAPI + docs UI', () => {
  it('session-gates openapi.json and serves it to authenticated users', async () => {
    const anonymous = await t.app.inject({ method: 'GET', url: '/api/v1/openapi.json' })
    expect(anonymous.statusCode).toBe(401)

    const { cookie } = await t.asRole('user')
    const response = await t.request(cookie, { method: 'GET', url: '/api/v1/openapi.json' })

    expect(response.statusCode).toBe(200)
    const spec = response.json<{ openapi: string; paths: Record<string, unknown> }>()
    expect(spec.openapi).toBe('3.1.0')
    expect(Object.keys(spec.paths)).toContain('/api/v1/cards')
  })

  it('serves the Scalar docs UI outside production', async () => {
    const { cookie } = await t.asRole('user')

    const entry = await t.request(cookie, { method: 'GET', url: '/api/v1/docs' })
    // The Scalar plugin redirects the bare prefix to its trailing-slash UI.
    expect([200, 301, 302]).toContain(entry.statusCode)

    const ui = await t.request(cookie, { method: 'GET', url: '/api/v1/docs/' })
    expect(ui.statusCode).toBe(200)
    expect(ui.body).toContain('openapi.json')
  })
})

describe('operational endpoints', () => {
  it('healthz, readyz, and version respond unauthenticated with no sensitive data', async () => {
    const health = await t.app.inject({ method: 'GET', url: '/healthz' })
    const ready = await t.app.inject({ method: 'GET', url: '/readyz' })
    const version = await t.app.inject({ method: 'GET', url: '/version' })

    expect(health.json()).toEqual({ status: 'ok' })
    expect(ready.json()).toEqual({ status: 'ok' })
    expect(version.json()).toEqual({ version: 'dev', gitSha: 'dev', builtAt: 'dev' })
  })
})
