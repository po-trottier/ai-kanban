import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import underPressure from '@fastify/under-pressure'
import { MAX_ATTACHMENT_BYTES } from '@rivian-kanban/core'
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { CsrfError, RateLimitExceededError } from '../errors.ts'
import { type AppDeps } from '../types.ts'

/**
 * HTTP hardening (docs/architecture/security.md#web-platform-hardening):
 * helmet CSP, deny-all CORS, layered CSRF, rate limits, under-pressure 503.
 */

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * CSRF layer 2 (SameSite=Lax is layer 1): every state-changing request must
 * carry `Content-Type: application/json` — checked BEFORE body parsing — or,
 * for multipart uploads and bodyless requests, an `X-Requested-With` header.
 * HTML forms can produce neither.
 */
function registerCsrfLayer(app: FastifyInstance): void {
  app.addHook('onRequest', (request, _reply, done) => {
    if (!MUTATING_METHODS.has(request.method) || !request.url.startsWith('/api/v1')) {
      done()
      return
    }
    const contentType = request.headers['content-type']
    const jsonDeclared = contentType?.toLowerCase().startsWith('application/json') === true
    const customHeader = request.headers['x-requested-with'] !== undefined
    done(jsonDeclared || customHeader ? undefined : new CsrfError())
  })
}

/**
 * The consume/headers/429 protocol shared by every `createRateLimit` bucket
 * hook (the app-level global per-IP bucket and the /mcp per-token gate): one
 * declaration of the x-ratelimit-* header names and the exceed semantics.
 */
export async function enforceBucket(
  bucket: ReturnType<FastifyInstance['createRateLimit']>,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const limit = await bucket(request)
  if (limit.isAllowed) return // allow-listed key (unused today)
  void reply.header('x-ratelimit-limit', String(limit.max))
  void reply.header('x-ratelimit-remaining', String(limit.remaining))
  void reply.header('x-ratelimit-reset', String(limit.ttlInSeconds))
  if (limit.isExceeded) throw new RateLimitExceededError(limit.ttlInSeconds)
}

/**
 * The blanket per-IP bucket (security.md: Global | 300/min | IP) as an
 * APP-level onRequest hook registered BEFORE session auth. The plugin's own
 * route-level hooks always run AFTER app-level hooks, so a plugin-managed
 * global limiter would never count requests the auth/CSRF hooks reject —
 * exactly the no-cookie/garbage-cookie flood the bucket exists to stop. The
 * hook also covers unknown routes (404 floods). `createRateLimit` (not
 * `app.rateLimit`) keeps the request's `rateLimitRan` flag untouched so the
 * tighter route-level login/upload buckets still run afterwards.
 */
export async function registerRateLimiting(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const { config } = deps
  // global:false — routes opt in via `config.rateLimit` (login, uploads);
  // the blanket bucket below covers everything else at the app level.
  await app.register(rateLimit, { global: false })

  const globalBucket = app.createRateLimit({
    max: config.rateLimits.global.max,
    timeWindow: config.rateLimits.global.timeWindowMs,
  })
  app.addHook('onRequest', async (request, reply) => enforceBucket(globalBucket, request, reply))
}

export async function registerSecurity(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const { config } = deps

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        // default-src 'self'; only what the SPA build actually needs is
        // relaxed: inline styles (React) and data:/blob: images (previews).
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
  })

  // Same-origin deployment: the allowlist is empty — no cross-origin
  // consumer gets CORS headers until explicitly configured (security.md).
  await app.register(cors, { origin: [] })

  registerCsrfLayer(app)

  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize: MAX_ATTACHMENT_BYTES,
      fields: 0,
      parts: 2,
      headerPairs: 200,
    },
  })

  if (config.maxEventLoopDelayMs > 0) {
    await app.register(underPressure, {
      maxEventLoopDelay: config.maxEventLoopDelayMs,
      message: 'server under pressure',
      retryAfter: 10,
    })
  }
}
