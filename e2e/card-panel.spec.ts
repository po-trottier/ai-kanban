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
  await expect(panel).toContainText('Card details')
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

test('edits title and priority through the If-Match happy path', async ({ page, context }) => {
  await signIn(context)
  const title = `Panel edit ${randomUUID()}`
  const card = await createCard(context.request, title)
  await page.goto(`/cards/${card.id}`)

  const newTitle = `${title} rev2`
  await page.getByLabel('Title').fill(newTitle)
  await selectOption(page, 'Priority', 'P0')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Card updated')).toBeVisible()

  await page.keyboard.press('Escape')
  const updated = boardCard(page, newTitle)
  await expect(updated).toBeVisible()
  await expect(updated.getByText('P0', { exact: true })).toBeVisible()

  await page.reload()
  await expect(boardCard(page, newTitle).getByText('P0', { exact: true })).toBeVisible()
})

test('previews the markdown description', async ({ page, context }) => {
  await signIn(context)
  const title = `Markdown ${randomUUID()}`
  const card = await createCard(context.request, title)
  await page.goto(`/cards/${card.id}`)

  await page.getByLabel('Description').fill('A **bold** claim')
  await page.getByText('Preview', { exact: true }).click()

  const panel = page.getByRole('dialog')
  await expect(panel.locator('strong')).toHaveText('bold')
  await expect(panel.getByText('A bold claim')).toBeVisible()
})
