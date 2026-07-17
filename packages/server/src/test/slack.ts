import { once } from 'node:events'
import { createServer } from 'node:http'
import { type AddressInfo } from 'node:net'
import { type SummarizerPort } from '@rivian-kanban/core'
import { type App, type Receiver, type ReceiverEvent } from '@slack/bolt'
import { pino } from 'pino'
import { type SlackLimits } from '../slack/context.ts'
import { createSlackApp } from '../slack/slack-app.ts'
import { createTestApp, type TestApp } from './support.ts'

/**
 * Slack contract-test harness (docs/architecture/slack.md#testing-without-a-workspace):
 * the REAL Bolt App driven through a hand-rolled Receiver with recorded
 * payloads, its Web API traffic served by a local fixture HTTP server that
 * records every call — real HTTP, no mocking of our code.
 */

/** The pinned workspace id every fixture payload carries. */
const TEST_TEAM_ID = 'T0TEST'

/** Drives the real `App` via processEvent; `send` resolves the ack response. */
class TestReceiver implements Receiver {
  private app: App | undefined

  init(app: App): void {
    this.app = app
  }

  start(): Promise<unknown> {
    return Promise.resolve()
  }

  stop(): Promise<unknown> {
    return Promise.resolve()
  }

  async send(body: Record<string, unknown>): Promise<unknown> {
    if (this.app === undefined) throw new Error('TestReceiver: init() was never called')
    let ackResponse: unknown
    const event: ReceiverEvent = {
      body,
      ack: (response) => {
        ackResponse = response
        return Promise.resolve()
      },
    }
    await this.app.processEvent(event)
    return ackResponse
  }
}

interface SlackApiCall {
  method: string
  body: Record<string, unknown>
}

type SlackResponder = (body: Record<string, unknown>) => Record<string, unknown>

export interface SlackFixture {
  /** Pass as `slackApiUrl` (trailing slash included). */
  url: string
  calls: SlackApiCall[]
  callsTo(method: string): Record<string, unknown>[]
  /** Registers a Slack-side user directory entry (users.info + lookupByEmail). */
  setUserEmail(slackUserId: string, email: string): void
  close(): Promise<void>
}

/** WebClient serializes calls as form-urlencoded with JSON-encoded nested values. */
function parseSlackCallBody(contentType: string | undefined, raw: string): Record<string, unknown> {
  if (contentType?.includes('application/json') === true) {
    return JSON.parse(raw) as Record<string, unknown>
  }
  const maybeJson = (value: string): unknown => {
    if (!value.startsWith('{') && !value.startsWith('[')) return value
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }
  return Object.fromEntries(
    [...new URLSearchParams(raw)].map(([key, value]) => [key, maybeJson(value)]),
  )
}

/**
 * A local fixture HTTP server standing in for the Slack Web API: records
 * every call and serves recorded-shape responses. Per-method overrides let a
 * test change one answer without re-faking the rest.
 */
export async function startSlackFixture(
  overrides: Record<string, SlackResponder> = {},
): Promise<SlackFixture> {
  const calls: SlackApiCall[] = []
  const emailBySlackId = new Map<string, string>()

  const defaults = new Map<string, SlackResponder>([
    [
      'auth.test',
      () => ({
        ok: true,
        url: 'https://fixture.slack.com/',
        team: 'Fixture Workspace',
        team_id: TEST_TEAM_ID,
        user: 'facilitiesbot',
        user_id: 'UBOT001',
        bot_id: 'B0BOT001',
      }),
    ],
    ['views.open', () => ({ ok: true, view: { id: 'V0FIXTURE', hash: 'fixturehash1' } })],
    [
      'views.update',
      (body) => ({ ok: true, view: { id: body.view_id ?? 'V0FIXTURE', hash: 'fixturehash2' } }),
    ],
    [
      'conversations.replies',
      () => ({
        ok: true,
        has_more: false,
        messages: [
          {
            type: 'message',
            user: 'U0REPORTER',
            ts: '1752749000.000100',
            text: 'The compressor in bay 4 is leaking oil again',
          },
          {
            type: 'message',
            user: 'U0COWORKER',
            ts: '1752749060.000200',
            thread_ts: '1752749000.000100',
            text: 'Maintenance looked at it last month, probably needs a new hose',
          },
        ],
      }),
    ],
    [
      'users.info',
      (body) => {
        const slackUserId = typeof body.user === 'string' ? body.user : ''
        const email = emailBySlackId.get(slackUserId)
        return email === undefined
          ? { ok: false, error: 'user_not_found' }
          : {
              ok: true,
              user: {
                id: slackUserId,
                team_id: TEST_TEAM_ID,
                is_bot: false,
                profile: { email, real_name: 'Fixture User' },
              },
            }
      },
    ],
    [
      'users.lookupByEmail',
      (body) => {
        const email = typeof body.email === 'string' ? body.email.toLowerCase() : ''
        const match = [...emailBySlackId].find(([, value]) => value.toLowerCase() === email)
        return match === undefined
          ? { ok: false, error: 'users_not_found' }
          : { ok: true, user: { id: match[0], profile: { email } } }
      },
    ],
    ['chat.postMessage', (body) => ({ ok: true, channel: body.channel, ts: '1752750000.000100' })],
  ])

  const responders = new Map<string, SlackResponder>([...defaults, ...Object.entries(overrides)])

  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const method = (req.url ?? '/').replace(/^\//, '').split('?')[0] ?? ''
      const body = parseSlackCallBody(
        req.headers['content-type'],
        Buffer.concat(chunks).toString('utf8'),
      )
      calls.push({ method, body })
      const responder = responders.get(method)
      const payload = responder ? responder(body) : { ok: false, error: 'unknown_method' }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(payload))
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${String(port)}/`,
    calls,
    callsTo: (method) => calls.filter((call) => call.method === method).map((call) => call.body),
    setUserEmail: (slackUserId, email) => emailBySlackId.set(slackUserId, email),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      }),
  }
}

export interface SlackHarnessOptions {
  summarizer?: SummarizerPort | null
  limits?: Partial<SlackLimits>
  slackOverrides?: Record<string, SlackResponder>
}

export interface SlackHarness {
  testApp: TestApp
  fixture: SlackFixture
  /** Feeds one recorded payload through the real Bolt App; resolves the ack. */
  send(body: Record<string, unknown>): Promise<unknown>
  cleanup(): Promise<void>
}

/** Real app + real temp db + real Bolt App wired to the fixture Web API. */
export async function createSlackHarness(options: SlackHarnessOptions = {}): Promise<SlackHarness> {
  const testApp = await createTestApp()
  const fixture = await startSlackFixture(options.slackOverrides)
  const receiver = new TestReceiver()
  createSlackApp({
    botToken: 'xoxb-fixture-token',
    teamId: TEST_TEAM_ID,
    publicBaseUrl: 'http://localhost:3000',
    apiUrl: fixture.url,
    receiver,
    cards: testApp.wired.deps.services.cards,
    uow: testApp.wired.deps.uow,
    clock: testApp.wired.deps.clock,
    summarizer: options.summarizer ?? null,
    logger: pino({ level: 'silent' }),
    ...(options.limits !== undefined ? { limits: options.limits } : {}),
  })
  return {
    testApp,
    fixture,
    send: (body) => receiver.send(body),
    cleanup: async () => {
      await fixture.close()
      await testApp.cleanup()
    },
  }
}
