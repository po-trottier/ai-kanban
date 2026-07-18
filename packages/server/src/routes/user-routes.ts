import {
  createUserInputSchema,
  evaluatePolicy,
  updateUserInputSchema,
  userSearchQuerySchema,
  userWithTempPasswordSchemaOf,
  type Actor,
  type PickerUser,
  type User,
} from '@rivian-kanban/core'
import { type FastifyInstance, type FastifyRequest } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { UnauthenticatedError } from '../errors.ts'
import { type AppDeps } from '../types.ts'
import { idParamsSchema, pickerUserSchema, userResponseSchema } from './schemas.ts'

/** The acting user as a core Actor (kind 'user'). */
export function actorOf(request: FastifyRequest): Actor {
  const user: User | null = request.authUser
  if (user === null) throw new UnauthenticatedError()
  return { kind: 'user', id: user.id, role: user.role }
}

/** Core's envelope over the stripping user wrapper (temp password shown once). */
const userWithTempPasswordSchema = userWithTempPasswordSchemaOf(userResponseSchema)

/**
 * Query-string shape for `GET /users/search`, derived from the shared core
 * schema (single-schema rule): `limit` needs numeric coercion, and `ids`
 * arrives as `?ids=a,b,c` (comma-joined) or repeated keys — normalized to the
 * array `userSearchQuerySchema` expects. Unknown params are stripped, not 400.
 */
const userSearchQueryStringSchema = z.object({
  q: userSearchQuerySchema.shape.q,
  limit: z.coerce.number().int().min(1).max(50).optional(),
  ids: z.preprocess(
    (value) =>
      value === undefined
        ? undefined
        : (Array.isArray(value) ? value : [value]).flatMap((part) => String(part).split(',')),
    userSearchQuerySchema.shape.ids,
  ),
})

/** GET/POST /users, PATCH /users/:id (docs/architecture/rest-api.md#auth--users). */
export function userRoutes(deps: AppDeps) {
  return function routes(app: FastifyInstance): void {
    const r = app.withTypeProvider<ZodTypeProvider>()

    /**
     * Picker email gate (docs/architecture/rest-api.md#auth--users): emails
     * ride along only for actors who can manage users (the admin users table);
     * every other role keeps the email-free picker so the roster never becomes
     * an email oracle (slack/messages.ts relies on this). Gated on the
     * manageUsers PERMISSION, not a hardcoded role key, so a UI-created custom
     * admin role (ADR-013) sees emails too.
     */
    const toPickerUsers = async (request: FastifyRequest, users: User[]): Promise<PickerUser[]> => {
      const policy = (await deps.services.policies.getActive()).config
      const withEmail = evaluatePolicy(actorOf(request), { type: 'manageUsers' }, policy).allowed
      return users.map(({ id, displayName, role, email }) =>
        withEmail ? { id, displayName, role, email } : { id, displayName, role },
      )
    }

    r.get('/users', { schema: { response: { 200: z.array(pickerUserSchema) } } }, async (request) =>
      toPickerUsers(request, await deps.services.users.listActive()),
    )

    r.get(
      '/users/search',
      {
        schema: {
          querystring: userSearchQueryStringSchema,
          response: { 200: z.array(pickerUserSchema) },
        },
      },
      async (request) => {
        const { q, limit, ids } = request.query
        const users = await deps.services.users.search({
          q,
          ...(limit !== undefined ? { limit } : {}),
          ...(ids !== undefined ? { ids } : {}),
        })
        return toPickerUsers(request, users)
      },
    )

    r.post(
      '/users',
      {
        schema: {
          body: createUserInputSchema,
          response: { 201: userWithTempPasswordSchema },
        },
      },
      async (request, reply) => {
        const created = await deps.services.users.create(actorOf(request), request.body)
        return reply.code(201).send(created)
      },
    )

    r.patch(
      '/users/:id',
      {
        schema: {
          params: idParamsSchema,
          body: updateUserInputSchema,
          response: { 200: userWithTempPasswordSchema },
        },
      },
      async (request) =>
        deps.services.users.update(actorOf(request), request.params.id, request.body),
    )
  }
}
