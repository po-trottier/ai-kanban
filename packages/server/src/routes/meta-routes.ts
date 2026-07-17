import { type FastifyInstance } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

/**
 * GET /api/v1/openapi.json — the generated OpenAPI 3.1 document. Requires an
 * authenticated session like every /api/v1 route ("always available" means
 * all environments, not anonymous — docs/architecture/rest-api.md). The
 * Scalar docs UI at /api/v1/docs is registered in app.ts (non-production).
 */
export function metaRoutes() {
  return function routes(app: FastifyInstance): void {
    const r = app.withTypeProvider<ZodTypeProvider>()
    r.get(
      '/openapi.json',
      { schema: { response: { 200: z.record(z.string(), z.unknown()) } } },
      () => app.swagger() as unknown as Record<string, unknown>,
    )
  }
}
