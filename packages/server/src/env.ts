import { z } from 'zod'

/**
 * Environment configuration, Zod-validated at boot per the table in
 * docs/architecture/deployment.md#configuration-env-zod-validated-at-boot.
 * The process refuses to start on missing or malformed values. Empty strings
 * (a cleared line in an env file) are treated as absent.
 */
const envSchema = z
  .object({
    /** `production` disables demo seeding and the dev docs UI. */
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    /** Internal Prometheus listener — Compose never publishes it. */
    METRICS_PORT: z.coerce.number().int().min(1).max(65535).default(9464),
    /**
     * Bind address for the metrics listener: loopback by default; the
     * container image sets 0.0.0.0 so the org Prometheus can scrape over the
     * internal Docker network (the port still is not published).
     */
    METRICS_HOST: z.string().min(1).default('127.0.0.1'),
    PUBLIC_BASE_URL: z.url().default('http://localhost:3000'),
    /** Known reverse-proxy hop count — client-IP rate limits depend on it. */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
    DATABASE_PATH: z.string().min(1).default('./data/app.sqlite'),
    BLOB_DIR: z.string().min(1).default('./data/blobs'),
    /** Nightly online-backup snapshots land here (deployment.md#database-operations). */
    SNAPSHOT_DIR: z.string().min(1).default('./data/snapshots'),
    /**
     * Drizzle migrations directory override. Unset in dev (packages/db
     * resolves its own ./migrations); the production bundle cannot — esbuild
     * relocates the code, so the image pins /app/dist/migrations explicitly.
     */
    MIGRATIONS_DIR: z.string().min(1).optional(),
    /**
     * Built SPA directory override. Unset in dev (packages/web/dist is found
     * relative to the source tree); the image pins /app/web explicitly.
     */
    SPA_DIR: z.string().min(1).optional(),
    /** Demo fixtures — additionally gated to non-production at boot. */
    SEED_DEMO_DATA: z.stringbool().default(false),
    /**
     * Fixed password for the seeded demo users (deterministic logins for
     * local dev and Playwright). Same policy bounds as real passwords;
     * refused outright in production mode — a known password must never
     * reach a production boot.
     */
    SEED_DEMO_PASSWORD: z.string().min(12).max(128).optional(),
    SLACK_ENABLED: z.stringbool().default(false),
    SLACK_BOT_TOKEN: z.string().min(1).optional(),
    SLACK_APP_TOKEN: z.string().min(1).optional(),
    SLACK_TEAM_ID: z.string().min(1).optional(),
    SUMMARIZER_ENABLED: z.stringbool().default(false),
    /** Provider-agnostic summarizer (ADR-017): the LLM is pure configuration. */
    SUMMARIZER_PROVIDER: z
      .enum(['anthropic', 'openai', 'google', 'openai-compatible'])
      .default('anthropic'),
    SUMMARIZER_MODEL: z.string().min(1).default('claude-haiku-4-5'),
    /** Always passed explicitly to the provider factory — never ambient env vars. */
    SUMMARIZER_API_KEY: z.string().min(1).optional(),
    /** Optional endpoint override; required for openai-compatible (e.g. build.nvidia.com). */
    SUMMARIZER_BASE_URL: z.url().optional(),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    /** Build-time stamps surfaced by GET /version; 'dev' outside the image. */
    APP_VERSION: z.string().min(1).default('dev'),
    GIT_SHA: z.string().min(1).default('dev'),
    BUILT_AT: z.string().min(1).default('dev'),
  })
  .check((ctx) => {
    const env = ctx.value
    if (env.SLACK_ENABLED) {
      const slackValues: readonly [string, string | undefined][] = [
        ['SLACK_BOT_TOKEN', env.SLACK_BOT_TOKEN],
        ['SLACK_APP_TOKEN', env.SLACK_APP_TOKEN],
        ['SLACK_TEAM_ID', env.SLACK_TEAM_ID],
      ]
      for (const [key, value] of slackValues) {
        if (value === undefined) {
          ctx.issues.push({
            code: 'custom',
            message: `${key} is required when SLACK_ENABLED=true`,
            path: [key],
            input: env,
          })
        }
      }
    }
    if (env.NODE_ENV === 'production' && env.SEED_DEMO_PASSWORD !== undefined) {
      ctx.issues.push({
        code: 'custom',
        message: 'SEED_DEMO_PASSWORD is refused in production mode',
        path: ['SEED_DEMO_PASSWORD'],
        input: env,
      })
    }
    if (env.SUMMARIZER_ENABLED) {
      if (env.SUMMARIZER_API_KEY === undefined) {
        ctx.issues.push({
          code: 'custom',
          message: 'SUMMARIZER_API_KEY is required when SUMMARIZER_ENABLED=true',
          path: ['SUMMARIZER_API_KEY'],
          input: env,
        })
      }
      if (
        env.SUMMARIZER_PROVIDER === 'openai-compatible' &&
        env.SUMMARIZER_BASE_URL === undefined
      ) {
        ctx.issues.push({
          code: 'custom',
          message: 'SUMMARIZER_BASE_URL is required when SUMMARIZER_PROVIDER=openai-compatible',
          path: ['SUMMARIZER_BASE_URL'],
          input: env,
        })
      }
    }
  })

export type Env = z.infer<typeof envSchema>

/** Parses (and defaults) the environment; throws a readable list of violations. */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  )
  const result = envSchema.safeParse(cleaned)
  if (!result.success) {
    const lines = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')
    throw new Error(`invalid configuration — refusing to boot:\n${lines}`)
  }
  return result.data
}
