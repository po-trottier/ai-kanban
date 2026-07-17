import { type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createCard } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { signIn } from './support/ui.ts'

/** Threaded comments: add, reply, edit-own, delete-leaves-placeholder. */

async function openComments(page: Page, cardId: string): Promise<void> {
  await page.goto(`/cards/${cardId}`)
  await page.getByRole('tab', { name: 'Comments' }).click()
}

test('adds a comment to the thread', async ({ page, context }) => {
  await signIn(context)
  const card = await createCard(context.request, `Comments add ${randomUUID()}`)
  await openComments(page, card.id)
  await expect(page.getByText('No comments yet')).toBeVisible()

  const body = `First comment ${randomUUID()}`
  await page.getByLabel('Add a comment').fill(body)
  await page.getByRole('button', { name: 'Comment', exact: true }).click()

  await expect(page.getByRole('article').filter({ hasText: body })).toBeVisible()
  await expect(page.getByRole('article').filter({ hasText: body })).toContainText('Demo Admin')
  // The composer clears only after the POST succeeded.
  await expect(page.getByLabel('Add a comment')).toHaveValue('')
})

test('replies nest under the parent comment', async ({ page, context }) => {
  await signIn(context)
  const card = await createCard(context.request, `Comments reply ${randomUUID()}`)
  const parentBody = `Parent A ${randomUUID()}`
  const laterTopLevelBody = `Top-level C ${randomUUID()}`
  const replyBody = `Reply B ${randomUUID()}`
  await openComments(page, card.id)

  // Two top-level comments first (A then C), then a reply B to A. Threaded
  // rendering yields document order A, B, C; a regression to a flat
  // createdAt-ordered list would render A, C, B instead.
  await page.getByLabel('Add a comment').fill(parentBody)
  await page.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(page.getByRole('article').filter({ hasText: parentBody })).toBeVisible()

  await page.getByLabel('Add a comment').fill(laterTopLevelBody)
  await page.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(page.getByRole('article').filter({ hasText: laterTopLevelBody })).toBeVisible()

  await page
    .getByRole('article')
    .filter({ hasText: parentBody })
    .getByRole('button', { name: 'Reply', exact: true })
    .click()
  await page.getByLabel('Reply', { exact: true }).fill(replyBody)
  await page.getByRole('button', { name: 'Post reply' }).click()

  const articles = page.getByRole('tabpanel').getByRole('article')
  await expect(articles).toHaveCount(3)
  await expect(articles.nth(0)).toContainText(parentBody)
  await expect(articles.nth(1)).toContainText(replyBody)
  await expect(articles.nth(2)).toContainText(laterTopLevelBody)
})

test('edits an own comment in place', async ({ page, context }) => {
  await signIn(context)
  const card = await createCard(context.request, `Comments edit ${randomUUID()}`)
  const body = `Before edit ${randomUUID()}`
  const editedBody = `After edit ${randomUUID()}`
  await openComments(page, card.id)

  await page.getByLabel('Add a comment').fill(body)
  await page.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(page.getByRole('article').filter({ hasText: body })).toBeVisible()

  await page.getByRole('button', { name: 'Edit comment' }).click()
  await page.getByLabel('Edit comment').fill(editedBody)
  await page.getByRole('button', { name: 'Save', exact: true }).click()

  await expect(page.getByRole('article').filter({ hasText: editedBody })).toBeVisible()
  await expect(page.getByText(body)).toBeHidden()
})

test('deleting a comment leaves a placeholder that keeps replies in context', async ({
  page,
  context,
}) => {
  await signIn(context)
  const card = await createCard(context.request, `Comments delete ${randomUUID()}`)
  const parentBody = `Doomed parent ${randomUUID()}`
  const replyBody = `Surviving reply ${randomUUID()}`

  // Arrange the thread through the REST API, then interact via the browser.
  const parentResponse = await context.request.post(`/api/v1/cards/${card.id}/comments`, {
    data: { body: parentBody },
  })
  const parent = (await parentResponse.json()) as { id: string }
  await context.request.post(`/api/v1/cards/${card.id}/comments`, {
    data: { body: replyBody, parentCommentId: parent.id },
  })

  await openComments(page, card.id)
  await page
    .getByRole('article')
    .filter({ hasText: parentBody })
    .getByRole('button', { name: 'Delete comment' })
    .click()

  await expect(page.getByText('(deleted)')).toBeVisible()
  await expect(page.getByText(parentBody)).toBeHidden()
  await expect(page.getByRole('article').filter({ hasText: replyBody })).toBeVisible()
})
