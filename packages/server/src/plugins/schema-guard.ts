import { type FastifyInstance, type RouteOptions } from 'fastify'

/**
 * Boot-time schema enforcement (docs/dev/standards.md): every /api/v1 route
 * must declare Zod schemas — a response schema always, a body schema on
 * mutating methods (unless multipart or deliberately bodyless), and a params
 * schema whenever the path has params. A violating route registration throws,
 * failing the process before it can listen; any integration test catches it.
 */

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function methodsOf(route: RouteOptions): string[] {
  return (Array.isArray(route.method) ? route.method : [route.method]).map((method) =>
    method.toUpperCase(),
  )
}

export function registerSchemaGuard(app: FastifyInstance): void {
  app.addHook('onRoute', (route) => {
    if (!route.url.startsWith('/api/v1')) return
    // The Scalar docs UI (dev only) registers its own asset routes.
    if (route.url.startsWith('/api/v1/docs')) return
    const config = route.config ?? {}
    const methods = methodsOf(route).filter((method) => method !== 'HEAD' && method !== 'OPTIONS')
    if (methods.length === 0) return

    const schema = route.schema
    if (config.rawResponse !== true && schema?.response === undefined) {
      throw new Error(`route ${methods.join(',')} ${route.url} is missing a response schema`)
    }
    if (route.url.includes(':') && schema?.params === undefined) {
      throw new Error(`route ${methods.join(',')} ${route.url} is missing a params schema`)
    }
    const mutates = methods.some((method) => MUTATING_METHODS.has(method))
    if (
      mutates &&
      schema?.body === undefined &&
      config.multipart !== true &&
      config.bodyless !== true
    ) {
      throw new Error(`route ${methods.join(',')} ${route.url} is missing a body schema`)
    }
  })
}
