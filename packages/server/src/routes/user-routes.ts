import { type Actor, type User } from '@rivian-kanban/core'
import { type FastifyInstance, type FastifyRequest } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { UnauthenticatedError } from '../errors.ts'
import { createUserInputSchema, updateUserInputSchema } from '../users/user-admin-service.ts'
import { type AppDeps } from '../types.ts'
import { idParamsSchema, pickerUserSchema, userResponseSchema } from './schemas.ts'

/** The acting user as a core Actor (kind 'user'). */
export function actorOf(request: FastifyRequest): Actor {
  const user: User | null = request.authUser
  if (user === null) throw new UnauthenticatedError()
  return { kind: 'user', id: user.id, role: user.role }
}

const userWithTempPasswordSchema = z.object({
  user: userResponseSchema,
  /** One-time temp password — present on create and resetPassword only. */
  tempPassword: z.string().optional(),
})

/** GET/POST /users, PATCH /users/:id (docs/architecture/rest-api.md#auth--users). */
export function userRoutes(deps: AppDeps) {
  return function routes(app: FastifyInstance): void {
    const r = app.withTypeProvider<ZodTypeProvider>()

    r.get('/users', { schema: { response: { 200: z.array(pickerUserSchema) } } }, async () =>
      deps.services.users.listActive(),
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
