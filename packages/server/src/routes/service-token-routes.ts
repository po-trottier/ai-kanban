import { createServiceTokenInputSchema } from '@rivian-kanban/core'
import { type FastifyInstance } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { type AppDeps } from '../types.ts'
import { actorOf } from './user-routes.ts'
import { emptyBodySchema, idParamsSchema, serviceTokenResponseSchema } from './schemas.ts'

/**
 * Admin MCP credentials (docs/architecture/rest-api.md#admin): the raw
 * `rkb_…` token appears exactly once, in the create response; list responses
 * carry metadata only (the hash is omitted even from serialization).
 */
export function serviceTokenRoutes(deps: AppDeps) {
  return function routes(app: FastifyInstance): void {
    const r = app.withTypeProvider<ZodTypeProvider>()
    const { tokens } = deps.services

    r.post(
      '/service-tokens',
      {
        schema: {
          body: createServiceTokenInputSchema,
          response: {
            201: z.object({ token: serviceTokenResponseSchema, rawToken: z.string() }),
          },
        },
      },
      async (request, reply) => {
        const created = await tokens.create(actorOf(request), request.body)
        return reply.code(201).send(created)
      },
    )

    r.get(
      '/service-tokens',
      { schema: { response: { 200: z.array(serviceTokenResponseSchema) } } },
      async (request) => tokens.list(actorOf(request)),
    )

    r.delete(
      '/service-tokens/:id',
      {
        config: { bodyless: true },
        schema: {
          params: idParamsSchema,
          response: { 204: emptyBodySchema },
        },
      },
      async (request, reply) => {
        await tokens.revoke(actorOf(request), request.params.id)
        await reply.code(204).send(null)
      },
    )
  }
}
