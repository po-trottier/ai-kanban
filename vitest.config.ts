import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/{core,db,server}/src/**/*.unit.test.ts'],
          pool: 'threads',
          // Native Node execution — no Vite module-runner sandbox for backend code (ADR-014)
          experimental: { viteModuleRunner: false },
        },
      },
      {
        test: {
          name: 'integration',
          include: ['packages/**/*.integration.test.ts'],
          pool: 'forks',
          // One fresh process per file: each file owns a real temp SQLite DB
          isolate: true,
          testTimeout: 15_000,
          hookTimeout: 30_000,
          experimental: { viteModuleRunner: false },
        },
      },
      // The 'web' project is defined in packages/web/vite.config.ts (needs the React plugin)
      'packages/web',
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**'],
      exclude: ['**/*.test.*', '**/test/**', '**/migrations/**'],
      thresholds: {
        'packages/core/**': { lines: 90, functions: 90, statements: 90, branches: 85 },
        'packages/db/**': { lines: 90, functions: 90, statements: 90, branches: 85 },
        'packages/server/**': { lines: 90, functions: 90, statements: 90, branches: 85 },
        'packages/web/**': { lines: 80, functions: 80, statements: 80, branches: 75 },
      },
    },
  },
})
