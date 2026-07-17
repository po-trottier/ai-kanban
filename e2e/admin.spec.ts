import { type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { expect, test } from './support/fixtures.ts'
import { laneList, openBoard, signIn } from './support/ui.ts'

/** Admin settings: users, lane WIP limits, the location tree, service tokens. */

async function openSettingsTab(page: Page, tab: string): Promise<void> {
  await page.goto('/settings')
  await page.getByRole('tab', { name: tab }).click()
}

test('creates a user and reveals the one-time temporary password', async ({ page, context }) => {
  await signIn(context)
  await openSettingsTab(page, 'Users')

  await page.getByRole('button', { name: 'New user' }).click()
  const modal = page.getByRole('dialog')
  await modal.getByLabel('Display name').fill(`E2E Created ${randomUUID().slice(0, 8)}`)
  await modal.getByLabel('Email').fill(`created-${randomUUID()}@e2e.example`)
  await modal.getByRole('button', { name: 'Create', exact: true }).click()

  const reveal = page.getByRole('dialog')
  await expect(reveal).toContainText('One-time temporary password')
  await expect(reveal).toContainText('shown only once')
  await expect(reveal.getByText(/^[\w-]{16}$/)).toBeVisible()
})

test('editing a lane WIP limit reflects on the board badge', async ({ page, context }) => {
  await signIn(context)
  await openSettingsTab(page, 'Columns')

  // Unique-ish per run so the field is dirty even against a reused local server.
  const limit = String((Date.now() % 89) + 11)
  await page.getByLabel('WIP limit (waiting_approval)').fill(limit)
  await page
    .getByLabel('Column Waiting for Approval')
    .getByRole('button', { name: 'Save', exact: true })
    .click()
  await expect(page.getByText('Column updated')).toBeVisible()

  await openBoard(page)
  const lane = page.locator('section', { has: laneList(page, 'Waiting for Approval') })
  await expect(lane.getByText(new RegExp(`^\\d+/${limit}$`))).toBeVisible()
})

test('adds a building to the location tree', async ({ page, context }) => {
  await signIn(context)
  await openSettingsTab(page, 'Locations')

  const name = `Warehouse ${randomUUID().slice(0, 8)}`
  await page.getByRole('button', { name: 'Add building' }).click()
  const modal = page.getByRole('dialog')
  await expect(modal).toContainText('Add location')
  await modal.getByLabel('Name', { exact: true }).fill(name)
  await modal.getByRole('button', { name: 'Save', exact: true }).click()

  await expect(page.getByRole('tree').getByText(name)).toBeVisible()
})

test('creates a service token whose raw rkb_ value is shown exactly once', async ({
  page,
  context,
}) => {
  await signIn(context)
  await openSettingsTab(page, 'Service tokens')

  const name = `e2e-token-${randomUUID().slice(0, 8)}`
  await page.getByRole('button', { name: 'New token' }).click()
  const modal = page.getByRole('dialog')
  await expect(modal).toContainText('Create service token')
  await modal.getByLabel('Name', { exact: true }).fill(name)
  await modal.getByRole('button', { name: 'Create', exact: true }).click()

  const reveal = page.getByRole('dialog')
  await expect(reveal).toContainText('Service token created')
  await expect(reveal).toContainText('shown only once')
  await expect(reveal.getByText(/^rkb_[\w-]+$/)).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
  // Listed with its revoke affordance; the raw value is gone for good.
  const row = page.getByRole('row').filter({ hasText: name })
  await expect(row).toBeVisible()
  await expect(row.getByRole('button', { name: 'Revoke' })).toBeVisible()
  await expect(page.getByText(/^rkb_[\w-]+$/)).toBeHidden()
})
