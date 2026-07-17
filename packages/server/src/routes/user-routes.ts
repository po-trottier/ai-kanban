import {
  createUserInputSchema,
  updateUserInputSchema,
  userWithTempPasswordSchemaOf,
  type Actor,
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

/** GET/POST /users, PATCH /users/:id (docs/architecture/rest-api.md#auth--users). */
export function userRoutes(deps: AppDeps) {
  return function routes(app: FastifyInstance): void {
    const r = app.withTypeProvider<ZodTypeProvider>()

    r.get(
      '/users',
      { schema: { response: { 200: z.array(pickerUserSchema) } } },
      async (request) => {
        const users = await deps.services.users.listActive()
        // Emails ride along for admins only (the users admin table); every
        // other role keeps the email-free picker (slack/messages.ts relies on
        // the roster never becoming an email oracle for non-admins).
        if (actorOf(request).role === 'admin') return users
        return users.map(({ id, displayName, role }) => ({ id, displayName, role }))
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
