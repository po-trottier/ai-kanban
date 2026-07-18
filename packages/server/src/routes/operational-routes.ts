import { type FastifyInstance } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { type AppDeps } from '../types.ts'

/**
 * Operational endpoints outside /api/v1 (docs/architecture/rest-api.md):
 * unauthenticated, no sensitive data. /healthz = process up; /readyz = DB
 * ping (the Compose healthcheck); /version = build identity.
 */
export function operationalRoutes(deps: AppDeps) {
  return function routes(app: FastifyInstance): void {
    const r = app.withTypeProvider<ZodTypeProvider>()

    r.get(
      '/healthz',
      { schema: { response: { 200: z.object({ status: z.literal('ok') }) } } },
      () => ({ status: 'ok' as const }),
    )

    r.get(
      '/readyz',
      {
        schema: {
          response: {
            200: z.object({ status: z.literal('ok') }),
            503: z.object({ status: z.literal('unavailable') }),
          },
        },
      },
      async (_request, reply) => {
        try {
          // An O(1) indexed point read through the read-only path proves the
          // DB answers — deliberately not the write queue (so the Compose
          // healthcheck does not flap while a long write transaction holds
          // the single writer) and never a table scan: this polls every few
          // seconds forever, so its cost must not grow with the data.
          // Card ids are positive; 0 is a guaranteed indexed miss (O(1) probe).
          await deps.uow.read((tx) => tx.cards.findById(0))
          return { status: 'ok' as const }
        } catch {
          return reply.code(503).send({ status: 'unavailable' as const })
        }
      },
    )

    r.get(
      '/version',
      {
        schema: {
          response: {
            200: z.object({ version: z.string(), gitSha: z.string(), builtAt: z.string() }),
          },
        },
      },
      () => deps.config.version,
    )
  }
}
