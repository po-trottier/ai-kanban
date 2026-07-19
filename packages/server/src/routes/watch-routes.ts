import { type FastifyInstance } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { type AppDeps } from '../types.ts'
import { actorOf } from './user-routes.ts'
import { cardIdParamsSchema, watchStateResponseSchema } from './schemas.ts'

/**
 * Per-user-per-card WATCH state (docs/architecture/notifications.md). Watching
 * is who-gets-notified about a card; managing your own watch is an identity
 * right (no `manage*` gate), so every route is scoped to the acting user. Both
 * writes are idempotent and return the resulting state so the client can
 * reflect the toggle without a refetch.
 */
export function watchRoutes(deps: AppDeps) {
  return function routes(app: FastifyInstance): void {
    const r = app.withTypeProvider<ZodTypeProvider>()
    const { watch } = deps.services

    r.get(
      '/cards/:id/watch',
      { schema: { params: cardIdParamsSchema, response: { 200: watchStateResponseSchema } } },
      async (request) => ({
        watching: await watch.isWatching(actorOf(request), request.params.id),
      }),
    )

    r.put(
      '/cards/:id/watch',
      {
        config: { bodyless: true },
        schema: { params: cardIdParamsSchema, response: { 200: watchStateResponseSchema } },
      },
      async (request) => {
        await watch.watch(actorOf(request), request.params.id)
        return { watching: true }
      },
    )

    r.delete(
      '/cards/:id/watch',
      {
        config: { bodyless: true },
        schema: { params: cardIdParamsSchema, response: { 200: watchStateResponseSchema } },
      },
      async (request) => {
        await watch.unwatch(actorOf(request), request.params.id)
        return { watching: false }
      },
    )
  }
}
