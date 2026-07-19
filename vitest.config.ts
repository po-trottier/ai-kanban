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
      // Excluded: tests, migrations, assets, and pure entry points (re-export
      // barrels and process mains — no logic, wired by the composition root).
      exclude: [
        '**/*.test.*',
        '**/test/**',
        '**/migrations/**',
        // Declarative pg table definitions (ADR-020) — the Postgres analogue of
        // the excluded migration SQL. Its FK/index closures fire during
        // drizzle-kit generation, not at query time; behavior is proven by the
        // pg integration tests (db/src/pg/services + server/postgres-app).
        '**/schema.pg.ts',
        // The pg REPOSITORY adapters (ADR-020) mirror the coverage-gated SQLite
        // repositories statement-for-statement (same Drizzle query-builder calls,
        // only sync→async + the pg schema import). Their behavior is verified by
        // the pg integration tests; re-testing every filter/error branch already
        // gated on SQLite would be pure duplication. The pg-specific
        // INFRASTRUCTURE (unit of work, connection, errors, seed, data layer)
        // stays under the threshold.
        '**/pg/repositories/**',
        '**/*.css',
        '**/src/index.ts',
        '**/src/testing/index.ts',
        '**/src/main.ts',
        '**/src/main.tsx',
        '**/src/cli.ts',
        '**/src/migrate-cli.ts',
        '**/src/seed-cli.ts',
      ],
      thresholds: {
        'packages/core/**': { lines: 90, functions: 90, statements: 90, branches: 85 },
        'packages/db/**': { lines: 90, functions: 90, statements: 90, branches: 85 },
        'packages/server/**': { lines: 90, functions: 90, statements: 90, branches: 85 },
        'packages/web/**': { lines: 80, functions: 80, statements: 80, branches: 75 },
      },
    },
  },
})
