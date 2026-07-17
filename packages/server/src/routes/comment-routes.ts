import { addCommentInputSchema, editCommentInputSchema, type Comment } from '@rivian-kanban/core'
import { type FastifyInstance } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { type AppDeps } from '../types.ts'
import { actorOf } from './user-routes.ts'
import { commentResponseSchema, emptyBodySchema, idParamsSchema } from './schemas.ts'

/**
 * Threaded comments (docs/architecture/rest-api.md#comments). Soft-deleted
 * comments keep their place in the thread but their body is blanked before
 * serialization — deleted content never leaves the server.
 */
function redactDeleted(comment: Comment): Comment {
  return comment.deletedAt === null ? comment : { ...comment, body: '' }
}

export function commentRoutes(deps: AppDeps) {
  return function routes(app: FastifyInstance): void {
    const r = app.withTypeProvider<ZodTypeProvider>()
    const { comments } = deps.services

    r.get(
      '/cards/:id/comments',
      {
        schema: {
          params: idParamsSchema,
          response: { 200: z.array(commentResponseSchema) },
        },
      },
      async (request) => {
        const thread = await comments.listForCard(request.params.id)
        return thread.map(redactDeleted)
      },
    )

    r.post(
      '/cards/:id/comments',
      {
        schema: {
          params: idParamsSchema,
          body: addCommentInputSchema,
          response: { 201: commentResponseSchema },
        },
      },
      async (request, reply) => {
        const comment = await comments.add(actorOf(request), request.params.id, request.body)
        return reply.code(201).send(comment)
      },
    )

    r.patch(
      '/comments/:id',
      {
        schema: {
          params: idParamsSchema,
          body: editCommentInputSchema,
          response: { 200: commentResponseSchema },
        },
      },
      async (request) => comments.edit(actorOf(request), request.params.id, request.body),
    )

    r.delete(
      '/comments/:id',
      {
        config: { bodyless: true },
        schema: {
          params: idParamsSchema,
          response: { 204: emptyBodySchema },
        },
      },
      async (request, reply) => {
        await comments.softDelete(actorOf(request), request.params.id)
        await reply.code(204).send(null)
      },
    )
  }
}
