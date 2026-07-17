import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Uuidv7IdGenerator, type Role, type User } from '@rivian-kanban/core'
import {
  type FastifyInstance,
  type InjectOptions,
  type LightMyRequestResponse as InjectResponse,
} from 'fastify'
import { buildApp } from '../app.ts'
import { type Argon2Params } from '../auth/password-hasher.ts'
import { parseEnv } from '../env.ts'
import { wireApp, type WiredApp, type WireOptions } from '../wiring/wire.ts'

/**
 * Integration-test harness (docs/dev/testing.md): every test file owns a real
 * temp SQLite database with real migrations and the real structural seed,
 * exercised through the real Fastify app via `app.inject()`. No mocks —
 * differences from production are configuration injected through the same
 * constructors (cheap argon2 cost, silent logs, roomy default rate limits).
 */

/** argon2 lib minimums — same argon2id code path, milliseconds per hash. */
export const TEST_ARGON2: Argon2Params = { memoryCost: 2048, timeCost: 2, parallelism: 1 }

export interface TestAppOptions extends WireOptions {
  seedDemoData?: boolean
  /** Extra env vars for the boot (e.g. SLACK_* pointing at fixture servers). */
  env?: Record<string, string>
}

export interface TestApp {
  app: FastifyInstance
  wired: WiredApp
  /** The parsed env this app booted from (re-wiring the same db in tests). */
  env: ReturnType<typeof parseEnv>
  cleanup(): Promise<void>
  /** Directly inserts an active user with a known password (fast arrange). */
  createUser(role: Role, overrides?: Partial<User>): Promise<{ user: User; password: string }>
  /** POST /auth/login from a unique client IP; returns the session cookie value. */
  login(email: string, password: string): Promise<string>
  /** createUser + login in one step. */
  asRole(role: Role): Promise<{ user: User; password: string; cookie: string }>
  /** app.inject with the session cookie + JSON/CSRF headers pre-set. */
  request(cookie: string | null, options: InjectOptions): Promise<InjectResponse>
}

const ids = new Uuidv7IdGenerator()
let ipCounter = 0

/** A unique loopback-adjacent client IP so per-IP buckets never collide. */
export function nextClientIp(): string {
  ipCounter += 1
  return `10.99.${String(Math.floor(ipCounter / 250))}.${String((ipCounter % 250) + 1)}`
}

export function sessionCookieOf(response: InjectResponse): string {
  const cookie = response.cookies.find((candidate) => candidate.name === 'sid')
  if (cookie === undefined) throw new Error('response set no session cookie')
  return cookie.value
}

export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'rivian-kanban-server-'))
  const { seedDemoData, env: envOverrides, ...wireOptions } = options
  const env = parseEnv({
    NODE_ENV: 'test',
    DATABASE_PATH: join(dir, 'test.sqlite'),
    BLOB_DIR: join(dir, 'blobs'),
    SEED_DEMO_DATA: seedDemoData === true ? 'true' : 'false',
    ...envOverrides,
  })
  const wired = await wireApp(env, {
    hasherParams: TEST_ARGON2,
    logLevel: 'silent',
    maxEventLoopDelayMs: 0,
    spaRoot: null,
    ...wireOptions,
    rateLimits: {
      // Roomy defaults so unrelated tests never trip buckets; the security
      // suite passes tight budgets explicitly.
      global: { max: 100_000, timeWindowMs: 60_000 },
      login: { max: 100_000, timeWindowMs: 60_000 },
      upload: { max: 100_000, timeWindowMs: 60_000 },
      ...wireOptions.rateLimits,
    },
  })
  const app = await buildApp(wired.deps)
  await app.ready()

  let userCounter = 0
  const createUser: TestApp['createUser'] = async (role, overrides = {}) => {
    userCounter += 1
    const password = `correct-horse-${String(userCounter)}-staple`
    const passwordHash = await wired.hasher.hash(password)
    const user: User = {
      id: ids.newId(),
      email: `user${String(userCounter)}-${role}@test.example`,
      displayName: `Test ${role} ${String(userCounter)}`,
      role,
      mustChangePassword: false,
      slackUserId: null,
      isActive: true,
      createdAt: new Date().toISOString(),
      ...overrides,
    }
    await wired.deps.uow.run((tx) => tx.userAccounts.insert(user, passwordHash))
    return { user, password }
  }

  const login: TestApp['login'] = async (email, password) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: nextClientIp(),
      headers: { 'content-type': 'application/json' },
      payload: { email, password },
    })
    if (response.statusCode !== 200) {
      throw new Error(`login failed (${String(response.statusCode)}): ${response.body}`)
    }
    return sessionCookieOf(response)
  }

  const asRole: TestApp['asRole'] = async (role) => {
    const { user, password } = await createUser(role)
    const cookie = await login(user.email, password)
    return { user, password, cookie }
  }

  const request: TestApp['request'] = (cookie, injectOptions) => {
    const method = (injectOptions.method ?? 'GET').toUpperCase()
    const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
    const hasBody = injectOptions.payload !== undefined || injectOptions.body !== undefined
    return app.inject({
      remoteAddress: nextClientIp(),
      ...injectOptions,
      headers: {
        ...(cookie !== null ? { cookie: `sid=${cookie}` } : {}),
        // CSRF layer: JSON bodies declare application/json; bodyless
        // mutations carry X-Requested-With (docs/architecture/security.md).
        ...(mutating && hasBody ? { 'content-type': 'application/json' } : {}),
        ...(mutating && !hasBody ? { 'x-requested-with': 'rivian-kanban' } : {}),
        ...injectOptions.headers,
      },
    })
  }

  return {
    app,
    wired,
    env,
    cleanup: async () => {
      await app.close()
      wired.connection.close()
      rmSync(dir, { recursive: true, force: true })
    },
    createUser,
    login,
    asRole,
    request,
  }
}

/** Minimal real file fixtures (docs/dev/testing.md — real bytes, no fakes). */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

export const MINIMAL_PDF = Buffer.from(
  `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >> endobj
xref
0 4
trailer << /Size 4 /Root 1 0 R >>
%%EOF
`,
  'ascii',
)

/** A Windows-executable header (MZ + PE stub) — must be rejected 415. */
export const EXE_HEADER = Buffer.concat([
  Buffer.from('MZ', 'ascii'),
  Buffer.alloc(62, 0),
  Buffer.from([0x50, 0x45, 0x00, 0x00]),
  Buffer.alloc(200, 0x90),
])

/** Multipart body helper for upload tests. */
export function multipartBody(
  filename: string,
  bytes: Buffer,
  contentType = 'application/octet-stream',
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----riviankanban-test-boundary'
  const head = Buffer.from(
    `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${filename}"\r\ncontent-type: ${contentType}\r\n\r\n`,
    'utf8',
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
  return {
    payload: Buffer.concat([head, bytes, tail]),
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'x-requested-with': 'rivian-kanban',
    },
  }
}
