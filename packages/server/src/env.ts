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
    /** Internal Prometheus listener (wired by the metrics task). */
    METRICS_PORT: z.coerce.number().int().min(1).max(65535).default(9464),
    PUBLIC_BASE_URL: z.url().default('http://localhost:3000'),
    /** Known reverse-proxy hop count — client-IP rate limits depend on it. */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
    DATABASE_PATH: z.string().min(1).default('./data/app.sqlite'),
    BLOB_DIR: z.string().min(1).default('./data/blobs'),
    /** Demo fixtures — additionally gated to non-production at boot. */
    SEED_DEMO_DATA: z.stringbool().default(false),
    SLACK_ENABLED: z.stringbool().default(false),
    SLACK_BOT_TOKEN: z.string().min(1).optional(),
    SLACK_APP_TOKEN: z.string().min(1).optional(),
    SLACK_TEAM_ID: z.string().min(1).optional(),
    SUMMARIZER_ENABLED: z.stringbool().default(false),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
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
    if (env.SUMMARIZER_ENABLED && env.ANTHROPIC_API_KEY === undefined) {
      ctx.issues.push({
        code: 'custom',
        message: 'ANTHROPIC_API_KEY is required when SUMMARIZER_ENABLED=true',
        path: ['ANTHROPIC_API_KEY'],
        input: env,
      })
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
