import { type App as SlackApp } from '@slack/bolt'
import {
  createAiSummarizer,
  summarizerSettingsFromEnv,
} from './adapters/summarizer/ai-summarizer.ts'
import { buildApp } from './app.ts'
import { parseEnv } from './env.ts'
import { createSlackApp } from './slack/slack-app.ts'
import { wireApp } from './wiring/wire.ts'

/**
 * @rivian-kanban/server process entrypoint: env → composition root →
 * Fastify → listen → (optional) Slack Socket Mode. MCP mount, croner jobs,
 * and the metrics listener attach here in their own tasks
 * (docs/architecture/overview.md).
 */

const env = parseEnv()
const wired = await wireApp(env)
const app = await buildApp(wired.deps)

for (const { email, password } of wired.demoCredentials) {
  // One-time demo credentials (SEED_DEMO_DATA, non-production boots only).
  app.log.warn(`demo user ${email} password: ${password} (shown once)`)
}

let slack: SlackApp | null = null

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down')
  if (slack !== null) {
    await slack.stop().catch((error: unknown) => {
      app.log.error(error)
    })
  }
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

// Bolt starts after Fastify listens: the board must be reachable before
// Slack traffic can create cards (docs/architecture/slack.md).
if (env.SLACK_ENABLED && env.SLACK_BOT_TOKEN !== undefined && env.SLACK_TEAM_ID !== undefined) {
  try {
    const summarizerSettings = summarizerSettingsFromEnv(env)
    slack = createSlackApp({
      botToken: env.SLACK_BOT_TOKEN,
      ...(env.SLACK_APP_TOKEN !== undefined ? { appToken: env.SLACK_APP_TOKEN } : {}),
      teamId: env.SLACK_TEAM_ID,
      publicBaseUrl: env.PUBLIC_BASE_URL,
      cards: wired.deps.services.cards,
      uow: wired.deps.uow,
      clock: wired.deps.clock,
      summarizer:
        summarizerSettings === null ? null : createAiSummarizer(summarizerSettings, app.log),
      logger: app.log,
    })
    await slack.start()
    app.log.info('slack socket mode started')
  } catch (error) {
    // Fail fast, mirroring the listen block: SLACK_ENABLED with a dead
    // socket (revoked xapp token, blocked egress) would otherwise be a
    // silent outage. Close Fastify and the db cleanly before exiting.
    app.log.error(error)
    await app.close()
    wired.connection.close()
    process.exit(1)
  }
}
