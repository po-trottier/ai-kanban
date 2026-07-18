import cookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import swagger from '@fastify/swagger'
import Fastify, { type FastifyInstance } from 'fastify'
import { FastifySSEPlugin } from 'fastify-sse-v2'
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod'
import { randomUUID } from 'node:crypto'
import { mcpRoutes } from './mcp/mcp-routes.ts'
import { registerErrorHandling } from './plugins/error-handler.ts'
import { registerSchemaGuard } from './plugins/schema-guard.ts'
import { registerRateLimiting, registerSecurity } from './plugins/security.ts'
import { registerSessionAuth } from './plugins/session-auth.ts'
import { attachmentRoutes } from './routes/attachment-routes.ts'
import { authRoutes } from './routes/auth-routes.ts'
import { boardRoutes } from './routes/board-routes.ts'
import { cardRoutes } from './routes/card-routes.ts'
import { commentRoutes } from './routes/comment-routes.ts'
import { filterPresetRoutes } from './routes/filter-preset-routes.ts'
import { metaRoutes } from './routes/meta-routes.ts'
import { operationalRoutes } from './routes/operational-routes.ts'
import { serviceTokenRoutes } from './routes/service-token-routes.ts'
import { streamRoutes } from './routes/stream-routes.ts'
import { userRoutes } from './routes/user-routes.ts'
import { UploadQuota } from './uploads/upload-quota.ts'
import { type AppDeps } from './types.ts'

/**
 * The Fastify app factory (composition root output). Wiring (production) and
 * createTestApp (integration tests) construct the same app from the same
 * deps — tests exercise exactly what ships (docs/dev/testing.md).
 */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config } = deps
  const app = Fastify({
    trustProxy: config.trustProxyHops,
    genReqId: () => randomUUID(),
    // The process-wide pino root from the composition root (redaction
    // configured there) — the notifier and Slack adapter share it.
    loggerInstance: deps.logger,
    bodyLimit: 1024 * 1024,
  })

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  // Boot-time schema enforcement must observe every route registration.
  registerSchemaGuard(app)
  registerErrorHandling(app, deps)

  // Latency per TEMPLATED route (deployment.md#observability): routeOptions
  // gives the pattern, so ids never explode label cardinality; unrouted 404
  // noise is folded into one label.
  app.addHook('onResponse', (request, reply, done) => {
    deps.metrics.observeHttpRequest(
      request.method,
      request.routeOptions.url ?? 'unmatched',
      reply.statusCode,
      reply.elapsedTime / 1000,
    )
    done()
  })

  // No cookie signing: the session id is already unforgeable randomness
  // stored hashed (ADR-009). Must precede the session hook (cookie parsing).
  await app.register(cookie)
  // The global per-IP bucket must be an app-level hook AHEAD of session auth:
  // it counts (and eventually 429s) unauthenticated/garbage-cookie floods
  // that the auth hook would otherwise reject before any route-level limiter
  // ever ran. Route-level buckets (login, upload) still run afterwards — the
  // upload bucket keys on request.authUser resolved by the session hook.
  await registerRateLimiting(app, deps)
  registerSessionAuth(app, deps)
  await registerSecurity(app, deps)
  await app.register(FastifySSEPlugin)

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: { title: 'Rivian Kanban REST API', version: config.version.version },
      servers: [],
    },
    transform: jsonSchemaTransform,
  })

  const quota = new UploadQuota(deps.clock, config.uploads.dailyQuotaBytesPerUser)

  await app.register(
    async (api) => {
      authRoutes(deps)(api)
      userRoutes(deps)(api)
      boardRoutes(deps)(api)
      cardRoutes(deps)(api)
      commentRoutes(deps)(api)
      attachmentRoutes(deps, quota)(api)
      serviceTokenRoutes(deps)(api)
      filterPresetRoutes(deps)(api)
      streamRoutes(deps)(api)
      metaRoutes()(api)
      await Promise.resolve()
    },
    { prefix: '/api/v1' },
  )

  // Dev-only interactive docs UI (rest-api.md: non-production; still session-gated).
  if (config.nodeEnv !== 'production') {
    const scalar = await import('@scalar/fastify-api-reference')
    await app.register(scalar.default, {
      routePrefix: '/api/v1/docs',
      configuration: { url: '/api/v1/openapi.json' },
    })
  }

  // Bearer-authenticated MCP mount at POST /mcp — outside /api/v1, so the
  // session-auth and CSRF hooks skip it by URL while the global per-IP
  // bucket, helmet and under-pressure (all app-level) still cover it.
  mcpRoutes(deps)(app)

  operationalRoutes(deps)(app)

  if (config.spaRoot !== null) {
    await app.register(fastifyStatic, { root: config.spaRoot })
  }

  return app
}
