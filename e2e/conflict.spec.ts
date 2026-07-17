import { randomUUID } from 'node:crypto'
import { createCard } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import {
  boardCard,
  laneList,
  newRoleContext,
  openBoard,
  openCardMenu,
  selectOption,
  signIn,
} from './support/ui.ts'

/**
 * Optimistic locking across two real browser sessions (ADR-012): B holds a
 * stale version in an open Move modal while A edits the card; B's move is
 * rejected with 409, rolled back, and toasted — never silently overwritten.
 */

test('a stale move from a second session is rolled back with the conflict toast', async ({
  page,
  context,
  browser,
}) => {
  await signIn(context) // session A: the demo admin
  const title = `Conflict ${randomUUID()}`
  const card = await createCard(context.request, title)

  const contextB = await newRoleContext(browser, 'technician') // session B: a different real user
  const pageB = await contextB.newPage()
  await openBoard(pageB)

  // B opens Move to… — the modal captures the card version as of NOW.
  await openCardMenu(pageB, title, 'Move to…')
  await expect(pageB.getByRole('dialog')).toContainText('Move card')

  // Meanwhile A edits the card, bumping its version.
  const editedTitle = `${title} (A got here first)`
  await page.goto(`/cards/${card.id}`)
  await page.getByLabel('Title').fill(editedTitle)
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Card updated')).toBeVisible()

  // B's move now carries a stale If-Match → 409 → rollback + calm toast.
  await selectOption(pageB, 'Column', 'Ready')
  await pageB.getByRole('button', { name: 'Move', exact: true }).click()
  await expect(
    pageB.getByText('This card was just updated by someone else — the board has been refreshed.'),
  ).toBeVisible()

  // Rolled back and refreshed: still in Intake, now under A's title.
  await expect(laneList(pageB, 'Intake').getByRole('group', { name: editedTitle })).toBeVisible()
  await expect(laneList(pageB, 'Ready').getByRole('group', { name: editedTitle })).toBeHidden()
  await expect(boardCard(pageB, title)).toBeHidden()

  await contextB.close()
})
