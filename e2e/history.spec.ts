import { randomUUID } from 'node:crypto'
import { createCard, patchCard } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { laneList, openBoard, openCardMenu, selectOption, signIn } from './support/ui.ts'

/** The audit trail (ADR-005): oldest-first rendering and Load more paging. */

test('renders history oldest-first after a move and an edit', async ({ page, context }) => {
  await signIn(context)
  const title = `History ${randomUUID()}`
  const card = await createCard(context.request, title)

  // Move through the real UI…
  await openBoard(page)
  await openCardMenu(page, title, 'Move to…')
  await selectOption(page, 'Column', 'Ready')
  await page.getByRole('button', { name: 'Move', exact: true }).click()
  await expect(laneList(page, 'Ready').getByRole('group', { name: title })).toBeVisible()
  // Navigating would abort an in-flight move POST (the optimistic UI already
  // shows the card in Ready) — the live-region announcement only fires from
  // the mutation's onSuccess, so it proves the POST landed before the goto.
  await expect(page.getByRole('status')).toContainText(`Card "${title}" moved to Ready`)

  // …then edit a field through the panel.
  await page.goto(`/cards/${card.id}`)
  await selectOption(page, 'Priority', 'P1')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Card updated')).toBeVisible()

  await page.getByRole('tab', { name: 'History' }).click()
  const items = page.getByRole('list', { name: 'History' }).getByRole('listitem')
  await expect(items).toHaveCount(3)
  await expect(items.nth(0)).toContainText('Demo Admin created the card')
  await expect(items.nth(1)).toContainText('moved the card from Intake to Ready')
  await expect(items.nth(2)).toContainText('changed priority')
})

test('pages older events behind Load more', async ({ page, context }) => {
  await signIn(context)
  const title = `History paging ${randomUUID()}`
  let card = await createCard(context.request, title)
  // 51 field edits + the creation event = 52 events; the page size is 50.
  for (let i = 0; i < 51; i += 1) {
    card = await patchCard(context.request, card, { title: `${title} rev${String(i)}` })
  }

  await page.goto(`/cards/${card.id}`)
  await page.getByRole('tab', { name: 'History' }).click()

  const items = page.getByRole('list', { name: 'History' }).getByRole('listitem')
  await expect(items).toHaveCount(50)
  await page.getByRole('button', { name: 'Load more' }).click()
  await expect(items).toHaveCount(52)
  await expect(page.getByRole('button', { name: 'Load more' })).toBeHidden()
  await expect(items.nth(0)).toContainText('created the card')
  await expect(items.nth(51)).toContainText('changed title')
})
