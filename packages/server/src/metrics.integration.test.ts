import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { type Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startMetricsServer, type MetricsServer } from './metrics/metrics-server.ts'
import { createTestApp, type TestApp } from './test/support.ts'

/**
 * The Prometheus surface end-to-end (docs/architecture/deployment.md
 * #observability): boot BOTH listeners — the public app on a real socket and
 * the internal metrics listener — drive real traffic (REST, MCP, SSE, blob
 * writes), scrape /metrics over HTTP, and assert every documented family is
 * present. The public app must never serve the Prometheus payload — including
 * through the SPA catch-all the production image configures via SPA_DIR.
 */

let t: TestApp
let baseUrl: string
let metricsServer: MetricsServer

beforeEach(async () => {
  t = await createTestApp()
  await t.app.listen({ port: 0, host: '127.0.0.1' })
  const address = t.app.server.address()
  if (address === null || typeof address === 'string') throw new Error('no listen address')
  baseUrl = `http://127.0.0.1:${String(address.port)}`
  metricsServer = await startMetricsServer(t.wired.deps.metrics, { host: '127.0.0.1', port: 0 })
})

afterEach(async () => {
  await metricsServer.close()
  await t.cleanup()
})

async function scrape(): Promise<string> {
  const response = await fetch(`${metricsServer.url}/metrics`)
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('text/plain')
  return response.text()
}

describe('metrics listener', () => {
  it('serves /metrics on its own internal listener — never on the public app', async () => {
    const internal = await fetch(`${metricsServer.url}/metrics`)
    // spaRoot is null in this harness, so an unrouted GET is a plain 404.
    const publicApp = await t.request(null, { method: 'GET', url: '/metrics' })

    expect(metricsServer.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(internal.status).toBe(200)
    expect(publicApp.statusCode).toBe(404)
  })

  it('never leaks the Prometheus payload through the SPA fallback the image ships', async () => {
    // The production image sets SPA_DIR, so the catch-all answers unknown GETs
    // (including /metrics) with 200 index.html. The isolation invariant is
    // therefore about CONTENT, not status: the public port must serve the SPA
    // shell there, never the Prometheus exposition.
    const spaDir = mkdtempSync(join(tmpdir(), 'rivian-kanban-metrics-spa-'))
    writeFileSync(join(spaDir, 'index.html'), '<!doctype html><title>rivian-kanban spa</title>')
    const withSpa = await createTestApp({ spaRoot: spaDir })
    try {
      const viaSpa = await withSpa.request(null, { method: 'GET', url: '/metrics' })

      expect(viaSpa.statusCode).toBe(200)
      expect(viaSpa.headers['content-type']).toContain('text/html')
      expect(viaSpa.body).toContain('rivian-kanban spa')
      expect(viaSpa.body).not.toContain('# TYPE')
    } finally {
      await withSpa.cleanup()
      rmSync(spaDir, { recursive: true, force: true })
    }
  })

  it('exposes default process metrics and every documented custom family', async () => {
    const body = await scrape()

    const families = [
      'process_cpu_user_seconds_total',
      '# TYPE http_request_duration_seconds histogram',
      '# TYPE sse_clients gauge',
      '# TYPE mcp_tool_calls_total counter',
      '# TYPE job_runs_total counter',
      '# TYPE job_duration_seconds histogram',
      '# TYPE sqlite_wal_size_bytes gauge',
      '# TYPE blob_dir_size_bytes gauge',
      '# TYPE data_volume_free_bytes gauge',
    ]
    expect(families.filter((family) => !body.includes(family))).toEqual([])
  })

  it('observes HTTP latency per templated route (never per raw URL)', async () => {
    const { user, cookie } = await t.asRole('user')
    const created = await t.request(cookie, {
      method: 'POST',
      url: '/api/v1/cards',
      payload: { title: 'measure me' },
    })
    expect(created.statusCode).toBe(201)
    const cardId = created.json<{ id: string }>().id
    const detail = await t.request(cookie, { method: 'GET', url: `/api/v1/cards/${cardId}` })
    expect(detail.statusCode).toBe(200)

    const body = await scrape()

    expect(body).toContain('route="/api/v1/cards"')
    expect(body).toContain('route="/api/v1/cards/:id"')
    expect(body).not.toContain(cardId)
    expect(body).not.toContain(user.email)
  })

  it('counts MCP tool calls through the real mount', async () => {
    const admin = await t.asRole('admin')
    const minted = await t.request(admin.cookie, {
      method: 'POST',
      url: '/api/v1/service-tokens',
      payload: { name: 'metrics probe', role: 'user', scope: 'read' },
    })
    expect(minted.statusCode).toBe(201)
    const rawToken = minted.json<{ rawToken: string }>().rawToken
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${rawToken}` } },
    })
    const client = new Client({ name: 'metrics-test', version: '0.0.0' })
    // Cast: the SDK's transport class getters return `T | undefined`, which
    // its own Transport interface rejects under exactOptionalPropertyTypes.
    await client.connect(transport as Transport)
    try {
      await client.callTool({ name: 'get_board_snapshot', arguments: {} })
    } finally {
      await client.close()
    }

    const body = await scrape()

    expect(body).toContain('mcp_tool_calls_total{tool="get_board_snapshot",outcome="success"} 1')
  })

  it('gauges live SSE clients through the stream bookkeeping', async () => {
    const { cookie } = await t.asRole('user')
    const controller = new AbortController()
    const stream = await fetch(`${baseUrl}/api/v1/stream`, {
      headers: { accept: 'text/event-stream', cookie: `sid=${cookie}` },
      signal: controller.signal,
    })
    expect(stream.status).toBe(200)
    // Wait for the hello comment: the stream is registered once it flows.
    const reader = stream.body?.getReader()
    await reader?.read()

    const whileOpen = await scrape()
    expect(whileOpen).toContain('sse_clients 1')

    controller.abort()
    // The close is asynchronous; poll the real scrape until the gauge drops.
    const deadline = Date.now() + 5000
    let droppedToZero = false
    while (Date.now() < deadline && !droppedToZero) {
      droppedToZero = (await scrape()).includes('sse_clients 0')
      if (!droppedToZero) await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(droppedToZero).toBe(true)
  })

  it('reports SQLite WAL size, blob directory bytes, and volume free space', async () => {
    // Boot migrations + seed already wrote through the WAL; add a blob so the
    // directory gauge has something to sum.
    await t.wired.deps.blobStore.put('11111111-2222-4333-8444-555555555555', new Uint8Array(2048))

    const body = await scrape()

    const value = (name: string): number => {
      const line = body.split('\n').find((candidate) => candidate.startsWith(`${name} `))
      if (line === undefined) throw new Error(`gauge ${name} missing:\n${body}`)
      return Number(line.slice(name.length + 1))
    }
    expect(value('sqlite_wal_size_bytes')).toBeGreaterThan(0)
    expect(value('blob_dir_size_bytes')).toBeGreaterThanOrEqual(2048)
    expect(value('data_volume_free_bytes')).toBeGreaterThan(0)
  })
})
