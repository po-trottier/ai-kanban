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
const PASSWORD = 'rivian-visual-qa-pass'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'screenshots')
const dataDir = mkdtempSync(join(tmpdir(), 'rivian-shots-'))

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const server = spawn(process.execPath, ['--import', 'tsx', 'packages/server/src/main.ts'], {
  cwd: join(dirname(fileURLToPath(import.meta.url)), '..', '..'),
  env: {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(PORT),
    METRICS_PORT: '9484',
    DATABASE_PATH: join(dataDir, 'app.sqlite'),
    BLOB_DIR: join(dataDir, 'blobs'),
    SNAPSHOT_DIR: join(dataDir, 'snapshots'),
    SEED_DEMO_DATA: 'true',
    SEED_DEMO_PASSWORD: PASSWORD,
    SLACK_ENABLED: 'false',
    SUMMARIZER_ENABLED: 'false',
    LOG_LEVEL: 'error',
  },
  stdio: 'inherit',
})

async function waitReady() {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${BASE}/readyz`)
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
  await page.keyboard.press('Escape')

  await page.getByRole('link', { name: 'Search cards' }).click()
  await page.getByRole('textbox', { name: 'Search' }).fill('door')
  // Submit so the shot shows actual filtered results, not the idle page.
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await shot(page, '09-search')
  await page.getByRole('checkbox', { name: 'Include archived' }).check()
  await shot(page, '10-search-archived')

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

  await browser.close()
  console.log(`done - screenshots in ${OUT}`)
} finally {
  server.kill()
  // Windows holds the SQLite file until the server exits; best-effort cleanup.
  await new Promise((resolve) => {
    server.once('exit', resolve)
    setTimeout(resolve, 5000)
  })
  try {
    rmSync(dataDir, { recursive: true, force: true })
  } catch {
    console.warn(`temp data dir left behind: ${dataDir}`)
  }
}
