import { randomUUID } from 'node:crypto'
import { devices } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCard } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { boardCard, filterBoard, laneList, openBoard, signIn } from './support/ui.ts'

test.use({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 } })

test('keeps the phone header compact and opens details over the full board width', async ({
  page,
  context,
}) => {
  await signIn(context)
  const title = `Mobile panel ${randomUUID()}`
  await createCard(context.request, title)
  await openBoard(page)
  await filterBoard(page, title)
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 })
    const header = page.getByRole('banner')
    await expect(header.getByRole('heading')).toBeHidden()
    for (const button of await header.getByRole('button').all()) {
      await expect(button).toBeInViewport({ ratio: 1 })
      const box = await button.boundingBox()
      const headerBox = await header.boundingBox()
      expect((box?.y ?? NaN) + (box?.height ?? NaN)).toBeLessThanOrEqual(
        (headerBox?.y ?? NaN) + (headerBox?.height ?? NaN),
      )
    }
    await boardCard(page, title).tap()
    const panel = page.getByRole('dialog')
    await expect(panel.getByLabel('Title')).toHaveValue(title)
    const board = page.getByRole('region', { name: 'Kanban board', includeHidden: true })
    await expect(board).toBeHidden()
    const panelBox = await panel.boundingBox()
    expect(panelBox?.width ?? NaN).toBeGreaterThanOrEqual(width - 34)
    expect(panelBox?.x ?? NaN).toBeGreaterThanOrEqual(0)
    expect((panelBox?.x ?? NaN) + (panelBox?.width ?? NaN)).toBeLessThanOrEqual(width)
    await expect(panel.getByRole('tab', { name: 'History' })).toBeInViewport({ ratio: 1 })
    await page.screenshot({ path: join(tmpdir(), `rivian-mobile-panel-${String(width)}.png`) })
    await panel.getByRole('tab', { name: 'Comments' }).tap()
    await panel.getByRole('tab', { name: 'History' }).tap()
    await panel.getByRole('tab', { name: 'Details', exact: true }).tap()
    await panel.getByLabel('Title').fill(`${title} edited`)
    await panel.getByRole('button', { name: 'Save changes' }).tap()
    await expect(panel.getByRole('button', { name: 'Save changes' })).toHaveAttribute(
      'data-disabled',
      'true',
    )
    await panel.getByLabel('Title').fill(title)
    await panel.getByRole('button', { name: 'Save changes' }).tap()
    await expect(panel.getByRole('button', { name: 'Save changes' })).toHaveAttribute(
      'data-disabled',
      'true',
    )
    await panel.getByRole('button', { name: /Close/ }).tap()
    await expect(board).toBeVisible()
  }
  await boardCard(page, title).getByRole('button', { name: 'Work order actions' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menu')).toBeVisible()
  // The dropdown can become visible before its focus trap takes keyboard focus.
  await expect
    .poll(() => page.getByRole('menu').evaluate((menu) => menu.contains(document.activeElement)))
    .toBe(true)
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: 'Open work order' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toBeFocused()
  await page.keyboard.press('Escape')
  await page.getByRole('banner').getByRole('button', { name: 'New work order' }).tap()
  await expect(page.getByRole('dialog').getByLabel('Title')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).tap()
})

test('swipes cards without moving them', async ({ page, context }) => {
  await signIn(context)
  const title = `Touch move ${randomUUID()}`
  await createCard(context.request, title)
  await openBoard(page)
  await filterBoard(page, title)
  const card = boardCard(page, title)
  await expect(card).toBeVisible()
  const cdp = await context.newCDPSession(page)
  const box = await card.boundingBox()
  const x = (box?.x ?? NaN) + (box?.width ?? NaN) / 2
  const y = (box?.y ?? NaN) + (box?.height ?? NaN) / 2
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  for (let step = 1; step <= 8; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x - step * 15, y }],
    })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect
    .poll(async () => (await laneList(page, 'Intake').boundingBox())?.x ?? NaN)
    .toBeLessThan(0)
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.reload()
  await expect(laneList(page, 'Intake').getByRole('group', { name: title })).toBeVisible()
})

test('moves through the touch menu and cancels incomplete waiting moves', async ({
  page,
  context,
}) => {
  await signIn(context)
  const title = `Touch menu ${randomUUID()}`
  await createCard(context.request, title)
  await openBoard(page)
  const card = boardCard(page, title)
  await card.getByRole('button', { name: 'Work order actions' }).tap()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.getByRole('menuitem', { name: 'Move to…' }).tap()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('combobox', { name: 'Column' }).tap()
  await page.getByRole('option', { name: 'Waiting on Parts / Vendor', exact: true }).tap()
  await expect(dialog.getByRole('button', { name: 'Move', exact: true })).toHaveAttribute(
    'data-disabled',
    'true',
  )
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).tap()
  await expect(laneList(page, 'Intake').getByRole('group', { name: title })).toBeVisible()
  await card.getByRole('button', { name: 'Work order actions' }).tap()
  await page.getByRole('menuitem', { name: 'Move to…' }).tap()
  await dialog.getByRole('combobox', { name: 'Column' }).tap()
  await page.getByRole('option', { name: 'Ready', exact: true }).tap()
  await dialog.getByRole('button', { name: 'Move', exact: true }).tap()
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.reload()
  await expect(laneList(page, 'Ready').getByRole('group', { name: title })).toBeVisible()
})
