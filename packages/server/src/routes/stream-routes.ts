import { type FastifyInstance } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { rawSessionIdOf } from '../plugins/session-auth.ts'
import { type AppDeps } from '../types.ts'
import { type SseHint } from '@rivian-kanban/core'
import { selectedBoardId } from './board-scope.ts'
import { actorOf } from './user-routes.ts'

/**
 * GET /stream — SSE invalidation hints (ADR-008), fed by the in-process
 * EventBus. Hints are the core `sseHintSchema` payloads serialized as the
 * default `message` event; a keepalive comment flows every 25 s so idle
 * connections survive proxies. Each user holds at most 5 concurrent streams
 * — opening a 6th drops the oldest (docs/architecture/security.md). Every
 * keepalive tick re-validates the session so logout/deactivation revokes a
 * live stream within one interval, and a preClose hook ends every stream so
 * `app.close()` (SIGTERM) never hangs on connected browsers.
 */

interface StreamHandle {
  close(): void
  /** Rechecks membership before sending a board's hint. */
  send(hint: SseHint): Promise<void>
}

export function streamRoutes(deps: AppDeps) {
  const streamsByUser = new Map<string, StreamHandle[]>()

  return function routes(app: FastifyInstance): void {
    const r = app.withTypeProvider<ZodTypeProvider>()

    // One bus subscription per app; each stream checks current access before delivery.
    const unsubscribe = deps.eventBus.subscribe((hint) => {
      for (const handles of streamsByUser.values()) {
        // Snapshot: a handle closing mid-dispatch must not skip its siblings.
        for (const handle of [...handles]) void handle.send(hint)
      }
    })

    // SSE responses are hijacked and never look idle: without this, a single
    // connected browser would block graceful shutdown until SIGKILL.
    app.addHook('preClose', (done) => {
      unsubscribe()
      for (const handles of [...streamsByUser.values()]) {
        for (const handle of [...handles]) handle.close()
      }
      done()
    })

    r.get('/stream', { config: { rawResponse: true }, schema: {} }, async (request, reply) => {
      const user = request.authUser
      const rawSessionId = rawSessionIdOf(request, deps.config.nodeEnv)
      // The session hook guarantees a cookie-backed user; guards keep types honest.
      if (user === null || rawSessionId === undefined) return
      const boardId = selectedBoardId(deps, request)
      await deps.services.boards.requireAccess(actorOf(request), boardId)

      let closed = false
      const close = (): void => {
        if (closed) return
        closed = true
        deps.metrics.sseStreamClosed()
        clearInterval(keepalive)
        // sseContext exists only once the first sse() write happened — a
        // client that aborted before that has nothing to end.
        if (reply.raw.headersSent) reply.sseContext.source.end()
        const remaining = (streamsByUser.get(user.id) ?? []).filter((h) => h !== handle)
        if (remaining.length === 0) streamsByUser.delete(user.id)
        else streamsByUser.set(user.id, remaining)
      }
      const handle: StreamHandle = {
        close,
        send: async (hint) => {
          try {
            if (closed) return
            const current = await deps.services.auth.authenticate(rawSessionId)
            if (current === null) {
              close()
              return
            }
            // Catalog changes let the client recover its selection after access is revoked.
            if (hint.type === 'board.updated') reply.sse({ data: JSON.stringify(hint) })
            const allowed = await deps.services.boards.acceptsHint(
              { kind: 'user', id: current.id, role: current.role },
              boardId,
              hint,
            )
            // A disconnect can set closed while the access check awaits.
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            if (!closed && allowed && hint.type !== 'board.updated')
              reply.sse({ data: JSON.stringify(hint) })
          } catch {
            close()
          }
        },
      }
      // Attach BEFORE registering: a client that disconnected while the
      // session hook awaited its DB read has already emitted 'close' — the
      // destroyed re-check below reaps that race instead of leaking the
      // registry entry and keepalive interval forever.
      request.raw.on('close', close)

      const keepalive = setInterval(() => {
        if (closed) return
        reply.sse({ comment: 'keepalive' })
        // Sessions revoke immediately everywhere else (security.md); one
        // indexed read per tick keeps that promise for long-lived streams.
        deps.services.auth
          .authenticate(rawSessionId)
          .then(async (current) => {
            if (current === null) close()
            else
              await deps.services.boards.requireAccess(
                { kind: 'user', id: current.id, role: current.role },
                boardId,
              )
          })
          .catch(() => {
            close()
          })
      }, deps.config.sse.keepaliveMs)

      const existing = streamsByUser.get(user.id) ?? []
      existing.push(handle)
      streamsByUser.set(user.id, existing)
      // Every registered handle passes through close() exactly once (the
      // `closed` guard), so the gauge cannot drift.
      deps.metrics.sseStreamOpened()
      while ((streamsByUser.get(user.id) ?? []).length > deps.config.sse.maxStreamsPerUser) {
        const oldest = (streamsByUser.get(user.id) ?? [])[0]
        if (oldest === undefined) break
        oldest.close()
      }

      if (request.raw.destroyed) {
        close()
        return
      }
      // Open the stream immediately (headers + a hello comment) so
      // EventSource fires `open` without waiting for the first hint.
      reply.sse({ comment: 'connected' })
    })
  }
}
