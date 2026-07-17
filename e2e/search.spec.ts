import { type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { cancelCard, createCard } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { laneList, openBoard, openCardMenu, signIn } from './support/ui.ts'

/** Advanced-search modal: live search, the archived-scope filter, and the
 * reopen path (guide.md). The legacy `/search` route redirects into the modal. */

async function search(page: Page, query: string): Promise<void> {
  // The modal searches live (debounced) — no submit button to press.
  await page.getByLabel('Search cards').fill(query)
}

/** Switch the archived-scope facet (a 3-way combobox, default "Active and archived"). */
async function setArchivedScope(
  page: Page,
  option: 'Active and archived' | 'Active cards only' | 'Archived only',
) {
  await page.getByRole('combobox', { name: 'Archived cards' }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

test('finds a seeded card by substring', async ({ page, context }) => {
  await signIn(context)
  await page.goto('/search')

  await search(page, 'loading-dock')

  await expect(
    page.getByRole('list', { name: 'Search results' }).getByText('Repair loading-dock leveler'),
  ).toBeVisible()
})

// Read-only on the seeded archived card: nothing can re-archive a card (only
// the retention scheduler and the seed do), so reopening it here would leak
// state into the next run against a reused server. The reopen behavior itself
// is proven below on a terminal card this test owns.
test('surfaces the archived demo card (in scope by default), read-only until reopened', async ({
  page,
  context,
}) => {
  await signIn(context)
  await page.goto('/search')

  // Archived cards are in scope by default, so the card surfaces immediately.
  await search(page, 'fire extinguisher')
  const result = page
    .getByRole('list', { name: 'Search results' })
    .getByText('Annual fire extinguisher inspection')
  await expect(result).toBeVisible()

  // Narrowing to active-only proves the archived-scope facet filters it out.
  await setArchivedScope(page, 'Active cards only')
  await expect(page.getByText('No cards match your search.')).toBeVisible()
  // "Archived only" brings it back (it is archived).
  await setArchivedScope(page, 'Archived only')
  await expect(result).toBeVisible()

  await result.click()
  // The result navigates to the card, opening the docked detail panel. The
  // search modal is also a dialog and briefly overlaps during its close
  // transition, so target the panel by its accessible name (the card title).
  const panel = page.getByRole('dialog', { name: /Annual fire extinguisher inspection/ })
  await expect(panel).toContainText('This card is archived — reopen it to make changes.')
  await expect(panel.getByText('Archived', { exact: true })).toBeVisible()
  // Archived cards are read-only except the reopen affordance.
  await expect(panel.getByLabel('Title')).toBeDisabled()
  await expect(panel.getByRole('button', { name: 'Reopen' })).toBeEnabled()
})

test('archives a Done card from the menu: it leaves the board and stays findable in search', async ({
  page,
  context,
}) => {
  await signIn(context)
  const title = `Archive ${randomUUID()}`
  const card = await createCard(context.request, title)
  await cancelCard(context.request, card, 'duplicate')

  await openBoard(page)
  await expect(laneList(page, 'Done').getByRole('group', { name: title })).toBeVisible()

  // Archive from the ⋯ menu; a confirmation toast names the outcome.
  await openCardMenu(page, title, 'Archive')
  await expect(page.getByText('Card archived')).toBeVisible()

  // It has left the board entirely (the board query excludes archived cards).
  await expect(page.getByRole('group', { name: title, exact: true })).toBeHidden()

  // But advanced search includes archived by default, so it is still findable.
  await page.goto('/search')
  await search(page, title)
  await expect(page.getByRole('list', { name: 'Search results' }).getByText(title)).toBeVisible()

  // And narrowing to active-only hides it (it is archived).
  await setArchivedScope(page, 'Active cards only')
  await expect(page.getByRole('list', { name: 'Search results' }).getByText(title)).toBeHidden()
})

test('reopens a terminal card into Ready', async ({ page, context }) => {
  await signIn(context)
  const title = `Reopen ${randomUUID()}`
  const card = await createCard(context.request, title)
  await cancelCard(context.request, card, 'duplicate')

  await openBoard(page)
  const doneCard = laneList(page, 'Done').getByRole('group', { name: title })
  await expect(doneCard).toBeVisible()
  await expect(doneCard.getByText('Duplicate')).toBeVisible()

  await openCardMenu(page, title, 'Reopen')

  await expect(laneList(page, 'Ready').getByRole('group', { name: title })).toBeVisible()
  await expect(laneList(page, 'Done').getByRole('group', { name: title })).toBeHidden()
  await expect(
    laneList(page, 'Ready').getByRole('group', { name: title }).getByText('Duplicate'),
  ).toBeHidden()
})
