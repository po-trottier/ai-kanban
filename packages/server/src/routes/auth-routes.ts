import { type FastifyInstance } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { UnauthenticatedError } from '../errors.ts'
import { rawSessionIdOf, sessionCookieName } from '../plugins/session-auth.ts'
import { type AppDeps } from '../types.ts'
import { userResponseSchema, emptyBodySchema } from './schemas.ts'

const loginBodySchema = z.strictObject({
  email: z.email().max(254),
  password: z.string().min(1).max(1024),
})

const changePasswordBodySchema = z.strictObject({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(1).max(1024),
})

/** Sliding-window absolute cap: the cookie may outlive the session row, never vice versa. */
const COOKIE_MAX_AGE_SECONDS = 30 * 86_400

/**
 * POST /auth/login|logout|change-password, GET /auth/me
 * (docs/architecture/rest-api.md#auth--users, ADR-009).
 */
export function authRoutes(deps: AppDeps) {
  return function routes(app: FastifyInstance): void {
    const r = app.withTypeProvider<ZodTypeProvider>()
    const secureCookies = deps.config.nodeEnv === 'production'
    const sessionCookie = sessionCookieName(deps.config.nodeEnv)

    r.post(
      '/auth/login',
      {
        config: {
          public: true,
          rateLimit: {
            max: deps.config.rateLimits.login.max,
            timeWindow: deps.config.rateLimits.login.timeWindowMs,
          },
        },
        schema: {
          body: loginBodySchema,
          response: { 200: userResponseSchema },
        },
      },
      async (request, reply) => {
        const { user, rawSessionId } = await deps.services.auth.login(
          request.body.email,
          request.body.password,
        )
        reply.setCookie(sessionCookie, rawSessionId, {
          path: '/',
          httpOnly: true,
          sameSite: 'lax',
          secure: secureCookies,
          maxAge: COOKIE_MAX_AGE_SECONDS,
        })
        return user
      },
    )

    r.post(
      '/auth/logout',
      {
        config: { bodyless: true, allowWithPasswordChange: true },
        schema: { response: { 204: emptyBodySchema } },
      },
      async (request, reply) => {
        const raw = rawSessionIdOf(request, deps.config.nodeEnv)
        if (raw !== undefined) await deps.services.auth.logout(raw)
        reply.clearCookie(sessionCookie, { path: '/' })
        await reply.code(204).send(null)
      },
    )

    r.post(
      '/auth/change-password',
      {
        config: { allowWithPasswordChange: true },
        schema: {
          body: changePasswordBodySchema,
          response: { 204: emptyBodySchema },
        },
      },
      async (request, reply) => {
        const user = request.authUser
        const raw = rawSessionIdOf(request, deps.config.nodeEnv)
        if (user === null || raw === undefined) throw new UnauthenticatedError()
        await deps.services.auth.changePassword(
          user.id,
          raw,
          request.body.currentPassword,
          request.body.newPassword,
        )
        await reply.code(204).send(null)
      },
    )

    r.get(
      '/auth/me',
      {
        config: { allowWithPasswordChange: true },
        schema: { response: { 200: userResponseSchema } },
      },
      (request) => {
        if (request.authUser === null) throw new UnauthenticatedError()
        return Promise.resolve(request.authUser)
      },
    )
  }
}
