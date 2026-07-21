import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { type Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  DEFAULT_POLICY_DOCUMENT,
  type Card,
  type CardEvent,
  type Comment,
  type Role,
  type TokenScope,
} from '@rivian-kanban/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { consentCsrfToken } from './oauth/consent-page.ts'
import { createTestApp, type TestApp } from './test/support.ts'

/**
 * MCP e2e (docs/architecture/mcp.md#testing): the SDK's own client speaks
 * Streamable HTTP to the real Fastify app over a real listening socket (the
 * one listen-based file the socket-smoke budget allows) — real temp SQLite,
 * demo seed, real service tokens minted through the admin REST routes.
 */

const MCP_TOOL_NAMES = [
  'get_board_snapshot',
  'list_cards',
  'get_card',
  'get_card_history',
  'list_stale_cards',
  'list_activity',
  'list_lanes',
  'list_locations',
  'list_tags',
  'list_blocked_cards',
  'whoami',
  'create_card',
  'update_card',
  'move_card',
  'comment_on_card',
  'cancel_card',
  'reopen_card',
  'archive_card',
  'block_card',
  'unblock_card',
] as const

let t: TestApp
let baseUrl: string
let adminCookie: string
let adminId: string
let writer: { id: string; raw: string }
let reader: { id: string; raw: string }
const openClients: Client[] = []

interface ToolContent {
  type: string
  text: string
}

interface ToolResult {
  isError?: boolean
  content: ToolContent[]
}

async function mintToken(name: string, role: Role, scope: TokenScope) {
  const response = await t.request(adminCookie, {
    method: 'POST',
    url: '/api/v1/service-tokens',
    payload: { name, role, scope },
  })
  if (response.statusCode !== 201) throw new Error(`token mint failed: ${response.body}`)
  const body = response.json<{ token: { id: string }; rawToken: string }>()
  return { id: body.token.id, raw: body.rawToken }
}

const OAUTH_RESOURCE = 'http://localhost:3000/mcp'
const OAUTH_REDIRECT = 'http://127.0.0.1:8765/callback'

/**
 * Runs the FULL OAuth 2.1 flow through the real AS routes as `sessionCookie`'s
 * user (register → authorize GET → consent approve → code+PKCE token exchange)
 * and returns the minted `rka_` access token — the exact credential an agent
 * like Claude Code obtains after the human approves in the browser.
 */
async function mintAccessTokenFor(
  sessionCookie: string,
  clientName: string,
  scope: 'read' | 'read_write',
): Promise<string> {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')

  const registered = await t.app.inject({
    method: 'POST',
    url: '/oauth/register',
    headers: { 'content-type': 'application/json' },
    payload: { client_name: clientName, redirect_uris: [OAUTH_REDIRECT] },
  })
  const clientId = registered.json<{ client_id: string }>().client_id

  const authorizeFields = {
    client_id: clientId,
    redirect_uri: OAUTH_REDIRECT,
    resource: OAUTH_RESOURCE,
    scope,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: randomBytes(8).toString('hex'),
  }
  const approve = await t.app.inject({
    method: 'POST',
    url: '/oauth/authorize',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: `sid=${sessionCookie}`,
    },
    payload: new URLSearchParams({
      ...authorizeFields,
      csrf: consentCsrfToken(sessionCookie),
      decision: 'approve',
    }).toString(),
  })
  if (approve.statusCode !== 302) throw new Error(`authorize failed: ${approve.body}`)
  const code = new URL(String(approve.headers.location)).searchParams.get('code') ?? ''

  const token = await t.app.inject({
    method: 'POST',
    url: '/oauth/token',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: clientId,
      redirect_uri: OAUTH_REDIRECT,
      resource: OAUTH_RESOURCE,
    }).toString(),
  })
  if (token.statusCode !== 200) throw new Error(`token exchange failed: ${token.body}`)
  return token.json<{ access_token: string }>().access_token
}

async function connect(rawToken: string | null, url = `${baseUrl}/mcp`): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: rawToken === null ? {} : { headers: { authorization: `Bearer ${rawToken}` } },
  })
  const client = new Client({ name: 'rivian-kanban-tests', version: '0.0.0' })
  // Cast: the SDK's transport class getters return `T | undefined`, which its
  // own Transport interface rejects under exactOptionalPropertyTypes.
  await client.connect(transport as Transport)
  openClients.push(client)
  return client
}

async function call(client: Client, name: string, args?: Record<string, unknown>) {
  return (await client.callTool({ name, arguments: args ?? {} })) as ToolResult
}

function jsonOf(result: ToolResult): unknown {
  const first = result.content[0]
  if (first === undefined) throw new Error('tool result had no content')
  return JSON.parse(first.text)
}

/** Calls a tool and parses the JSON payload, failing loudly on tool errors. */
async function callOk<T>(client: Client, name: string, args?: Record<string, unknown>) {
  const result = await call(client, name, args)
  if (result.isError === true) {
    throw new Error(`tool ${name} failed: ${result.content[0]?.text ?? '<no content>'}`)
  }
  return jsonOf(result) as T
}

interface Problem {
  type: string
  status: number
  [extra: string]: unknown
}

/** Calls a tool expecting a problem-shaped tool error. */
async function callProblem(client: Client, name: string, args?: Record<string, unknown>) {
  const result = await call(client, name, args)
  expect(result.isError).toBe(true)
  return jsonOf(result) as Problem
}

interface SnapshotLane {
  lane: { id: string; key: string; wipLimit: number | null }
  cardCount: number
  blockedCount: number
  wipLimitExceeded: boolean
  oldestCardCreatedAt: string | null
  cards: { id: number; title: string; createdAt: string }[]
}

/**
 * The current top card of a lane (position order) — cross-lane moves into a
 * non-empty lane need a real neighbor, exactly like REST drags (ADR-006).
 */
async function laneTopId(client: Client, laneKey: string): Promise<number | null> {
  const snapshot = await callOk<{ lanes: SnapshotLane[] }>(client, 'get_board_snapshot')
  return snapshot.lanes.find((entry) => entry.lane.key === laneKey)?.cards[0]?.id ?? null
}

function rawInitializeRequest(headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'raw', version: '0.0.0' },
      },
    }),
  })
}

beforeAll(async () => {
  t = await createTestApp({ seedDemoData: true })
  const address = await t.app.listen({ port: 0, host: '127.0.0.1' })
  baseUrl = address
  const admin = await t.asRole('admin')
  adminCookie = admin.cookie
  adminId = admin.user.id
  writer = await mintToken('writer agent', 'user', 'read_write')
  reader = await mintToken('reporting agent', 'user', 'read')
})

afterAll(async () => {
  for (const client of openClients) await client.close().catch(() => undefined)
  await t.cleanup()
})

describe('handshake and discovery', () => {
  it('completes the initialize handshake and reports the server identity', async () => {
    const client = await connect(writer.raw)

    expect(client.getServerVersion()).toMatchObject({ name: 'rivian-kanban' })
  })

  it('lists exactly the documented tools with descriptions', async () => {
    const client = await connect(reader.raw)

    const { tools } = await client.listTools()

    expect(tools.map((tool) => tool.name).sort()).toEqual([...MCP_TOOL_NAMES].sort())
    for (const tool of tools) {
      expect(tool.description, `${tool.name} description`).toBeTruthy()
      // mcp.md#tools: result shapes are core schemas exposed as JSON Schema.
      expect(tool.outputSchema, `${tool.name} output schema`).toBeTruthy()
    }
    const stale = tools.find((tool) => tool.name === 'list_stale_cards')
    expect(stale?.description).toContain('default 7')
    expect(stale?.description).toContain('default 3')
  })

  it('tags reads read-only and writes non-read-only (not the pessimistic SDK defaults)', async () => {
    const client = await connect(reader.raw)
    const { tools } = await client.listTools()
    const hintsOf = (name: string) => tools.find((tool) => tool.name === name)?.annotations

    // Every read tool: read-only, non-destructive, idempotent, closed-world.
    const readTools = [
      'get_board_snapshot',
      'list_cards',
      'get_card',
      'get_card_history',
      'list_stale_cards',
      'list_activity',
      'list_lanes',
      'list_locations',
      'list_tags',
      'list_blocked_cards',
      'whoami',
    ]
    for (const name of readTools) {
      expect(hintsOf(name), `${name} hints`).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      })
    }

    // Every write tool is non-read-only and closed-world.
    const writeTools = [
      'create_card',
      'update_card',
      'move_card',
      'comment_on_card',
      'cancel_card',
      'reopen_card',
      'archive_card',
      'block_card',
      'unblock_card',
    ]
    for (const name of writeTools) {
      expect(hintsOf(name), `${name} hints`).toMatchObject({
        readOnlyHint: false,
        openWorldHint: false,
      })
    }
  })

  it('flags destructive lifecycle actions and non-idempotent appends per tool', async () => {
    const client = await connect(reader.raw)
    const { tools } = await client.listTools()
    const hintsOf = (name: string) => tools.find((tool) => tool.name === name)?.annotations

    // Destructive/lifecycle terminal actions are flagged destructive; a plain
    // field update is not.
    expect(hintsOf('cancel_card')).toMatchObject({ destructiveHint: true })
    expect(hintsOf('archive_card')).toMatchObject({ destructiveHint: true })
    expect(hintsOf('update_card')).toMatchObject({ destructiveHint: false })

    // Append actions each add a row (non-idempotent); set-to-value updates converge.
    expect(hintsOf('create_card')).toMatchObject({ idempotentHint: false })
    expect(hintsOf('comment_on_card')).toMatchObject({ idempotentHint: false })
    expect(hintsOf('update_card')).toMatchObject({ idempotentHint: true })
    expect(hintsOf('block_card')).toMatchObject({ idempotentHint: true })
  })
})

describe('read tools against the demo seed', () => {
  it('get_board_snapshot returns the 7 lanes with counts, WIP and blocked state', async () => {
    const client = await connect(reader.raw)

    const snapshot = await callOk<{ lanes: SnapshotLane[] }>(client, 'get_board_snapshot')

    expect(snapshot.lanes).toHaveLength(7)
    const inProgress = snapshot.lanes.find((entry) => entry.lane.key === 'in_progress')
    expect(inProgress?.cardCount).toBe(2)
    expect(inProgress?.blockedCount).toBe(1)
    expect(inProgress?.oldestCardCreatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(inProgress?.cards[0]?.id).toEqual(expect.any(Number))
    expect(inProgress?.cards[0]?.id).toBeGreaterThan(0)
  })

  it('list_cards filters by lane and paginates with the shared cursor', async () => {
    const client = await connect(reader.raw)

    const intake = await callOk<{ items: Card[]; nextCursor: string | null }>(
      client,
      'list_cards',
      { lane: 'intake' },
    )
    const firstPage = await callOk<{ items: Card[]; nextCursor: string | null }>(
      client,
      'list_cards',
      { limit: 3 },
    )
    const secondPage = await callOk<{ items: Card[]; nextCursor: string | null }>(
      client,
      'list_cards',
      { limit: 3, cursor: firstPage.nextCursor ?? '' },
    )

    expect(intake.items).toHaveLength(2)
    expect(intake.items.every((card) => card.createdAt.includes('T'))).toBe(true)
    expect(firstPage.items).toHaveLength(3)
    expect(secondPage.items[0]?.id).not.toBe(firstPage.items[0]?.id)
  })

  it('list_cards supports the blocked and q filters', async () => {
    const client = await connect(reader.raw)

    const blocked = await callOk<{ items: Card[] }>(client, 'list_cards', { blocked: true })
    const search = await callOk<{ items: Card[] }>(client, 'list_cards', { q: 'boiler' })

    expect(blocked.items.map((card) => card.title)).toEqual(['Patch drywall in Room 101'])
    expect(search.items.map((card) => card.title)).toEqual(['Boiler recalibration by vendor'])
  })

  it('get_card returns detail with tags, location, attachments, comments and latest events', async () => {
    const client = await connect(reader.raw)
    const { items } = await callOk<{ items: Card[] }>(client, 'list_cards', {
      q: 'loading-dock',
    })
    const cardId = items[0]?.id ?? ''

    const detail = await callOk<{
      card: Card
      tags: unknown[]
      location: unknown
      attachments: unknown[]
      comments: Comment[]
      latestEvents: CardEvent[]
    }>(client, 'get_card', { cardId })

    expect(detail.card.id).toBe(cardId)
    expect(detail.comments).toHaveLength(2)
    expect(detail.comments[1]?.parentCommentId).toBe(detail.comments[0]?.id)
    expect(detail.latestEvents.map((event) => event.eventType)).toContain('comment.added')
    expect(detail.latestEvents.every((event) => event.createdAt.includes('T'))).toBe(true)
  })

  it('get_card_history returns the audit trail oldest-first, filterable by type', async () => {
    const client = await connect(reader.raw)
    const { items } = await callOk<{ items: Card[] }>(client, 'list_cards', { q: 'drywall' })
    const cardId = items[0]?.id ?? ''

    const history = await callOk<{ items: CardEvent[]; nextCursor: string | null }>(
      client,
      'get_card_history',
      { cardId },
    )
    const filtered = await callOk<{ items: CardEvent[] }>(client, 'get_card_history', {
      cardId,
      type: 'card.blocked',
    })

    expect(history.items.map((event) => event.eventType)).toEqual(['card.created', 'card.blocked'])
    expect(filtered.items.map((event) => event.eventType)).toEqual(['card.blocked'])
  })

  it('list_stale_cards applies the documented 7/3-day defaults and accepts overrides', async () => {
    const client = await connect(reader.raw)

    const defaults = await callOk<{ items: { card: Card; reasons: string[] }[] }>(
      client,
      'list_stale_cards',
    )
    const tightened = await callOk<{ items: { card: Card; reasons: string[] }[] }>(
      client,
      'list_stale_cards',
      { reviewDays: 6, blockedDays: 1 },
    )

    expect(defaults.items.flatMap((entry) => entry.reasons)).toEqual(['overdue_resume'])
    const tightenedReasons = tightened.items.flatMap((entry) => entry.reasons)
    expect(tightenedReasons).toContain('stale_review')
    expect(tightenedReasons).toContain('stale_blocked')
  })
})

describe('mutating tools', () => {
  it('create_card lands in intake with origin mcp and the system user as reporter', async () => {
    const client = await connect(writer.raw)

    const card = await callOk<Card>(client, 'create_card', {
      title: 'MCP-created: replace hallway sensor',
      priority: 'P1',
      tags: ['electrical'],
    })

    expect(card.origin).toBe('mcp')
    expect(card.reporterId).toBe(t.wired.systemUserId)
    expect(card.version).toBe(1)
    expect(card.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('create_card resolves reporterEmail to the matching user', async () => {
    const client = await connect(writer.raw)
    const { user } = await t.createUser('user')

    const card = await callOk<Card>(client, 'create_card', {
      title: 'MCP-created on behalf of a requester',
      reporterEmail: user.email,
    })

    expect(card.reporterId).toBe(user.id)
  })

  it('create_card rejects an unknown reporterEmail as not-found', async () => {
    const client = await connect(writer.raw)

    const problem = await callProblem(client, 'create_card', {
      title: 'Reporter cannot be resolved',
      reporterEmail: 'nobody@test.example',
    })

    expect(problem.type).toBe('urn:rivian-kanban:problem:not-found')
  })

  it('create_card rejects a deactivated reporterEmail exactly like an unknown one', async () => {
    // Inactive accounts are not attribution targets (matching the Slack
    // assignee rule), and the identical outcome closes the user-enumeration
    // oracle a distinct error would open.
    const client = await connect(writer.raw)
    const { user } = await t.createUser('user', { isActive: false })

    const problem = await callProblem(client, 'create_card', {
      title: 'Reporter is deactivated',
      reporterEmail: user.email,
    })

    expect(problem.type).toBe('urn:rivian-kanban:problem:not-found')
  })

  it('update_card edits fields under expectedVersion', async () => {
    const client = await connect(writer.raw)
    const card = await callOk<Card>(client, 'create_card', { title: 'To be updated' })

    const updated = await callOk<Card>(client, 'update_card', {
      cardId: card.id,
      title: 'Updated by an agent',
      priority: 'P0',
      expectedVersion: 1,
    })

    expect(updated.title).toBe('Updated by an agent')
    expect(updated.version).toBe(2)
  })

  it('update_card surfaces a version conflict with the current card state', async () => {
    const client = await connect(writer.raw)
    const card = await callOk<Card>(client, 'create_card', { title: 'Conflict target' })
    await callOk<Card>(client, 'update_card', {
      cardId: card.id,
      title: 'First writer wins',
      expectedVersion: 1,
    })

    const problem = await callProblem(client, 'update_card', {
      cardId: card.id,
      title: 'Stale writer loses',
      expectedVersion: 1,
    })

    expect(problem.type).toBe('urn:rivian-kanban:problem:conflict')
    expect((problem.current as Card).version).toBe(2)
  })

  it('move_card moves across lanes under the permissive default policy', async () => {
    const client = await connect(writer.raw)
    const card = await callOk<Card>(client, 'create_card', { title: 'To be moved' })

    const moved = await callOk<Card>(client, 'move_card', {
      cardId: card.id,
      toLane: 'ready',
      nextCardId: await laneTopId(client, 'ready'),
      expectedVersion: 1,
    })

    expect(moved.version).toBe(2)
    const snapshot = await callOk<{ lanes: SnapshotLane[] }>(client, 'get_board_snapshot')
    const ready = snapshot.lanes.find((entry) => entry.lane.key === 'ready')
    expect(ready?.cards.some((entry) => entry.id === card.id)).toBe(true)
  })

  it('move_card into the waiting lane demands waiting fields (validation problem)', async () => {
    const client = await connect(writer.raw)
    const card = await callOk<Card>(client, 'create_card', { title: 'Waiting fields required' })

    const problem = await callProblem(client, 'move_card', {
      cardId: card.id,
      toLane: 'waiting_parts_vendor',
      expectedVersion: 1,
    })

    expect(problem.type).toBe('urn:rivian-kanban:problem:validation')
  })

  it('comment_on_card comments as the system user and threads replies', async () => {
    const client = await connect(writer.raw)
    const card = await callOk<Card>(client, 'create_card', { title: 'Commented by an agent' })

    const comment = await callOk<Comment>(client, 'comment_on_card', {
      cardId: card.id,
      body: 'Agent triage: probable duplicate of the dock leveler ticket.',
    })
    const reply = await callOk<Comment>(client, 'comment_on_card', {
      cardId: card.id,
      body: 'Follow-up: confirmed distinct issue.',
      parentCommentId: comment.id,
    })

    expect(comment.authorId).toBe(t.wired.systemUserId)
    expect(reply.parentCommentId).toBe(comment.id)
  })

  it('get_card blanks soft-deleted comment bodies (deleted content never leaves the server)', async () => {
    const client = await connect(writer.raw)
    const card = await callOk<Card>(client, 'create_card', { title: 'Redaction check' })
    const comment = await callOk<Comment>(client, 'comment_on_card', {
      cardId: card.id,
      body: 'sensitive text the author deliberately deleted',
    })
    const deleted = await t.request(adminCookie, {
      method: 'DELETE',
      url: `/api/v1/comments/${comment.id}`,
    })
    expect(deleted.statusCode).toBe(204)

    const detail = await callOk<{ comments: Comment[] }>(client, 'get_card', { cardId: card.id })

    const thread = detail.comments.find((entry) => entry.id === comment.id)
    expect(thread?.deletedAt).not.toBeNull()
    expect(thread?.body).toBe('')
  })

  it('rejects malformed arguments before any service runs', async () => {
    const client = await connect(writer.raw)

    const result = await call(client, 'create_card', { title: '', bogus: true })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/validation error/i)
  })
})

describe('terminal-action tools', () => {
  it('cancel_card moves the card into done with the resolution', async () => {
    const client = await connect(writer.raw)
    const card = await callOk<Card>(client, 'create_card', { title: 'Cancel via MCP' })

    const cancelled = await callOk<Card>(client, 'cancel_card', {
      cardId: card.id,
      resolution: 'duplicate',
      expectedVersion: 1,
    })

    expect(cancelled.resolution).toBe('duplicate')
    expect(cancelled.version).toBe(2)
  })

  it('reopen_card returns a done card to ready, clearing the resolution', async () => {
    const client = await connect(writer.raw)
    const card = await callOk<Card>(client, 'create_card', { title: 'Reopen via MCP' })
    const cancelled = await callOk<Card>(client, 'cancel_card', {
      cardId: card.id,
      resolution: 'declined',
      expectedVersion: 1,
    })

    const reopened = await callOk<Card>(client, 'reopen_card', {
      cardId: card.id,
      expectedVersion: cancelled.version,
    })

    expect(reopened.resolution).toBeNull()
  })

  it('archive_card sets archivedAt on a done card', async () => {
    const client = await connect(writer.raw)
    const card = await callOk<Card>(client, 'create_card', { title: 'Archive via MCP' })
    const cancelled = await callOk<Card>(client, 'cancel_card', {
      cardId: card.id,
      resolution: 'cancelled',
      expectedVersion: 1,
    })

    const archived = await callOk<Card & { archivedAt: string | null }>(client, 'archive_card', {
      cardId: card.id,
      expectedVersion: cancelled.version,
    })

    expect(archived.archivedAt).not.toBeNull()
  })

  it('block_card and unblock_card toggle the blocked flag with a reason', async () => {
    const client = await connect(writer.raw)
    const card = await callOk<Card>(client, 'create_card', { title: 'Block via MCP' })

    const blocked = await callOk<Card>(client, 'block_card', {
      cardId: card.id,
      reason: 'awaiting sign-off',
      expectedVersion: 1,
    })
    expect(blocked.blocked).toBe(true)
    expect(blocked.blockedReason).toBe('awaiting sign-off')

    const unblocked = await callOk<Card>(client, 'unblock_card', {
      cardId: card.id,
      expectedVersion: blocked.version,
    })
    expect(unblocked.blocked).toBe(false)
  })
})

describe('board-wide read tools', () => {
  it('list_lanes returns the 7 board lanes in position order', async () => {
    const client = await connect(reader.raw)

    const { lanes } = await callOk<{ lanes: { key: string; position: number }[] }>(
      client,
      'list_lanes',
    )

    expect(lanes).toHaveLength(7)
    expect(lanes[0]?.key).toBe('intake')
    const positions = lanes.map((lane) => lane.position)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('list_locations returns the seeded location tree with a root building', async () => {
    const client = await connect(reader.raw)

    const { locations } = await callOk<{
      locations: { id: string; kind: string; name: string; parentId: string | null }[]
    }>(client, 'list_locations')

    // The demo seed plants buildings → floors → rooms; agents resolve an id
    // here before setting card.locationId (the field takes an id, not a name).
    expect(locations.length).toBeGreaterThan(0)
    expect(locations.some((loc) => loc.parentId === null && loc.kind === 'building')).toBe(true)
    expect(locations.every((loc) => loc.id.length > 0 && loc.name.length > 0)).toBe(true)
  })

  it('list_tags returns tags in use, reflecting a freshly tagged card', async () => {
    const client = await connect(writer.raw)
    await callOk<Card>(client, 'create_card', { title: 'Tag discovery', tags: ['electrical'] })

    const { tags } = await callOk<{ tags: { id: string; name: string }[] }>(client, 'list_tags')

    expect(tags.map((tag) => tag.name)).toContain('electrical')
  })

  it('list_activity returns recent board-wide events newest-first, filterable by type', async () => {
    const client = await connect(writer.raw)
    // A fresh mutation guarantees at least one very-recent event in the feed.
    const card = await callOk<Card>(client, 'create_card', { title: 'Activity feed subject' })

    const feed = await callOk<{ items: CardEvent[]; nextCursor: string | null }>(
      client,
      'list_activity',
      { limit: 5 },
    )
    const created = await callOk<{ items: CardEvent[] }>(client, 'list_activity', {
      type: 'card.created',
      cardId: card.id,
    })

    expect(feed.items.length).toBeGreaterThan(0)
    // Newest-first: the timestamps already come sorted descending.
    const timestamps = feed.items.map((event) => event.createdAt)
    expect(timestamps).toEqual([...timestamps].sort((a, b) => (a < b ? 1 : -1)))
    expect(created.items.map((event) => event.eventType)).toEqual(['card.created'])
    expect(created.items[0]?.cardId).toBe(card.id)
  })

  it('list_activity filters by actorKind and enriches mcp events', async () => {
    const client = await connect(writer.raw)
    await callOk<Card>(client, 'create_card', { title: 'MCP actor-kind subject' })

    const mcpOnly = await callOk<{
      items: (CardEvent & { actorKind: string; actorLabel?: string })[]
    }>(client, 'list_activity', { actorKind: 'mcp', limit: 50 })

    expect(mcpOnly.items.length).toBeGreaterThan(0)
    expect(mcpOnly.items.every((event) => event.actorKind === 'mcp')).toBe(true)
    expect(mcpOnly.items.every((event) => event.actorLabel === 'writer agent')).toBe(true)
  })

  it('list_activity gates the cross-user feed: admin token sees all, a user token self-scopes', async () => {
    // A separate REST user creates a card — activity NOT attributable to the
    // reader token's creator (the admin who minted it).
    const { cookie, user } = await t.asRole('user')
    const before = new Date().toISOString()
    const created = await t.request(cookie, {
      method: 'POST',
      url: '/api/v1/cards',
      payload: { title: 'Someone else’s activity' },
    })
    const otherCardId = created.json<{ id: number }>().id

    const adminToken = await mintToken('audit agent', 'admin', 'read')
    const adminClient = await connect(adminToken.raw)
    const readerClient = await connect(reader.raw)

    const seenByAdmin = await callOk<{
      items: (CardEvent & { actorDisplayName?: string })[]
      users: Record<string, { id: string; displayName: string; email: string }>
    }>(adminClient, 'list_activity', { sinceIso: before, limit: 200 })
    const seenByReader = await callOk<{ items: CardEvent[] }>(readerClient, 'list_activity', {
      sinceIso: before,
      limit: 200,
    })

    // Admin (viewAllActivity) sees the other user's event and resolves its name;
    // the reader (plain user role) is scoped to its own creator's activity.
    const adminHit = seenByAdmin.items.find((event) => event.cardId === otherCardId)
    expect(adminHit).toBeDefined()
    expect(adminHit?.actorDisplayName).toBe(user.displayName)
    expect(seenByAdmin.users[user.id]).toMatchObject({ id: user.id, email: user.email })
    expect(seenByReader.items.some((event) => event.cardId === otherCardId)).toBe(false)
  })

  it('list_blocked_cards returns only currently-blocked cards, cursor-paginated', async () => {
    const writeClient = await connect(writer.raw)
    // Two fresh blocked cards guarantee a second page at limit 1.
    for (const title of ['Blocked feed A', 'Blocked feed B']) {
      const card = await callOk<Card>(writeClient, 'create_card', { title })
      await callOk<Card>(writeClient, 'block_card', {
        cardId: card.id,
        reason: 'feed test',
        expectedVersion: 1,
      })
    }
    const client = await connect(reader.raw)

    const firstPage = await callOk<{ items: Card[]; nextCursor: string | null }>(
      client,
      'list_blocked_cards',
      { limit: 1 },
    )
    const secondPage = await callOk<{ items: Card[] }>(client, 'list_blocked_cards', {
      limit: 1,
      cursor: firstPage.nextCursor ?? '',
    })

    expect(firstPage.items).toHaveLength(1)
    expect(firstPage.items.every((card) => card.blocked)).toBe(true)
    expect(secondPage.items[0]?.id).not.toBe(firstPage.items[0]?.id)
    expect(secondPage.items.every((card) => card.blocked)).toBe(true)
  })

  it('whoami returns the calling token identity without the hash', async () => {
    const client = await connect(reader.raw)
    // Prime the output-schema validator so whoami's structured content is checked.
    await client.listTools()

    const me = await callOk<Record<string, unknown>>(client, 'whoami')

    expect(me.kind).toBe('mcp')
    expect(me.id).toBe(reader.id)
    expect(me.name).toBe('reporting agent')
    expect(me.scope).toBe('read')
    expect(me.role).toBe('user')
    expect(me).not.toHaveProperty('tokenHash')
  })
})

describe('read-scope identity rule', () => {
  const ABSENT_CARD_ID = 999999
  it.each([
    ['create_card', { title: 'denied' }],
    ['update_card', { cardId: ABSENT_CARD_ID, expectedVersion: 1 }],
    ['move_card', { cardId: ABSENT_CARD_ID, toLane: 'ready', expectedVersion: 1 }],
    ['comment_on_card', { cardId: ABSENT_CARD_ID, body: 'denied' }],
    ['cancel_card', { cardId: ABSENT_CARD_ID, resolution: 'duplicate', expectedVersion: 1 }],
    ['reopen_card', { cardId: ABSENT_CARD_ID, expectedVersion: 1 }],
    ['archive_card', { cardId: ABSENT_CARD_ID, expectedVersion: 1 }],
    ['block_card', { cardId: ABSENT_CARD_ID, reason: 'denied', expectedVersion: 1 }],
    ['unblock_card', { cardId: ABSENT_CARD_ID, expectedVersion: 1 }],
  ] as const)('denies %s for a read-scope token, naming the rule', async (name, args) => {
    const client = await connect(reader.raw)

    const problem = await callProblem(client, name, { ...args })

    expect(problem.type).toBe('urn:rivian-kanban:problem:policy-denied')
    expect(problem.rule).toBe('token-scope-read')
  })

  it('denies before any side effect: no card is created', async () => {
    const client = await connect(reader.raw)

    await callProblem(client, 'create_card', { title: 'Should never exist' })

    const { items } = await callOk<{ items: Card[] }>(client, 'list_cards', {
      q: 'Should never exist',
    })
    expect(items).toHaveLength(0)
  })
})

describe('enforcement-on policy posture', () => {
  beforeAll(async () => {
    const applied = await t.request(adminCookie, {
      method: 'PUT',
      url: '/api/v1/policy',
      payload: {
        ...DEFAULT_POLICY_DOCUMENT,
        transitionEnforcement: true,
      },
    })
    if (applied.statusCode !== 200) throw new Error(applied.body)
  })

  afterAll(async () => {
    const restored = await t.request(adminCookie, {
      method: 'PUT',
      url: '/api/v1/policy',
      payload: DEFAULT_POLICY_DOCUMENT,
    })
    if (restored.statusCode !== 200) throw new Error(restored.body)
  })

  it('move_card off the workflow graph is an illegal transition with from/to', async () => {
    const client = await connect(writer.raw)
    const card = await callOk<Card>(client, 'create_card', { title: 'Illegal jump via MCP' })

    const problem = await callProblem(client, 'move_card', {
      cardId: card.id,
      toLane: 'done',
      expectedVersion: 1,
    })

    expect(problem.type).toBe('urn:rivian-kanban:problem:illegal-transition')
    expect(problem.from).toBe('intake')
    expect(problem.to).toBe('done')
  })

  it('allows a legal edge to the user token (topology only, no per-edge role)', async () => {
    const client = await connect(writer.raw)
    const card = await callOk<Card>(client, 'create_card', { title: 'Legal edge via MCP' })
    const staged = await callOk<Card>(client, 'move_card', {
      cardId: card.id,
      toLane: 'waiting_approval',
      nextCardId: await laneTopId(client, 'waiting_approval'),
      expectedVersion: 1,
    })

    // waiting_approval→ready no longer carries a per-edge role gate — a plain
    // user token that has card.move may traverse it under enforcement.
    const promoted = await callOk<Card>(client, 'move_card', {
      cardId: card.id,
      toLane: 'ready',
      nextCardId: await laneTopId(client, 'ready'),
      expectedVersion: staged.version,
    })

    expect(promoted.laneId).not.toBe(staged.laneId)
  })
})

describe('authentication at the transport edge', () => {
  // RFC 9728 §5.1: every /mcp 401 advertises the protected-resource metadata so
  // an OAuth client can discover the AS (issuer = PUBLIC_BASE_URL in tests).
  const RESOURCE_METADATA =
    'resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"'

  it('401s a missing token with WWW-Authenticate + resource_metadata before any JSON-RPC processing', async () => {
    const response = await rawInitializeRequest()

    expect(response.status).toBe(401)
    // No credential presented: a bare Bearer challenge plus the discovery param.
    expect(response.headers.get('www-authenticate')).toBe(`Bearer ${RESOURCE_METADATA}`)
    expect(response.headers.get('content-type')).toContain('application/problem+json')
    const body = (await response.json()) as Problem
    expect(body.type).toBe('urn:rivian-kanban:problem:unauthenticated')
    // The blanket global bucket counted this unauthenticated /mcp request.
    expect(response.headers.get('x-ratelimit-limit')).toBeTruthy()
  })

  it('401s an unknown token with invalid_token + resource_metadata', async () => {
    const response = await rawInitializeRequest({ authorization: 'Bearer rkb_bogus' })

    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBe(
      `Bearer error="invalid_token", ${RESOURCE_METADATA}`,
    )
  })

  it('401s a revoked token', async () => {
    const revoked = await mintToken('to be revoked', 'user', 'read_write')
    const client = await connect(revoked.raw)
    await callOk(client, 'get_board_snapshot')

    const deleted = await t.request(adminCookie, {
      method: 'DELETE',
      url: `/api/v1/service-tokens/${revoked.id}`,
    })
    expect(deleted.statusCode).toBe(204)

    const response = await rawInitializeRequest({ authorization: `Bearer ${revoked.raw}` })
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBe(
      `Bearer error="invalid_token", ${RESOURCE_METADATA}`,
    )
  })

  it('rejects the SDK client outright when no token is presented', async () => {
    await expect(connect(null)).rejects.toThrow(/401/)
  })

  it('rejects a JSON-RPC batch body — batching was removed in MCP 2025-06-18 and would let one POST smuggle many calls past the per-token bucket', async () => {
    const batch = [1, 2].map((id) => ({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: 'get_board_snapshot', arguments: {} },
    }))

    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${writer.raw}`,
      },
      body: JSON.stringify(batch),
    })

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: { code: number; message: string } }
    expect(body.error.code).toBe(-32600)
    expect(body.error.message).toMatch(/batching/i)
  })

  it('exposes the per-token budget headers on successful (hijacked) responses', async () => {
    const response = await rawInitializeRequest({ authorization: `Bearer ${writer.raw}` })

    expect(response.status).toBe(200)
    expect(response.headers.get('x-ratelimit-limit')).toBeTruthy()
    expect(response.headers.get('x-ratelimit-remaining')).toMatch(/^\d+$/)
    expect(response.headers.get('x-ratelimit-reset')).toBeTruthy()
  })

  it('405s GET and DELETE on /mcp (stateless POST-only mount)', async () => {
    const get = await fetch(`${baseUrl}/mcp`, {
      headers: { accept: 'text/event-stream' },
    })
    const del = await fetch(`${baseUrl}/mcp`, { method: 'DELETE' })

    expect(get.status).toBe(405)
    expect(get.headers.get('allow')).toBe('POST')
    expect(del.status).toBe(405)
  })

  it('tracks lastUsedAt on use, throttled between calls', async () => {
    const client = await connect(writer.raw)
    await callOk(client, 'get_board_snapshot')

    const first = await t.request(adminCookie, { method: 'GET', url: '/api/v1/service-tokens' })
    const usedAt = first
      .json<{ id: string; lastUsedAt: string | null }[]>()
      .find((token) => token.id === writer.id)?.lastUsedAt
    expect(usedAt).toBeTruthy()

    await callOk(client, 'get_board_snapshot')
    const second = await t.request(adminCookie, { method: 'GET', url: '/api/v1/service-tokens' })
    const usedAtAfter = second
      .json<{ id: string; lastUsedAt: string | null }[]>()
      .find((token) => token.id === writer.id)?.lastUsedAt
    expect(usedAtAfter).toBe(usedAt)
  })
})

describe('audit trail', () => {
  it('tool mutations write events with actor_kind mcp and the token id', async () => {
    const client = await connect(writer.raw)
    const card = await callOk<Card>(client, 'create_card', { title: 'Audited MCP card' })
    await callOk<Card>(client, 'move_card', {
      cardId: card.id,
      toLane: 'ready',
      nextCardId: await laneTopId(client, 'ready'),
      expectedVersion: 1,
    })
    await callOk<Comment>(client, 'comment_on_card', { cardId: card.id, body: 'audited' })

    const response = await t.request(adminCookie, {
      method: 'GET',
      url: `/api/v1/cards/${String(card.id)}/events`,
    })

    const events = response.json<{
      items: {
        eventType: string
        actorKind: string
        actorId: string
        actorLabel?: string
        onBehalfOfUserId?: string
      }[]
    }>()
    expect(events.items.map((event) => event.eventType)).toEqual([
      'card.created',
      'card.status_changed',
      'comment.added',
    ])
    for (const event of events.items) {
      // Stored attribution is unchanged: kind mcp + the token id (audit integrity).
      expect(event.actorKind).toBe('mcp')
      expect(event.actorId).toBe(writer.id)
      // Read-time enrichment: the token name + the user who minted it.
      expect(event.actorLabel).toBe('writer agent')
      expect(event.onBehalfOfUserId).toBe(adminId)
    }
  })
})

describe('OAuth agent on-behalf-of (resource server, ADR-021 §A)', () => {
  it('mints an access token through the AS, calls /mcp, and audits the mutation to the user with the client label', async () => {
    // A distinct human operator authorizes a named agent for read+write.
    const operator = await t.asRole('user')
    const accessToken = await mintAccessTokenFor(operator.cookie, 'Claude Code', 'read_write')
    expect(accessToken).toMatch(/^rka_/)

    // The OAuth access token drives /mcp exactly like a service token would.
    const client = await connect(accessToken)
    const card = await callOk<Card>(client, 'create_card', {
      title: 'Agent-created via OAuth on-behalf-of',
      priority: 'P1',
    })

    // The tool works AND an agent card is origin mcp, bounded by the user's role.
    expect(card.origin).toBe('mcp')

    // The audit event attributes to the USER (ownership/attribution) but names
    // the agent's client so history reads "Claude Code on behalf of <user>".
    const events = await t
      .request(adminCookie, { method: 'GET', url: `/api/v1/cards/${String(card.id)}/events` })
      .then((response) =>
        response.json<{
          items: {
            eventType: string
            actorKind: string
            actorId: string
            actorLabel?: string
            onBehalfOfUserId?: string
          }[]
        }>(),
      )
    const created = events.items.find((event) => event.eventType === 'card.created')
    expect(created).toBeDefined()
    expect(created?.actorKind).toBe('agent')
    // actorId IS the operator (the agent acts as them), with the denormalized
    // client name and the on-behalf user resolved to the same operator.
    expect(created?.actorId).toBe(operator.user.id)
    expect(created?.actorLabel).toBe('Claude Code')
    expect(created?.onBehalfOfUserId).toBe(operator.user.id)
  })

  it('lists tools, reads its agent identity, and validates history output (real-client parity)', async () => {
    const operator = await t.asRole('user')
    const accessToken = await mintAccessTokenFor(operator.cookie, 'Codex', 'read_write')

    const client = await connect(accessToken)
    // listTools caches each tool's output schema, so every subsequent callTool
    // validates its structured content against it — exactly what a real client
    // (Claude Code) does, and the only path that exercises these output schemas.
    await client.listTools()

    // whoami reports the AGENT identity: the operator it acts as + the client it
    // authorized (a service token has no such shape — hence the `kind` field).
    const me = await callOk<Record<string, unknown>>(client, 'whoami')
    expect(me).toMatchObject({
      kind: 'agent',
      userId: operator.user.id,
      role: 'user',
      scope: 'read_write',
      client: { name: 'Codex' },
    })
    expect(me).not.toHaveProperty('tokenHash')

    // A mutation, then its history read back THROUGH the validated output schema:
    // the enriched agent event (stored actorLabel + derived onBehalfOfUserId) must
    // satisfy the strict per-branch event schema, or the SDK client rejects it.
    const card = await callOk<Card>(client, 'create_card', { title: 'Agent history via OAuth' })
    const history = await callOk<{
      items: (CardEvent & { actorKind: string; actorLabel?: string; onBehalfOfUserId?: string })[]
    }>(client, 'get_card_history', { cardId: card.id })
    expect(history.items.find((event) => event.eventType === 'card.created')).toMatchObject({
      actorKind: 'agent',
      actorLabel: 'Codex',
      onBehalfOfUserId: operator.user.id,
    })
  })

  it('bounds a read-scope agent token to reads — it cannot mutate', async () => {
    const operator = await t.asRole('user')
    const readToken = await mintAccessTokenFor(operator.cookie, 'Read-only agent', 'read')

    const client = await connect(readToken)
    // A read tool works…
    await callOk(client, 'get_board_snapshot')
    // …but a write is denied by the always-on read-scope identity rule.
    const problem = await callProblem(client, 'create_card', { title: 'should be denied' })
    expect(problem.type).toBe('urn:rivian-kanban:problem:policy-denied')
    expect(problem.rule).toBe('token-scope-read')
  })

  it('401s an access token whose audience is NOT this /mcp (RFC 8707, no passthrough)', async () => {
    // A real AS-hashed, unexpired, unrevoked token — but minted for a foreign
    // `resource`. Inserted directly (the AS only ever mints for /mcp) with a raw
    // value we control, so the RS's audience check is the only thing that can
    // reject it. Register a real client so the client_id FK is satisfied.
    const operator = await t.asRole('user')
    const registered = await t.app.inject({
      method: 'POST',
      url: '/oauth/register',
      headers: { 'content-type': 'application/json' },
      payload: { client_name: 'Foreign-audience agent', redirect_uris: [OAUTH_REDIRECT] },
    })
    const clientId = registered.json<{ client_id: string }>().client_id

    const rawToken = 'rka_foreign-audience-token-value'
    await t.wired.deps.uow.run((tx) =>
      tx.oauthAccessTokens.insert({
        id: randomUUID(),
        tokenHash: createHash('sha256').update(rawToken).digest('hex'),
        userId: operator.user.id,
        clientId,
        scope: 'read',
        resource: 'http://localhost:3000/not-mcp',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        revokedAt: null,
        lastUsedAt: null,
        createdAt: new Date().toISOString(),
      }),
    )

    const response = await rawInitializeRequest({ authorization: `Bearer ${rawToken}` })
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain('resource_metadata=')
  })
})

describe('per-token rate limiting', () => {
  it('keys the 120/min bucket on the token id, not the IP', async () => {
    const tight = await createTestApp({
      seedDemoData: false,
      rateLimits: { mcp: { max: 3, timeWindowMs: 60_000 } },
    })
    try {
      const tightUrl = await tight.app.listen({ port: 0, host: '127.0.0.1' })
      const { cookie } = await tight.asRole('admin')
      const mint = async (name: string) => {
        const response = await tight.request(cookie, {
          method: 'POST',
          url: '/api/v1/service-tokens',
          payload: { name, role: 'user', scope: 'read' },
        })
        return response.json<{ rawToken: string }>().rawToken
      }
      const tokenA = await mint('token A')
      const tokenB = await mint('token B')

      // Budget 3: connect costs two requests (initialize + the initialized
      // notification), one call exhausts token A; the next call 429s.
      const clientA = await connect(tokenA, `${tightUrl}/mcp`)
      await clientA.callTool({ name: 'get_board_snapshot', arguments: {} })
      await expect(clientA.callTool({ name: 'get_board_snapshot', arguments: {} })).rejects.toThrow(
        /429/,
      )

      // Token B from the same client IP is untouched.
      const clientB = await connect(tokenB, `${tightUrl}/mcp`)
      const result = (await clientB.callTool({
        name: 'get_board_snapshot',
        arguments: {},
      })) as ToolResult
      expect(result.isError).not.toBe(true)
      await clientA.close()
      await clientB.close()
    } finally {
      await tight.cleanup()
    }
  })
})
