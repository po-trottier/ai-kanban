import { type FastifyInstance } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { rawSessionIdOf } from '../plugins/session-auth.ts'
import { type AppDeps } from '../types.ts'

/**
 * GET /stream — SSE invalidation hints (ADR-008), fed by the in-process
 * EventBus. Hints are the core `sseHintSchema` payloads serialized as the
 * default `message` event; a keepalive comment flows every 25 s so idle
 * connections survive proxies. Each user holds at most 5 concurrent streams
 * — opening a 6th drops the oldest (docs/architecture/security.md). Every
 * keepalive tick re-validates the session so logout/deactivation revokes a
 * live stream within one interval, and an onClose hook ends every stream so
 * `app.close()` (SIGTERM) never hangs on connected browsers.
 */

interface StreamHandle {
  close(): void
  /** Writes an already-serialized hint frame to the stream. */
  send(data: string): void
}

export function streamRoutes(deps: AppDeps) {
  const streamsByUser = new Map<string, StreamHandle[]>()

  return function routes(app: FastifyInstance): void {
    const r = app.withTypeProvider<ZodTypeProvider>()

    // ONE bus subscription per app: each hint is serialized once and the
    // shared string fans out to every connected stream — per-stream
    // subscriptions would re-JSON.stringify the same hint up to
    // (users x maxStreamsPerUser) times per mutation.
    const unsubscribe = deps.eventBus.subscribe((hint) => {
      const data = JSON.stringify(hint)
      for (const handles of streamsByUser.values()) {
        // Snapshot: a handle closing mid-dispatch must not skip its siblings.
        for (const handle of [...handles]) handle.send(data)
      }
    })

    // SSE responses are hijacked and never look idle: without this, a single
    // connected browser would block graceful shutdown until SIGKILL.
    app.addHook('onClose', () => {
      unsubscribe()
      for (const handles of [...streamsByUser.values()]) {
        for (const handle of [...handles]) handle.close()
      }
    })

    r.get('/stream', { config: { rawResponse: true }, schema: {} }, (request, reply) => {
      const user = request.authUser
      const rawSessionId = rawSessionIdOf(request, deps.config.nodeEnv)
      // The session hook guarantees a cookie-backed user; guards keep types honest.
      if (user === null || rawSessionId === undefined) return

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
        send: (data) => {
          if (!closed) reply.sse({ data })
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
          .then((current) => {
            if (current === null) close()
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
