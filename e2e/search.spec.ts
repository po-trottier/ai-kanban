import { randomUUID } from 'node:crypto'
import { cancelCard, createCard } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import {
  boardCard,
  filterBoard,
  laneList,
  openBoard,
  openCardMenu,
  setBoardScope,
  signIn,
} from './support/ui.ts'

/**
 * The board FILTER BAR is the one filtering surface (the /search page + modal
 * are gone). Filtering is API-level: the text query and the archived-scope
 * segmented control drive `POST /board/query`, narrowing the board in place.
 */

test('narrows the board to a seeded card by a text-query substring', async ({ page, context }) => {
  await signIn(context)
  await openBoard(page)

  // The unfiltered board shows both seeded cards.
  await expect(boardCard(page, 'Repair loading-dock leveler')).toBeVisible()
  await expect(boardCard(page, 'Quarterly HVAC filter replacement')).toBeVisible()

  // Typing a query narrows the board (server-filtered) to the match.
  await filterBoard(page, 'loading-dock')

  await expect(boardCard(page, 'Repair loading-dock leveler')).toBeVisible()
  await expect(boardCard(page, 'Quarterly HVAC filter replacement')).toBeHidden()
  // Lanes stay visible even when they no longer hold a match.
  await expect(laneList(page, 'Review')).toBeVisible()
})

// Read-only on the seeded archived card: nothing can re-archive a card (only
// the retention scheduler and the seed do), so reopening it here would leak
// state into the next run against a reused server. The reopen behavior itself
// is proven below on a terminal card this test owns.
test('reaches the archived demo card only via the archived scope, read-only until reopened', async ({
  page,
  context,
}) => {
  await signIn(context)
  await openBoard(page)

  // Active scope is the default, so archived cards are NOT on the board…
  await filterBoard(page, 'fire extinguisher')
  await expect(boardCard(page, 'Annual fire extinguisher inspection')).toBeHidden()

  // …switching the scope to Archived brings it into the board.
  await setBoardScope(page, 'Archived')
  const archived = boardCard(page, 'Annual fire extinguisher inspection')
  await expect(archived).toBeVisible()

  await archived.click()
  const panel = page.getByRole('dialog', { name: /Annual fire extinguisher inspection/ })
  await expect(panel).toContainText('This work order is archived — reopen it to make changes.')
  await expect(panel.getByText('Archived', { exact: true })).toBeVisible()
  // Archived cards are read-only except the reopen affordance.
  await expect(panel.getByLabel('Title')).toBeDisabled()
  await expect(panel.getByRole('button', { name: 'Reopen' })).toBeEnabled()
})

test('archives a Done card from the menu: it leaves the active board but the archived scope finds it', async ({
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
  await expect(page.getByText('Work order archived')).toBeVisible()

  // It has left the (active) board — the default scope excludes archived cards.
  await expect(page.getByRole('group', { name: title, exact: true })).toBeHidden()

  // Filtering to the Archived scope brings it back on the board.
  await filterBoard(page, title)
  await setBoardScope(page, 'Archived')
  await expect(boardCard(page, title)).toBeVisible()

  // …and switching back to Active hides it again (it is archived).
  await setBoardScope(page, 'Active')
  await expect(boardCard(page, title)).toBeHidden()
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

test('saves the current filter as a preset, then reapplies it (per-user CRUD)', async ({
  page,
  context,
}) => {
  await signIn(context)
  await openBoard(page)

  // Filter down to the loading-dock card, then save it as a named preset via the
  // presets dropdown's "Save preset" entry (no separate Save icon button).
  await filterBoard(page, 'loading-dock')
  await expect(boardCard(page, 'Repair loading-dock leveler')).toBeVisible()
  const name = `Dock ${randomUUID()}`
  await page.getByRole('combobox', { name: 'Preset' }).click()
  await page.getByRole('option', { name: 'Save preset' }).click()
  await page.getByRole('textbox', { name: 'Preset name' }).fill(name)
  await page.getByRole('button', { name: 'Save preset', exact: true }).click()
  await expect(page.getByText('Preset saved')).toBeVisible()

  // Resetting the filter restores the full board…
  await page.getByRole('button', { name: 'Reset filters' }).click()
  await expect(boardCard(page, 'Quarterly HVAC filter replacement')).toBeVisible()

  // …and reapplying the saved preset sets the complete filter again.
  await page.getByRole('combobox', { name: 'Preset' }).click()
  await page.getByRole('option', { name }).click()
  await expect(boardCard(page, 'Repair loading-dock leveler')).toBeVisible()
  await expect(boardCard(page, 'Quarterly HVAC filter replacement')).toBeHidden()

  // Clean up the preset so the shared demo user's list doesn't accrete rows.
  await page.getByRole('button', { name: 'Delete this preset' }).click()
  await expect(page.getByText('Preset deleted')).toBeVisible()
})
