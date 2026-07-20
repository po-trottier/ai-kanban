import { randomUUID } from 'node:crypto'
import { createCard } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { boardCard, openBoard, selectOption, signIn } from './support/ui.ts'

/** The card detail panel: open, deep link, edit (If-Match), collapse, preview. */

test('opens the panel by clicking a card and collapses it back to the board', async ({
  page,
  context,
}) => {
  await signIn(context)
  const title = `Panel open ${randomUUID()}`
  const card = await createCard(context.request, title)
  await openBoard(page)

  await boardCard(page, title).click()
  await expect(page).toHaveURL(new RegExp(`/cards/${card.id}$`))
  const panel = page.getByRole('dialog')
  await expect(panel).toContainText('Work order details')
  await expect(panel.getByLabel('Title')).toHaveValue(title)

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page).toHaveURL(/\/$/)
})

test('deep-links the panel at /cards/:id', async ({ page, context }) => {
  await signIn(context)
  const title = `Deep link ${randomUUID()}`
  const card = await createCard(context.request, title)

  await page.goto(`/cards/${card.id}`)

  const panel = page.getByRole('dialog')
  await expect(panel.getByLabel('Title')).toHaveValue(title)
  await expect(page.getByRole('region', { name: 'Kanban board' })).toBeVisible()
})

test('docks the panel below the header without overlapping it', async ({ page, context }) => {
  await signIn(context)
  const title = `Docked ${randomUUID()}`
  const card = await createCard(context.request, title)
  await page.goto(`/cards/${card.id}`)

  // The header (title + New work order + avatar) stays fully usable, and structurally
  // the panel sits entirely below the header band — never over it.
  const header = page.getByRole('banner')
  const panel = page.getByRole('dialog')
  await expect(panel.getByLabel('Title')).toHaveValue(title)
  await expect(header.getByRole('button', { name: 'New work order' })).toBeVisible()
  // Fallbacks make a null box fail the numeric comparison (no conditional).
  const headerBox = (await header.boundingBox()) ?? { y: Number.NaN, height: Number.NaN }
  const panelBox = (await panel.boundingBox()) ?? { x: Number.NaN, y: Number.NaN }
  const viewport = page.viewportSize() ?? { width: Number.NaN, height: Number.NaN }
  // The panel's top edge sits at or below the header's bottom edge — docked, not over.
  expect(panelBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 1)
  // …and it docks on the RIGHT (its left edge is past the viewport midpoint), not
  // stacked full-width below the board — the regression guard.
  expect(panelBox.x).toBeGreaterThan(viewport.width / 2)
})

test('resizes the detail panel by dragging the handle, and remembers the width', async ({
  page,
  context,
}) => {
  await signIn(context)
  const title = `Resize ${randomUUID()}`
  const card = await createCard(context.request, title)
  await page.goto(`/cards/${card.id}`)

  const panel = page.getByRole('complementary')
  await expect(page.getByRole('dialog').getByLabel('Title')).toHaveValue(title)
  const handle = page.getByRole('separator', { name: /Resize the detail panel/ })
  await expect(handle).toBeVisible()
  // Fallbacks keep a null box out of the assertion path (no conditional in a test).
  const startWidth = ((await panel.boundingBox()) ?? { width: Number.NaN }).width

  // The handle is an ARIA window-splitter: focus it and widen with the arrow
  // keys (panel is on the right, so Left widens). Each press is a fixed step.
  await handle.focus()
  for (let press = 0; press < 6; press += 1) await page.keyboard.press('ArrowLeft')

  const widened = ((await panel.boundingBox()) ?? { width: Number.NaN }).width
  expect(widened).toBeGreaterThan(startWidth + 80)

  // The chosen width survives a reload (persisted to localStorage).
  await page.reload()
  await expect(page.getByRole('dialog').getByLabel('Title')).toHaveValue(title)
  const restored = (await page.getByRole('complementary').boundingBox())?.width ?? Number.NaN
  expect(Math.abs(restored - widened)).toBeLessThan(4)
})

test('explains a blocked card with a banner and unblocks it inline', async ({ page, context }) => {
  await signIn(context)
  await openBoard(page)

  // The seeded blocked card carries a reason; opening it surfaces the banner.
  await boardCard(page, 'Patch drywall in Room 101').click()
  const panel = page.getByRole('dialog')
  await expect(panel).toContainText('This work order is blocked')
  await expect(panel).toContainText('Room occupied until the audit wraps up')

  await panel.getByRole('button', { name: 'Unblock' }).click()
  await expect(page.getByText('Work order unblocked')).toBeVisible()
})

test('edits title and priority through the If-Match happy path', async ({ page, context }) => {
  await signIn(context)
  const title = `Panel edit ${randomUUID()}`
  const card = await createCard(context.request, title)
  await page.goto(`/cards/${card.id}`)

  const newTitle = `${title} rev2`
  await page.getByLabel('Title').fill(newTitle)
  await selectOption(page, 'Priority', 'P0')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Work order updated')).toBeVisible()

  await page.keyboard.press('Escape')
  const updated = boardCard(page, newTitle)
  await expect(updated).toBeVisible()
  await expect(updated.getByText('P0', { exact: true })).toBeVisible()

  await page.reload()
  await expect(boardCard(page, newTitle).getByText('P0', { exact: true })).toBeVisible()
})

test('formats the description in the rich-text editor and round-trips it as markdown', async ({
  page,
  context,
}) => {
  await signIn(context)
  const title = `Markdown ${randomUUID()}`
  const card = await createCard(context.request, title)
  await page.goto(`/cards/${card.id}`)

  // Bold text via the toolbar, WYSIWYG.
  const editor = page.getByRole('textbox', { name: 'Description' })
  await editor.click()
  await page.getByRole('button', { name: 'Bold', exact: true }).click()
  await page.keyboard.type('Important')
  await expect(editor.locator('strong')).toHaveText('Important')

  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Work order updated')).toBeVisible()

  // Reload: the bold survives, having round-tripped through stored markdown.
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Description' }).locator('strong')).toHaveText(
    'Important',
  )
})
