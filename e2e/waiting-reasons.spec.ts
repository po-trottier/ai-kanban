import { randomUUID } from 'node:crypto'
import { type PolicyDocument } from '@rivian-kanban/core'
import { createCard } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { boardCard, openBoard, openCardMenu, signIn } from './support/ui.ts'

test('admins configure waiting reasons, and cards retain renamed and removed choices', async ({
  page,
  context,
}) => {
  await signIn(context)
  const response = await context.request.get('/api/v1/policy')
  expect(response.ok()).toBe(true)
  const original = (await response.json()) as { config: PolicyDocument }
  const name = `Inspection ${randomUUID().slice(0, 8)}`
  const renamed = `${name} approved`
  const title = `Waiting settings ${randomUUID()}`
  await createCard(context.request, title)
  try {
    await page.goto('/settings?tab=waiting-reasons')
    await page.setViewportSize({ width: 390, height: 844 })
    for (const label of ['Parts', 'Vendor', 'Access', 'Information', 'Funding']) {
      await expect(
        page.getByRole('textbox', { name: `Reason name (${label})`, exact: true }),
      ).toHaveValue(label)
    }
    await page.getByRole('button', { name: 'Add reason', exact: true }).click()
    await page.getByRole('textbox', { name: 'Reason name (New reason)', exact: true }).fill(name)
    await page.getByRole('button', { name: 'Save reasons', exact: true }).click()
    await expect(page.getByText('Policy updated', { exact: true })).toBeVisible()
    await page.reload()
    await expect(
      page.getByRole('textbox', { name: `Reason name (${name})`, exact: true }),
    ).toHaveValue(name)

    await openBoard(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await openCardMenu(page, title, 'Move to…')
    const modal = page.getByRole('dialog')
    await modal.getByRole('combobox', { name: 'Column', exact: true }).click()
    await page.getByRole('option', { name: 'Waiting on Parts / Vendor', exact: true }).click()
    await modal.getByRole('combobox', { name: 'Waiting reason', exact: true }).click()
    await page.getByRole('option', { name, exact: true }).click()
    await modal.getByRole('button', { name: 'Expected resume date', exact: true }).click()
    const today = new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date())
    await page.getByRole('button', { name: today, exact: true }).first().click()
    await modal.getByRole('button', { name: 'Move', exact: true }).click()
    await expect(modal).toBeHidden()
    await expect(boardCard(page, title)).toContainText(name)

    await page.goto('/settings?tab=waiting-reasons')
    await page.getByRole('textbox', { name: `Reason name (${name})`, exact: true }).fill(renamed)
    await page.getByRole('button', { name: 'Save reasons', exact: true }).click()
    await expect(page.getByText('Policy updated', { exact: true })).toBeVisible()
    await openBoard(page)
    await expect(boardCard(page, title)).toContainText(renamed)

    await page.goto('/settings?tab=waiting-reasons')
    await page.getByRole('button', { name: `Remove reason (${renamed})`, exact: true }).click()
    await page.getByRole('button', { name: 'Save reasons', exact: true }).click()
    await expect(page.getByText('Policy updated', { exact: true })).toBeVisible()
    await page.reload()
    await expect(
      page.getByRole('textbox', { name: `Reason name (${renamed})`, exact: true }),
    ).toBeHidden()
    await openBoard(page)
    await expect(boardCard(page, title)).toContainText(renamed)
    await boardCard(page, title).click()
    const panel = page.getByRole('dialog')
    await expect(panel.getByRole('combobox', { name: 'Waiting reason', exact: true })).toHaveValue(
      renamed,
    )
    await panel.getByRole('combobox', { name: 'Waiting reason', exact: true }).click()
    await page.getByRole('option', { name: 'Vendor', exact: true }).click()
    await panel.getByRole('button', { name: 'Save', exact: true }).first().click()
    await page.reload()
    await expect(
      page.getByRole('dialog').getByRole('combobox', { name: 'Waiting reason', exact: true }),
    ).toHaveValue('Vendor')
    await page
      .getByRole('dialog')
      .getByRole('combobox', { name: 'Waiting reason', exact: true })
      .click()
    await expect(page.getByRole('option', { name: renamed, exact: true })).toBeHidden()
  } finally {
    const restored = await context.request.put('/api/v1/policy', { data: original.config })
    expect(restored.ok()).toBe(true)
  }
})

test('ordinary users cannot configure waiting reasons', async ({ page, context }) => {
  await signIn(context, 'user')
  await page.goto('/settings?tab=waiting-reasons')
  await expect(page.getByRole('tab', { name: 'Preferences', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Waiting reasons', exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Add reason', exact: true })).toBeHidden()
  const current = await context.request.get('/api/v1/policy')
  const record = (await current.json()) as { config: PolicyDocument }
  const denied = await context.request.put('/api/v1/policy', { data: record.config })
  expect(denied.status()).toBe(403)
})
