// Visual-QA capture tool: boots the seeded app and screenshots every page/state
// into e2e/screenshots/ (gitignored). Usage, from the repo root:
//   npm run build -w @rivian-kanban/web && node e2e/scripts/screenshots.mjs
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const PORT = 3333
const BASE = `http://localhost:${PORT}`
// A second, unseeded instance so we can capture the first-boot setup wizard
// (which redirects away once any user exists).
const SETUP_PORT = 3334
const SETUP_BASE = `http://localhost:${SETUP_PORT}`
const PASSWORD = 'rivian-visual-qa-pass'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'screenshots')
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const dataDir = mkdtempSync(join(tmpdir(), 'rivian-shots-'))
const setupDataDir = mkdtempSync(join(tmpdir(), 'rivian-shots-setup-'))

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

/** Spawns a server on `port` with its own data dir; demo seed is optional. */
function startServer(port, metricsPort, dir, seedDemo) {
  return spawn(process.execPath, ['--import', 'tsx', 'packages/server/src/main.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      METRICS_PORT: String(metricsPort),
      DATABASE_PATH: join(dir, 'app.sqlite'),
      BLOB_DIR: join(dir, 'blobs'),
      SNAPSHOT_DIR: join(dir, 'snapshots'),
      SEED_DEMO_DATA: seedDemo ? 'true' : 'false',
      SEED_DEMO_PASSWORD: PASSWORD,
      SLACK_ENABLED: 'false',
      SUMMARIZER_ENABLED: 'false',
      LOG_LEVEL: 'error',
    },
    stdio: 'inherit',
  })
}

const server = startServer(PORT, 9484, dataDir, true)
// Unseeded: no users → the first-boot setup wizard is reachable.
const setupServer = startServer(SETUP_PORT, 9485, setupDataDir, false)

async function waitReady(base = BASE) {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${base}/readyz`)
      if (res.ok) return
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('server never became ready')
}

/** @param {import('@playwright/test').Page} page */
async function login(page, email) {
  await page.goto(`${BASE}/login`)
  await page.getByLabel('Email').fill(email)
  await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByText('Intake').first().waitFor()
}

async function shot(page, name) {
  // networkidle never fires with the SSE stream held open — settle briefly instead.
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(OUT, `${name}.png`) })
  console.log(`captured ${name}`)
}

const CARD_FOR_DETAILS = 'Flickering lights in stairwell B'
// The demo seed threads its comments (parent + reply) onto this in-progress
// card (packages/db/src/seed.ts), so the comments capture uses it.
const CARD_WITH_THREAD = 'Repair loading-dock leveler'

try {
  await waitReady()
  const browser = await chromium.launch()

  // --- Desktop (1440x900) ---
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await desktop.newPage()

  await page.goto(`${BASE}/login`)
  await shot(page, '01-login')

  await login(page, 'admin@demo.rivian-kanban.local')
  await shot(page, '02-board')

  // ITEM A: the finalized header — logo + wordmark left, centered live-search,
  // and the right cluster (New card, badge-legend help icon, settings gear,
  // avatar). Cropped to the header band for the reviewer.
  await page.screenshot({
    path: join(OUT, '02a-header.png'),
    clip: { x: 0, y: 0, width: 1440, height: 56 },
  })
  console.log('captured 02a-header')

  // The filter bar (below the header) narrows the board via the text query.
  await page.getByRole('textbox', { name: 'Filter cards' }).fill('HVAC')
  await page.getByText('Quarterly HVAC filter replacement').first().waitFor()
  await shot(page, '02b-board-filtered')
  await page.getByRole('button', { name: 'Reset filters' }).click()

  await page.getByText(CARD_FOR_DETAILS).first().click()
  await page.waitForURL(/\/cards\//)
  await shot(page, '03-card-details')
  await page.keyboard.press('Escape')

  // The comments/history captures use the card that actually has a thread.
  await page.getByText(CARD_WITH_THREAD).first().click()
  await page.waitForURL(/\/cards\//)
  await page.getByRole('tab', { name: 'Comments' }).click()
  await shot(page, '04-card-comments')

  await page.getByRole('tab', { name: 'History' }).click()
  await shot(page, '05-card-history')
  await page.keyboard.press('Escape')

  const firstCard = page.getByRole('group', { name: CARD_FOR_DETAILS, exact: true })
  await firstCard.hover()
  await firstCard.getByRole('button', { name: 'Card actions' }).click()
  await shot(page, '06-card-menu')
  await page.getByRole('menuitem', { name: 'Move to…' }).click()
  await shot(page, '07-move-modal')
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'New card' }).click()
  await shot(page, '08-new-card-modal')
  // ITEM 3: the priority dropdown open, showing the plain-language descriptions.
  await page.getByRole('combobox', { name: 'Priority' }).click()
  await page.getByRole('option', { name: /P0 — Critical/ }).waitFor()
  await shot(page, '08b-priority-dropdown')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  // ITEM B: the badge-legend help icon in the header opens a centered modal.
  await page.getByRole('button', { name: 'What do the badges mean?' }).click()
  await page.getByRole('dialog').getByText('Badge guide').waitFor()
  await shot(page, '08c-badge-legend-modal')
  await page.keyboard.press('Escape')

  // The filter bar is the one filtering surface: a text query narrows the board
  // in place (API-level, POST /board/query). No separate search page or modal.
  await page.getByRole('textbox', { name: 'Filter cards' }).fill('door')
  await shot(page, '09-filter-query')
  // Switching the archived scope reaches archived cards on the board.
  await page.getByRole('textbox', { name: 'Filter cards' }).fill('fire extinguisher')
  await page.getByRole('radio', { name: 'Archived', exact: true }).click()
  await page.getByText('Annual fire extinguisher inspection').waitFor()
  await shot(page, '10-filter-archived')
  await page.getByRole('button', { name: 'Reset filters' }).click()

  await page.goto(`${BASE}/settings`)
  await page.getByRole('tab', { name: 'Users' }).click()
  await shot(page, '11-settings-users')
  await page.getByRole('tab', { name: 'Columns' }).click()
  await shot(page, '12-settings-lanes')
  await page.getByRole('tab', { name: 'Permissions' }).click()
  await shot(page, '13-settings-policy')
  await page.getByRole('tab', { name: 'Locations' }).click()
  await shot(page, '14-settings-locations')
  await page.getByRole('tab', { name: 'Service tokens' }).click()
  await shot(page, '15-settings-tokens')

  await page.goto(`${BASE}/`)
  await page.getByText('Intake').first().waitFor()
  await page.getByText(CARD_WITH_THREAD).first().click()
  await page.getByRole('tab', { name: 'Comments' }).click()
  await page.getByRole('textbox', { name: 'Add a comment' }).fill('Visual QA pass')
  await page.getByRole('button', { name: 'Comment' }).first().click()
  await page.getByText('Visual QA pass').first().waitFor()
  await shot(page, '16-toast')
  await desktop.close()

  // --- Tablet (820x1180) ---
  const tablet = await browser.newContext({ viewport: { width: 820, height: 1180 } })
  const tpage = await tablet.newPage()
  await login(tpage, 'admin@demo.rivian-kanban.local')
  await shot(tpage, '17-tablet-board')
  await tpage.getByText(CARD_WITH_THREAD).first().click()
  await tpage.waitForURL(/\/cards\//)
  await shot(tpage, '18-tablet-card-panel')
  await tablet.close()

  // --- First-boot setup wizard, step 2 (Add your locations) ---
  // Captured on the unseeded instance so the wizard is reachable (it redirects
  // away once any user exists). Create the admin (step 1), then add a
  // building/floor/room so the redesigned tree renders in the shot.
  await waitReady(SETUP_BASE)
  const setup = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const setupPage = await setup.newPage()
  await setupPage.goto(`${SETUP_BASE}/setup`)
  await setupPage.getByRole('textbox', { name: 'Email' }).fill('admin@visual-qa.example')
  await setupPage.getByRole('textbox', { name: 'Display name' }).fill('Visual QA Admin')
  await setupPage.getByRole('textbox', { name: 'Password' }).fill(PASSWORD)
  await setupPage.getByRole('button', { name: 'Create admin account' }).click()
  await setupPage.getByRole('heading', { name: 'Add your locations' }).waitFor()
  const addLocation = async (inputLabel, buttonLabel, value) => {
    await setupPage.getByRole('textbox', { name: inputLabel }).fill(value)
    await setupPage.getByRole('button', { name: buttonLabel }).click()
    await setupPage.getByText(value).first().waitFor()
  }
  await addLocation('Add building', 'Add building', 'Main Plant')
  await addLocation('Add floor', 'Add floor', 'Ground Floor')
  await addLocation('Add room', 'Add room', 'Machine Shop')
  // ITEM C: full-width name inputs + the per-row rename (Pencil) affordance.
  await shot(setupPage, '19-setup-locations')

  // ITEM C: a duplicate SIBLING name is rejected with a friendly inline error.
  // "Ground Floor" already sits under "Main Plant", so re-adding it collides.
  await setupPage.getByRole('textbox', { name: 'Add floor' }).fill('Ground Floor')
  await setupPage.getByRole('button', { name: 'Add floor' }).click()
  await setupPage
    .getByText('Another location here already has this name. Pick a different name.')
    .first()
    .waitFor()
  await shot(setupPage, '19b-setup-locations-duplicate')
  await setup.close()

  await browser.close()
  console.log(`done - screenshots in ${OUT}`)
} finally {
  server.kill()
  setupServer.kill()
  // Windows holds the SQLite file until the server exits; best-effort cleanup.
  await Promise.all(
    [server, setupServer].map(
      (child) =>
        new Promise((resolve) => {
          child.once('exit', resolve)
          setTimeout(resolve, 5000)
        }),
    ),
  )
  for (const dir of [dataDir, setupDataDir]) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      console.warn(`temp data dir left behind: ${dir}`)
    }
  }
}
