# Engineering Standards (enforced)

Every rule here is a **MUST** and names the tool that enforces it. A rule without an enforcer
does not belong in this file — put it in code review guidance instead. CI (see
[testing.md](testing.md#ci-pipeline)) fails on any violation; git hooks (lefthook) are advisory
convenience only, CI is the gate.

## Language & compiler

| Rule                                                                                                   | Enforcer                                                   |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| TypeScript strict, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride` | `tsc --noEmit` in CI                                       |
| TypeScript pinned 6.0.3 monorepo-wide (ADR-002)                                                        | exact pin + lockfile                                       |
| No `any`, no non-null assertions, no `@ts-ignore`/`@ts-expect-error` without description               | typescript-eslint `strict-type-checked` + `ban-ts-comment` |
| ESLint 10 flat config, `--max-warnings 0` — warnings are errors                                        | CI lint step                                               |
| Exact-pinned dependencies (`save-exact`), `npm ci` in CI                                               | `.npmrc` + CI                                              |

## Architecture (SOLID made mechanical)

The useful parts of SOLID here are dependency direction and interface ownership; they are
enforced structurally, not aspirationally.

| Rule                                                                                                             | Enforcer                                                          |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `core` imports no other package and no framework/IO library (DIP: core owns the ports)                           | dependency-cruiser                                                |
| Only `packages/db` may import `drizzle-orm` / `better-sqlite3` (no hard SQLite dependency)                       | dependency-cruiser                                                |
| Only the blob adapter may use `node:fs` for blob paths                                                           | dependency-cruiser                                                |
| Adapters (REST routes, MCP tools, Slack listeners) may import core services but never repositories or each other | dependency-cruiser                                                |
| No circular dependencies anywhere                                                                                | dependency-cruiser `no-circular`                                  |
| No dead code, unused exports, or unused dependencies                                                             | knip (fails CI)                                                   |
| Every REST route declares Zod request+response schemas                                                           | boot-time `onRoute` hook throws → any integration test catches it |
| All config/secrets via env, validated at boot                                                                    | Zod env schema; process refuses to start                          |
| Raw SQL banned outside `packages/db`                                                                             | eslint `no-restricted-imports` / dependency-cruiser               |

**DRY** is served by the single-schema rule: a shape defined once in `core` (Zod) drives REST
validation, OpenAPI, MCP inputSchema, and frontend forms. Duplicating a schema shape instead of
importing it is a review-blocking defect.

**KISS** has one enforceable proxy — additions must justify themselves: knip removes what
nothing uses, and new dependencies require an ADR note if they overlap an existing one.

## Naming & style

| Rule                                                                         | Enforcer                              |
| ---------------------------------------------------------------------------- | ------------------------------------- |
| Prettier formatting, single quotes, no semicolons debate — config is the law | prettier --check in CI                |
| eslint-plugin-security recommended rules on backend packages                 | ESLint                                |
| No `console.*` outside the CLI entrypoints — pino only                       | ESLint `no-console`                   |
| Conventional Commits (`type(scope): subject`)                                | commitlint in CI on PR titles/commits |

## Git & review

- Atomic commits: one logical change per commit; docs updated in the same commit as the
  behavior they describe (see [overview.md](../architecture/overview.md#deviations-from-this-document)).
- `main` is protected: CI green required; no force pushes.
- Every feature lands with its tests (TDD — see [testing.md](testing.md)); a PR that lowers
  coverage below the gates fails CI mechanically.

## Documentation

- ADRs for any decision that changes an existing ADR or adds a dependency with architectural
  weight. ADRs are immutable once accepted; supersede, don't edit.
- Public service methods in `core` carry JSDoc stating their policy checks and audit events —
  the contract adapters rely on.
