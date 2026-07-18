import { existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  AttachmentService,
  BoardQueryService,
  CardService,
  CommentService,
  PolicyService,
  ROLES,
  SystemClock,
  Uuidv7IdGenerator,
  type Card,
  type NotifierPort,
  type User,
} from '@rivian-kanban/core'
import {
  demoSeed,
  demoUserEmail,
  openDatabase,
  PLACEHOLDER_PASSWORD_HASH,
  structuralSeed,
  SqliteUnitOfWork,
  type DbConnection,
} from '@rivian-kanban/db'
import { WebClient } from '@slack/web-api'
import { type FastifyBaseLogger } from 'fastify'
import { pino } from 'pino'
import { LocalBlobStore } from '../adapters/blob/local-blob-store.ts'
import { InProcessEventBus } from '../adapters/event-bus.ts'
import { SlackNotifier } from '../adapters/slack-notifier.ts'
import { AuthService } from '../auth/auth-service.ts'
import { SetupService } from '../auth/setup-service.ts'
import { LoginBackoff } from '../auth/backoff.ts'
import { PasswordHasher, type Argon2Params } from '../auth/password-hasher.ts'
import { type Env } from '../env.ts'
import { LaneAdminService } from '../lanes/lane-admin-service.ts'
import { AppMetrics } from '../metrics/metrics.ts'
import { createMetricCollectors } from './metric-collectors.ts'
import { LocationAdminService } from '../locations/location-admin-service.ts'
import { ServiceTokenService } from '../tokens/service-token-service.ts'
import { UserAdminService } from '../users/user-admin-service.ts'
import { type AppConfig, type AppDeps } from '../types.ts'

/**
 * The composition root (docs/architecture/overview.md): the only place where
 * packages/db meets core. Boot order — open db (runs migrations) →
 * structural seed (always, idempotent) → demo seed (dev opt-in) → wire
 * adapters into services → hand `AppDeps` to `buildApp`.
 */

/** The default notifier: all DMs are dropped unless Slack is enabled. */
class NoopNotifier implements NotifierPort {
  cardCompleted(_card: Card): Promise<void> {
    return Promise.resolve()
  }

  waitingOverdue(_card: Card, _recipients: User[]): Promise<void> {
    return Promise.resolve()
  }
}

export interface WireOptions {
  /** Cheaper argon2 for tests — same code path, different cost. */
  hasherParams?: Argon2Params
  rateLimits?: Partial<AppConfig['rateLimits']>
  sse?: Partial<AppConfig['sse']>
  uploads?: Partial<AppConfig['uploads']>
  maxEventLoopDelayMs?: number
  logLevel?: string
  spaRoot?: string | null
  /** Slack Web API origin override (local fixture servers in tests). */
  slackApiUrl?: string
}

interface DemoCredential {
  email: string
  password: string
}

export interface WiredApp {
  deps: AppDeps
  connection: DbConnection
  hasher: PasswordHasher
  systemUserId: string
  boardId: string
  /** The wired NotifierPort — the scheduled-jobs wiring DMs through it. */
  notifier: NotifierPort
  /**
   * One-time demo credentials, present only when this boot replaced the db
   * package's placeholder hashes (SEED_DEMO_DATA, non-production). Printed
   * once by main.ts; subsequent boots leave real hashes untouched.
   */
  demoCredentials: DemoCredential[]
}

/** Initial budgets from docs/architecture/security.md (tuned later). */
const DEFAULT_RATE_LIMITS: AppConfig['rateLimits'] = {
  global: { max: 300, timeWindowMs: 60_000 },
  login: { max: 5, timeWindowMs: 60_000 },
  upload: { max: 20, timeWindowMs: 60_000 },
  mcp: { max: 120, timeWindowMs: 60_000 },
}

const DEFAULT_SSE: AppConfig['sse'] = { keepaliveMs: 25_000, maxStreamsPerUser: 5 }

const DEFAULT_UPLOADS: AppConfig['uploads'] = {
  dailyQuotaBytesPerUser: 500 * 1024 * 1024,
  /** Initial high-water mark; leaves SQLite+WAL headroom on the shared volume. */
  blobHighWaterBytes: 50 * 1024 * 1024 * 1024,
}

/** packages/web/dist when it exists (non-fatal when absent — API-only mode). */
function defaultSpaRoot(): string | null {
  const dist = fileURLToPath(new URL('../../../web/dist', import.meta.url))
  return existsSync(dist) ? dist : null
}

export async function wireApp(env: Env, options: WireOptions = {}): Promise<WiredApp> {
  // MIGRATIONS_DIR is only set where the source tree is not present (the
  // bundled image); dev/test boots resolve packages/db's own migrations.
  const connection = openDatabase(env.DATABASE_PATH, env.MIGRATIONS_DIR)
  const { boardId, systemUserId } = structuralSeed(connection.db)

  const uow = new SqliteUnitOfWork(connection)
  const clock = new SystemClock()
  const ids = new Uuidv7IdGenerator()
  const eventBus = new InProcessEventBus()
  const blobStore = new LocalBlobStore(env.BLOB_DIR)
  // The single pino root for the process — Fastify, the Slack adapter, and
  // the notifier all share it. Typed as the base logger: pino's own Logger
  // type would narrow the FastifyInstance generics and break every plugin
  // signature.
  const logger: FastifyBaseLogger = pino({
    level: options.logLevel ?? env.LOG_LEVEL,
    // Secrets never reach the logs (docs/architecture/security.md#secrets--configuration).
    redact: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.currentPassword',
      '*.newPassword',
      '*.tempPassword',
      '*.rawToken',
      // The raw web-session credential (LoginResult) — as sensitive as rawToken.
      '*.rawSessionId',
      '*.sid',
      '*.passwordHash',
    ],
    // Human-readable logs in dev — as a pino transport, not a shell pipe:
    // `… | pino-pretty` broke on machines without the root node_modules/.bin
    // on PATH. Production and tests (NODE_ENV) keep raw JSON.
    ...(env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {}),
  })
  // When Slack is enabled, completion notifications DM the requester
  // (docs/architecture/slack.md#notifications-outbound); otherwise they drop.
  const notifier: NotifierPort =
    env.SLACK_ENABLED && env.SLACK_BOT_TOKEN !== undefined
      ? new SlackNotifier({
          client: new WebClient(env.SLACK_BOT_TOKEN, {
            ...(options.slackApiUrl !== undefined ? { slackApiUrl: options.slackApiUrl } : {}),
            // NotifierPort is best-effort with BOUNDED latency: the SDK's
            // defaults retry for ~30 minutes and sleep through 429s, which
            // would hold a completing move's DM (and the hourly aging job)
            // hostage through a Slack outage. Same budget philosophy as the
            // AI summarizer's whole-call clamp.
            retryConfig: { retries: 2 },
            timeout: 5_000,
            rejectRateLimitedCalls: true,
          }),
          uow,
          logger,
          publicBaseUrl: env.PUBLIC_BASE_URL,
        })
      : new NoopNotifier()
  const hasher = new PasswordHasher(options.hasherParams)
  const backoff = new LoginBackoff(clock)
  // One registry per wired app (never prom-client's global): production has
  // one, and every integration-test boot owns an isolated metric set.
  const metrics = new AppMetrics(
    createMetricCollectors({ databasePath: env.DATABASE_PATH, blobStore }),
  )

  const demoCredentials: DemoCredential[] = []
  if (env.SEED_DEMO_DATA && env.NODE_ENV !== 'production') {
    demoSeed(connection.db)
    // The db package deliberately seeds unverifiable placeholder hashes;
    // real argon2id hashing is this package's concern. First boot mints
    // one-time passwords; later boots (or changed passwords) are untouched.
    for (const role of ROLES) {
      const email = demoUserEmail(role)
      const credentials = await uow.run((tx) => tx.userAccounts.findByEmail(email))
      if (credentials !== null && credentials.passwordHash === PLACEHOLDER_PASSWORD_HASH) {
        // SEED_DEMO_PASSWORD (dev/e2e determinism; env refuses it in
        // production) fixes the minted value; otherwise one-time random.
        const password = env.SEED_DEMO_PASSWORD ?? randomBytes(12).toString('base64url')
        const passwordHash = await hasher.hash(password)
        await uow.run((tx) => tx.userAccounts.setPassword(credentials.user.id, passwordHash, false))
        demoCredentials.push({ email, password })
      }
    }
  }

  const shared = { uow, clock, ids, eventBus }
  const services: AppDeps['services'] = {
    cards: new CardService({ ...shared, notifier, boardId, systemUserId }),
    comments: new CommentService(shared),
    attachments: new AttachmentService({ ...shared, blobStore }),
    queries: new BoardQueryService({ uow, clock, boardId }),
    policies: new PolicyService({ ...shared, boardId }),
    auth: new AuthService({ uow, clock, hasher, backoff }),
    setup: new SetupService({ uow, clock, ids, hasher, systemUserId }),
    users: new UserAdminService({ ...shared, hasher, boardId, systemUserId }),
    lanes: new LaneAdminService({ uow, eventBus, boardId }),
    locations: new LocationAdminService({ ...shared, boardId }),
    tokens: new ServiceTokenService({ uow, clock, ids, boardId }),
  }

  const config: AppConfig = {
    nodeEnv: env.NODE_ENV,
    trustProxyHops: env.TRUST_PROXY_HOPS,
    logLevel: options.logLevel ?? env.LOG_LEVEL,
    version: { version: env.APP_VERSION, gitSha: env.GIT_SHA, builtAt: env.BUILT_AT },
    spaRoot: options.spaRoot !== undefined ? options.spaRoot : (env.SPA_DIR ?? defaultSpaRoot()),
    rateLimits: { ...DEFAULT_RATE_LIMITS, ...options.rateLimits },
    sse: { ...DEFAULT_SSE, ...options.sse },
    uploads: { ...DEFAULT_UPLOADS, ...options.uploads },
    maxEventLoopDelayMs: options.maxEventLoopDelayMs ?? 1_000,
  }

  return {
    deps: { config, logger, uow, clock, eventBus, blobStore, metrics, services, systemUserId },
    connection,
    hasher,
    systemUserId,
    boardId,
    notifier,
    demoCredentials,
  }
}
