import { type FastifyInstance, type FastifyRequest } from 'fastify'
import { MustChangePasswordError, UnauthenticatedError } from '../errors.ts'
import { sessionHashOf } from '../auth/auth-service.ts'
import { type AppConfig, type AppDeps } from '../types.ts'

/**
 * The session cookie name. Production uses the `__Host-` prefix — the cookie
 * already meets its requirements (Secure, path=/, no Domain) — so a
 * compromised sibling subdomain cannot SET/overwrite it (session fixation):
 * the half of the same-site threat in security.md#web-platform-hardening
 * that the header/content-type CSRF layer does not cover. Browsers refuse
 * `__Host-` cookies without Secure, so dev/test keep the plain name over
 * http; each mode reads only its own canonical name.
 */
export function sessionCookieName(nodeEnv: AppConfig['nodeEnv']): string {
  return nodeEnv === 'production' ? '__Host-sid' : 'sid'
}

/** The presented raw session id under the env-canonical cookie name. */
export function rawSessionIdOf(
  request: FastifyRequest,
  nodeEnv: AppConfig['nodeEnv'],
): string | undefined {
  return nodeEnv === 'production' ? request.cookies['__Host-sid'] : request.cookies.sid
}

/**
 * Session authentication for every /api/v1 route except those marked
 * `config.public` (login) — ADR-009. Runs at onRequest, before rate limiting
 * (so the upload bucket can key on the user) and before any body parsing.
 * While `must_change_password` is set, only routes marked
 * `allowWithPasswordChange` (change-password/logout/me) respond; everything
 * else is 403 (docs/architecture/rest-api.md#auth--users).
 */
export function registerSessionAuth(app: FastifyInstance, deps: AppDeps): void {
  const sessionCookie = sessionCookieName(deps.config.nodeEnv)
  app.decorateRequest('authUser', null)
  app.decorateRequest('sessionHash', null)

  app.addHook('onRequest', async (request, reply) => {
    const routeUrl = request.routeOptions.url
    // Unknown URLs fall through to the 404 handler; non-API routes (SPA,
    // health, version) are session-free.
    if (routeUrl?.startsWith('/api/v1') !== true) return
    if (request.routeOptions.config.public === true) return

    const rawSessionId = rawSessionIdOf(request, deps.config.nodeEnv)
    if (rawSessionId === undefined || rawSessionId === '') throw new UnauthenticatedError()
    const user = await deps.services.auth.authenticate(rawSessionId)
    if (user === null) {
      reply.clearCookie(sessionCookie, { path: '/' })
      throw new UnauthenticatedError()
    }
    request.authUser = user
    request.sessionHash = sessionHashOf(rawSessionId)

    if (user.mustChangePassword && request.routeOptions.config.allowWithPasswordChange !== true) {
      throw new MustChangePasswordError()
    }
  })
}
