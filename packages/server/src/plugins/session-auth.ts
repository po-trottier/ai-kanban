import { type FastifyInstance } from 'fastify'
import { MustChangePasswordError, UnauthenticatedError } from '../errors.ts'
import { sessionHashOf } from '../auth/auth-service.ts'
import { type AppDeps } from '../types.ts'

export const SESSION_COOKIE = 'sid'

/**
 * Session authentication for every /api/v1 route except those marked
 * `config.public` (login) — ADR-009. Runs at onRequest, before rate limiting
 * (so the upload bucket can key on the user) and before any body parsing.
 * While `must_change_password` is set, only routes marked
 * `allowWithPasswordChange` (change-password/logout/me) respond; everything
 * else is 403 (docs/architecture/rest-api.md#auth--users).
 */
export function registerSessionAuth(app: FastifyInstance, deps: AppDeps): void {
  app.decorateRequest('authUser', null)
  app.decorateRequest('sessionHash', null)

  app.addHook('onRequest', async (request, reply) => {
    const routeUrl = request.routeOptions.url
    // Unknown URLs fall through to the 404 handler; non-API routes (SPA,
    // health, version) are session-free.
    if (routeUrl?.startsWith('/api/v1') !== true) return
    if (request.routeOptions.config.public === true) return

    const { sid: rawSessionId } = request.cookies
    if (rawSessionId === undefined || rawSessionId === '') throw new UnauthenticatedError()
    const user = await deps.services.auth.authenticate(rawSessionId)
    if (user === null) {
      reply.clearCookie(SESSION_COOKIE, { path: '/' })
      throw new UnauthenticatedError()
    }
    request.authUser = user
    request.sessionHash = sessionHashOf(rawSessionId)

    if (user.mustChangePassword && request.routeOptions.config.allowWithPasswordChange !== true) {
      throw new MustChangePasswordError()
    }
  })
}
