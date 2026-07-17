import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { type Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { BearerAuthRequiredError } from '../errors.ts'
import { PROBLEM_CONTENT_TYPE } from '../http/problems.ts'
import { enforceBucket } from '../plugins/security.ts'
import { type AppDeps } from '../types.ts'
import { authenticateBearer } from './mcp-auth.ts'
import { buildMcpToolServer } from './mcp-tools.ts'

/**
 * The raw Streamable HTTP mount (ADR-010): POST /mcp only, stateless — one
 * SDK transport + tool server per request (`sessionIdGenerator: undefined`),
 * no GET stream, no DELETE. Fastify hands the SDK its raw req/res after the
 * bearer hook resolved the Actor and the per-token bucket admitted the call;
 * the app-level global per-IP bucket and helmet/under-pressure ran before us,
 * while session auth and the CSRF layer skip non-/api/v1 URLs by design.
 * This file is the entire expected blast radius of the SDK v2 migration.
 */

const MCP_PATH = '/mcp'

export function mcpRoutes(deps: AppDeps) {
  return function routes(app: FastifyInstance): void {
    app.decorateRequest('mcpActor', null)

    // Keyed per token id, NOT per IP — agents often share egress IPs
    // (docs/architecture/security.md rate-limit table: MCP | 120/min | token id).
    const tokenBucket = app.createRateLimit({
      max: deps.config.rateLimits.mcp.max,
      timeWindow: deps.config.rateLimits.mcp.timeWindowMs,
      keyGenerator: (request) => `mcp:${request.mcpActor?.id ?? 'unauthenticated'}`,
    })

    // onRequest = before body parsing: missing/unknown/revoked tokens are
    // 401 + WWW-Authenticate (problem+json) before any JSON-RPC processing.
    const bearerGate = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      request.mcpActor = await authenticateBearer(deps, request.headers.authorization)
      await enforceBucket(tokenBucket, request, reply)
    }

    app.route({
      method: 'POST',
      url: MCP_PATH,
      onRequest: bearerGate,
      handler: async (request, reply) => {
        const actor = request.mcpActor
        if (actor === null) throw new BearerAuthRequiredError('bearer hook did not run', false)

        // The 2025-06-18 MCP spec removed JSON-RPC batching, but SDK 1.29's
        // transport still dispatches every element of an array body — which
        // would let one POST smuggle thousands of tool calls past the
        // per-token bucket (it charges per HTTP request). Reject batches
        // outright: spec-compliant AND keeps the 120/min budget meaningful.
        if (Array.isArray(request.body)) {
          return reply
            .code(400)
            .type('application/json')
            .send({
              jsonrpc: '2.0',
              error: {
                code: -32600,
                message: 'JSON-RPC batching is not supported (MCP 2025-06-18)',
              },
              id: null,
            })
        }

        const server = buildMcpToolServer(deps, actor, request.log)
        // No sessionIdGenerator = `sessionIdGenerator: undefined` = stateless
        // mode (the key itself must be omitted under exactOptionalPropertyTypes).
        const transport = new StreamableHTTPServerTransport({
          enableJsonResponse: true,
        })

        // The SDK owns the raw response from here; one transport per request,
        // torn down when the response closes. Teardown failures must not
        // become unhandled rejections (they would crash the process).
        reply.hijack()
        reply.raw.on('close', () => {
          server.close().catch((error: unknown) => {
            request.log.warn({ err: error }, 'mcp server close failed')
          })
        })
        // `hijack()` means Fastify never flushes reply headers — re-attach the
        // bearer gate's rate-limit budget headers to the raw response so
        // successful tool calls also tell agents how much budget remains.
        for (const header of ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset']) {
          const value = reply.getHeader(header)
          if (value !== undefined) reply.raw.setHeader(header, String(value))
        }
        try {
          // The cast bridges the SDK's own class-vs-interface mismatch under
          // exactOptionalPropertyTypes (its getters return `T | undefined`).
          await server.connect(transport as Transport)
          await transport.handleRequest(request.raw, reply.raw, request.body)
        } catch (error) {
          request.log.error({ err: error }, 'mcp transport failed')
          if (!reply.raw.headersSent) {
            reply.raw.writeHead(500, { 'content-type': 'application/json' })
            reply.raw.end(
              JSON.stringify({
                jsonrpc: '2.0',
                error: { code: -32603, message: 'internal server error' },
                id: null,
              }),
            )
          } else {
            reply.raw.end()
          }
        }
      },
    })

    // Stateless Streamable HTTP is POST-only (SEP-2567 direction, ADR-010).
    app.route({
      method: ['GET', 'DELETE'],
      url: MCP_PATH,
      handler: async (request, reply) =>
        reply
          .code(405)
          .header('allow', 'POST')
          .type(PROBLEM_CONTENT_TYPE)
          .send({
            type: 'urn:rivian-kanban:problem:method-not-allowed',
            title: 'Method not allowed',
            status: 405,
            detail: `${request.method} is not supported on ${MCP_PATH} — the stateless MCP mount is POST-only`,
          }),
    })
  }
}
