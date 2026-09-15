import { boardInputSchema, boardSchema, groupInputSchema, groupSchema } from '@rivian-kanban/core'
import { type FastifyInstance } from 'fastify'
import { boardCatalogSchema, boardPreferenceSchema } from '@rivian-kanban/core'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { type AppDeps } from '../types.ts'
import { actorOf } from './user-routes.ts'
import { emptyBodySchema, idParamsSchema } from './schemas.ts'

export function boardsRoutes(deps: AppDeps) {
  return (app: FastifyInstance): void => {
    const r = app.withTypeProvider<ZodTypeProvider>()
    const { boards } = deps.services
    r.get('/groups', { schema: { response: { 200: z.array(groupSchema) } } }, (request) =>
      boards.listGroups(actorOf(request)),
    )
    r.post(
      '/groups',
      { schema: { body: groupInputSchema, response: { 201: groupSchema } } },
      async (request, reply) =>
        reply.code(201).send(await boards.saveGroup(actorOf(request), null, request.body)),
    )
    r.put(
      '/groups/:id',
      {
        schema: { params: idParamsSchema, body: groupInputSchema, response: { 200: groupSchema } },
      },
      (request) => boards.saveGroup(actorOf(request), request.params.id, request.body),
    )
    r.delete(
      '/groups/:id',
      {
        config: { bodyless: true },
        schema: { params: idParamsSchema, response: { 204: emptyBodySchema } },
      },
      async (request, reply) => {
        await boards.removeGroup(actorOf(request), request.params.id)
        return reply.code(204).send(null)
      },
    )
    r.get(
      '/boards',
      {
        schema: {
          response: { 200: boardCatalogSchema },
        },
      },
      (request) => boards.list(actorOf(request)),
    )
    r.put(
      '/boards/preference',
      {
        schema: { body: boardPreferenceSchema, response: { 200: boardCatalogSchema } },
      },
      (request) => boards.setPreference(actorOf(request), request.body),
    )
    r.post(
      '/boards',
      { schema: { body: boardInputSchema, response: { 201: boardSchema } } },
      async (request, reply) =>
        reply.code(201).send(await boards.create(actorOf(request), request.body)),
    )
    r.put(
      '/boards/:id',
      {
        schema: { params: idParamsSchema, body: boardInputSchema, response: { 200: boardSchema } },
      },
      (request) => boards.update(actorOf(request), request.params.id, request.body),
    )
    r.delete(
      '/boards/:id',
      {
        config: { bodyless: true },
        schema: { params: idParamsSchema, response: { 204: emptyBodySchema } },
      },
      async (request, reply) => {
        await boards.remove(actorOf(request), request.params.id)
        return reply.code(204).send(null)
      },
    )
  }
}
