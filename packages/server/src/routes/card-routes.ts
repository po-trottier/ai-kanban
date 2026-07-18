import {
  blockCardInputSchema,
  cancelCardInputSchema,
  cardHistoryRequestSchema,
  createCardInputSchema,
  listCardsFilterSchema,
  moveCardInputSchema,
  pageRequestSchema,
  updateCardInputSchema,
  type Card,
} from '@rivian-kanban/core'
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { RequestValidationError } from '../errors.ts'
import { etagOf, parseIfMatch } from '../http/if-match.ts'
import { type AppDeps } from '../types.ts'
import { actorOf } from './user-routes.ts'
import {
  cardDetailResponseSchema,
  cardEventResponseSchema,
  cardResponseSchema,
  idParamsSchema,
  ifMatchHeadersSchema,
  pageResponseOf,
} from './schemas.ts'

/**
 * Card CRUD + lifecycle actions (docs/architecture/rest-api.md#board--cards).
 * `If-Match: "<version>"` maps to the core commands' `expectedVersion`
 * (ADR-012); responses carry the fresh `ETag`.
 */

/**
 * Query-string shapes derived from the shared core filter/page schemas
 * (single-schema rule): only fields that need query-string coercion are
 * overridden (booleans via stringbool, the numeric limit), wrapped in a
 * stripping z.object so unknown query params are ignored, not 400s.
 */
const queryLimitSchema = z.coerce.number().int().min(1).max(200).optional()

const listCardsQuerySchema = z.object({
  ...listCardsFilterSchema.shape,
  blocked: z.stringbool().optional(),
  overdueResume: z.stringbool().optional(),
  includeArchived: z.stringbool().optional(),
  archivedOnly: z.stringbool().optional(),
  // A repeated query key (`?tags=a&tags=b`) parses to an array, a single one to
  // a string — normalize the lone string to a one-element array before validation.
  tags: z.preprocess(
    (value) => (value === undefined || Array.isArray(value) ? value : [value]),
    listCardsFilterSchema.shape.tags,
  ),
  cursor: pageRequestSchema.shape.cursor,
  limit: queryLimitSchema,
})

const eventsQuerySchema = z.object({
  type: cardHistoryRequestSchema.shape.type,
  cursor: pageRequestSchema.shape.cursor,
  limit: queryLimitSchema,
})

/** The version from a schema-required If-Match header (malformed → 400). */
function expectedVersionOf(request: FastifyRequest): number {
  const raw = request.headers['if-match']
  const version = parseIfMatch(typeof raw === 'string' ? raw : '')
  if (version === null) {
    throw new RequestValidationError('if-match', 'If-Match must be a quoted integer version')
  }
  return version
}

function sendCard(reply: FastifyReply, card: Card, status = 200) {
  return reply.code(status).header('etag', etagOf(card.version)).send(card)
}

export function cardRoutes(deps: AppDeps) {
  return function routes(app: FastifyInstance): void {
    const r = app.withTypeProvider<ZodTypeProvider>()
    const { cards, queries } = deps.services

    r.get(
      '/cards',
      {
        schema: {
          querystring: listCardsQuerySchema,
          response: { 200: pageResponseOf(cardResponseSchema) },
        },
      },
      async (request) => {
        const { cursor, limit, ...filter } = request.query
        return queries.listCards(filter, {
          ...(cursor !== undefined ? { cursor } : {}),
          ...(limit !== undefined ? { limit } : {}),
        })
      },
    )

    r.post(
      '/cards',
      {
        schema: {
          body: createCardInputSchema,
          response: { 201: cardResponseSchema },
        },
      },
      async (request, reply) => {
        const card = await cards.create(actorOf(request), request.body)
        return sendCard(reply, card, 201)
      },
    )

    r.get(
      '/cards/:id',
      {
        schema: {
          params: idParamsSchema,
          response: { 200: cardDetailResponseSchema },
        },
      },
      async (request, reply) => {
        const detail = await queries.cardDetail(request.params.id)
        return reply.header('etag', etagOf(detail.card.version)).send(detail)
      },
    )

    r.patch(
      '/cards/:id',
      {
        schema: {
          params: idParamsSchema,
          headers: ifMatchHeadersSchema,
          body: updateCardInputSchema.omit({ expectedVersion: true }),
          response: { 200: cardResponseSchema },
        },
      },
      async (request, reply) => {
        const card = await cards.update(actorOf(request), request.params.id, {
          ...request.body,
          expectedVersion: expectedVersionOf(request),
        })
        return sendCard(reply, card)
      },
    )

    r.post(
      '/cards/:id/move',
      {
        schema: {
          params: idParamsSchema,
          headers: ifMatchHeadersSchema,
          body: moveCardInputSchema.omit({ expectedVersion: true }),
          response: { 200: cardResponseSchema },
        },
      },
      async (request, reply) => {
        const card = await cards.move(actorOf(request), request.params.id, {
          ...request.body,
          expectedVersion: expectedVersionOf(request),
        })
        return sendCard(reply, card)
      },
    )

    r.post(
      '/cards/:id/cancel',
      {
        schema: {
          params: idParamsSchema,
          headers: ifMatchHeadersSchema,
          body: cancelCardInputSchema.omit({ expectedVersion: true }),
          response: { 200: cardResponseSchema },
        },
      },
      async (request, reply) => {
        const card = await cards.cancel(actorOf(request), request.params.id, {
          resolution: request.body.resolution,
          expectedVersion: expectedVersionOf(request),
        })
        return sendCard(reply, card)
      },
    )

    r.post(
      '/cards/:id/reopen',
      {
        config: { bodyless: true },
        schema: {
          params: idParamsSchema,
          headers: ifMatchHeadersSchema,
          response: { 200: cardResponseSchema },
        },
      },
      async (request, reply) => {
        const card = await cards.reopen(actorOf(request), request.params.id, {
          expectedVersion: expectedVersionOf(request),
        })
        return sendCard(reply, card)
      },
    )

    r.post(
      '/cards/:id/archive',
      {
        config: { bodyless: true },
        schema: {
          params: idParamsSchema,
          headers: ifMatchHeadersSchema,
          response: { 200: cardResponseSchema },
        },
      },
      async (request, reply) => {
        const card = await cards.archive(actorOf(request), request.params.id, {
          expectedVersion: expectedVersionOf(request),
        })
        return sendCard(reply, card)
      },
    )

    r.post(
      '/cards/:id/block',
      {
        schema: {
          params: idParamsSchema,
          headers: ifMatchHeadersSchema,
          body: blockCardInputSchema.omit({ expectedVersion: true }),
          response: { 200: cardResponseSchema },
        },
      },
      async (request, reply) => {
        const card = await cards.block(actorOf(request), request.params.id, {
          reason: request.body.reason,
          expectedVersion: expectedVersionOf(request),
        })
        return sendCard(reply, card)
      },
    )

    r.post(
      '/cards/:id/unblock',
      {
        config: { bodyless: true },
        schema: {
          params: idParamsSchema,
          headers: ifMatchHeadersSchema,
          response: { 200: cardResponseSchema },
        },
      },
      async (request, reply) => {
        const card = await cards.unblock(actorOf(request), request.params.id, {
          expectedVersion: expectedVersionOf(request),
        })
        return sendCard(reply, card)
      },
    )

    r.get(
      '/cards/:id/events',
      {
        schema: {
          params: idParamsSchema,
          querystring: eventsQuerySchema,
          response: { 200: pageResponseOf(cardEventResponseSchema) },
        },
      },
      async (request) => {
        const { type, cursor, limit } = request.query
        return queries.cardHistory(request.params.id, {
          ...(type !== undefined ? { type } : {}),
          ...(cursor !== undefined ? { cursor } : {}),
          ...(limit !== undefined ? { limit } : {}),
        })
      },
    )
  }
}
