import {
  type Actor,
  type AttachmentService,
  type BoardQueryService,
  type CardService,
  type Clock,
  type CommentService,
  type PolicyService,
  type UnitOfWork,
  type User,
} from '@rivian-kanban/core'
import { type FastifyBaseLogger } from 'fastify'
import { type LocalBlobStore } from './adapters/blob/local-blob-store.ts'
import { type InProcessEventBus } from './adapters/event-bus.ts'
import { type AuthService } from './auth/auth-service.ts'
import { type AppMetrics } from './metrics/metrics.ts'
import { type LaneAdminService } from './lanes/lane-admin-service.ts'
import { type LocationAdminService } from './locations/location-admin-service.ts'
import { type ServiceTokenService } from './tokens/service-token-service.ts'
import { type UserAdminService } from './users/user-admin-service.ts'

/**
 * Everything `buildApp` needs, assembled by the composition root
 * (src/wiring) for production and by createTestApp for integration tests.
 * Tunables default to the documented budgets; tests inject different values
 * through the same constructor path (configuration, not mocking).
 */

/**
 * The logging surface adapters receive (pino-compatible; Fastify's app.log
 * and standalone pino instances both satisfy it). Injected so tests run
 * silent and adapters never construct their own transports.
 */
export interface AdapterLogger {
  info(obj: object, msg?: string): void
  warn(obj: object, msg?: string): void
  error(obj: object, msg?: string): void
}

interface RateLimitBudget {
  max: number
  timeWindowMs: number
}

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production'
  trustProxyHops: number
  /** pino level; 'silent' in tests. */
  logLevel: string
  version: { version: string; gitSha: string; builtAt: string }
  /** Built SPA directory served statically; null when packages/web/dist is absent. */
  spaRoot: string | null
  /** docs/architecture/security.md rate-limit table. */
  rateLimits: {
    global: RateLimitBudget
    login: RateLimitBudget
    upload: RateLimitBudget
    /** /mcp bucket, keyed per service-token id — agents share egress IPs. */
    mcp: RateLimitBudget
  }
  sse: {
    /** 25 s in production (ADR-008); tests shorten it. */
    keepaliveMs: number
    /** Per-user concurrent stream cap — oldest dropped (security.md). */
    maxStreamsPerUser: number
  }
  uploads: {
    /** 500 MB/day/user (security.md#uploads). */
    dailyQuotaBytesPerUser: number
    /** BLOB_DIR high-water mark; uploads past it are 507. */
    blobHighWaterBytes: number
  }
  /** under-pressure event-loop-delay threshold; 0 disables (tests). */
  maxEventLoopDelayMs: number
}

interface AppServices {
  cards: CardService
  comments: CommentService
  attachments: AttachmentService
  queries: BoardQueryService
  policies: PolicyService
  auth: AuthService
  users: UserAdminService
  lanes: LaneAdminService
  locations: LocationAdminService
  tokens: ServiceTokenService
}

export interface AppDeps {
  config: AppConfig
  /**
   * The single pino root for the whole process, created by the composition
   * root: Fastify (`loggerInstance`), the Slack adapter, and the notifier all
   * log through it — one root, one set of bindings.
   */
  logger: FastifyBaseLogger
  uow: UnitOfWork
  clock: Clock
  eventBus: InProcessEventBus
  blobStore: LocalBlobStore
  /**
   * The process metrics registry (deployment.md#observability). Always
   * wired — the main app's onResponse hook, the SSE bookkeeping, and the MCP
   * mount record into it; only main.ts starts the internal /metrics listener.
   */
  metrics: AppMetrics
  services: AppServices
  /**
   * The seeded `system` user — the resolved reporter/author for MCP writes
   * when no `reporterEmail` is given (docs/architecture/mcp.md#tools): a
   * service-token id is not a user id, and cards/comments FK to users.
   */
  systemUserId: string
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Resolved by the session-auth hook on protected /api/v1 routes. */
    authUser: User | null
    /** sha256 of the presented session cookie (revocation handle). */
    sessionHash: string | null
    /** Resolved by the /mcp bearer hook (kind 'mcp', id = service-token id). */
    mcpActor: Actor | null
  }

  interface FastifyContextConfig {
    /** Skips session auth (login + operational endpoints). */
    public?: boolean
    /** Reachable while must_change_password is set (change-password/logout/me). */
    allowWithPasswordChange?: boolean
    /** Multipart request — exempt from the JSON body-schema requirement. */
    multipart?: boolean
    /** Deliberately bodyless mutation (logout, reopen, unblock). */
    bodyless?: boolean
    /** Response is a stream/binary — exempt from the response-schema rule. */
    rawResponse?: boolean
  }
}
