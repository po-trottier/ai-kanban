import {
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test'
import { demoEmail, type DemoRole } from './constants.ts'
import { apiLogin } from './api.ts'
import { testClientIp } from './fixtures.ts'

/** Selector + interaction helpers shared by the specs (role/label-first). */

/** Authenticates the whole browser context (cookie jar shared with pages). */
export async function signIn(context: BrowserContext, role: DemoRole = 'admin'): Promise<void> {
  await apiLogin(context.request, demoEmail(role))
}

/**
 * A second real session in the same test: fresh context with its own client
 * IP (the per-test fixture only covers the default context — without the
 * header these logins would all bucket under 127.0.0.1 and eat the shared
 * 5/min login budget), signed in as `role`.
 */
export async function newRoleContext(browser: Browser, role: DemoRole): Promise<BrowserContext> {
  const context = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': testClientIp() },
  })
  await signIn(context, role)
  return context
}

export async function openBoard(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Kanban board' })).toBeVisible()
}

export function laneList(page: Page, laneLabel: string): Locator {
  return page.getByRole('list', { name: `Cards in ${laneLabel}` })
}

/** Types into the board filter bar's text query (title/description substring). */
export async function filterBoard(page: Page, text: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Filter cards' }).fill(text)
}

/**
 * Sets the filter bar's archived-scope segmented control (Active/Archived/All).
 * Mantine's SegmentedControl renders a VISUALLY-HIDDEN radio `<input>` behind a
 * clickable `<label>`, so click the label (the radio itself is unclickable and
 * times out). The label is aria-hidden, hence text (not role) selection.
 */
export async function setBoardScope(
  page: Page,
  scope: 'Active' | 'Archived' | 'All',
): Promise<void> {
  const control = page.getByRole('radiogroup', { name: 'Active, archived, or all cards' })
  await control.getByText(scope, { exact: true }).click()
}

export function boardCard(page: Page, title: string): Locator {
  // exact — role-name matching is substring by default, and specs assert
  // absence of a title that may prefix another (e.g. after a rename).
  return page.getByRole('group', { name: title, exact: true })
}

/** Opens the card's ⋯ menu and picks an entry. */
export async function openCardMenu(page: Page, title: string, item: string): Promise<void> {
  await boardCard(page, title).getByRole('button', { name: 'Card actions' }).click()
  await page.getByRole('menuitem', { name: item }).click()
}

/**
 * A Mantine Select input by its label. (`getByLabel` alone is ambiguous: the
 * options listbox is aria-labelled by the same label as the input.)
 */
export function select(page: Page, label: string): Locator {
  return page.getByRole('combobox', { name: label })
}

/** Mantine Select: open by its label, pick an option from the dropdown. */
export async function selectOption(page: Page, label: string, option: string): Promise<void> {
  await select(page, label).click()
  await page.getByRole('option', { name: option }).click()
}

/**
 * Real mouse drag for Pragmatic drag-and-drop (native HTML5 drag events):
 * `page.dragAndDrop()` releases before the library's dragover-driven hitboxes
 * settle, so the pointer walks over in small steps and lingers on the target.
 */
export async function dragTo(
  page: Page,
  source: Locator,
  target: Locator,
  options: { edge?: 'top' | 'bottom' } = {},
): Promise<void> {
  const from = await source.boundingBox()
  const to = await target.boundingBox()
  if (from === null || to === null) throw new Error('drag source or target is not visible')

  const startX = from.x + from.width / 2
  const startY = from.y + from.height / 2
  const endX = to.x + to.width / 2
  let endY = to.y + to.height / 2
  if (options.edge === 'top') endY = to.y + 4
  if (options.edge === 'bottom') endY = to.y + to.height - 4

  await page.mouse.move(startX, startY)
  await page.mouse.down()
  // A first small move starts the native drag before heading for the target.
  await page.mouse.move(startX + 6, startY + 6, { steps: 2 })
  await page.mouse.move(endX, endY, { steps: 12 })
  // Extra dragover ticks over the target let closest-edge settle.
  await page.mouse.move(endX, endY + 1, { steps: 2 })
  await page.mouse.move(endX, endY, { steps: 2 })
  await page.mouse.up()
}

/** The order our own titles appear in within a lane (ignores other cards). */
export async function relativeOrder(list: Locator, titles: string[]): Promise<string[]> {
  const labels: string[] = []
  for (const card of await list.getByRole('group').all()) {
    const label = await card.getAttribute('aria-label')
    if (label !== null && titles.includes(label)) labels.push(label)
  }
  return labels
}
