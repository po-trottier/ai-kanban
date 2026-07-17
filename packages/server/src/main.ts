import { buildApp } from './app.ts'
import { parseEnv } from './env.ts'
import { wireApp } from './wiring/wire.ts'

/**
 * @rivian-kanban/server process entrypoint: env → composition root →
 * Fastify → listen. MCP mount, Slack Bolt, croner jobs, and the metrics
 * listener attach here in their own tasks (docs/architecture/overview.md).
 */

const env = parseEnv()
const wired = await wireApp(env)
const app = await buildApp(wired.deps)

for (const { email, password } of wired.demoCredentials) {
  // One-time demo credentials (SEED_DEMO_DATA, non-production boots only).
  app.log.warn(`demo user ${email} password: ${password} (shown once)`)
}

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down')
  await app.close()
  wired.connection.close()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
