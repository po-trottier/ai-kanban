import { type FastifyInstance } from 'fastify'
import { PROBLEM_CONTENT_TYPE, toProblem } from '../http/problems.ts'
import { type AppDeps } from '../types.ts'

/**
 * RFC 9457 problem+json everywhere (docs/architecture/rest-api.md): thrown
 * errors run through the pure mapper; unknown /api paths are problem 404s;
 * other unknown GETs fall back to the SPA's index.html (client-side routing)
 * when a built SPA is being served.
 */
export function registerErrorHandling(app: FastifyInstance, deps: AppDeps): void {
  app.setErrorHandler((error, request, reply) => {
    const { status, body, headers } = toProblem(error)
    if (status >= 500) {
      request.log.error({ err: error }, 'request failed')
    }
    void reply
      .code(status)
      .headers(headers ?? {})
      .type(PROBLEM_CONTENT_TYPE)
      .send(body)
  })

  app.setNotFoundHandler((request, reply) => {
    if (
      deps.config.spaRoot !== null &&
      request.method === 'GET' &&
      !request.url.startsWith('/api')
    ) {
      // SPA fallback: client-routed paths render index.html.
      return reply.sendFile('index.html')
    }
    return reply
      .code(404)
      .type(PROBLEM_CONTENT_TYPE)
      .send({
        type: 'urn:rivian-kanban:problem:not-found',
        title: 'Resource not found',
        status: 404,
        detail: `no route for ${request.method} ${request.url}`,
      })
  })
}
