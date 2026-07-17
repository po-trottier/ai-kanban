import Fastify, { type FastifyBaseLogger } from 'fastify'
import { type AppMetrics } from './metrics.ts'

/**
 * The SECOND Fastify listener (docs/architecture/deployment.md#topology):
 * `GET /metrics` only, bound to METRICS_HOST:METRICS_PORT — loopback by
 * default, the container's internal network in the image — and never
 * published by Compose or routed by the proxy. Keeping it off the public
 * listener means no auth story, no rate-limit coupling, and no way for a
 * misconfigured proxy to leak operational data.
 */

export interface MetricsServerOptions {
  host: string
  port: number
  logger?: FastifyBaseLogger
}

export interface MetricsServer {
  /** `http://host:port` as actually bound (port 0 resolves to the real one). */
  url: string
  close(): Promise<void>
}

export async function startMetricsServer(
  metrics: AppMetrics,
  options: MetricsServerOptions,
): Promise<MetricsServer> {
  const app = Fastify(options.logger === undefined ? {} : { loggerInstance: options.logger })
  app.get('/metrics', async (_request, reply) => {
    return reply.type(metrics.registry.contentType).send(await metrics.registry.metrics())
  })
  await app.listen({ host: options.host, port: options.port })
  const address = app.server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('metrics listener bound to a pipe — a TCP host:port is required')
  }
  return {
    url: `http://${options.host}:${String(address.port)}`,
    close: () => app.close(),
  }
}
