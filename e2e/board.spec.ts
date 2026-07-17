import { randomUUID } from 'node:crypto'
import { createCard } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { boardCard, dragTo, laneList, openBoard, relativeOrder, signIn } from './support/ui.ts'

/** The board and real mouse drag-and-drop (Pragmatic DnD, ADR-007). */

const ALL_LANES = [
  'Intake',
  'Waiting for Approval',
  'Ready',
  'In Progress',
  'Waiting on Parts / Vendor',
  'Review',
  'Done',
]

test('renders the seven seeded lanes with the demo cards', async ({ page, context }) => {
  await signIn(context)
  await openBoard(page)

  for (const lane of ALL_LANES) {
    await expect(laneList(page, lane)).toBeVisible()
  }
  await expect(boardCard(page, 'Repair loading-dock leveler')).toBeVisible()
  await expect(boardCard(page, 'Quarterly HVAC filter replacement')).toBeVisible()
})

test('board cards always show estimate, location, tags and attachments (board payload)', async ({
  page,
  context,
}) => {
  await signIn(context)
  await openBoard(page)

  // The seeded HVAC card carries a tag, a location, an estimate, and one
  // attachment — all rendered on the summary card from the board payload.
  const rich = boardCard(page, 'Quarterly HVAC filter replacement')
  // Exact match: the tag chip is exactly "HVAC" (the title also contains it).
  await expect(rich.getByText('HVAC', { exact: true })).toBeVisible()
  await expect(rich.getByText('1d')).toBeVisible() // 480 min = 8h = 1 working day
  await expect(rich.getByLabel('1 attachment')).toBeVisible()

  // A plain card still renders the placeholders, so every card reads the same.
  const plain = boardCard(page, 'Flickering lights in stairwell B')
  await expect(plain.getByText('No location')).toBeVisible()
  await expect(plain.getByText('No estimate')).toBeVisible()
})

test('drags a card across lanes with the mouse and the move persists', async ({
  page,
  context,
}) => {
  await signIn(context)
  const title = `Cross-lane drag ${randomUUID()}`
  await createCard(context.request, title)
  await openBoard(page)
  await expect(laneList(page, 'Intake').getByRole('group', { name: title })).toBeVisible()

  await dragTo(page, boardCard(page, title), laneList(page, 'Ready'), { edge: 'bottom' })

  await expect(laneList(page, 'Ready').getByRole('group', { name: title })).toBeVisible()
  await expect(laneList(page, 'Intake').getByRole('group', { name: title })).toBeHidden()

  await page.reload()
  await expect(laneList(page, 'Ready').getByRole('group', { name: title })).toBeVisible()
})

test('reorders a card within its lane and the order survives a reload', async ({
  page,
  context,
}) => {
  await signIn(context)
  const first = `Reorder A ${randomUUID()}`
  const second = `Reorder B ${randomUUID()}`
  // Appended in creation order: `first` sits above `second` in Intake.
  await createCard(context.request, first)
  await createCard(context.request, second)
  await openBoard(page)

  await dragTo(page, boardCard(page, second), boardCard(page, first), { edge: 'top' })

  const intake = laneList(page, 'Intake')
  await expect.poll(() => relativeOrder(intake, [first, second])).toEqual([second, first])

  await page.reload()
  await expect(laneList(page, 'Intake').getByRole('group', { name: first })).toBeVisible()
  await expect
    .poll(() => relativeOrder(laneList(page, 'Intake'), [first, second]))
    .toEqual([second, first])
})
