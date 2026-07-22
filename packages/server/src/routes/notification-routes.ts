import { type FastifyInstance } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { type AppDeps } from '../types.ts'
import { actorOf } from './user-routes.ts'
import { idParamsSchema, notificationResponseSchema, unreadCountResponseSchema } from './schemas.ts'

/**
 * `unreadOnly` is a query flag, so only the literal `true` opts in (an absent or
 * any other value means "all") — `z.coerce.boolean()` can't be used, it treats
 * the string `"false"` as truthy.
 */
const notificationListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
})

/**
 * In-app notifications (docs/architecture/notifications.md). Every route is
 * scoped to the acting user — you only ever list or mark your OWN notifications
 * (no `manage*` gate). Mark-read responses return the fresh unread count so the
 * bell badge updates without a second request.
 */
export function notificationRoutes(deps: AppDeps) {
  return function routes(app: FastifyInstance): void {
    const r = app.withTypeProvider<ZodTypeProvider>()
    const { notifications } = deps.services

    r.get(
      '/notifications',
      {
        schema: {
          querystring: notificationListQuerySchema,
          response: { 200: z.array(notificationResponseSchema) },
        },
      },
      async (request) => {
        const { limit, unreadOnly } = request.query
        return notifications.list(actorOf(request), {
          unreadOnly,
          ...(limit !== undefined ? { limit } : {}),
        })
      },
    )

    r.get(
      '/notifications/unread-count',
      { schema: { response: { 200: unreadCountResponseSchema } } },
      async (request) => ({ unread: await notifications.unreadCount(actorOf(request)) }),
    )

    r.post(
      '/notifications/:id/read',
      {
        config: { bodyless: true },
        schema: { params: idParamsSchema, response: { 200: unreadCountResponseSchema } },
      },
      async (request) => {
        const actor = actorOf(request)
        await notifications.markRead(actor, request.params.id)
        return { unread: await notifications.unreadCount(actor) }
      },
    )

    r.post(
      '/notifications/:id/unread',
      {
        config: { bodyless: true },
        schema: { params: idParamsSchema, response: { 200: unreadCountResponseSchema } },
      },
      async (request) => {
        const actor = actorOf(request)
        await notifications.markUnread(actor, request.params.id)
        return { unread: await notifications.unreadCount(actor) }
      },
    )

    r.post(
      '/notifications/read-all',
      { config: { bodyless: true }, schema: { response: { 200: unreadCountResponseSchema } } },
      async (request) => {
        await notifications.markAllRead(actorOf(request))
        return { unread: 0 }
      },
    )

    r.delete(
      '/notifications/:id',
      {
        config: { bodyless: true },
        schema: { params: idParamsSchema, response: { 200: unreadCountResponseSchema } },
      },
      async (request) => {
        const actor = actorOf(request)
        await notifications.clear(actor, request.params.id)
        return { unread: await notifications.unreadCount(actor) }
      },
    )

    r.delete(
      '/notifications',
      { config: { bodyless: true }, schema: { response: { 200: unreadCountResponseSchema } } },
      async (request) => {
        await notifications.clearAll(actorOf(request))
        return { unread: 0 }
      },
    )
  }
}
