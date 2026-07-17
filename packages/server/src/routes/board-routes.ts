import { policyDocumentSchema } from '@rivian-kanban/core'
import { type FastifyInstance } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { updateLaneInputSchema } from '../lanes/lane-admin-service.ts'
import {
  createLocationInputSchema,
  updateLocationInputSchema,
} from '../locations/location-admin-service.ts'
import { type AppDeps } from '../types.ts'
import { actorOf } from './user-routes.ts'
import {
  boardPolicyResponseSchema,
  boardResponseSchema,
  laneResponseSchema,
  locationResponseSchema,
  emptyBodySchema,
  idParamsSchema,
  tagResponseSchema,
} from './schemas.ts'

/**
 * Board snapshot, lane admin edits, locations (list + admin CRUD), tags, and
 * the permission policy (docs/architecture/rest-api.md#history--metadata /
 * #admin).
 */
export function boardRoutes(deps: AppDeps) {
  return function routes(app: FastifyInstance): void {
    const r = app.withTypeProvider<ZodTypeProvider>()
    const { queries, policies, lanes, locations } = deps.services

    r.get('/board', { schema: { response: { 200: boardResponseSchema } } }, async () =>
      queries.boardSnapshot(),
    )

    r.patch(
      '/lanes/:id',
      {
        schema: {
          params: idParamsSchema,
          body: updateLaneInputSchema,
          response: { 200: laneResponseSchema },
        },
      },
      async (request) => lanes.update(actorOf(request), request.params.id, request.body),
    )

    r.get(
      '/locations',
      { schema: { response: { 200: z.array(locationResponseSchema) } } },
      async () => locations.list(),
    )

    r.post(
      '/locations',
      {
        schema: {
          body: createLocationInputSchema,
          response: { 201: locationResponseSchema },
        },
      },
      async (request, reply) => {
        const location = await locations.create(actorOf(request), request.body)
        return reply.code(201).send(location)
      },
    )

    r.patch(
      '/locations/:id',
      {
        schema: {
          params: idParamsSchema,
          body: updateLocationInputSchema,
          response: { 200: locationResponseSchema },
        },
      },
      async (request) => locations.update(actorOf(request), request.params.id, request.body),
    )

    r.delete(
      '/locations/:id',
      {
        config: { bodyless: true },
        schema: {
          params: idParamsSchema,
          response: { 204: emptyBodySchema },
        },
      },
      async (request, reply) => {
        await locations.delete(actorOf(request), request.params.id)
        await reply.code(204).send(null)
      },
    )

    r.get('/tags', { schema: { response: { 200: z.array(tagResponseSchema) } } }, async () =>
      queries.listTags(),
    )

    r.get('/policy', { schema: { response: { 200: boardPolicyResponseSchema } } }, async () =>
      policies.getActive(),
    )

    r.put(
      '/policy',
      {
        schema: {
          body: policyDocumentSchema,
          response: { 200: boardPolicyResponseSchema },
        },
      },
      async (request) => policies.apply(actorOf(request), request.body),
    )
  }
}
