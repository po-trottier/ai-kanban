import { randomUUID } from 'node:crypto'
import { createCard } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { boardCard, laneList, openBoard, signIn } from './support/ui.ts'

/**
 * The keyboard/touch alternative to dragging: ⋯ → Move to… picks a column
 * and position, and the landing spot is read to the live region (ADR-007).
 * Driven end-to-end by the keyboard — the flow exists so the board is
 * operable without a mouse, so the test proves exactly that.
 */

test('moves a card via the Move to… menu using only the keyboard', async ({ page, context }) => {
  await signIn(context)
  const title = `Menu move ${randomUUID()}`
  await createCard(context.request, title)
  await openBoard(page)

  // Open the ⋯ menu from the keyboard: focus the actions button, press Enter
  // (focus stays on the target), then arrow into the items.
  await boardCard(page, title).getByRole('button', { name: 'Card actions' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: 'Open card' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: 'Move to…' })).toBeFocused()
  await page.keyboard.press('Enter')

  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Move card')

  // Tab through the trap (close button first) into the Column combobox, then
  // drive both selects with arrows + Enter: Intake → ↓↓ → Ready, position
  // stays First (top).
  await page.keyboard.press('Tab')
  await expect(page.getByRole('combobox', { name: 'Column' })).toBeFocused()
  await page.keyboard.press('ArrowDown') // opens the dropdown on Intake
  // Wait for the listbox to actually render before navigating: on a slow CI
  // runner the next ArrowDown can fire before the dropdown is ready and get
  // dropped, landing the highlight on the wrong option.
  await expect(page.getByRole('listbox')).toBeVisible()
  await page.keyboard.press('ArrowDown') // Waiting for Approval
  await page.keyboard.press('ArrowDown') // Ready
  await page.keyboard.press('Enter')
  await expect(page.getByRole('combobox', { name: 'Column' })).toHaveValue('Ready')

  await page.keyboard.press('Tab')
  await expect(page.getByRole('combobox', { name: 'Position' })).toBeFocused()
  await page.keyboard.press('ArrowDown') // opens the dropdown on First (top)
  await expect(page.getByRole('listbox')).toBeVisible()
  await page.keyboard.press('Enter') // confirms First (top)
  await expect(page.getByRole('combobox', { name: 'Position' })).toHaveValue('First (top)')

  await page.keyboard.press('Tab') // Cancel
  await page.keyboard.press('Tab') // Move
  await expect(page.getByRole('button', { name: 'Move', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')

  await expect(laneList(page, 'Ready').getByRole('group', { name: title })).toBeVisible()
  await expect(laneList(page, 'Ready').getByRole('group').first()).toHaveAccessibleName(title)
  // The Pragmatic DnD live region (role=status) carries the announcement.
  await expect(page.getByRole('status')).toContainText(`Card "${title}" moved to Ready, position 1`)
})
