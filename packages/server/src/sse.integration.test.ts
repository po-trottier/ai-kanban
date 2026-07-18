import { request as httpRequest, type IncomingMessage } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from './test/support.ts'

/**
 * SSE over a REAL listening socket (docs/dev/testing.md): raw HTTP client,
 * invalidation hints on mutations, keepalive comments, the per-user
 * 5-stream cap dropping the oldest, and session-gated access (ADR-008).
 */

let t: TestApp
let baseUrl: string
let port: number

beforeAll(async () => {
  t = await createTestApp({ sse: { keepaliveMs: 120, maxStreamsPerUser: 5 } })
  await t.app.listen({ port: 0, host: '127.0.0.1' })
  const address = t.app.server.address()
  if (address === null || typeof address === 'string') throw new Error('no listen address')
  port = address.port
  baseUrl = `http://127.0.0.1:${String(port)}`
})

afterAll(async () => {
  await t.cleanup()
})

interface SseClient {
  received(): string
  waitFor(needle: string, timeoutMs?: number): Promise<void>
  closed: Promise<void>
  destroy(): void
  response: IncomingMessage
}

function openStream(cookie: string | null): Promise<SseClient> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      `${baseUrl}/api/v1/stream`,
      {
        headers: {
          accept: 'text/event-stream',
          ...(cookie === null ? {} : { cookie: `sid=${cookie}` }),
        },
      },
      (response) => {
        let buffer = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => {
          buffer += chunk
        })
        const closed = new Promise<void>((resolveClosed) => {
          response.on('close', resolveClosed)
          response.on('end', resolveClosed)
        })
        resolve({
          response,
          received: () => buffer,
          closed,
          destroy: () => req.destroy(),
          waitFor: (needle, timeoutMs = 5_000) =>
            new Promise((resolveWait, rejectWait) => {
              const startedAt = Date.now()
              const poll = setInterval(() => {
                if (buffer.includes(needle)) {
                  clearInterval(poll)
                  resolveWait()
                } else if (Date.now() - startedAt > timeoutMs) {
                  clearInterval(poll)
                  rejectWait(new Error(`timed out waiting for ${needle} in: ${buffer}`))
                }
              }, 10)
            }),
        })
      },
    )
    req.on('error', reject)
    req.end()
  })
}

/** Status of a plain (non-streaming) request against the live listener. */
function statusOf(path: string, cookie: string | null): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      `${baseUrl}${path}`,
      { headers: cookie === null ? {} : { cookie: `sid=${cookie}` } },
      (response) => {
        response.resume()
        resolve(response.statusCode ?? 0)
      },
    )
    req.on('error', reject)
    req.end()
  })
}

describe('GET /api/v1/stream', () => {
  it('requires an authenticated session', async () => {
    const status = await statusOf('/api/v1/stream', null)

    expect(status).toBe(401)
  })

  it('streams invalidation hints for committed mutations', async () => {
    const { cookie } = await t.asRole('user')
    const client = await openStream(cookie)
    await client.waitFor(':connected')

    const created = await t.request(cookie, {
      method: 'POST',
      url: '/api/v1/cards',
      payload: { title: 'Streamed card' },
    })
    expect(created.statusCode).toBe(201)
    const cardId = created.json<{ id: string }>().id

    await client.waitFor(cardId)
    const dataLine = client
      .received()
      .split('\n')
      .find((line) => line.startsWith('data: '))
    expect(dataLine).toBeDefined()
    const hint = JSON.parse((dataLine ?? '').slice('data: '.length)) as Record<string, unknown>
    expect(hint).toMatchObject({ type: 'card.created', cardId, version: 1 })
    expect(typeof hint.eventId).toBe('string')

    client.destroy()
  })

  it('emits keepalive comments so idle proxies keep the connection', async () => {
    const { cookie } = await t.asRole('user')
    const client = await openStream(cookie)

    await client.waitFor(':keepalive', 3_000)

    expect(client.received()).toContain(':keepalive')
    client.destroy()
  })

  it('drops the oldest stream when a user opens a sixth connection', async () => {
    const { cookie } = await t.asRole('admin')
    const clients: SseClient[] = []
    for (let index = 0; index < 5; index += 1) {
      clients.push(await openStream(cookie))
    }
    const oldest = clients[0]
    if (oldest === undefined) throw new Error('no clients')

    const sixth = await openStream(cookie)
    await expect(oldest.closed).resolves.toBeUndefined()

    // The five newest stay live: a broadcast still reaches the sixth.
    const created = await t.request(cookie, {
      method: 'POST',
      url: '/api/v1/cards',
      payload: { title: 'Cap check' },
    })
    const cardId = created.json<{ id: string }>().id
    await sixth.waitFor(cardId)
    expect(sixth.received()).toContain(cardId)
    // The dropped stream never saw the hint.
    expect(oldest.received()).not.toContain(cardId)

    for (const client of [...clients.slice(1), sixth]) client.destroy()
  })

  it('unsubscribes closed connections from the bus', async () => {
    const { cookie } = await t.asRole('user')
    const client = await openStream(cookie)
    await client.waitFor(':connected')
    client.destroy()
    // Allow the close event to propagate and unsubscribe.
    await new Promise((resolve) => setTimeout(resolve, 50))

    const before = client.received().length
    await t.request(cookie, {
      method: 'POST',
      url: '/api/v1/cards',
      payload: { title: 'After close' },
    })
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(client.received().length).toBe(before)
  })

  it('releases the bus subscription when the client disconnects during auth', async () => {
    const { cookie } = await t.asRole('user')
    const before = t.wired.deps.eventBus.subscriberCount()

    // Destroy the socket the moment the request is written — racing the
    // async session lookup that runs before the stream handler.
    await new Promise<void>((resolve) => {
      const req = httpRequest(`${baseUrl}/api/v1/stream`, {
        headers: { accept: 'text/event-stream', cookie: `sid=${cookie}` },
      })
      req.on('error', () => {
        resolve()
      })
      req.on('close', () => {
        resolve()
      })
      req.end(() => req.destroy())
    })
    // Let the aborted request's lifecycle (auth read + handler) finish.
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(t.wired.deps.eventBus.subscriberCount()).toBe(before)
  })

  it('ends the stream within one keepalive after the user is deactivated', async () => {
    const admin = await t.asRole('admin')
    const victim = await t.asRole('user')
    const client = await openStream(victim.cookie)
    await client.waitFor(':connected')

    const deactivated = await t.request(admin.cookie, {
      method: 'PATCH',
      url: `/api/v1/users/${victim.user.id}`,
      payload: { isActive: false },
    })
    expect(deactivated.statusCode).toBe(200)

    // The next keepalive tick (120 ms here) re-validates the session and
    // closes the stream — revocation is immediate everywhere (security.md).
    await expect(client.closed).resolves.toBeUndefined()
  })
})

describe('graceful shutdown with connected SSE clients', () => {
  it('app.close() resolves while a stream is open and ends the stream', async () => {
    const solo = await createTestApp({ sse: { keepaliveMs: 120, maxStreamsPerUser: 5 } })
    await solo.app.listen({ port: 0, host: '127.0.0.1' })
    const address = solo.app.server.address()
    if (address === null || typeof address === 'string') throw new Error('no listen address')
    const soloUrl = `http://127.0.0.1:${String(address.port)}`

    const { cookie } = await solo.asRole('user')
    const client = await new Promise<SseClient>((resolve, reject) => {
      const req = httpRequest(
        `${soloUrl}/api/v1/stream`,
        { headers: { accept: 'text/event-stream', cookie: `sid=${cookie}` } },
        (response) => {
          let buffer = ''
          response.setEncoding('utf8')
          response.on('data', (chunk: string) => {
            buffer += chunk
          })
          const closed = new Promise<void>((resolveClosed) => {
            response.on('close', resolveClosed)
            response.on('end', resolveClosed)
          })
          resolve({
            response,
            received: () => buffer,
            closed,
            destroy: () => req.destroy(),
            waitFor: () => Promise.reject(new Error('unused')),
          })
        },
      )
      req.on('error', reject)
      req.end()
    })

    // Deliberately do NOT destroy the client: production browsers won't.
    const closeResult = await Promise.race([
      solo.cleanup().then(() => 'closed'),
      new Promise((resolve) => {
        setTimeout(() => {
          resolve('hung')
        }, 10_000)
      }),
    ])

    expect(closeResult).toBe('closed')
    await expect(client.closed).resolves.toBeUndefined()
  })
})
