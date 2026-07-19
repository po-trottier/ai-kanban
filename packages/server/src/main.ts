import { type App as SlackApp } from '@slack/bolt'
import {
  createAiSummarizer,
  summarizerSettingsFromEnv,
} from './adapters/summarizer/ai-summarizer.ts'
import { buildApp } from './app.ts'
import { parseEnv } from './env.ts'
import { startMetricsServer, type MetricsServer } from './metrics/metrics-server.ts'
import { createSlackApp } from './slack/slack-app.ts'
import { scheduleJobs, type ScheduledJobs } from './wiring/jobs.ts'
import { SqliteSnapshotStore } from './wiring/sqlite-snapshot-store.ts'
import { wireApp } from './wiring/wire.ts'

/**
 * @rivian-kanban/server process entrypoint: env → composition root →
 * Fastify → listen → internal metrics listener → croner jobs → (optional)
 * Slack Socket Mode (docs/architecture/overview.md).
 */

const env = parseEnv()
const wired = await wireApp(env)
const app = await buildApp(wired.deps)

for (const { email, password } of wired.demoCredentials) {
  // One-time demo credentials (SEED_DEMO_DATA, non-production boots only).
  app.log.warn(`demo user ${email} password: ${password} (shown once)`)
}

let slack: SlackApp | null = null
let metricsServer: MetricsServer | null = null
let jobs: ScheduledJobs | null = null

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down')
  // Cancels future ticks AND drains any in-flight run: the connection.close()
  // below must never land under a job mid-transaction.
  await jobs?.stop()
  if (slack !== null) {
    await slack.stop().catch((error: unknown) => {
      app.log.error(error)
    })
  }
  if (metricsServer !== null) {
    await metricsServer.close().catch((error: unknown) => {
      app.log.error(error)
    })
  }
  await app.close()
  await wired.close()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' })
  // The internal Prometheus listener (deployment.md#observability) — a
  // second Fastify instance that Compose never publishes. Fail-fast like the
  // public listener: a silently missing scrape target is an outage too.
  metricsServer = await startMetricsServer(wired.deps.metrics, {
    host: env.METRICS_HOST,
    port: env.METRICS_PORT,
    logger: app.log,
  })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}

// Croner jobs start once the app serves traffic; every job re-derives its
// work from persisted state, so a late start just means a later first tick.
jobs = scheduleJobs({
  uow: wired.deps.uow,
  clock: wired.deps.clock,
  cards: wired.deps.services.cards,
  notifier: wired.notifier,
  boardId: wired.boardId,
  systemUserId: wired.systemUserId,
  auth: wired.deps.services.auth,
  // VACUUM snapshots are SQLite-only; on Postgres (connection null) there is none.
  snapshots:
    wired.connection === null ? null : new SqliteSnapshotStore(wired.connection, env.SNAPSHOT_DIR),
  metrics: wired.deps.metrics,
  logger: app.log,
})
app.log.info({ jobs: jobs.jobs.map((job) => job.name) }, 'scheduled jobs registered')

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
    await wired.close()
    process.exit(1)
  }
}
