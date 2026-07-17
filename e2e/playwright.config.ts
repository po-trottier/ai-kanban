import { defineConfig, devices } from '@playwright/test'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BASE_URL, DATA_DIR, DEMO_PASSWORD, SERVER_PORT } from './support/constants.ts'

/**
 * E2E suite: real backend + real built frontend + real browser, seeded fixture
 * data, no mocks (docs/dev/testing.md). The webServer command resets a temp
 * data dir, builds the SPA if missing (scripts/prepare.mjs), then boots the
 * real server entrypoint on a per-checkout port (support/constants.ts).
 * `SEED_DEMO_PASSWORD` makes the demo logins deterministic; TRUST_PROXY_HOPS=1
 * lets each test present its own client IP (support/fixtures.ts) so per-IP
 * rate limits behave per-user.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  // One worker, sequential files: the suite shares one server + database per
  // run, and every spec owns its data (unique titles via randomUUID).
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node e2e/scripts/prepare.mjs && node --import tsx packages/server/src/main.ts',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    url: `${BASE_URL}/readyz`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      NODE_ENV: 'development',
      PORT: String(SERVER_PORT),
      DATABASE_PATH: join(DATA_DIR, 'app.sqlite'),
      BLOB_DIR: join(DATA_DIR, 'blobs'),
      E2E_DATA_DIR: DATA_DIR,
      SEED_DEMO_DATA: 'true',
      SEED_DEMO_PASSWORD: DEMO_PASSWORD,
      SLACK_ENABLED: 'false',
      SUMMARIZER_ENABLED: 'false',
      TRUST_PROXY_HOPS: '1',
      LOG_LEVEL: 'warn',
    },
  },
})
