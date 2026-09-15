/// <reference lib="dom" />
import { devices } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { expect, test } from './support/fixtures.ts'
import { signIn } from './support/ui.ts'

// Fractional CSS pixels at phone DPR can put a subpixel beyond the scroll viewport.
test.use({ ...devices['Pixel 7'], viewport: { width: 320, height: 844 } })

test('keeps every settings tab and its controls reachable on narrow screens', async ({
  page,
  context,
}) => {
  await signIn(context)
  await page.goto('/settings')
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 })
    for (const name of [
      'Preferences',
      'Boards',
      'Columns',
      'Waiting reasons',
      'Hours',
      'Locations',
      'Users',
      'Groups',
      'Permissions',
      'Service tokens',
    ]) {
      const tab = page.getByRole('tab', { name, exact: true })
      await tab.tap()
      await expect(tab).toHaveAttribute('aria-selected', 'true')
      await expect(tab).toBeInViewport({ ratio: 0.99 })
      const panel = page.getByRole('tabpanel', { name, exact: true })
      await expect(panel).toBeVisible()
      await expect(panel.getByRole('status')).toBeHidden()
      const layout = await panel.evaluate((element) => ({
        pageWidth: document.documentElement.scrollWidth,
        panelWidth: element.clientWidth,
        contentWidth: element.scrollWidth,
        tabRows: new Set(
          [...document.querySelectorAll('[role=tab]')].map((tab) =>
            Math.round(tab.getBoundingClientRect().top),
          ),
        ).size,
      }))
      expect(layout).toMatchObject({
        pageWidth: width,
        contentWidth: layout.panelWidth,
        tabRows: 1,
      })
      // Keyboard focus must reveal controls at the far edge of wide tables, too.
      const lastButton = panel.getByRole('button').last()
      await lastButton.focus()
      await expect(lastButton).toBeInViewport({ ratio: 0.99 })
    }
  }
  await page.setViewportSize({ width: 320, height: 844 })
  for (const [tab, action] of [
    ['Boards', 'Add board'],
    ['Groups', 'Add group'],
    ['Locations', 'Add building'],
    ['Users', 'New user'],
    ['Service tokens', 'New token'],
    ['Permissions', 'Add role'],
  ] as const) {
    await page.getByRole('tab', { name: tab, exact: true }).tap()
    await page.getByRole('button', { name: action, exact: true }).tap()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const dimensions = await dialog.evaluate((el) => ({
      width: el.clientWidth,
      content: el.scrollWidth,
    }))
    expect(dimensions.content).toBe(dimensions.width)
    await dialog.getByRole('textbox').first().fill('Mobile draft')
    await dialog.getByRole('button').last().focus()
    await expect(dialog.getByRole('button').last()).toBeInViewport({ ratio: 0.99 })
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  }
})

test('keeps permission labels above scrolling cells and nested location actions in view', async ({
  page,
  context,
}) => {
  await signIn(context)
  // Arrange a long three-level tree in the isolated test database.
  let parentId: string | null = null
  for (const kind of ['building', 'floor', 'room']) {
    const response = await context.request.post('/api/v1/locations', {
      data: { parentId, kind, name: `${kind}-${randomUUID()}-long-location-name` },
    })
    expect(response.ok()).toBe(true)
    parentId = ((await response.json()) as { id: string }).id
  }
  await page.goto('/settings?tab=locations')
  const tree = page.getByRole('tree')
  await expect(tree).toBeVisible()
  for (const button of await tree.getByRole('button').all()) {
    await button.focus()
    await expect(button).toBeInViewport({ ratio: 0.99 })
  }
  await page.getByRole('tab', { name: 'Permissions', exact: true }).tap()
  const table = page.getByRole('table')
  const label = table.getByRole('cell', { name: 'Create work orders', exact: true })
  await label.scrollIntoViewIfNeeded()
  // Scroll just past a role: its checkbox would previously paint over this label.
  await table.evaluate((el) => {
    const viewport = el.closest('.mantine-ScrollArea-viewport')
    if (viewport) viewport.scrollLeft = 160
  })
  await expect(label).toBeInViewport({ ratio: 0.99 })
  expect(
    await label.evaluate((el) => {
      const box = el.getBoundingClientRect()
      const painted = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      return el.contains(painted) && getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)'
    }),
  ).toBe(true)
  await table.getByRole('button', { name: 'Add role', exact: true }).tap()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
})
