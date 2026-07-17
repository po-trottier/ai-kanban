import {
  type CardService,
  type Clock,
  type SummarizerPort,
  type UnitOfWork,
} from '@rivian-kanban/core'
import { App, LogLevel, type Receiver } from '@slack/bolt'
import { type AdapterLogger } from '../types.ts'
import { DEFAULT_SLACK_LIMITS, type SlackContext, type SlackLimits } from './context.ts'
import { BoundedLruSet } from './dedup.ts'
import { createDeliveryGuard } from './guards.ts'
import { registerMentionListener } from './mention-listener.ts'
import { registerShortcutListener } from './shortcut-listener.ts'
import { registerSubmissionListener } from './submission-listener.ts'
import { SlidingWindowLimiter } from './throttle.ts'

/**
 * The Slack inbound adapter (docs/architecture/slack.md, ADR-011): a Bolt
 * App in Socket Mode whose listeners contain zero business logic — they call
 * the same core services as REST and MCP. Contract tests inject a custom
 * Receiver and a fixture `apiUrl` through the same constructor
 * (configuration, not mocking); production passes the `xapp-` app token and
 * lets Bolt build its SocketModeReceiver.
 */

export interface SlackAppOptions {
  botToken: string
  /** Pinned workspace id — events from any other workspace are rejected. */
  teamId: string
  publicBaseUrl: string
  /** Socket Mode `xapp-` token; required unless a custom receiver is injected. */
  appToken?: string
  /** Test receiver (contract tests drive the real App via processEvent). */
  receiver?: Receiver
  /** Slack Web API origin override (local fixture servers in tests). */
  apiUrl?: string
  limits?: Partial<SlackLimits>
  cards: CardService
  uow: UnitOfWork
  clock: Clock
  summarizer: SummarizerPort | null
  logger: AdapterLogger
}

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000

function requireAppToken(appToken: string | undefined): string {
  if (appToken === undefined) {
    throw new Error('SLACK_APP_TOKEN is required for Socket Mode (no receiver injected)')
  }
  return appToken
}

export function createSlackApp(options: SlackAppOptions): App {
  const limits: SlackLimits = { ...DEFAULT_SLACK_LIMITS, ...options.limits }
  const app = new App({
    token: options.botToken,
    logLevel: LogLevel.ERROR,
    ...(options.apiUrl !== undefined ? { clientOptions: { slackApiUrl: options.apiUrl } } : {}),
    ...(options.receiver !== undefined
      ? { receiver: options.receiver }
      : { socketMode: true, appToken: requireAppToken(options.appToken) }),
  })

  const ctx: SlackContext = {
    cards: options.cards,
    uow: options.uow,
    summarizer: options.summarizer,
    logger: options.logger,
    teamId: options.teamId,
    publicBaseUrl: options.publicBaseUrl,
    cardLimiter: new SlidingWindowLimiter(options.clock, limits.cardsPerUserPerMinute, MINUTE_MS),
    summaryUserLimiter: new SlidingWindowLimiter(
      options.clock,
      limits.summariesPerUserPerMinute,
      MINUTE_MS,
    ),
    summaryGlobalLimiter: new SlidingWindowLimiter(
      options.clock,
      limits.summariesGlobalPerHour,
      HOUR_MS,
    ),
  }

  // Anything escaping a listener lands here as a structured pino record —
  // never Bolt's built-in ConsoleLogger. Error names only; payloads (thread
  // content, tokens) must not reach the logs.
  app.error((error) => {
    options.logger.error({ reason: error.name }, 'unhandled slack listener error')
    return Promise.resolve()
  })

  app.use(
    createDeliveryGuard({
      teamId: options.teamId,
      dedup: new BoundedLruSet(limits.dedupCapacity),
      logger: options.logger,
    }),
  )
  registerShortcutListener(app, ctx)
  registerMentionListener(app, ctx)
  registerSubmissionListener(app, ctx)
  return app
}
