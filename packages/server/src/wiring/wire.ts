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
import { LocalBlobStore } from '../adapters/blob/local-blob-store.ts'
import { InProcessEventBus } from '../adapters/event-bus.ts'
import { AuthService } from '../auth/auth-service.ts'
import { LoginBackoff } from '../auth/backoff.ts'
import { PasswordHasher, type Argon2Params } from '../auth/password-hasher.ts'
import { type Env } from '../env.ts'
import { LaneAdminService } from '../lanes/lane-admin-service.ts'
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

/** Slack notifier lands with the Slack adapter task; completion DMs are dropped until then. */
class NoopNotifier implements NotifierPort {
  cardCompleted(_card: Card): Promise<void> {
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
  const connection = openDatabase(env.DATABASE_PATH)
  const { boardId, systemUserId } = structuralSeed(connection.db)

  const uow = new SqliteUnitOfWork(connection)
  const clock = new SystemClock()
  const ids = new Uuidv7IdGenerator()
  const eventBus = new InProcessEventBus()
  const blobStore = new LocalBlobStore(env.BLOB_DIR)
  const notifier = new NoopNotifier()
  const hasher = new PasswordHasher(options.hasherParams)
  const backoff = new LoginBackoff(clock)

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
        const password = randomBytes(12).toString('base64url')
        const passwordHash = await hasher.hash(password)
        await uow.run((tx) => tx.userAccounts.setPassword(credentials.user.id, passwordHash, false))
        demoCredentials.push({ email, password })
      }
    }
  }

  const shared = { uow, clock, ids, eventBus }
  const services: AppDeps['services'] = {
    cards: new CardService({ ...shared, notifier, boardId }),
    comments: new CommentService(shared),
    attachments: new AttachmentService({ ...shared, blobStore }),
    queries: new BoardQueryService({ uow, clock, boardId }),
    policies: new PolicyService({ ...shared, boardId }),
    auth: new AuthService({ uow, clock, hasher, backoff }),
    users: new UserAdminService({ ...shared, hasher, systemUserId }),
    lanes: new LaneAdminService({ uow, eventBus, boardId }),
    locations: new LocationAdminService(shared),
    tokens: new ServiceTokenService({ uow, clock, ids }),
  }

  const config: AppConfig = {
    nodeEnv: env.NODE_ENV,
    trustProxyHops: env.TRUST_PROXY_HOPS,
    logLevel: options.logLevel ?? env.LOG_LEVEL,
    version: { version: env.APP_VERSION, gitSha: env.GIT_SHA, builtAt: env.BUILT_AT },
    spaRoot: options.spaRoot !== undefined ? options.spaRoot : defaultSpaRoot(),
    rateLimits: { ...DEFAULT_RATE_LIMITS, ...options.rateLimits },
    sse: { ...DEFAULT_SSE, ...options.sse },
    uploads: { ...DEFAULT_UPLOADS, ...options.uploads },
    maxEventLoopDelayMs: options.maxEventLoopDelayMs ?? 1_000,
  }

  return {
    deps: { config, uow, clock, eventBus, blobStore, services, systemUserId },
    connection,
    hasher,
    systemUserId,
    boardId,
    demoCredentials,
  }
}
