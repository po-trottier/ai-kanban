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
          // A trivial read through the unit of work proves the DB answers.
          await deps.uow.run((tx) => tx.tags.listAll())
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
