# Testing Standards (enforced)

TDD is the working method: write the failing test, make it pass, refactor. The pyramid is
deliberately top-heavy — **integration and e2e tests against the real app with real data are
the source of truth**; unit tests prove micro-logic, they never substitute for the real thing.

## Test taxonomy

| Layer | Files | Runs against | Speed budget |
| --- | --- | --- | --- |
| Unit | `*.unit.test.ts` (Vitest, threads pool) | core services with **hand-written in-memory port fakes** | ms |
| Integration | `*.integration.test.ts` (Vitest, forks pool) | the **real Fastify app** via `app.inject()` + a **real temp SQLite file** per test file with real migrations; real Bolt app via TestReceiver; external HTTP (Slack/Anthropic) served by **local fixture HTTP servers** | < 1 s each |
| MCP e2e | integration layer | MCP SDK's own client ↔ the real server in-process | < 1 s each |
| E2E | `e2e/**` (Playwright) | real backend + real built frontend + real browser; seeded fixture data | seconds |

## The rules (each with its enforcer)

| Rule | Enforcer |
| --- | --- |
| **AAA pattern** in every unit test: explicit `// Arrange`, `// Act`, `// Assert` comments marking the three sections, in order, in every test body; one behavior per test | custom local ESLint rule `local/require-aaa-comments` on `*.unit.test.ts` (presence + order are machine-checked) plus `@vitest/eslint-plugin` `max-expects`, `expect-expect`, `valid-title` |
| **No mocking in integration/e2e** — no `vi.mock`, `vi.fn`, `vi.spyOn`, `vi.stubGlobal`, `vi.useFakeTimers`, no mock libraries | ESLint flat-config override on `**/*.integration.test.ts` and `e2e/**`: `no-restricted-properties` + `no-restricted-imports` |
| External services are faked only as **real local HTTP servers** serving recorded fixture responses (Slack Web API, Anthropic) — our code runs unmodified | integration harness provides them; the lint rule above blocks the lazy alternative |
| Unit-test doubles are **hand-written fakes implementing core ports** (e.g. `InMemoryCardRepository`), never mocking-library constructs | same lint rules applied repo-wide for `vi.mock`/`vi.spyOn`; fakes live in `packages/core/test/fakes/` |
| Time and randomness are **ports** (`Clock`, `IdGenerator`) — tests inject fixed values instead of faking globals | design + `vi.useFakeTimers` ban |
| Every test file owns its data: fresh DB file (integration) or fresh fake instances (unit); no shared mutable fixtures, no test-order dependence | forks-pool per-file isolation + `createTestApp()` per test |
| No focused/skipped/conditional tests in CI | `@vitest/eslint-plugin`: `no-focused-tests`, `no-disabled-tests`, `no-conditional-expect`, `no-conditional-tests` |
| Playwright: no `waitForTimeout`, web-first assertions only | eslint-plugin-playwright |
| Frontend component tests query by role/label (a11y-first) | eslint-plugin-testing-library |
| Coverage gates (lines/branches): core & server 90/85, web 80/75 — ratchet up, never down | `@vitest/coverage-v8` thresholds in config; CI fails below |
| Both policy postures tested: default-permissive and enforcement-on | required fixture matrix in integration suites (reviewed; policy tests named `policy.*.integration.test.ts`) |

## Fixtures

- `packages/db/src/seed.ts` seeds the canonical dataset: the board, 7 lanes, the permissive
  default policy + workflow graph, demo users of each role, a location tree, and a spread of
  cards (each lane, blocked, waiting-with-overdue-resume, cancelled, archived) — used by dev
  boot, integration tests, and Playwright alike, so every layer exercises the same shapes.
- Recorded Slack/Anthropic JSON fixtures live in `packages/server/test/fixtures/` and are
  checked in; they are real captured payload shapes, trimmed and anonymized.
- E2E never seeds through the UI; it calls the seed module directly, then interacts only
  through the browser.

## What integration tests must cover (definition of done per feature)

1. The happy path through the real route/tool/listener.
2. Every policy denial the feature can produce (403) and, for moves, illegal-transition (422)
   with enforcement on.
3. Optimistic-lock conflict (409) where applicable.
4. Validation rejection (400) with a malformed body.
5. The audit events written — type, actor kind, payload.
6. For anything ordered: the resulting `position` ordering, including a same-gap concurrent
   move (two rapid moves targeting the same neighbors).

## E2E suite (Playwright) — the macro proof

Real drag-and-drop across lanes and within a lane; keyboard "Move to…" flow; card panel
open/edit/collapse; threaded comment + reply; attachment upload and download; two-context 409
conflict toast; audit history rendering; login/logout; admin policy toggle changing drag
affordances live. Chromium in CI; the suite runs against the production Docker image build.

## CI pipeline

GitHub Actions, gates in order:

1. `npm ci` → typecheck → lint (`--max-warnings 0`) → prettier check → dependency-cruiser →
   knip → commitlint
2. Unit tests + coverage gate
3. Integration tests + coverage gate (includes MCP e2e and Slack contract tests)
4. **Build the production Linux Docker image and run the full integration suite inside it**
   (catches native-module drift: better-sqlite3/argon2 prebuilds differ between Windows dev
   and Linux prod)
5. Playwright e2e against the image
6. Security: `npm audit --omit=dev --audit-level=high`, OSV-Scanner, gitleaks
7. (scheduled) Litestream snapshot **restore drill**: restore latest backup, run migrations,
   boot read-only

All actions SHA-pinned. A red step blocks merge; there are no manual overrides.
