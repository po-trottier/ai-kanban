import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Shared between playwright.config.ts (webServer env) and the specs: one
 * source of truth for where the e2e server lives and how to log into it.
 */

/**
 * Port and data dir are derived from this checkout's absolute path so that
 * concurrent runs from different working trees (e.g. a parallel git worktree)
 * never reuse each other's mid-suite server or fight over the SQLite file.
 * Deterministic within a tree: the config is evaluated more than once per run.
 */
const treeId = createHash('sha256')
  .update(fileURLToPath(new URL('../..', import.meta.url)))
  .digest('hex')
  .slice(0, 8)

export const SERVER_PORT = 3210 + (parseInt(treeId, 16) % 100)
export const BASE_URL = `http://localhost:${String(SERVER_PORT)}`

/**
 * DB + blobs live here for the run. `scripts/prepare.mjs` resets it right
 * before the server boots; the leftover after a run is by design (on Windows
 * the server still holds the SQLite file when teardown could run).
 */
export const DATA_DIR = join(tmpdir(), `rivian-kanban-e2e-${treeId}`)

/** SEED_DEMO_PASSWORD handed to the server — deterministic demo logins. */
export const DEMO_PASSWORD = 'rivian-e2e-demo-pass'

export type DemoRole = 'requester' | 'technician' | 'supervisor' | 'admin'

/** Demo account emails match packages/db `demoUserEmail`. */
export function demoEmail(role: DemoRole): string {
  return `${role}@demo.rivian-kanban.local`
}
