import { type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiLogin, createUser } from './support/api.ts'
import { DEMO_PASSWORD, demoEmail } from './support/constants.ts'
import { expect, test } from './support/fixtures.ts'

/** Login/logout and the must-change-password interstitial (guide.md, ADR-009). */

async function fillLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test('rejects bad credentials with the uniform authentication error', async ({ page }) => {
  await fillLogin(page, `nobody-${randomUUID()}@e2e.example`, 'definitely-not-the-password')

  // A 401 is mapped to friendly, specific copy rather than the raw problem title.
  await expect(page.getByRole('alert')).toContainText('That email or password is not correct.')
  await expect(page).toHaveURL(/\/login$/)
})

test('signs in the demo admin and shows the seeded board', async ({ page }) => {
  await fillLogin(page, demoEmail('admin'), DEMO_PASSWORD)

  await expect(page.getByRole('region', { name: 'Kanban board' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Cards in Intake' })).toBeVisible()
})

test('logs out via the user menu and the session is really revoked', async ({ page }) => {
  await fillLogin(page, demoEmail('admin'), DEMO_PASSWORD)
  await expect(page.getByRole('region', { name: 'Kanban board' })).toBeVisible()

  await page.getByRole('button', { name: 'Demo Admin' }).click()
  await page.getByRole('menuitem', { name: 'Log out' }).click()
  await expect(page).toHaveURL(/\/login$/)

  // Server-side revocation: a fresh navigation cannot resurrect the session.
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
})

test('routes a fresh admin-created user through the change-password interstitial', async ({
  page,
  request,
}) => {
  // Arrange through the REST API (never the UI): the admin creates the user.
  await apiLogin(request)
  const email = `interstitial-${randomUUID()}@e2e.example`
  const created = await createUser(request, {
    email,
    displayName: 'Interstitial User',
    role: 'technician',
  })

  await fillLogin(page, email, created.tempPassword)
  await expect(page.getByRole('heading', { name: 'Change your password' })).toBeVisible()

  const newPassword = `fresh-${randomUUID()}`
  await page.getByLabel('Current password').fill(created.tempPassword)
  await page.getByLabel('New password', { exact: true }).fill(newPassword)
  await page.getByLabel('Confirm new password').fill(newPassword)
  await page.getByRole('button', { name: 'Change password' }).click()

  await expect(page.getByRole('region', { name: 'Kanban board' })).toBeVisible()
})
