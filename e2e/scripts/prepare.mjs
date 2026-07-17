import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Runs as the first half of the playwright webServer command (the webServer
 * plugin boots BEFORE globalSetup, so per-run state must be prepared here):
 * 1. resets the run's data dir (fresh SQLite + blobs every run), and
 * 2. builds the SPA once if packages/web/dist is missing — the server serves
 *    the built bundle itself, so this is the whole frontend deployment.
 */

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

const dataDir = process.env.E2E_DATA_DIR
if (dataDir === undefined || dataDir === '') {
  throw new Error('E2E_DATA_DIR is not set (see e2e/playwright.config.ts webServer env)')
}
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })

const distIndex = fileURLToPath(new URL('../../packages/web/dist/index.html', import.meta.url))
if (!existsSync(distIndex)) {
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit', shell: true })
}
