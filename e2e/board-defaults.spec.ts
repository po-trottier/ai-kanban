import { devices } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { boardCatalogSchema, boardSchema, groupSchema, userSchema } from '@rivian-kanban/core'
import { expect, test } from './support/fixtures.ts'
import { newRoleContext, signIn } from './support/ui.ts'

test.use({ ...devices['Pixel 7'], viewport: { width: 320, height: 844 } })

const cleanupPaths: string[] = []

test.afterEach(async ({ context }) => {
  for (const path of cleanupPaths.splice(0)) {
    const response = await context.request.delete(path, {
      headers: { 'X-Requested-With': 'rivian-kanban' },
    })
    expect(response.ok()).toBe(true)
  }
})

test('admins assign global and group defaults and members can override without changing the global badge', async ({
  page,
  context,
  browser,
}) => {
  await signIn(context)
  const member = await newRoleContext(browser, 'user')
  const memberUser = userSchema.parse(await (await member.request.get('/api/v1/auth/me')).json())
  const group = groupSchema.parse(
    await (
      await context.request.post('/api/v1/groups', {
        data: { name: `Crew ${randomUUID()}`, userIds: [memberUser.id] },
      })
    ).json(),
  )
  const name = `Crew board ${randomUUID()}`
  cleanupPaths.push(`/api/v1/groups/${group.id}`)
  const original = boardCatalogSchema
    .parse(await (await context.request.get('/api/v1/boards')).json())
    .items.find((board) => board.isDefault)
  expect(original).toBeDefined()
  const originalName = original?.name ?? ''
  const created = await context.request.post('/api/v1/boards', {
    data: {
      name,
      accessMode: 'restricted',
      allowedRoleKeys: [],
      allowedUserIds: [],
      allowedGroupIds: [group.id],
    },
  })
  const board = boardSchema.parse(await created.json())
  cleanupPaths.unshift(`/api/v1/boards/${board.id}`)
  try {
    await page.goto('/settings?tab=boards')
    await page.getByRole('button', { name: `Edit (${name})`, exact: true }).tap()
    const modal = page.getByRole('dialog')
    await modal.getByRole('checkbox', { name: 'Use as the global default board' }).check()
    await modal.getByRole('combobox', { name: 'Default for groups', exact: true }).fill(group.name)
    await page.getByRole('option', { name: group.name, exact: true }).tap()
    await modal.getByText('Default board assignments', { exact: true }).tap()
    await page.screenshot({ path: join(tmpdir(), 'rivian-board-defaults-admin-mobile.png') })
    await modal.getByRole('button', { name: 'Save', exact: true }).tap()
    await expect(modal).toBeHidden()
    await expect(
      page.getByRole('row').filter({ hasText: name }).getByText('Default', { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('row').filter({ hasText: originalName }).getByText('Default', { exact: true }),
    ).toHaveCount(0)

    const memberPage = await member.newPage()
    await memberPage.setViewportSize({ width: 320, height: 844 })
    await memberPage.goto('/')
    const switcher = memberPage.getByRole('button', { name: /Switch board/ })
    await expect(switcher).toHaveAccessibleName(`Switch board (current: ${name})`)
    await switcher.click()
    await memberPage.getByRole('menuitem', { name: 'Board preferences', exact: true }).click()
    await expect(memberPage.getByRole('tab', { name: 'Boards', selected: true })).toBeVisible()
    await expect(memberPage.getByRole('button', { name: 'Add board', exact: true })).toBeHidden()
    await expect(memberPage.getByRole('button', { name: /^Edit \(/ })).toHaveCount(0)
    await expect(memberPage.getByRole('button', { name: /Archive this board/ })).toHaveCount(0)
    for (const button of await memberPage.getByRole('banner').getByRole('button').all()) {
      await expect(button).toBeInViewport({ ratio: 1 })
    }
    await memberPage.screenshot({ path: join(tmpdir(), 'rivian-board-defaults-member-mobile.png') })
    await memberPage.getByRole('combobox', { name: 'My default board' }).click()
    await memberPage.getByRole('option', { name: originalName, exact: true }).click()
    await expect(
      memberPage.getByText('Default board preference saved', { exact: true }),
    ).toBeVisible()
    await memberPage.reload()
    await expect(switcher).toHaveAccessibleName(`Switch board (current: ${originalName})`)
    await expect(
      memberPage
        .getByRole('row')
        .filter({ hasText: originalName })
        .getByText('Your default', { exact: true }),
    ).toBeVisible()
    await expect(
      memberPage.getByRole('row').filter({ hasText: name }).getByText('Default', { exact: true }),
    ).toBeVisible()
    await memberPage.getByRole('combobox', { name: 'My default board' }).click()
    await memberPage.getByRole('option', { name: 'Use assigned default', exact: true }).click()
    await expect(
      memberPage.getByText('Default board preference saved', { exact: true }),
    ).toBeVisible()
    await memberPage.reload()
    await expect(switcher).toHaveAccessibleName(`Switch board (current: ${name})`)
  } finally {
    await member.close()
  }
})
