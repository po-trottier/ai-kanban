import { defineConfig, devices } from '@playwright/test'

/**
 * E2E suite: real backend + real built frontend + real browser, seeded fixture data,
 * no mocks (docs/dev/testing.md). The webServer boots the server on a temp SQLite DB.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // webServer is configured when the server package exists (task: e2e suite)
})
