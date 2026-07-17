# ADR-014: Backend toolchain — tsx + esbuild; Vitest without a Vite app pipeline

**Status**: accepted (2026-07-16, researched at product-owner prompting: "if using Vitest,
shouldn't you use Vite too?")

## Context

The web package is built with Vite 8; backend packages (core, db, server) planned tsx for dev,
esbuild for the production bundle, Vitest for tests. Question: is testing non-Vite packages
with Vitest inconsistent, and should the backend adopt Vite for symmetry?

## Findings (primary sources, July 2026)

- Vitest peer-depends on Vite and uses it internally (config/plugins, module resolution,
  TS transforms via Vite's Module Runner). Using Vitest in a project not otherwise built with
  Vite is first-class and maintainer-endorsed (vitest-dev/vitest#3362).
- Running a server _through_ Vite is not the 2026 path: `vite-node` is legacy by its own README
  ("finished its mission"); Vite's Environment API server builds are RC and aimed at framework
  authors, not applications.
- Vitest's own 4.1 guidance for server-side code is the opposite of "add Vite": disable the
  module runner (`experimental.viteModuleRunner: false`) so tests execute with native Node
  imports — the Vite sandbox can mask resolution/env differences that then fail in production
  (documented: vitest#8414).
- Node 24 native type-stripping is stable but bans enums/parameter properties and ignores
  tsconfig paths — tsx (actively maintained) has none of those constraints. tsup is
  unmaintained; esbuild remains the standard server bundler.

## Decision

- Dev: **tsx watch**. Prod: **esbuild** single-artifact bundle, native modules external.
- Tests: **Vitest everywhere**; backend test projects set
  `experimental.viteModuleRunner: false` (native Node execution, v8 coverage, forks/threads
  pools — all already our defaults); the web project keeps its full Vite pipeline via its own
  `vite.config.ts`.

## Consequences

Backend tests exercise the same module-resolution semantics production runs — one less drift
class. No mocking APIs are lost that we use (mock functions are lint-banned in integration
tests; unit tests use hand-written fakes). If the flag misbehaves, removing it is a one-line
revert per project.
