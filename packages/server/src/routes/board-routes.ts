import { randomUUID } from 'node:crypto'
import {
  ACTOR_KINDS,
  activityFeedRequestSchema,
  affectsBoardSnapshot,
  createLocationInputSchema,
  policyDocumentSchema,
  updateLaneInputSchema,
  updateLocationInputSchema,
} from '@rivian-kanban/core'
import { type FastifyInstance } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { type AppDeps } from '../types.ts'
import { actorOf } from './user-routes.ts'
import {
  boardPolicyResponseSchema,
  boardResponseSchema,
  cardEventResponseSchema,
  laneResponseSchema,
  locationResponseSchema,
  emptyBodySchema,
  idParamsSchema,
  pageResponseOf,
  tagResponseSchema,
} from './schemas.ts'

/**
 * `GET /events` query shape (single-schema rule): the shared activity-feed
 * schema with query-string coercion for the numeric limit, wrapped in a
 * stripping z.object so unknown params are ignored (not 400s). `since` maps to
 * the core `sinceIso` field; an invalid ISO datetime is a 400.
 */
const activityQuerySchema = z.object({
  since: activityFeedRequestSchema.shape.sinceIso,
  type: activityFeedRequestSchema.shape.type,
  cardId: activityFeedRequestSchema.shape.cardId,
  actorKind: z.enum(ACTOR_KINDS).optional(),
  cursor: activityFeedRequestSchema.shape.cursor,
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

/**
 * Board snapshot, lane admin edits, locations (list + admin CRUD), tags, and
 * the permission policy (docs/architecture/rest-api.md#history--metadata /
 * #admin).
 */
export function boardRoutes(deps: AppDeps) {
  /**
   * GET /board is the hottest read in the system: every board-changing SSE
   * hint makes every connected client refetch it. The serialized body is
   * memoized per board version — a monotonic counter bumped only by hints
   * that can change the body (lane edits and card mutations; the shared
   * `affectsBoardSnapshot` predicate) so a comment burst neither recomputes
   * the snapshot nor breaks clients' If-None-Match. Because the hint fan-out
   * makes all N refetches arrive together, concurrent misses for one version
   * coalesce on a single in-flight compute — N clients after one mutation
   * cost one snapshot read + one serialization. The version-stable ETag
   * additionally lets a validating client cache turn repeats into 304s. The
   * nonce keeps ETags from colliding across process restarts.
   */
  const bootNonce = randomUUID().slice(0, 8)
  let boardVersion = 0
  deps.eventBus.subscribe((hint) => {
    if (affectsBoardSnapshot(hint)) boardVersion += 1
  })
  interface BoardCacheEntry {
    version: number
    etag: string
    body: string
  }
  let boardCache: BoardCacheEntry | null = null
  let pendingSnapshot: { version: number; promise: Promise<BoardCacheEntry> } | null = null

  return function routes(app: FastifyInstance): void {
    const r = app.withTypeProvider<ZodTypeProvider>()
    const { queries, policies, lanes, locations } = deps.services

    const computeEntry = async (version: number): Promise<BoardCacheEntry> => {
      // rawResponse route: the body is pre-serialized here; the schema parse
      // applies the same stripping serialization the schema route path would.
      const snapshot = boardResponseSchema.parse(await queries.boardSnapshot())
      const entry: BoardCacheEntry = {
        version,
        etag: `W/"board-${String(version)}-${bootNonce}"`,
        body: JSON.stringify(snapshot),
      }
      // Don't publish a cache entry that raced a mutation's invalidation.
      if (boardVersion === version) boardCache = entry
      return entry
    }

    r.get('/board', { config: { rawResponse: true }, schema: {} }, async (request, reply) => {
      const version = boardVersion
      let entry = boardCache
      if (entry?.version !== version) {
        let pending = pendingSnapshot
        if (pending?.version !== version) {
          pending = { version, promise: computeEntry(version) }
          pendingSnapshot = pending
          const settle = () => {
            // boardCache holds the success; a failure must not be memoized.
            if (pendingSnapshot === pending) pendingSnapshot = null
          }
          void pending.promise.then(settle, settle)
        }
        entry = await pending.promise
      }
      void reply.header('etag', entry.etag).header('cache-control', 'no-cache')
      if (request.headers['if-none-match'] === entry.etag) {
        return reply.code(304).send()
      }
      return reply.type('application/json; charset=utf-8').send(entry.body)
    })

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

    r.get('/lanes', { schema: { response: { 200: z.array(laneResponseSchema) } } }, async () =>
      queries.listLanes(),
    )

    r.get(
      '/events',
      {
        schema: {
          querystring: activityQuerySchema,
          response: { 200: pageResponseOf(cardEventResponseSchema) },
        },
      },
      async (request) => {
        const { since, type, cardId, actorKind, cursor, limit } = request.query
        return queries.eventsSince({
          ...(since !== undefined ? { sinceIso: since } : {}),
          ...(type !== undefined ? { type } : {}),
          ...(cardId !== undefined ? { cardId } : {}),
          ...(actorKind !== undefined ? { actorKind } : {}),
          ...(cursor !== undefined ? { cursor } : {}),
          ...(limit !== undefined ? { limit } : {}),
        })
      },
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
