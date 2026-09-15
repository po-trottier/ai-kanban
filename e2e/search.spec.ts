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

test('keeps filters on one scrollable row from mobile to wide desktop', async ({
  page,
  context,
}) => {
  await signIn(context)
  await openBoard(page)
  const bar = page.getByRole('region', { name: 'Board filters' })
  const query = bar.getByRole('textbox', { name: 'Filter work orders' })
  const priority = bar.getByRole('combobox', { name: 'Priority', exact: true })
  const reset = bar.getByRole('button', { name: 'Reset filters' })

  for (const width of [1902, 1280, 768, 390, 320, 2560]) {
    await page.setViewportSize({ width, height: 900 })
    const controls = bar.getByRole('combobox').or(query).or(reset).or(bar.getByRole('radiogroup'))
    await expect(async () => {
      const centers = await Promise.all(
        (await controls.all()).map(async (control) => {
          const box = await control.boundingBox()
          return (box?.y ?? Number.NaN) + (box?.height ?? Number.NaN) / 2
        }),
      )
      expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(2)
      const box = await bar.boundingBox()
      expect((box?.x ?? Number.NaN) + (box?.width ?? Number.NaN)).toBeLessThanOrEqual(width)
    }).toPass({ timeout: 3000 })
    const scrollbar = bar.locator('.mantine-ScrollArea-scrollbar[data-orientation="horizontal"]')
    await expect(scrollbar).toBeVisible({ visible: width !== 2560 })
  }

  await page.setViewportSize({ width: 390, height: 900 })
  const queryStart = (await query.boundingBox())?.x ?? Number.NaN
  const thumb = bar.locator('.mantine-ScrollArea-thumb')
  await expect(thumb).toBeVisible()
  await bar.screenshot({ path: 'e2e/screenshots/filters-scrollbar-mobile.png' })
  const thumbBox = await thumb.boundingBox()
  expect(thumbBox).not.toBeNull()
  const thumbX = (thumbBox?.x ?? Number.NaN) + (thumbBox?.width ?? Number.NaN) / 2
  const thumbY = (thumbBox?.y ?? Number.NaN) + (thumbBox?.height ?? Number.NaN) / 2
  await page.mouse.move(thumbX, thumbY)
  await page.mouse.down()
  await page.mouse.move(thumbX + 100, thumbY, { steps: 5 })
  await page.mouse.up()
  await expect(async () => {
    expect((await query.boundingBox())?.x ?? Number.NaN).toBeLessThan(queryStart)
  }).toPass({ timeout: 3000 })
  await query.focus()
  await page.keyboard.press('Tab')
  await expect(priority).toBeFocused()
  await expect(priority).toBeInViewport({ ratio: 1 })
  await priority.click()
  await page.getByRole('option', { name: /P1 —/ }).click()
  await page.keyboard.press('Escape')
  await expect(bar.getByText('P1', { exact: true })).toBeVisible()
  await bar.getByRole('combobox', { name: 'Preset' }).focus()
  await page.keyboard.press('Tab')
  await expect(reset).toBeFocused()
  await expect(reset).toBeInViewport({ ratio: 1 })
  const resetBox = await reset.boundingBox()
  const scrollBox = await bar.locator('.mantine-ScrollArea-viewport').boundingBox()
  // Mantine's 2px outline + 2px offset must fit inside the scrolling viewport.
  expect((resetBox?.y ?? Number.NaN) - (scrollBox?.y ?? Number.NaN)).toBeGreaterThanOrEqual(4)
  expect(
    (scrollBox?.y ?? Number.NaN) +
      (scrollBox?.height ?? Number.NaN) -
      ((resetBox?.y ?? Number.NaN) + (resetBox?.height ?? Number.NaN)),
  ).toBeGreaterThanOrEqual(4)
  await page.keyboard.press('Enter')
  await expect(bar.getByText('P1', { exact: true })).toBeHidden()

  const scope = bar.getByRole('radiogroup', { name: 'Active, archived, or all work orders' })
  await scope.getByRole('radio', { name: 'Active', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(scope.getByRole('radio', { name: 'Archived', exact: true })).toBeChecked()
  await expect(scope.getByText('Archived', { exact: true })).toBeInViewport({ ratio: 1 })
  const overdue = bar.getByRole('radiogroup', { name: 'Overdue', exact: true })
  await overdue.getByRole('radio', { name: 'Any', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(overdue.getByRole('radio', { name: 'Overdue', exact: true })).toBeChecked()
  await expect(overdue.getByText('Overdue', { exact: true })).toBeInViewport({ ratio: 1 })
})

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

test('reopens a cancelled card back to the lane it came from', async ({ page, context }) => {
  await signIn(context)
  const title = `Reopen ${randomUUID()}`
  const card = await createCard(context.request, title) // lands in Intake
  await cancelCard(context.request, card, 'duplicate')

  await openBoard(page)
  const doneCard = laneList(page, 'Done').getByRole('group', { name: title })
  await expect(doneCard).toBeVisible()
  await expect(doneCard.getByText('Duplicate')).toBeVisible()

  await openCardMenu(page, title, 'Reopen')

  // Restored to Intake (where it was cancelled from) — not a blanket Ready.
  await expect(laneList(page, 'Intake').getByRole('group', { name: title })).toBeVisible()
  await expect(laneList(page, 'Done').getByRole('group', { name: title })).toBeHidden()
  await expect(
    laneList(page, 'Intake').getByRole('group', { name: title }).getByText('Duplicate'),
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
