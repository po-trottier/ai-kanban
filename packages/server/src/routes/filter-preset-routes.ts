import { createFilterPresetInputSchema, updateFilterPresetInputSchema } from '@rivian-kanban/core'
import { type FastifyInstance } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { type AppDeps } from '../types.ts'
import { actorOf } from './user-routes.ts'
import { emptyBodySchema, filterPresetResponseSchema, idParamsSchema } from './schemas.ts'

/**
 * Saved board filters (docs/architecture/board-filters.md). Reads surface the
 * acting user's OWN presets plus every SHARED preset; writes stay owner-scoped
 * (an id owned by another user is 404). No `manage*` permission — managing your
 * own presets is an identity right (like editing your own comment).
 */
export function filterPresetRoutes(deps: AppDeps) {
  return function routes(app: FastifyInstance): void {
    const r = app.withTypeProvider<ZodTypeProvider>()
    const { filterPresets } = deps.services

    r.get(
      '/filter-presets',
      { schema: { response: { 200: z.array(filterPresetResponseSchema) } } },
      async (request) => filterPresets.list(actorOf(request)),
    )

    r.post(
      '/filter-presets',
      {
        schema: {
          body: createFilterPresetInputSchema,
          response: { 201: filterPresetResponseSchema },
        },
      },
      async (request, reply) => {
        const created = await filterPresets.create(actorOf(request), request.body)
        return reply.code(201).send(created)
      },
    )

    r.patch(
      '/filter-presets/:id',
      {
        schema: {
          params: idParamsSchema,
          body: updateFilterPresetInputSchema,
          response: { 200: filterPresetResponseSchema },
        },
      },
      async (request) => filterPresets.update(actorOf(request), request.params.id, request.body),
    )

    r.delete(
      '/filter-presets/:id',
      {
        config: { bodyless: true },
        schema: {
          params: idParamsSchema,
          response: { 204: emptyBodySchema },
        },
      },
      async (request, reply) => {
        await filterPresets.delete(actorOf(request), request.params.id)
        await reply.code(204).send(null)
      },
    )
  }
}
