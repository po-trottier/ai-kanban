import { randomUUID } from 'node:crypto'
import { apiLogin, createCard, setTransitionEnforcement } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import {
  boardCard,
  dragTo,
  laneList,
  newRoleContext,
  openBoard,
  openCardMenu,
  select,
  signIn,
} from './support/ui.ts'

/**
 * The admin policy toggle changes another session's drag/move affordances
 * LIVE via SSE (ADR-008/ADR-013): no reload, options tighten, illegal drop
 * targets refuse the card.
 */

// The suite's other specs assume the seeded permissive posture — restore it
// even when an assertion fails mid-test.
test.afterEach(async ({ request }) => {
  await apiLogin(request)
  await setTransitionEnforcement(request, false)
})

test('enabling enforcement tightens a technician session live, without reload', async ({
  page,
  context,
  browser,
}) => {
  await signIn(context) // the admin session
  const title = `Policy ${randomUUID()}`
  await createCard(context.request, title)

  const techContext = await newRoleContext(browser, 'technician')
  const techPage = await techContext.newPage()
  await openBoard(techPage)

  // Permissive default: Done is a legal target from Intake.
  await openCardMenu(techPage, title, 'Move to…')
  await select(techPage, 'Column').click()
  await expect(techPage.getByRole('option', { name: 'Done' })).not.toHaveAttribute(
    'data-combobox-disabled',
    'true',
  )
  await techPage.keyboard.press('Escape') // close the dropdown…
  await techPage.keyboard.press('Escape') // …and the modal
  await expect(techPage.getByRole('dialog')).toBeHidden()

  // The admin flips enforcement on through the real settings UI.
  await page.goto('/settings')
  await page.getByRole('tab', { name: 'Permissions' }).click()
  await page.getByLabel('Enforce workflow transitions').check()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Policy updated')).toBeVisible()

  // The technician's affordances tighten live (SSE policy hint, no reload):
  // from Intake only Intake → Waiting for Approval remains on the graph.
  await openCardMenu(techPage, title, 'Move to…')
  await select(techPage, 'Column').click()
  await expect(techPage.getByRole('option', { name: 'Done' })).toHaveAttribute(
    'data-combobox-disabled',
    'true',
  )
  await expect(techPage.getByRole('option', { name: 'Ready', exact: true })).toHaveAttribute(
    'data-combobox-disabled',
    'true',
  )
  await expect(techPage.getByRole('option', { name: 'Waiting for Approval' })).not.toHaveAttribute(
    'data-combobox-disabled',
    'true',
  )
  await techPage.keyboard.press('Escape')
  await techPage.keyboard.press('Escape')
  await expect(techPage.getByRole('dialog')).toBeHidden()

  // An illegal drop target refuses the card outright: nothing moves.
  await dragTo(techPage, boardCard(techPage, title), laneList(techPage, 'Done'), {
    edge: 'bottom',
  })
  await expect(laneList(techPage, 'Intake').getByRole('group', { name: title })).toBeVisible()
  await expect(laneList(techPage, 'Done').getByRole('group', { name: title })).toBeHidden()

  // Positive control in the same session: the still-legal Intake → Waiting
  // for Approval drag lands, proving the refusal above was policy, not a
  // drag that never engaged.
  await dragTo(techPage, boardCard(techPage, title), laneList(techPage, 'Waiting for Approval'), {
    edge: 'bottom',
  })
  await expect(
    laneList(techPage, 'Waiting for Approval').getByRole('group', { name: title }),
  ).toBeVisible()
  await expect(laneList(techPage, 'Intake').getByRole('group', { name: title })).toBeHidden()

  await techContext.close()
})
