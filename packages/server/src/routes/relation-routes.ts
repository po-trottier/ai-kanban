import { createCardRelationInputSchema } from '@rivian-kanban/core'
import { type FastifyInstance } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { type AppDeps } from '../types.ts'
import { cardIdParamsSchema, cardRelationResponseSchema, emptyBodySchema } from './schemas.ts'

/** `:id` = the card (ticket number); `:relationId` = the relation UUID. */
const relationParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  relationId: z.uuid(),
})

/**
 * Typed card-to-card relations (docs/architecture/card-relations.md). Managing
 * relations is collaborative card metadata available to any authenticated user
 * (no `manage*` gate); the routes sit behind the normal session gate. Reads
 * resolve each relation to the OTHER card + the viewing direction. Deletes are
 * scoped to a relation that actually touches `:id` (else 404).
 */
export function relationRoutes(deps: AppDeps) {
  return function routes(app: FastifyInstance): void {
    const r = app.withTypeProvider<ZodTypeProvider>()
    const { relations } = deps.services

    r.get(
      '/cards/:id/relations',
      {
        schema: {
          params: cardIdParamsSchema,
          response: { 200: z.array(cardRelationResponseSchema) },
        },
      },
      async (request) => relations.list(request.params.id),
    )

    r.post(
      '/cards/:id/relations',
      {
        schema: {
          params: cardIdParamsSchema,
          body: createCardRelationInputSchema,
          response: { 201: cardRelationResponseSchema },
        },
      },
      async (request, reply) => {
        const created = await relations.create(request.params.id, request.body)
        return reply.code(201).send(created)
      },
    )

    r.delete(
      '/cards/:id/relations/:relationId',
      {
        config: { bodyless: true },
        schema: {
          params: relationParamsSchema,
          response: { 204: emptyBodySchema },
        },
      },
      async (request, reply) => {
        await relations.delete(request.params.id, request.params.relationId)
        await reply.code(204).send(null)
      },
    )
  }
}
