/**
 * Architecture rules from docs/dev/standards.md — the machine-enforced half of SOLID.
 * Run: npm run depcruise
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'core-is-framework-free',
      comment:
        'packages/core owns the domain and its ports; it may depend only on pure algorithm libraries (zod, fractional-indexing, uuidv7) — never on other packages, frameworks, or node builtins.',
      severity: 'error',
      from: { path: '^packages/core/src', pathNot: '\\.unit\\.test\\.ts$' },
      to: {
        pathNot: '^(packages/core/src|node_modules/(zod|fractional-indexing|uuidv7)([/]|$))',
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'core-unit-tests-almost-pure',
      comment:
        'Core unit tests (colocated under src/ per docs/dev/testing.md) may additionally import the test runner — nothing else.',
      severity: 'error',
      from: { path: '^packages/core/src/.*\\.unit\\.test\\.ts$' },
      to: {
        pathNot:
          '^(packages/core/src|node_modules/(zod|fractional-indexing|uuidv7|vitest|@vitest)([/]|$))',
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'sqlite-only-in-db',
      comment: 'No hard SQLite/ORM dependency outside packages/db (ADR-003).',
      severity: 'error',
      from: { pathNot: '^packages/db' },
      to: { path: 'node_modules/(better-sqlite3|drizzle-orm|drizzle-kit)([/]|$)' },
    },
    {
      name: 'adapters-call-services-not-repos',
      comment:
        'Inbound adapters (REST routes, MCP tools, Slack listeners, jobs) must go through core services; only the composition root wires packages/db.',
      severity: 'error',
      from: { path: '^packages/server/src/(routes|mcp|slack|jobs)/' },
      to: { path: '^packages/db' },
    },
    {
      name: 'adapters-do-not-cross',
      comment: 'REST, MCP, and Slack adapters are peers; they must not import each other.',
      severity: 'error',
      from: { path: '^packages/server/src/(routes|mcp|slack)/' },
      to: {
        path: '^packages/server/src/(routes|mcp|slack)/',
        pathNot: '^packages/server/src/$1',
      },
    },
    {
      name: 'fs-only-in-blob-adapter-and-wiring',
      comment:
        'Filesystem access is confined to the blob-store adapter and the composition root (BlobStorePort portability, docs/dev/standards.md). Test files are exempt: every integration test file owns a real temp directory (docs/dev/testing.md).',
      severity: 'error',
      from: {
        path: '^packages/server/src',
        pathNot:
          '^packages/server/src/(adapters/blob|wiring|main\\.ts|cli\\.ts|test/)|\\.integration\\.test\\.ts$',
      },
      to: { path: '^(node:)?fs' },
    },
    {
      name: 'web-imports-core-only',
      comment: 'The SPA may import shared schemas/types from core, never db or server internals.',
      severity: 'error',
      from: { path: '^packages/web/src' },
      to: { path: '^packages/(db|server)' },
    },
    {
      name: 'no-orphans',
      comment: 'Entry points (package index, process mains, CLIs) are legitimate roots.',
      severity: 'error',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)[^/]+\\.d\\.ts$',
          '\\.config\\.(js|cjs|ts)$',
          '/migrations/',
          '^packages/[^/]+/src/index\\.ts$',
          '^packages/server/src/(main|cli)\\.ts$',
          '^packages/db/src/(seed-cli|migrate-cli)\\.ts$',
          '^packages/web/src/main\\.tsx$',
          '^packages/web/src/test/setup\\.ts$',
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'default', 'types'],
      mainFields: ['module', 'main', 'types'],
    },
  },
}
