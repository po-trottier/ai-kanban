import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createCard, PNG_1X1 } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { signIn } from './support/ui.ts'

/** Attachment round trip: real PNG bytes up, thumbnail, real bytes down, delete. */

test('uploads a PNG via the dropzone input and shows the thumbnail', async ({ page, context }) => {
  await signIn(context)
  const card = await createCard(context.request, `Attach upload ${randomUUID()}`)
  await page.goto(`/cards/${card.id}`)
  await expect(page.getByText('No attachments yet')).toBeVisible()

  await page
    .getByRole('group', { name: 'Attachment dropzone' })
    .locator('input[type="file"]')
    .setInputFiles({ name: 'before-photo.png', mimeType: 'image/png', buffer: PNG_1X1 })

  await expect(page.getByRole('img', { name: 'before-photo.png' })).toBeVisible()
  await expect(page.getByText('No attachments yet')).toBeHidden()
})

test('downloads the exact uploaded bytes and deletes the attachment', async ({ page, context }) => {
  await signIn(context)
  const card = await createCard(context.request, `Attach download ${randomUUID()}`)
  await page.goto(`/cards/${card.id}`)
  await page
    .getByRole('group', { name: 'Attachment dropzone' })
    .locator('input[type="file"]')
    .setInputFiles({ name: 'evidence.png', mimeType: 'image/png', buffer: PNG_1X1 })
  await expect(page.getByRole('img', { name: 'evidence.png' })).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('link', { name: 'evidence.png' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('evidence.png')
  const bytes = readFileSync(await download.path())
  expect(bytes.equals(PNG_1X1)).toBe(true)

  await page.getByRole('button', { name: 'Delete evidence.png' }).click()
  await expect(page.getByRole('img', { name: 'evidence.png' })).toBeHidden()
  await expect(page.getByText('No attachments yet')).toBeVisible()
})
