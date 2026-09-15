import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type APIRequestContext } from '@playwright/test'
import { newRoleContext, openBoard, signIn } from './support/ui.ts'
import { expect, test } from './support/fixtures.ts'

/** Header selection, board access, settings management, and phone layout. */

/** Creates the board used by these browser scenarios. */
async function createBoard(
  request: APIRequestContext,
  name: string,
  extras: Record<string, unknown> = {},
): Promise<{ id: string; name: string }> {
  const response = await request.post('/api/v1/boards', {
    data: { name, accessMode: 'all', allowedRoleKeys: [], allowedUserIds: [], ...extras },
  })
  if (!response.ok()) {
    throw new Error(`create board failed (${String(response.status())}): ${await response.text()}`)
  }
  return (await response.json()) as { id: string; name: string }
}

async function createCard(
  request: APIRequestContext,
  title: string,
  boardId: string,
): Promise<{ id: number }> {
  const response = await request.post('/api/v1/cards', {
    headers: { 'X-Board-Id': boardId },
    data: { title },
  })
  if (!response.ok()) throw new Error(await response.text())
  return (await response.json()) as { id: number }
}

async function deleteBoard(request: APIRequestContext, boardId: string): Promise<void> {
  const response = await request.delete(`/api/v1/boards/${boardId}`, {
    headers: { 'X-Requested-With': 'rivian-kanban' },
  })
  if (!response.ok()) throw new Error(await response.text())
}

test.describe('multiple boards', () => {
  test('switches between two boards from the header, isolating each board’s cards', async ({
    page,
    context,
  }) => {
    await signIn(context)
    const second = await createBoard(context.request, `Warehouse ${randomUUID()}`)
    const catalog = (await (await context.request.get('/api/v1/boards')).json()) as {
      items: { id: string; name: string; isDefault: boolean }[]
    }
    const original = catalog.items.find((board) => board.isDefault)
    expect(original).toBeDefined()
    const originalName = original?.name ?? ''
    const onlyOnSecond = `Second-board card ${randomUUID()}`
    await createCard(context.request, onlyOnSecond, second.id)

    await openBoard(page)
    const switcher = page.getByRole('button', { name: /Switch board/ })
    await expect(switcher).toBeVisible()
    await expect(page).toHaveTitle(`Rivian ${originalName} Tickets System`)

    // The default board's switcher does not show the other board's card.
    await expect(page.getByRole('group', { name: onlyOnSecond })).toHaveCount(0)

    // Switching resets the URL to '/' and shows the second board's own card.
    await switcher.click()
    await page.getByRole('menuitem', { name: second.name }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('group', { name: onlyOnSecond })).toBeVisible()
    await expect(page).toHaveTitle(`Rivian ${second.name} Tickets System`)
    await page.getByRole('group', { name: onlyOnSecond }).click()
    await expect(page.getByRole('dialog', { name: /Work order details/ })).toBeVisible()
    await switcher.click()
    await page.getByRole('menuitem', { name: originalName, exact: true }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('dialog', { name: /Work order details/ })).toHaveCount(0)
    await expect(page).toHaveTitle(`Rivian ${originalName} Tickets System`)
    await expect(page.getByRole('group', { name: onlyOnSecond })).toHaveCount(0)

    await deleteBoard(context.request, second.id)
  })

  test('an admin creates, edits, and deletes a board from Settings → Boards', async ({
    page,
    context,
  }) => {
    await signIn(context)
    const name = `Loading dock ${randomUUID()}`
    const renamed = `${name} (renamed)`

    await page.goto('/settings?tab=boards')
    await expect(page.getByRole('tab', { name: 'Boards', selected: true })).toBeVisible()

    await page.getByRole('button', { name: 'Add board' }).click()
    await page.getByRole('textbox', { name: 'Name' }).fill(name)
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible()

    await page
      .getByRole('row')
      .filter({ hasText: name })
      .getByRole('button', { name: /^Edit/ })
      .click()
    await page.getByRole('textbox', { name: 'Name' }).fill(renamed)
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('row').filter({ hasText: renamed })).toBeVisible()

    await page
      .getByRole('row')
      .filter({ hasText: renamed })
      .getByRole('button', { name: 'Archive this board — its work orders and history are kept' })
      .click()
    await page.getByRole('button', { name: 'Delete board' }).click()
    await expect(page.getByRole('row').filter({ hasText: renamed })).toHaveCount(0)
  })

  test('non-admins can reach board preferences without board management controls', async ({
    page,
    context,
  }) => {
    await signIn(context, 'user')
    await openBoard(page)

    await page.getByRole('button', { name: /Switch board/ }).click()
    await expect(page.getByRole('menuitem', { name: 'Manage boards' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await page.goto('/settings')
    await page.getByRole('tab', { name: 'Boards', exact: true }).click()
    await expect(page.getByRole('combobox', { name: 'My default board' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add board', exact: true })).toHaveCount(0)
  })

  test('an ordinary user only sees boards their role or account is allowed on', async ({
    context,
    browser,
  }) => {
    await signIn(context)
    const restricted = await createBoard(context.request, `Admin-only ${randomUUID()}`, {
      accessMode: 'restricted',
      allowedRoleKeys: [],
      allowedUserIds: [],
    })

    const userContext = await newRoleContext(browser, 'user')
    const userPage = await userContext.newPage()
    await openBoard(userPage)
    await userPage.getByRole('button', { name: /Switch board/ }).click()
    await expect(userPage.getByRole('menuitem', { name: restricted.name })).toHaveCount(0)
    await userContext.close()

    await deleteBoard(context.request, restricted.id)
  })

  test('a direct /cards/:id link resolves the card’s OWN board, not the currently selected one', async ({
    page,
    context,
  }) => {
    await signIn(context)
    const second = await createBoard(context.request, `Annex ${randomUUID()}`)
    const title = `Deep-linked card ${randomUUID()}`
    const card = await createCard(context.request, title, second.id)

    // Land on the default board first (nothing selects the second board yet).
    await openBoard(page)
    await page.goto(`/cards/${String(card.id)}`)

    const panel = page.getByRole('dialog')
    await expect(panel.getByLabel('Title')).toHaveValue(title)
    // The switcher follows the card to its real board rather than staying on
    // whatever was selected before the deep link.
    await expect(page.getByRole('button', { name: new RegExp(second.name) })).toBeVisible()

    await deleteBoard(context.request, second.id)
  })

  test('the board switcher stays usable at 320/390/768 alongside the other header controls', async ({
    page,
    context,
  }) => {
    await signIn(context)
    await openBoard(page)
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 })
      const header = page.getByRole('banner')
      const switcher = header.getByRole('button', { name: /Switch board/ })
      await expect(switcher).toBeInViewport({ ratio: 1 })
      for (const button of await header.getByRole('button').all()) {
        await expect(button).toBeInViewport({ ratio: 1 })
      }
    }
  })
})

test('admins manage groups and a group membership grants access to a board', async ({
  page,
  context,
  browser,
}) => {
  await signIn(context)
  await page.setViewportSize({ width: 390, height: 844 })
  const name = `Maintainers ${randomUUID()}`
  await page.goto('/settings?tab=groups')
  await page.getByRole('button', { name: 'Add group' }).click()
  await page.getByRole('textbox', { name: 'Name' }).fill(name)
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible()
  const groups = (await (await context.request.get('/api/v1/groups')).json()) as {
    id: string
    name: string
  }[]
  const group = groups.find((item) => item.name === name)
  expect(group).toBeDefined()
  const groupId = group?.id ?? ''
  const board = await createBoard(context.request, `Group board ${randomUUID()}`, {
    accessMode: 'restricted',
  })
  const memberContext = await newRoleContext(browser, 'user')
  const memberPage = await memberContext.newPage()
  await openBoard(memberPage)
  await memberPage.getByRole('button', { name: /Switch board/ }).click()
  await expect(memberPage.getByRole('menuitem', { name: board.name })).toHaveCount(0)
  await page
    .getByRole('row')
    .filter({ hasText: name })
    .getByRole('button', { name: /^Edit/ })
    .click()
  await page.getByRole('combobox', { name: 'Members' }).fill('Demo User')
  await page.getByRole('option', { name: /Demo User/ }).click()
  await page.getByRole('textbox', { name: 'Name', exact: true }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.screenshot({ path: join(tmpdir(), 'rivian-groups-mobile.png') })
  await page.goto('/settings?tab=boards')
  await page
    .getByRole('row')
    .filter({ hasText: board.name })
    .getByRole('button', { name: /^Edit/ })
    .click()
  await page.getByRole('combobox', { name: 'Groups', exact: true }).press('ArrowDown')
  await page.getByRole('option', { name, exact: true }).click()
  await page.getByRole('textbox', { name: 'Name', exact: true }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(memberPage.getByRole('menuitem', { name: board.name })).toBeVisible()
  const revoke = await context.request.put(`/api/v1/groups/${groupId}`, {
    data: { name, userIds: [] },
  })
  expect(revoke.ok()).toBe(true)
  await expect(memberPage.getByRole('menuitem', { name: board.name })).toHaveCount(0)
  await memberContext.close()
  await deleteBoard(context.request, board.id)
  await page.goto('/settings?tab=groups')
  await page
    .getByRole('row')
    .filter({ hasText: name })
    .getByRole('button', { name: /Delete/ })
    .click()
  await page.getByRole('button', { name: 'Delete group', exact: true }).click()
  await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(0)
})
